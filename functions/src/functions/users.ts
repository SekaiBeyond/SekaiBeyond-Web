import { HttpsError, onCall } from "firebase-functions/v2/https";
import { onDocumentDeleted } from "firebase-functions/v2/firestore";
import { getDownloadURL, getStorage } from "firebase-admin/storage";
import { getAuth } from "firebase-admin/auth";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import {
    ADMIN_GROUPS,
    adminTransaction,
    checkRateLimit,
    isValidGroup,
    MANAGEABLE_GROUPS,
    normalizeGroup,
    requireAuth,
} from "../utils/auth";
import { deletionExpiresAt, recordExpiresAt } from "../utils/config";
import { extendedExpiry, isMembershipActive, MAX_GRANT_DAYS } from "../utils/membership";
import { db } from "../utils/firebase";
import { detectImageMime, MAX_UPLOAD_SIZE, MAX_UPLOAD_SIZE_MB } from "../utils/storage";
import { sanitizeDisplayText, validateDocId, validateISODate } from "../utils/validation";

export const createUserProfile = onCall({maxInstances: 20}, async (request) => {
    if (!request.auth) {
        throw new HttpsError("unauthenticated", "Must be signed in.");
    }

    const uid = request.auth.uid;
    await checkRateLimit(uid);

    // ID tokens outlive account deletion by up to an hour, so a deleted user's
    // client (AuthProvider auto-creates missing profiles) could resurrect the
    // doc after onUserDeleted ran. Only Auth itself knows the account is gone.
    try {
        await getAuth().getUser(uid);
    } catch (err: unknown) {
        if ((err as {code?: string})?.code === "auth/user-not-found") {
            throw new HttpsError("failed-precondition", "Account has been deleted.");
        }
        throw err;
    }

    const userRef = db.collection("users").doc(uid);

    const rawName = request.auth.token.name ?? "";
    const email = request.auth.token.email ?? "";
    const photoURL = request.auth.token.picture ?? "";

    const displayName = sanitizeDisplayText(typeof rawName === "string" ? rawName : "").slice(0, 50);

    let alreadyExists = false;

    await db.runTransaction(async (txn) => {
        const snap = await txn.get(userRef);
        if (snap.exists) {
            alreadyExists = true;
            return;
        }
        txn.set(userRef, {
            displayName,
            email,
            photoURL: photoURL.slice(0, 500),
            joinedAt: FieldValue.serverTimestamp(),
            attendedEvents: [],
            badges: [],
            group: "user",
            eventStaffEvents: [],
        });
    });

    return {alreadyExists};
});
export const getPublicProfile = onCall({maxInstances: 20}, async (request) => {
    if (!request.auth) {
        throw new HttpsError("unauthenticated", "Must be signed in.");
    }

    await checkRateLimit(request.auth.uid);

    const targetUid = validateDocId((request.data as {uid?: string})?.uid, "uid");
    const userSnap = await db.collection("users").doc(targetUid).get();
    if (!userSnap.exists) {
        throw new HttpsError("not-found", "User not found.");
    }

    const data = userSnap.data()!;
    const rawEarnedAt = (data.badgeEarnedAt ?? {}) as Record<string, Timestamp>;
    const badgeEarnedAt: Record<string, string> = {};
    for (const [k, v] of Object.entries(rawEarnedAt)) {
        const iso = v?.toDate?.()?.toISOString();
        if (iso) badgeEarnedAt[k] = iso;
    }

    // Restrict eventStaffEvents to past events only — upcoming-event ids would
    // leak unpublished events whose titles are otherwise gated by Firestore rules.
    const rawStaffEvents: string[] = data.eventStaffEvents ?? [];
    const eventStaffEvents: string[] = [];
    if (rawStaffEvents.length > 0) {
        const refs = rawStaffEvents.map(id => db.collection("pastEvents").doc(id));
        const snaps = await db.getAll(...refs);
        for (let i = 0; i < snaps.length; i++) {
            if (snaps[i].exists) eventStaffEvents.push(rawStaffEvents[i]);
        }
    }

    return {
        displayName: data.displayName ?? "",
        photoURL: data.photoURL ?? "",
        joinedAt: data.joinedAt?.toDate?.()?.toISOString() ?? new Date().toISOString(),
        attendedEvents: data.attendedEvents ?? [],
        eventStaffEvents,
        badges: data.badges ?? [],
        badgeEarnedAt,
        group: normalizeGroup(data.group),
        // Only the membership's existence is public — the expiry date is the
        // owner's business and stays on their own profile.
        isMember: isMembershipActive(data),
        title: data.title ?? "",
        titleCn: data.titleCn ?? "",
    };
});

