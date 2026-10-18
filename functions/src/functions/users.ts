import { HttpsError, onCall } from "firebase-functions/v2/https";
import { onDocumentDeleted } from "firebase-functions/v2/firestore";
import { getDownloadURL, getStorage } from "firebase-admin/storage";
import { getAuth } from "firebase-admin/auth";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import {
    ADMIN_GROUPS,
    adminTransaction,
    isValidGroup,
    MANAGEABLE_GROUPS,
    normalizeGroup,
    requireAuth,
} from "../utils/auth";
import { deletionExpiresAt } from "../utils/config";
import { extendedExpiry, isMembershipActive, MAX_GRANT_DAYS, startedAtAfter } from "../utils/membership";
import { db } from "../utils/firebase";
import { pastEventIds, toStringIds } from "../utils/publicProfile";
import { detectImageMime, MAX_UPLOAD_SIZE, MAX_UPLOAD_SIZE_MB } from "../utils/storage";
import { sanitizeDisplayText, validateDocId, validateInstant } from "../utils/validation";
import { parseVisibilityInput, readVisibility } from "../utils/visibility";
import { recordDoc, recordRef } from "../utils/records";
import { isScannedTicket } from "../utils/tickets";

export const createUserProfile = onCall({maxInstances: 20}, async (request) => {
    const uid = await requireAuth(request);

    // ID tokens outlive account deletion by up to an hour, so a deleted user's
    // client could recreate the doc after onUserDeleted ran; only Auth knows
    // the account is gone.
    try {
        await getAuth().getUser(uid);
    } catch (err: unknown) {
        if ((err as {code?: string})?.code === "auth/user-not-found") {
            throw new HttpsError("failed-precondition", "Account has been deleted.");
        }
        throw err;
    }

    const userRef = db.collection("users").doc(uid);

    const rawName = request.auth!.token.name ?? "";
    const email = request.auth!.token.email ?? "";
    const photoURL = request.auth!.token.picture ?? "";

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

    if (!alreadyExists && email && request.auth!.token.email_verified === true) {
        try {
            await creditScannedTickets(userRef, email.trim().toLowerCase());
        } catch (err) {
            // The profile exists either way; a missed credit must not fail sign-up.
            console.error(`createUserProfile: ticket credit failed for ${uid}`, err);
        }
    }

    return {alreadyExists};
});

/**
 * Credit a new account with the paid events its email was scanned into. The
 * scanner only credits accounts that already existed, and getMyTickets only
 * while the event is live, so a sign-up after the event ends is caught here.
 *
 * Only a verified email may claim its tickets, so the caller checks the token.
 * The collection-group query uses the attendees.email override in
 * firestore.indexes.json.
 */
async function creditScannedTickets(
    userRef: FirebaseFirestore.DocumentReference,
    email: string,
): Promise<void> {
    const snap = await db.collectionGroup("attendees").where("email", "==", email).get();
    const eventRefs = new Map<string, FirebaseFirestore.DocumentReference>();
    for (const doc of snap.docs) {
        const eventRef = doc.ref.parent.parent;
        const root = eventRef?.parent.id;
        if (!eventRef || (root !== "pastEvents" && root !== "upcomingEvents")) continue;
        const tickets: unknown[] = Array.isArray(doc.data().tickets) ? doc.data().tickets : [];
        if (tickets.some(isScannedTicket)) eventRefs.set(eventRef.id, eventRef);
    }
    if (eventRefs.size === 0) return;

    // A deleted event's tickets outlive it when its cleanup fails; a gone event
    // must not land in attendedEvents.
    const events = await db.getAll(...eventRefs.values());
    const ids = events.filter(e => e.exists).map(e => e.id);
    if (ids.length > 0) await userRef.update({attendedEvents: FieldValue.arrayUnion(...ids)});
}

