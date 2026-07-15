import { HttpsError, onCall } from "firebase-functions/v2/https";
import { onDocumentDeleted } from "firebase-functions/v2/firestore";
import { getDownloadURL, getStorage } from "firebase-admin/storage";
import { getAuth } from "firebase-admin/auth";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { ADMIN_GROUPS, adminTransaction, checkRateLimit, requireAuth } from "../utils/auth";
import { deletionExpiresAt, recordExpiresAt } from "../utils/config";
import { db } from "../utils/firebase";
import { detectImageMime, MAX_UPLOAD_SIZE } from "../utils/storage";
import { sanitizeDisplayText, validateDocId } from "../utils/validation";

export const createUserProfile = onCall({maxInstances: 20}, async (request) => {
    if (!request.auth) {
        throw new HttpsError("unauthenticated", "Must be signed in.");
    }

    const uid = request.auth.uid;
    await checkRateLimit(uid);

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
            group: "visitor",
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
        group: data.group ?? "visitor",
        title: data.title ?? "",
        titleCn: data.titleCn ?? "",
    };
});
export const updateDisplayName = onCall({maxInstances: 20}, async (request) => {
    if (!request.auth) {
        throw new HttpsError("unauthenticated", "Must be signed in.");
    }

    const uid = request.auth.uid;
    await checkRateLimit(uid);

    const raw = (request.data as {displayName?: string})?.displayName;
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

    const userRef = db.collection("users").doc(uid);
    const userSnap = await userRef.get();
    if (!userSnap.exists) {
        throw new HttpsError("not-found", "User not found.");
    }

    await userRef.update({displayName: sanitized});
    return {displayName: sanitized};
});
export const uploadAvatar = onCall({maxInstances: 10}, async (request) => {
    if (!request.auth) {
        throw new HttpsError("unauthenticated", "Must be signed in.");
    }

    const uid = request.auth.uid;
    await checkRateLimit(uid);

    const userSnap = await db.collection("users").doc(uid).get();
    const group = userSnap.data()?.group;
    if (!group || group === "visitor") {
        throw new HttpsError("permission-denied", "Visitors cannot upload avatars.");
    }

    const input = request.data as {data?: string; contentType?: string};
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
        throw new HttpsError("invalid-argument", "Image exceeds 5MB limit.");
    }

    const detectedMime = detectImageMime(buffer);
    if (!detectedMime || detectedMime !== contentType) {
        throw new HttpsError("invalid-argument", "File content does not match claimed content type.");
    }

    const bucket = getStorage().bucket();
    const path = `avatars/${uid}`;
    const file = bucket.file(path);
    await file.save(buffer, {
        metadata: {contentType, cacheControl: "public, max-age=31536000, immutable"},
    });

    const baseDownloadUrl = await getDownloadURL(file);
    const downloadUrl = `${baseDownloadUrl}&t=${Date.now()}`;

    // Atomically set photoURL on the user doc so clients can't set arbitrary URLs
    await db.collection("users").doc(uid).update({photoURL: downloadUrl});

    return {url: downloadUrl};
});
export const deleteAvatar = onCall({maxInstances: 10}, async (request) => {
    if (!request.auth) {
        throw new HttpsError("unauthenticated", "Must be signed in.");
    }

    const uid = request.auth.uid;
    await checkRateLimit(uid);

    const userSnap = await db.collection("users").doc(uid).get();
    const group = userSnap.data()?.group;
    if (!group || group === "visitor") {
        throw new HttpsError("permission-denied", "Visitors cannot delete avatars.");
    }

    const userRef = db.collection("users").doc(uid);

    const bucket = getStorage().bucket();
    const file = bucket.file(`avatars/${uid}`);
    const [exists] = await file.exists();
    if (exists) {
        await file.delete();
    }

    // Reset to Google OAuth photo or empty string
    const googlePhoto = request.auth.token.picture ?? "";
    const photoURL = googlePhoto.slice(0, 500);
    await userRef.update({photoURL});

    return {photoURL};
});
const VALID_GROUPS = ["visitor", "member", "staff", "core-staff", "president"];
export const changeUserGroup = onCall({maxInstances: 10}, async (request) => {
    if (!request.auth) {
        throw new HttpsError("unauthenticated", "Must be signed in.");
    }

    const uid = request.auth.uid;

    const input = request.data as {targetUid?: string; newGroup?: string; title?: string; titleCn?: string};
    const targetUid = validateDocId(input.targetUid, "targetUid");
    const newGroup = input.newGroup;

    if (!newGroup || !VALID_GROUPS.includes(newGroup)) {
        throw new HttpsError("invalid-argument", "Invalid group.");
    }

    if (uid === targetUid) {
        throw new HttpsError("permission-denied", "Cannot change your own group.");
    }

    // Titles can only be set when assigning staff or core-staff
    const title = input.title;
    const titleCn = input.titleCn;
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

        oldGroup = targetSnap.data()!.group;
        oldTitle = targetSnap.data()!.title ?? "";
        oldTitleCn = targetSnap.data()!.titleCn ?? "";

        if (callerGroup !== "president") {
            if (!["visitor", "member", "staff"].includes(oldGroup)) {
                throw new HttpsError("permission-denied",
                    "Cannot manage users at or above your level.");
            }
            if (!["visitor", "member", "staff"].includes(newGroup)) {
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
export const setUserTitle = onCall({maxInstances: 10}, async (request) => {
    if (!request.auth) {
        throw new HttpsError("unauthenticated", "Must be signed in.");
    }

    const uid = request.auth.uid;
    const input = request.data as {targetUid?: string; title?: string; titleCn?: string};
    const targetUid = validateDocId(input.targetUid, "targetUid");
    const title = input.title;
    const titleCn = input.titleCn;

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
        if (callerGroup !== "president" && !["visitor", "member", "staff"].includes(targetSnap.data()!.group)) {
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

        if (callerUid === targetUid) {
            if (targetData.group === "visitor") {
                throw new HttpsError("permission-denied", "Visitors cannot delete.");
            }
        } else {
            if (!callerSnap.exists) {
                throw new HttpsError("permission-denied", "Insufficient permissions.");
            }
            const callerGroup = callerSnap.data()!.group;
            if (!ADMIN_GROUPS.includes(callerGroup)) {
                throw new HttpsError("permission-denied", "Insufficient permissions.");
            }
            if (callerGroup !== "president"
                && !["visitor", "member", "staff"].includes(targetData.group)) {
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
                && !["visitor", "member", "staff"].includes(targetData.group)) {
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
export const onUserDeleted = onDocumentDeleted(
    {document: "users/{uid}", maxInstances: 10},
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

        try {
            await getStorage().bucket().file(`avatars/${uid}`).delete({ignoreNotFound: true});
        } catch (err) {
            console.error(`onUserDeleted: avatar delete failed for ${uid}`, err);
        }

        try {
            await db.collection("records").add({
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
