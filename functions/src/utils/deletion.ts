import { type CallableRequest, HttpsError } from "firebase-functions/v2/https";
import { FieldValue } from "firebase-admin/firestore";
import { adminTransaction, requireAuth } from "./auth";
import { deletionExpiresAt } from "./config";
import { db } from "./firebase";
import { performer, recordDoc, type RecordFields, recordRef, type RecordType } from "./records";
import { validateDocId } from "./validation";

export function deletionPending(data: FirebaseFirestore.DocumentData): boolean {
    return !!data.deleteAt && data.deleteAt.toMillis() > Date.now();
}

export interface Deletable {
    collection: string;
    idField: string;
    notFound: string;
    requested: RecordType;
    cancelled: RecordType;
    describe: (id: string, data: FirebaseFirestore.DocumentData) => RecordFields;
}

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
            ...performer(uid, callerSnap),
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