interface ProfileTarget {
    targetUid: string;
    isSelf: boolean;
    targetData: FirebaseFirestore.DocumentData;
    callerName: string;
}

// Resolves whose profile an edit applies to. Editing your own is always allowed;
// editing someone else's requires admin rights over their group.
async function resolveProfileTarget(callerUid: string, rawTargetUid: unknown): Promise<ProfileTarget> {
    const targetUid = rawTargetUid === undefined || rawTargetUid === null
        ? callerUid
        : validateDocId(rawTargetUid, "targetUid");
    const isSelf = targetUid === callerUid;

    const callerSnap = await db.collection("users").doc(callerUid).get();
    const targetSnap = isSelf ? callerSnap : await db.collection("users").doc(targetUid).get();
    if (!targetSnap.exists) {
        throw new HttpsError("not-found", "User not found.");
    }

    if (!isSelf) {
        const callerGroup = callerSnap.data()?.group;
        if (!ADMIN_GROUPS.includes(callerGroup)) {
            throw new HttpsError("permission-denied", "Insufficient permissions.");
        }
        if (callerGroup !== "president"
            && !MANAGEABLE_GROUPS.includes(normalizeGroup(targetSnap.data()!.group))) {
            throw new HttpsError("permission-denied", "Cannot manage users at or above your level.");
        }
    }

    return {
        targetUid,
        isSelf,
        targetData: targetSnap.data()!,
        callerName: callerSnap.data()?.displayName ?? "",
    };
}

// Avatar uploads are a membership perk, but staff+ keep them without holding a
// passport — otherwise this would quietly take avatars away from every staff
// member who has never bought one. The only people blocked are plain users with
// no active membership.
function canSetOwnAvatar(userData: FirebaseFirestore.DocumentData): boolean {
    return isMembershipActive(userData) || normalizeGroup(userData.group) !== "user";
}

// The photo a user reverts to once their uploaded avatar is gone. For the caller
// this is on their token; for anyone else it has to come from their auth record.
async function googlePhotoURL(uid: string): Promise<string> {
    try {
        return (await getAuth().getUser(uid)).photoURL ?? "";
    } catch {
        return "";
    }
}

