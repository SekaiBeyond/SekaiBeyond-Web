import { HttpsError, onCall } from "firebase-functions/v2/https";
import { onDocumentDeleted } from "firebase-functions/v2/firestore";
import { FieldValue } from "firebase-admin/firestore";
import { adminTransaction, requireAuth } from "../utils/auth";
import { cancelDeletion, type Deletable, requestDeletion } from "../utils/deletion";
import { db } from "../utils/firebase";
import { commitInChunks } from "../utils/helpers";
import { deleteStorageFile, logStorageCleanupError, requireNewlyLinkedFilesExist } from "../utils/storage";
import { recordDoc, recordRef } from "../utils/records";
import {
    sanitizeDisplayText,
    validateDocId,
    validateStorageImageUrl,
    validateStr,
    validateUrl
} from "../utils/validation";

const BADGE: Deletable = {
    collection: "badges",
    idField: "badgeId",
    notFound: "Badge not found.",
    requested: "badge-deletion-requested",
    cancelled: "badge-deletion-cancelled",
    describe: (badgeId, data) => ({badgeId, badgeName: data.name ?? badgeId}),
};

export const requestBadgeDeletion = onCall({maxInstances: 10}, request => requestDeletion(request, BADGE));
export const cancelBadgeDeletion = onCall({maxInstances: 10}, request => cancelDeletion(request, BADGE));
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
            await recordRef().set(recordDoc("badge-deleted", {
                badgeId,
                badgeName: data.name ?? "",
            }));
        } catch (err) {
            console.error(`onBadgeDeleted: record write failed for ${badgeId}`, err);
        }
    }
);
export const saveBadge = onCall({maxInstances: 10}, async (request) => {
    const uid = await requireAuth(request, "staff");

    const input = request.data as Record<string, unknown>;
    const badgeId = input.badgeId ? validateDocId(input.badgeId, "badgeId") : null;
    const name = validateStr(input.name, "name", 200, true);
    const nameCn = validateStr(input.nameCn, "nameCn", 200);
    const description = validateStr(input.description, "description", 2000);
    const descriptionCn = validateStr(input.descriptionCn, "descriptionCn", 2000);
    const imageUrl = validateStr(input.imageUrl, "imageUrl", 500);
    validateStorageImageUrl(imageUrl, "imageUrl");
    // createdBy* credits the badge's designer; the admin who saves it is recorded as
    // performedBy.
    const createdByUid = validateStr(input.createdByUid, "createdByUid", 128);
    const createdByName = sanitizeDisplayText(validateStr(input.createdByName, "createdByName", 100));
    const createdByLink = validateStr(input.createdByLink, "createdByLink", 500);
    validateUrl(createdByLink, "createdByLink");

    const newRef = badgeId ? null : db.collection("badges").doc();

    const {result, oldImageUrl} = await adminTransaction(uid, async (txn, callerSnap) => {
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
            await requireNewlyLinkedFilesExist([imageUrl], [prevImageUrl]);

            txn.update(db.collection("badges").doc(badgeId), {
                name, nameCn, description, descriptionCn, imageUrl,
                createdByUid, createdByName, createdByLink,
            });
            txn.set(recordRef(), recordDoc("badge-edit", {
                performedBy: uid,
                performedByName: callerSnap.data()?.displayName ?? "",
                badgeId,
                badgeName: name,
            }));
            return {result: {badgeId}, oldImageUrl: prevImageUrl};
        }

        txn.set(newRef!, {
            name, nameCn, description, descriptionCn, imageUrl,
            createdBy: uid,
            createdByUid, createdByName, createdByLink,
            createdAt: FieldValue.serverTimestamp(),
        });
        txn.set(recordRef(), recordDoc("badge-create", {
            performedBy: uid,
            performedByName: callerSnap.data()?.displayName ?? "",
            badgeId: newRef!.id,
            badgeName: name,
        }));
        return {result: {badgeId: newRef!.id}, oldImageUrl: ""};
    });

    if (oldImageUrl && oldImageUrl !== imageUrl) {
        await deleteStorageFile(oldImageUrl, ["badges/"])
            .catch(logStorageCleanupError(`saveBadge ${result.badgeId}`));
    }

    return result;
});