export const getPublicProfile = onCall({maxInstances: 20}, async (request) => {
    const callerUid = await requireAuth(request);

    const targetUid = validateDocId((request.data as {uid?: string})?.uid, "uid");
    const userSnap = await db.collection("users").doc(targetUid).get();
    if (!userSnap.exists) {
        throw new HttpsError("not-found", "User not found.");
    }

    const data = userSnap.data()!;
    // Sections the owner has switched off are emptied here, not at the client,
    // so the data is actually withheld. The flags go along so the viewer reads
    // "kept private" rather than an empty state.
    const visibility = readVisibility(data.profileVisibility);
    // Your own profile is never filtered, or you couldn't tell a hidden section
    // from an empty one.
    const isSelf = callerUid === targetUid;
    const showBadges = isSelf || visibility.badges;
    const showEvents = isSelf || visibility.events;

    const badgeEarnedAt: Record<string, string> = {};
    if (showBadges) {
        const rawEarnedAt = (data.badgeEarnedAt ?? {}) as Record<string, Timestamp>;
        for (const [k, v] of Object.entries(rawEarnedAt)) {
            const iso = v?.toDate?.()?.toISOString();
            if (iso) badgeEarnedAt[k] = iso;
        }
    }

    // Past events only: upcoming ids would leak unpublished events whose titles
    // the rules withhold.
    const rawStaffEvents = showEvents ? toStringIds(data.eventStaffEvents) : [];
    const pastEvents = await pastEventIds(rawStaffEvents);
    const eventStaffEvents = rawStaffEvents.filter(id => pastEvents.has(id));

    return {
        displayName: data.displayName ?? "",
        photoURL: data.photoURL ?? "",
        bannerURL: data.bannerURL ?? "",
        joinedAt: data.joinedAt?.toDate?.()?.toISOString() ?? new Date().toISOString(),
        attendedEvents: showEvents ? (data.attendedEvents ?? []) : [],
        eventStaffEvents,
        badges: showBadges ? (data.badges ?? []) : [],
        badgeEarnedAt,
        group: normalizeGroup(data.group),
        // Only whether there is a membership; the expiry is the owner's
        // business.
        isMember: isMembershipActive(data),
        title: data.title ?? "",
        titleCn: data.titleCn ?? "",
        visibility: {badges: showBadges, events: showEvents},
    };
});

/**
 * Switch sections of the caller's own profile on or off for everyone else, like
 * setPassportPrivacy. Partial updates, so two open tabs can't undo each other's
 * switches.
 */
export const setProfileVisibility = onCall({maxInstances: 10}, async (request) => {
    const uid = await requireAuth(request);

    const sections = parseVisibilityInput((request.data as {sections?: unknown})?.sections);

    const userRef = db.collection("users").doc(uid);
    const merged = await db.runTransaction(async (txn) => {
        const snap = await txn.get(userRef);
        if (!snap.exists) throw new HttpsError("not-found", "User not found.");
        const next = {...readVisibility(snap.data()?.profileVisibility), ...sections};
        txn.update(userRef, {profileVisibility: next});
        return next;
    });

    return {visibility: merged};
});

interface ProfileTarget {
    targetUid: string;
    isSelf: boolean;
    targetData: FirebaseFirestore.DocumentData;
    callerName: string;
}

// Whose profile an edit applies to: your own always, someone else's only with
// admin rights over their group.
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

// Uploading your own avatar or banner is a membership perk that staff+ keep
// without one; only plain users with no active membership are blocked.
function canSetOwnImages(userData: FirebaseFirestore.DocumentData): boolean {
    return isMembershipActive(userData) || normalizeGroup(userData.group) !== "user";
}

// Checks every profile image upload makes before touching Storage: allowed
// type, size, and bytes that match the type.
function decodeProfileImage(input: {data?: string; contentType?: string}): {buffer: Buffer; contentType: string} {
    const {data: dataBase64, contentType} = input;

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

    return {buffer, contentType};
}

// Each upload overwrites the same path, so the URL busts the year-long cache.
async function saveProfileImage(path: string, buffer: Buffer, contentType: string): Promise<string> {
    const file = getStorage().bucket().file(path);
    await file.save(buffer, {
        metadata: {contentType, cacheControl: "public, max-age=31536000, immutable"},
    });
    return `${await getDownloadURL(file)}&t=${Date.now()}`;
}

// The photo a user reverts to without an uploaded avatar, from their auth
// record.
async function googlePhotoURL(uid: string): Promise<string> {
    try {
        return (await getAuth().getUser(uid)).photoURL ?? "";
    } catch {
        return "";
    }
}