export const updateDisplayName = onCall({maxInstances: 20}, async (request) => {
    if (!request.auth) {
        throw new HttpsError("unauthenticated", "Must be signed in.");
    }

    const uid = request.auth.uid;
    await checkRateLimit(uid);

    const input = request.data as {displayName?: string; targetUid?: string};
    const raw = input?.displayName;
    if (typeof raw !== "string") {
        throw new HttpsError("invalid-argument", "displayName must be a string.");
    }

    const sanitized = sanitizeDisplayText(raw);
    if (sanitized.length === 0) {
        throw new HttpsError("invalid-argument", "displayName is required.");
    }
    if (sanitized.length > 50) {
        throw new HttpsError("invalid-argument", "displayName exceeds maximum length.");
    }

    const {targetUid, isSelf, targetData, callerName} = await resolveProfileTarget(uid, input?.targetUid);
    const oldName = targetData.displayName ?? "";

    await db.collection("users").doc(targetUid).update({displayName: sanitized});

    if (!isSelf && oldName !== sanitized) {
        await db.collection("records").add({
            type: "name-set",
            performedBy: uid,
            performedByName: callerName,
            targetUid,
            targetName: sanitized,
            oldName,
            newName: sanitized,
            timestamp: FieldValue.serverTimestamp(),
            expiresAt: recordExpiresAt(),
        });
    }

    return {displayName: sanitized};
});
export const uploadAvatar = onCall({maxInstances: 10}, async (request) => {
    if (!request.auth) {
        throw new HttpsError("unauthenticated", "Must be signed in.");
    }

    const uid = request.auth.uid;
    await checkRateLimit(uid);

    const input = request.data as {data?: string; contentType?: string; targetUid?: string};
    const {targetUid, isSelf, targetData, callerName} = await resolveProfileTarget(uid, input.targetUid);

    // Uploading your own avatar is a membership perk, but staff+ keep it without
    // holding a passport. An admin can still give an avatar to anyone.
    if (isSelf && !canSetOwnAvatar(targetData)) {
        throw new HttpsError("permission-denied", "An active membership is required to upload an avatar.");
    }

    const dataBase64 = input.data;
    const contentType = input.contentType;

    if (!dataBase64 || !contentType) {
        throw new HttpsError("invalid-argument", "Missing data or contentType.");
    }

    if (!["image/webp", "image/jpeg", "image/png"].includes(contentType)) {
        throw new HttpsError("invalid-argument", "Only image/webp, image/jpeg, or image/png are allowed.");
    }

    const buffer = Buffer.from(dataBase64, "base64");
    if (buffer.length > MAX_UPLOAD_SIZE) {
        throw new HttpsError("invalid-argument", `Image exceeds ${MAX_UPLOAD_SIZE_MB}MB limit.`);
    }

    const detectedMime = detectImageMime(buffer);
    if (!detectedMime || detectedMime !== contentType) {
        throw new HttpsError("invalid-argument", "File content does not match claimed content type.");
    }

    const bucket = getStorage().bucket();
    const path = `avatars/${targetUid}`;
    const file = bucket.file(path);
    await file.save(buffer, {
        metadata: {contentType, cacheControl: "public, max-age=31536000, immutable"},
    });

    const baseDownloadUrl = await getDownloadURL(file);
    const downloadUrl = `${baseDownloadUrl}&t=${Date.now()}`;

    // Atomically set photoURL on the user doc so clients can't set arbitrary URLs
    await db.collection("users").doc(targetUid).update({photoURL: downloadUrl});

    if (!isSelf) {
        await db.collection("records").add({
            type: "avatar-set",
            performedBy: uid,
            performedByName: callerName,
            targetUid,
            targetName: targetData.displayName ?? "",
            timestamp: FieldValue.serverTimestamp(),
            expiresAt: recordExpiresAt(),
        });
    }

    return {url: downloadUrl};
});
export const deleteAvatar = onCall({maxInstances: 10}, async (request) => {
    if (!request.auth) {
        throw new HttpsError("unauthenticated", "Must be signed in.");
    }

    const uid = request.auth.uid;
    await checkRateLimit(uid);

    const input = request.data as {targetUid?: string};
    const {targetUid, isSelf, targetData, callerName} = await resolveProfileTarget(uid, input?.targetUid);

    // Someone without an active membership can't upload an avatar, but may remove
    // one an admin gave them.
    const hasUploadedAvatar = typeof targetData.photoURL === "string"
        && targetData.photoURL.includes("firebasestorage.googleapis.com");
    if (isSelf && !canSetOwnAvatar(targetData) && !hasUploadedAvatar) {
        throw new HttpsError("permission-denied", "An active membership is required to delete an avatar.");
    }

    const bucket = getStorage().bucket();
    const file = bucket.file(`avatars/${targetUid}`);
    const [exists] = await file.exists();
    if (exists) {
        await file.delete();
    }

    const googlePhoto = isSelf
        ? (request.auth.token.picture ?? "")
        : await googlePhotoURL(targetUid);
    const photoURL = googlePhoto.slice(0, 500);
    await db.collection("users").doc(targetUid).update({photoURL});

    if (!isSelf) {
        await db.collection("records").add({
            type: "avatar-remove",
            performedBy: uid,
            performedByName: callerName,
            targetUid,
            targetName: targetData.displayName ?? "",
            timestamp: FieldValue.serverTimestamp(),
            expiresAt: recordExpiresAt(),
        });
    }

    return {photoURL};
});
export const changeUserGroup = onCall({maxInstances: 10}, async (request) => {
    if (!request.auth) {
        throw new HttpsError("unauthenticated", "Must be signed in.");
    }

    const uid = request.auth.uid;

    const input = request.data as {targetUid?: string; newGroup?: string; title?: string; titleCn?: string};
    const targetUid = validateDocId(input.targetUid, "targetUid");
    const newGroup = input.newGroup;

    if (!isValidGroup(newGroup)) {
        throw new HttpsError("invalid-argument", "Invalid group.");
    }

    if (uid === targetUid) {
        throw new HttpsError("permission-denied", "Cannot change your own group.");
    }

    // Titles can only be set when assigning staff or core-staff
    const title = typeof input.title === "string" ? sanitizeDisplayText(input.title) : input.title;
    const titleCn = typeof input.titleCn === "string" ? sanitizeDisplayText(input.titleCn) : input.titleCn;
    if (title || titleCn) {
        if ((title?.length ?? 0) > 100 || (titleCn?.length ?? 0) > 100) {
            throw new HttpsError("invalid-argument", "Invalid title.");
        }
        if (!["staff", "core-staff"].includes(newGroup)) {
            throw new HttpsError("invalid-argument", "Title can only be set for staff or core-staff.");
        }
    }

    await checkRateLimit(uid);

    let oldGroup: string = "";
    let oldTitle: string = "";
    let oldTitleCn: string = "";

    await db.runTransaction(async (txn) => {
        const [callerSnap, targetSnap] = await Promise.all([
            txn.get(db.collection("users").doc(uid)),
            txn.get(db.collection("users").doc(targetUid)),
        ]);

        if (!callerSnap.exists) throw new HttpsError("not-found", "Caller not found.");
        if (!targetSnap.exists) throw new HttpsError("not-found", "Target user not found.");

        const callerGroup = callerSnap.data()!.group;
        if (!ADMIN_GROUPS.includes(callerGroup)) {
            throw new HttpsError("permission-denied", "Insufficient permissions.");
        }

        oldGroup = normalizeGroup(targetSnap.data()!.group);
        oldTitle = targetSnap.data()!.title ?? "";
        oldTitleCn = targetSnap.data()!.titleCn ?? "";

        if (callerGroup !== "president") {
            if (!MANAGEABLE_GROUPS.includes(oldGroup)) {
                throw new HttpsError("permission-denied",
                    "Cannot manage users at or above your level.");
            }
            if (!MANAGEABLE_GROUPS.includes(newGroup)) {
                throw new HttpsError("permission-denied",
                    "Cannot assign this group.");
            }
        }

        const shouldHaveTitle = ["staff", "core-staff"].includes(newGroup);
        const newTitle = shouldHaveTitle ? (title ?? "") : "";
        const newTitleCn = shouldHaveTitle ? (titleCn ?? "") : "";
        const updateData: Record<string, unknown> = {group: newGroup};
        if (shouldHaveTitle) {
            updateData.title = newTitle;
            updateData.titleCn = newTitleCn;
        } else {
            updateData.title = FieldValue.delete();
            updateData.titleCn = FieldValue.delete();
        }

        txn.update(db.collection("users").doc(targetUid), updateData);
        txn.set(db.collection("records").doc(), {
            type: "group-assign",
            performedBy: uid,
            performedByName: callerSnap.data()!.displayName ?? "",
            targetUid,
            targetName: targetSnap.data()!.displayName ?? "",
            oldGroup,
            newGroup,
            timestamp: FieldValue.serverTimestamp(),
            expiresAt: recordExpiresAt(),
        });

        if (oldTitle !== newTitle || oldTitleCn !== newTitleCn) {
            txn.set(db.collection("records").doc(), {
                type: "title-set",
                performedBy: uid,
                performedByName: callerSnap.data()!.displayName ?? "",
                targetUid,
                targetName: targetSnap.data()!.displayName ?? "",
                oldTitle,
                newTitle,
                oldTitleCn,
                newTitleCn,
                timestamp: FieldValue.serverTimestamp(),
                expiresAt: recordExpiresAt(),
            });
        }
    });

    return {oldGroup, newGroup};
});
// Membership is a time-boxed attribute, not a group. This never writes `group` —
// changeUserGroup is the only function that does, so granting or revoking
// membership can't promote or demote anyone.
export const setMembership = onCall({maxInstances: 10}, async (request) => {
    if (!request.auth) {
        throw new HttpsError("unauthenticated", "Must be signed in.");
    }

    const uid = request.auth.uid;
    const input = request.data as {targetUid?: string; expiresAt?: string | null; extendDays?: number};
    const targetUid = validateDocId(input.targetUid, "targetUid");

    const hasExpiresAt = "expiresAt" in input;
    const hasExtendDays = input.extendDays !== undefined;
    if (hasExpiresAt === hasExtendDays) {
        throw new HttpsError("invalid-argument", "Provide exactly one of expiresAt or extendDays.");
    }

    // expiresAt: null revokes. A date sets the expiry outright.
    let absoluteExpiry: Timestamp | null = null;
    if (hasExpiresAt && input.expiresAt !== null) {
        const iso = validateISODate(input.expiresAt, "expiresAt");
        if (!iso) {
            throw new HttpsError("invalid-argument", "expiresAt must be a date or null.");
        }
        absoluteExpiry = Timestamp.fromDate(new Date(iso));
    }

    let extendDays = 0;
    if (hasExtendDays) {
        extendDays = input.extendDays!;
        if (!Number.isInteger(extendDays) || extendDays === 0 || Math.abs(extendDays) > MAX_GRANT_DAYS) {
            throw new HttpsError("invalid-argument",
                `extendDays must be a non-zero integer within ${MAX_GRANT_DAYS} days.`);
        }
    }

    await checkRateLimit(uid);

    return db.runTransaction(async (txn) => {
        const [callerSnap, targetSnap] = await Promise.all([
            txn.get(db.collection("users").doc(uid)),
            txn.get(db.collection("users").doc(targetUid)),
        ]);

        if (!callerSnap.exists) throw new HttpsError("not-found", "Caller not found.");
        if (!targetSnap.exists) throw new HttpsError("not-found", "Target user not found.");

        const callerGroup = normalizeGroup(callerSnap.data()!.group);
        if (!ADMIN_GROUPS.includes(callerGroup)) {
            throw new HttpsError("permission-denied", "Insufficient permissions.");
        }

        const targetData = targetSnap.data()!;
        // Same hierarchy guard as changeUserGroup: core-staff act on users and
        // staff, the president on anyone.
        if (callerGroup !== "president" && !MANAGEABLE_GROUPS.includes(normalizeGroup(targetData.group))) {
            throw new HttpsError("permission-denied", "Cannot manage users at or above your level.");
        }

        const oldExpiry: Timestamp | null = targetData.membershipExpiresAt ?? null;
        const newExpiry = hasExtendDays
            ? extendedExpiry(oldExpiry, extendDays)
            : absoluteExpiry;

        txn.update(db.collection("users").doc(targetUid), {
            membershipExpiresAt: newExpiry === null ? FieldValue.delete() : newExpiry,
        });

        txn.set(db.collection("records").doc(), {
            type: newExpiry === null
                ? "membership-revoke"
                : hasExtendDays ? "membership-extend" : "membership-grant",
            performedBy: uid,
            performedByName: callerSnap.data()!.displayName ?? "",
            targetUid,
            targetName: targetData.displayName ?? "",
            oldExpiresAt: oldExpiry?.toDate?.()?.toISOString() ?? "",
            newExpiresAt: newExpiry?.toDate?.()?.toISOString() ?? "",
            extendDays: hasExtendDays ? extendDays : null,
            timestamp: FieldValue.serverTimestamp(),
            expiresAt: recordExpiresAt(),
        });

        return {membershipExpiresAt: newExpiry?.toDate?.()?.toISOString() ?? null};
    });
});
export const setUserTitle = onCall({maxInstances: 10}, async (request) => {
    if (!request.auth) {
        throw new HttpsError("unauthenticated", "Must be signed in.");
    }

    const uid = request.auth.uid;
    const input = request.data as {targetUid?: string; title?: string; titleCn?: string};
    const targetUid = validateDocId(input.targetUid, "targetUid");
    const title = typeof input.title === "string" ? sanitizeDisplayText(input.title) : input.title;
    const titleCn = typeof input.titleCn === "string" ? sanitizeDisplayText(input.titleCn) : input.titleCn;

    if ((title != null && title.length > 100) || (titleCn != null && titleCn.length > 100)) {
        throw new HttpsError("invalid-argument", "Invalid title.");
    }

    await checkRateLimit(uid);

    await db.runTransaction(async (txn) => {
        const [callerSnap, targetSnap] = await Promise.all([
            txn.get(db.collection("users").doc(uid)),
            txn.get(db.collection("users").doc(targetUid)),
        ]);

        if (!callerSnap.exists) throw new HttpsError("not-found", "Caller not found.");
        if (!targetSnap.exists) throw new HttpsError("not-found", "Target user not found.");

        const callerGroup = callerSnap.data()!.group;
        const targetGroup = targetSnap.data()!.group;

        if (!ADMIN_GROUPS.includes(callerGroup)) {
            throw new HttpsError("permission-denied", "Insufficient permissions.");
        }

        if (!["staff", "core-staff"].includes(targetGroup)) {
            throw new HttpsError("invalid-argument", "Title can only be set for staff or core-staff.");
        }

        // Only president can set title for core-staff; core-staff can only set title for staff
        if (targetGroup === "core-staff" && callerGroup !== "president") {
            throw new HttpsError("permission-denied",
                "Only the president can set the title of a core-staff member.");
        }

        const updateData: Record<string, unknown> = {};
        updateData.title = title ? title : FieldValue.delete();
        updateData.titleCn = titleCn ? titleCn : FieldValue.delete();

        txn.update(db.collection("users").doc(targetUid), updateData);
        txn.set(db.collection("records").doc(), {
            type: "title-set",
            performedBy: uid,
            performedByName: callerSnap.data()!.displayName ?? "",
            targetUid,
            targetName: targetSnap.data()!.displayName ?? "",
            oldTitle: targetSnap.data()!.title ?? "",
            newTitle: title ?? "",
            oldTitleCn: targetSnap.data()!.titleCn ?? "",
            newTitleCn: titleCn ?? "",
            timestamp: FieldValue.serverTimestamp(),
            expiresAt: recordExpiresAt(),
        });
    });

    return {success: true};
});
export const toggleUserBadge = onCall({maxInstances: 10}, async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Must be signed in.");
    const uid = request.auth.uid;
    await checkRateLimit(uid);

    const input = request.data as {targetUid?: string; badgeId?: string; grant?: boolean};
    const targetUid = validateDocId(input.targetUid, "targetUid");
    const badgeId = validateDocId(input.badgeId, "badgeId");
    if (typeof input.grant !== "boolean") {
        throw new HttpsError("invalid-argument", "grant must be a boolean.");
    }
    const grant = input.grant;

    return adminTransaction(uid, async (txn, callerSnap) => {
        const callerGroup = callerSnap.data()!.group;
        const targetSnap = await txn.get(db.collection("users").doc(targetUid));
        if (!targetSnap.exists) throw new HttpsError("not-found", "User not found.");
        if (callerGroup !== "president"
            && !MANAGEABLE_GROUPS.includes(normalizeGroup(targetSnap.data()!.group))) {
            throw new HttpsError("permission-denied", "Cannot manage users at or above your level.");
        }

        const badgeSnap = await txn.get(db.collection("badges").doc(badgeId));
        if (!badgeSnap.exists) throw new HttpsError("not-found", "Badge not found.");

        txn.update(db.collection("users").doc(targetUid), {
            badges: grant ? FieldValue.arrayUnion(badgeId) : FieldValue.arrayRemove(badgeId),
            [`badgeEarnedAt.${badgeId}`]: grant ? FieldValue.serverTimestamp() : FieldValue.delete(),
        });
        txn.set(db.collection("records").doc(), {
            type: grant ? "achievement-grant" : "achievement-revoke",
            performedBy: uid,
            performedByName: callerSnap.data()!.displayName ?? "",
            targetUid,
            targetName: targetSnap.data()!.displayName ?? "",
            badgeId,
            badgeName: badgeSnap.data()?.name ?? badgeId,
            timestamp: FieldValue.serverTimestamp(),
            expiresAt: recordExpiresAt(),
        });
        return {granted: grant};
    });
});
export const requestAccountDeletion = onCall({maxInstances: 10}, async (request) => {
    const callerUid = await requireAuth(request);
    const inputTarget = (request.data as {targetUid?: string})?.targetUid;
    const targetUid = inputTarget ? validateDocId(inputTarget, "targetUid") : callerUid;

    const deleteAt = deletionExpiresAt();

    await db.runTransaction(async (txn) => {
        const [callerSnap, targetSnap] = await Promise.all([
            txn.get(db.collection("users").doc(callerUid)),
            txn.get(db.collection("users").doc(targetUid)),
        ]);

        if (!targetSnap.exists) {
            throw new HttpsError("not-found", "User not found.");
        }
        const targetData = targetSnap.data()!;

        // Deleting your own account is a right every signed-in user has, membership
        // or not. Deleting someone else's still requires admin rights over them.
        if (callerUid !== targetUid) {
            if (!callerSnap.exists) {
                throw new HttpsError("permission-denied", "Insufficient permissions.");
            }
            const callerGroup = callerSnap.data()!.group;
            if (!ADMIN_GROUPS.includes(callerGroup)) {
                throw new HttpsError("permission-denied", "Insufficient permissions.");
            }
            if (callerGroup !== "president"
                && !MANAGEABLE_GROUPS.includes(normalizeGroup(targetData.group))) {
                throw new HttpsError("permission-denied", "Cannot manage users at or above your level.");
            }
        }

        if (targetData.deleteAt && targetData.deleteAt.toMillis() > Date.now()) {
            throw new HttpsError("already-exists", "deletion-already-pending");
        }

        const callerName = callerSnap.exists
            ? (callerSnap.data()!.displayName ?? "")
            : (targetData.displayName ?? "");

        txn.update(db.collection("users").doc(targetUid), {deleteAt});
        txn.set(db.collection("records").doc(), {
            type: "account-deletion-requested",
            performedBy: callerUid,
            performedByName: callerName,
            targetUid,
            targetName: targetData.displayName ?? "",
            timestamp: FieldValue.serverTimestamp(),
            expiresAt: recordExpiresAt(),
        });
    });

    return {deleteAt: deleteAt.toDate().toISOString()};
});
export const cancelAccountDeletion = onCall({maxInstances: 10}, async (request) => {
    const callerUid = await requireAuth(request);
    const inputTarget = (request.data as {targetUid?: string})?.targetUid;
    const targetUid = inputTarget ? validateDocId(inputTarget, "targetUid") : callerUid;

    await db.runTransaction(async (txn) => {
        const [callerSnap, targetSnap] = await Promise.all([
            txn.get(db.collection("users").doc(callerUid)),
            txn.get(db.collection("users").doc(targetUid)),
        ]);

        if (!targetSnap.exists) {
            throw new HttpsError("not-found", "User not found.");
        }
        const targetData = targetSnap.data()!;
        if (!targetData.deleteAt || targetData.deleteAt.toMillis() <= Date.now()) {
            throw new HttpsError("not-found", "No pending deletion.");
        }

        if (callerUid !== targetUid) {
            if (!callerSnap.exists || !ADMIN_GROUPS.includes(callerSnap.data()!.group)) {
                throw new HttpsError("permission-denied", "Insufficient permissions.");
            }
            const callerGroup = callerSnap.data()!.group;
            if (callerGroup !== "president"
                && !MANAGEABLE_GROUPS.includes(normalizeGroup(targetData.group))) {
                throw new HttpsError("permission-denied", "Cannot manage users at or above your level.");
            }
        }

        const callerName = callerSnap.exists
            ? (callerSnap.data()!.displayName ?? "")
            : (targetData.displayName ?? "");

        txn.update(db.collection("users").doc(targetUid), {deleteAt: FieldValue.delete()});
        txn.set(db.collection("records").doc(), {
            type: "account-deletion-cancelled",
            performedBy: callerUid,
            performedByName: callerName,
            targetUid,
            targetName: targetData.displayName ?? "",
            timestamp: FieldValue.serverTimestamp(),
            expiresAt: recordExpiresAt(),
        });
    });

    return {cancelled: true};
});
// retry: a dropped event would leave the Auth account alive with no user doc,
// silently undoing the deletion on next sign-in. Re-runs are safe: deleteUser
// tolerates user-not-found, the avatar delete ignores missing files, and the
// audit record writes to a fixed id.
export const onUserDeleted = onDocumentDeleted(
    {document: "users/{uid}", maxInstances: 10, retry: true},
    async (event) => {
        const data = event.data?.data();
        const uid = event.params.uid;

        try {
            await getAuth().deleteUser(uid);
        } catch (err: unknown) {
            const code = (err as {code?: string})?.code;
            if (code !== "auth/user-not-found") {
                console.error(`onUserDeleted: deleteUser failed for ${uid}`, err);
                throw err;
            }
        }

        // The client can recreate the doc between the TTL delete and the auth
        // deletion above (createUserProfile's existence check still passes in
        // that window). Deleting a missing doc is a no-op that fires no event,
        // so this only re-triggers the function when a resurrected doc really
        // existed — and the re-fired run's own delete is then a no-op, ending
        // the chain. Errors propagate so retry re-delivers the event.
        await db.collection("users").doc(uid).delete();

        try {
            await getStorage().bucket().file(`avatars/${uid}`).delete({ignoreNotFound: true});
        } catch (err) {
            console.error(`onUserDeleted: avatar delete failed for ${uid}`, err);
        }

        try {
            // Fixed id: retries and the resurrected-doc re-fire overwrite the
            // same record instead of duplicating the audit entry.
            await db.collection("records").doc(`account-deleted-${uid}`).set({
                type: "account-deleted",
                targetUid: uid,
                targetName: data?.displayName ?? "",
                targetEmail: data?.email ?? "",
                timestamp: FieldValue.serverTimestamp(),
                expiresAt: recordExpiresAt(),
            });
        } catch (err) {
            console.error(`onUserDeleted: record write failed for ${uid}`, err);
        }
    }
);
