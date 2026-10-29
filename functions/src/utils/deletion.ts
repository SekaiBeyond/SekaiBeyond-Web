import { type CallableRequest, HttpsError } from "firebase-functions/v2/https";
import { FieldValue } from "firebase-admin/firestore";
import { adminTransaction, requireAuth } from "./auth";
import { deletionExpiresAt } from "./config";
import { db } from "./firebase";
import { recordDoc, type RecordFields, recordRef, type RecordType } from "./records";
import { validateDocId } from "./validation";

/**
 * Deleting a badge, an event or an account sets `deleteAt` instead, and the
 * TTL policy on it (firestore.indexes.json) deletes the doc once the cooldown
 * has passed. Until then the deletion can be cancelled.
 */

/** Whether a doc's deletion cooldown is running. */
export function deletionPending(data: FirebaseFirestore.DocumentData): boolean {
    return !!data.deleteAt && data.deleteAt.toMillis() > Date.now();
}

/** A kind of doc core staff delete with a cooldown. */
export interface Deletable {
    collection: string;
    /** The request field naming the doc. */
    idField: string;
    notFound: string;
    requested: RecordType;
    cancelled: RecordType;
    /** What the deletion's records say of the doc. */
    describe: (id: string, data: FirebaseFirestore.DocumentData) => RecordFields;
}

/**
 * Reads the doc a deletion request names, as core staff, and applies `change`
 * to it with its record.
 */
async function changeDeletion(
    request: CallableRequest,
    kind: Deletable,
    change: (data: FirebaseFirestore.DocumentData) => {
        deleteAt: FirebaseFirestore.Timestamp | FieldValue;
        recordType: RecordType;
    },
): Promise<void> {
    const uid = await requireAuth(request, "staff");
    const id = validateDocId((request.data as Record<string, unknown> | null)?.[kind.idField], kind.idField);
    const ref = db.collection(kind.collection).doc(id);

    await adminTransaction(uid, async (txn, callerSnap) => {
        const snap = await txn.get(ref);
        if (!snap.exists) throw new HttpsError("not-found", kind.notFound);
        const data = snap.data()!;
        const {deleteAt, recordType} = change(data);

        txn.update(ref, {deleteAt});
        txn.set(recordRef(), recordDoc(recordType, {
            performedBy: uid,
            performedByName: callerSnap.data()?.displayName ?? "",
            ...kind.describe(id, data),
        }));
    });
}

export async function requestDeletion(request: CallableRequest, kind: Deletable): Promise<{deleteAt: string}> {
    const deleteAt = deletionExpiresAt();
    await changeDeletion(request, kind, data => {
        if (deletionPending(data)) throw new HttpsError("already-exists", "deletion-already-pending");
        return {deleteAt, recordType: kind.requested};
    });
    return {deleteAt: deleteAt.toDate().toISOString()};
}

export async function cancelDeletion(request: CallableRequest, kind: Deletable): Promise<{cancelled: boolean}> {
    await changeDeletion(request, kind, data => {
        if (!deletionPending(data)) throw new HttpsError("not-found", "No pending deletion.");
        return {deleteAt: FieldValue.delete(), recordType: kind.cancelled};
    });
    return {cancelled: true};
}