export const updateDisplayName = onCall({maxInstances: 20}, async (request) => {
    const uid = await requireAuth(request);

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
        await recordRef().set(recordDoc("name-set", {
            performedBy: uid,
            performedByName: callerName,
            targetUid,
            targetName: sanitized,
            oldName,
            newName: sanitized,
        }));
    }

    return {displayName: sanitized};
});
export const uploadAvatar = onCall({maxInstances: 10}, async (request) => {
    const uid = await requireAuth(request);

    const input = request.data as {data?: string; contentType?: string; targetUid?: string};
    const {targetUid, isSelf, targetData, callerName} = await resolveProfileTarget(uid, input.targetUid);

    // A membership perk for your own avatar; admins can give one to anyone.
    if (isSelf && !canSetOwnImages(targetData)) {
        throw new HttpsError("permission-denied", "An active membership is required to upload an avatar.");
    }

    const {buffer, contentType} = decodeProfileImage(input);
    const downloadUrl = await saveProfileImage(`avatars/${targetUid}`, buffer, contentType);

    // Atomically set photoURL on the user doc so clients can't set arbitrary URLs
    await db.collection("users").doc(targetUid).update({photoURL: downloadUrl});

    if (!isSelf) {
        await recordRef().set(recordDoc("avatar-set", {
            performedBy: uid,
            performedByName: callerName,
            targetUid,
            targetName: targetData.displayName ?? "",
        }));
    }

    return {url: downloadUrl};
});
export const deleteAvatar = onCall({maxInstances: 10}, async (request) => {
    const uid = await requireAuth(request);

    const input = request.data as {targetUid?: string};
    const {targetUid, isSelf, targetData, callerName} = await resolveProfileTarget(uid, input?.targetUid);

    // Without a membership you can't upload an avatar, but may remove one an
    // admin gave you.
    const hasUploadedAvatar = typeof targetData.photoURL === "string"
        && targetData.photoURL.includes("firebasestorage.googleapis.com");
    if (isSelf && !canSetOwnImages(targetData) && !hasUploadedAvatar) {
        throw new HttpsError("permission-denied", "An active membership is required to delete an avatar.");
    }

    const bucket = getStorage().bucket();
    const file = bucket.file(`avatars/${targetUid}`);
    const [exists] = await file.exists();
    if (exists) {
        await file.delete();
    }

    const googlePhoto = isSelf
        ? (request.auth!.token.picture ?? "")
        : await googlePhotoURL(targetUid);
    const photoURL = googlePhoto.slice(0, 500);
    await db.collection("users").doc(targetUid).update({photoURL});

    if (!isSelf) {
        await recordRef().set(recordDoc("avatar-remove", {
            performedBy: uid,
            performedByName: callerName,
            targetUid,
            targetName: targetData.displayName ?? "",
        }));
    }

    return {photoURL};
});
/**
 * The image across the top of the caller's profile. A membership perk like an
 * avatar, but self only: admins can take a banner down, never put one up.
 */
