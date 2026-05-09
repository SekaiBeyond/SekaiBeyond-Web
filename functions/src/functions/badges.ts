import { HttpsError, onCall } from "firebase-functions/v2/https";
import { onDocumentDeleted } from "firebase-functions/v2/firestore";
import { FieldValue } from "firebase-admin/firestore";
import { adminTransaction, checkRateLimit } from "../utils/auth";
import { deletionExpiresAt, recordExpiresAt } from "../utils/config";
import { db } from "../utils/firebase";
import { commitInChunks } from "../utils/helpers";
import { deleteStorageFile, logStorageCleanupError } from "../utils/storage";
import {
    sanitizeDisplayText,
    validateDocId,
    validateStorageImageUrl,
    validateStr,
    validateUrl
} from "../utils/validation";

export const requestBadgeDeletion = onCall({maxInstances: 10}, async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Must be signed in.");
    const uid = request.auth.uid;
    await checkRateLimit(uid);

    const badgeId = validateDocId((request.data as {badgeId?: string})?.badgeId, "badgeId");
    const deleteAt = deletionExpiresAt();

    await adminTransaction(uid, async (txn, callerSnap) => {
        const badgeSnap = await txn.get(db.collection("badges").doc(badgeId));
        if (!badgeSnap.exists) throw new HttpsError("not-found", "Badge not found.");
        const data = badgeSnap.data()!;

        if (data.deleteAt && data.deleteAt.toMillis() > Date.now()) {
            throw new HttpsError("already-exists", "deletion-already-pending");
        }

        txn.update(db.collection("badges").doc(badgeId), {deleteAt});
        txn.set(db.collection("records").doc(), {
            type: "badge-deletion-requested",
            performedBy: uid,
            performedByName: callerSnap.data()?.displayName ?? "",
            badgeId,
            badgeName: data.name ?? badgeId,
            timestamp: FieldValue.serverTimestamp(),
            expiresAt: recordExpiresAt(),
        });
    });

    return {deleteAt: deleteAt.toDate().toISOString()};
});
export const cancelBadgeDeletion = onCall({maxInstances: 10}, async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Must be signed in.");
    const uid = request.auth.uid;
    await checkRateLimit(uid);

    const badgeId = validateDocId((request.data as {badgeId?: string})?.badgeId, "badgeId");

    await adminTransaction(uid, async (txn, callerSnap) => {
        const badgeSnap = await txn.get(db.collection("badges").doc(badgeId));
        if (!badgeSnap.exists) throw new HttpsError("not-found", "Badge not found.");
        const data = badgeSnap.data()!;

        if (!data.deleteAt || data.deleteAt.toMillis() <= Date.now()) {
            throw new HttpsError("not-found", "No pending deletion.");
        }

        txn.update(db.collection("badges").doc(badgeId), {deleteAt: FieldValue.delete()});
        txn.set(db.collection("records").doc(), {
            type: "badge-deletion-cancelled",
            performedBy: uid,
            performedByName: callerSnap.data()?.displayName ?? "",
            badgeId,
            badgeName: data.name ?? badgeId,
            timestamp: FieldValue.serverTimestamp(),
            expiresAt: recordExpiresAt(),
        });
    });

    return {cancelled: true};
});
export const onBadgeDeleted = onDocumentDeleted(
    {document: "badges/{badgeId}", maxInstances: 10},
    async (event) => {
        const data = event.data?.data();
        const badgeId = event.params.badgeId;
        if (!data?.deleteAt) return;

        try {
            const [codesSnap, holdersSnap] = await Promise.all([
                db.collection("badgeActivationCodes").where("badgeId", "==", badgeId).get(),
                db.collection("users").where("badges", "array-contains", badgeId).get(),
            ]);
            const cascadeOps: ((b: FirebaseFirestore.WriteBatch) => void)[] = [
                ...codesSnap.docs.map(d => (b: FirebaseFirestore.WriteBatch) => b.delete(d.ref)),
                ...holdersSnap.docs.map(d => (b: FirebaseFirestore.WriteBatch) =>
                    b.update(d.ref, {badges: FieldValue.arrayRemove(badgeId)})
                ),
            ];
            if (cascadeOps.length > 0) await commitInChunks(cascadeOps);
        } catch (err) {
            console.error(`onBadgeDeleted: cascade failed for ${badgeId}`, err);
        }

        await deleteStorageFile(data.imageUrl ?? "", ["badges/"])
            .catch(logStorageCleanupError(`onBadgeDeleted ${badgeId}`));

        try {
            await db.collection("records").add({
                type: "badge-deleted",
                badgeId,
                badgeName: data.name ?? "",
                timestamp: FieldValue.serverTimestamp(),
                expiresAt: recordExpiresAt(),
            });
        } catch (err) {
            console.error(`onBadgeDeleted: record write failed for ${badgeId}`, err);
        }
    }
);
export const saveBadge = onCall({maxInstances: 10}, async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Must be signed in.");
    const uid = request.auth.uid;
    await checkRateLimit(uid);

    const input = request.data as Record<string, unknown>;
    const badgeId = input.badgeId ? validateDocId(input.badgeId, "badgeId") : null;
    const name = validateStr(input.name, "name", 200, true);
    const nameCn = validateStr(input.nameCn, "nameCn", 200);
    const description = validateStr(input.description, "description", 2000);
    const descriptionCn = validateStr(input.descriptionCn, "descriptionCn", 2000);
    const imageUrl = validateStr(input.imageUrl, "imageUrl", 500);
    validateStorageImageUrl(imageUrl, "imageUrl");
    // createdByUid/Name/Link are for crediting the badge designer (not the admin who enters it).
    // The actual admin who performed the action is recorded as createdBy/performedBy.
    const createdByUid = validateStr(input.createdByUid, "createdByUid", 128);
    const createdByName = sanitizeDisplayText(validateStr(input.createdByName, "createdByName", 100));
    const createdByLink = validateStr(input.createdByLink, "createdByLink", 500);
    validateUrl(createdByLink, "createdByLink");

    const newRef = badgeId ? null : db.collection("badges").doc();

    const {result, oldImageUrl} = await adminTransaction(uid, async (txn, callerSnap) => {
        // Validate createdByUid references an existing user if provided
        if (createdByUid) {
            const creatorSnap = await txn.get(db.collection("users").doc(createdByUid));
            if (!creatorSnap.exists) {
                throw new HttpsError("invalid-argument", "createdByUid does not reference an existing user.");
            }
        }

        if (badgeId) {
            const existing = await txn.get(db.collection("badges").doc(badgeId));
            if (!existing.exists) throw new HttpsError("not-found", "Badge not found.");
            const prevImageUrl: string = existing.data()?.imageUrl ?? "";

            txn.update(db.collection("badges").doc(badgeId), {
                name, nameCn, description, descriptionCn, imageUrl,
                createdByUid, createdByName, createdByLink,
            });
            txn.set(db.collection("records").doc(), {
                type: "badge-edit",
                performedBy: uid,
                performedByName: callerSnap.data()?.displayName ?? "",
                badgeId,
                badgeName: name,
                timestamp: FieldValue.serverTimestamp(),
                expiresAt: recordExpiresAt(),
            });
            return {result: {badgeId}, oldImageUrl: prevImageUrl};
        }

        txn.set(newRef!, {
            name, nameCn, description, descriptionCn, imageUrl,
            createdBy: uid,
            createdByUid, createdByName, createdByLink,
            createdAt: FieldValue.serverTimestamp(),
        });
        txn.set(db.collection("records").doc(), {
            type: "badge-create",
            performedBy: uid,
            performedByName: callerSnap.data()?.displayName ?? "",
            badgeId: newRef!.id,
            badgeName: name,
            timestamp: FieldValue.serverTimestamp(),
            expiresAt: recordExpiresAt(),
        });
        return {result: {badgeId: newRef!.id}, oldImageUrl: ""};
    });

    if (oldImageUrl && oldImageUrl !== imageUrl) {
        await deleteStorageFile(oldImageUrl, ["badges/"])
            .catch(logStorageCleanupError(`saveBadge ${result.badgeId}`));
    }

    return result;
});