export const uploadBanner = onCall({maxInstances: 10}, async (request) => {
    const uid = await requireAuth(request);

    const userRef = db.collection("users").doc(uid);
    const snap = await userRef.get();
    if (!snap.exists) {
        throw new HttpsError("not-found", "User not found.");
    }
    if (!canSetOwnImages(snap.data()!)) {
        throw new HttpsError("permission-denied", "An active membership is required to upload a banner.");
    }

    const {buffer, contentType} = decodeProfileImage(request.data as {data?: string; contentType?: string});
    const downloadUrl = await saveProfileImage(`banners/${uid}`, buffer, contentType);

    // Set on the user doc here so clients can't point bannerURL anywhere else.
    await userRef.update({bannerURL: downloadUrl});

    return {url: downloadUrl};
});
// No membership needed to remove your banner; admins can remove anyone's they
// manage.
export const deleteBanner = onCall({maxInstances: 10}, async (request) => {
    const uid = await requireAuth(request);

    const input = request.data as {targetUid?: string};
    const {targetUid, isSelf, targetData, callerName} = await resolveProfileTarget(uid, input?.targetUid);

    await getStorage().bucket().file(`banners/${targetUid}`).delete({ignoreNotFound: true});
    await db.collection("users").doc(targetUid).update({bannerURL: FieldValue.delete()});

    if (!isSelf) {
        await recordRef().set(recordDoc("banner-remove", {
            performedBy: uid,
            performedByName: callerName,
            targetUid,
            targetName: targetData.displayName ?? "",
        }));
    }

    return {deleted: true};
});
export const changeUserGroup = onCall({maxInstances: 10}, async (request) => {
    const uid = await requireAuth(request);

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
        txn.set(recordRef(), recordDoc("group-assign", {
            performedBy: uid,
            performedByName: callerSnap.data()!.displayName ?? "",
            targetUid,
            targetName: targetSnap.data()!.displayName ?? "",
            oldGroup,
            newGroup,
        }));

        if (oldTitle !== newTitle || oldTitleCn !== newTitleCn) {
            txn.set(recordRef(), recordDoc("title-set", {
                performedBy: uid,
                performedByName: callerSnap.data()!.displayName ?? "",
                targetUid,
                targetName: targetSnap.data()!.displayName ?? "",
                oldTitle,
                newTitle,
                oldTitleCn,
                newTitleCn,
            }));
        }
    });

    return {oldGroup, newGroup};
});
// Membership is time-boxed, not a group: this never writes `group`, which only
// changeUserGroup does.
export const setMembership = onCall({maxInstances: 10}, async (request) => {
    const uid = await requireAuth(request);
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
        const iso = validateInstant(input.expiresAt, "expiresAt");
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
        // changeUserGroup's guard: core-staff act on users and staff, the
        // president on anyone.
        if (callerGroup !== "president" && !MANAGEABLE_GROUPS.includes(normalizeGroup(targetData.group))) {
            throw new HttpsError("permission-denied", "Cannot manage users at or above your level.");
        }

        const oldExpiry: Timestamp | null = targetData.membershipExpiresAt ?? null;
        const newExpiry = hasExtendDays
            ? extendedExpiry(oldExpiry, extendDays)
            : absoluteExpiry;
        const newStart = startedAtAfter(targetData, newExpiry);

        txn.update(db.collection("users").doc(targetUid), {
            membershipExpiresAt: newExpiry === null ? FieldValue.delete() : newExpiry,
            membershipStartedAt: newStart ?? FieldValue.delete(),
        });

        const recordType = newExpiry === null
            ? "membership-revoke"
            : hasExtendDays ? "membership-extend" : "membership-grant";
        txn.set(recordRef(), recordDoc(recordType, {
            performedBy: uid,
            performedByName: callerSnap.data()!.displayName ?? "",
            targetUid,
            targetName: targetData.displayName ?? "",
            oldExpiresAt: oldExpiry?.toDate?.()?.toISOString() ?? "",
            newExpiresAt: newExpiry?.toDate?.()?.toISOString() ?? "",
            extendDays: hasExtendDays ? extendDays : null,
        }));

        return {membershipExpiresAt: newExpiry?.toDate?.()?.toISOString() ?? null};
    });
});
export const setUserTitle = onCall({maxInstances: 10}, async (request) => {
    const uid = await requireAuth(request);
    const input = request.data as {targetUid?: string; title?: string; titleCn?: string};
    const targetUid = validateDocId(input.targetUid, "targetUid");
    const title = typeof input.title === "string" ? sanitizeDisplayText(input.title) : input.title;
    const titleCn = typeof input.titleCn === "string" ? sanitizeDisplayText(input.titleCn) : input.titleCn;

    if ((title != null && title.length > 100) || (titleCn != null && titleCn.length > 100)) {
        throw new HttpsError("invalid-argument", "Invalid title.");
    }

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
        txn.set(recordRef(), recordDoc("title-set", {
            performedBy: uid,
            performedByName: callerSnap.data()!.displayName ?? "",
            targetUid,
            targetName: targetSnap.data()!.displayName ?? "",
            oldTitle: targetSnap.data()!.title ?? "",
            newTitle: title ?? "",
            oldTitleCn: targetSnap.data()!.titleCn ?? "",
            newTitleCn: titleCn ?? "",
        }));
    });

    return {success: true};
});
export const toggleUserBadge = onCall({maxInstances: 10}, async (request) => {
    const uid = await requireAuth(request);

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
        txn.set(recordRef(), recordDoc(grant ? "achievement-grant" : "achievement-revoke", {
            performedBy: uid,
            performedByName: callerSnap.data()!.displayName ?? "",
            targetUid,
            targetName: targetSnap.data()!.displayName ?? "",
            badgeId,
            badgeName: badgeSnap.data()?.name ?? badgeId,
        }));
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

        // Anyone may delete their own account; someone else's needs admin rights
        // over them.
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
        txn.set(recordRef(), recordDoc("account-deletion-requested", {
            performedBy: callerUid,
            performedByName: callerName,
            targetUid,
            targetName: targetData.displayName ?? "",
        }));
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
        txn.set(recordRef(), recordDoc("account-deletion-cancelled", {
            performedBy: callerUid,
            performedByName: callerName,
            targetUid,
            targetName: targetData.displayName ?? "",
        }));
    });

    return {cancelled: true};
});
// retry: a dropped event would leave the Auth account alive with no user doc,
// undoing the deletion at next sign-in. Re-runs are safe: every step tolerates
// what's already gone, and the record has a fixed id.
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

        // The client can recreate the doc between the TTL delete and the Auth
        // deletion above. Deleting a missing doc fires nothing, so this
        // re-triggers only for a doc that really came back, and that run's
        // delete ends the chain. Errors propagate so retry re-delivers.
        await db.collection("users").doc(uid).delete();

        for (const path of [`avatars/${uid}`, `banners/${uid}`]) {
            try {
                await getStorage().bucket().file(path).delete({ignoreNotFound: true});
            } catch (err) {
                console.error(`onUserDeleted: ${path} delete failed`, err);
            }
        }

        try {
            // Fixed id, so retries and re-fires overwrite one record.
            await recordRef(`account-deleted-${uid}`).set(recordDoc("account-deleted", {
                targetUid: uid,
                targetName: data?.displayName ?? "",
                targetEmail: data?.email ?? "",
            }));
        } catch (err) {
            console.error(`onUserDeleted: record write failed for ${uid}`, err);
        }
    }
);
