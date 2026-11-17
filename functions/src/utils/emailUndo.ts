import { createHash, randomBytes } from "node:crypto";
import { Timestamp } from "firebase-admin/firestore";
import { PUBLIC_ORIGIN } from "./config";
import { db } from "./firebase";

export const EMAIL_UNDO_DAYS = 7;

const TOKEN_RE = /^[0-9a-f]{64}$/;

export function newEmailUndoToken(): string {
    return randomBytes(32).toString("hex");
}

export function emailUndoRef(token: string): FirebaseFirestore.DocumentReference {
    return db.collection("emailUndos").doc(createHash("sha256").update(token).digest("hex"));
}

export const isEmailUndoToken = (value: unknown): value is string =>
    typeof value === "string" && TOKEN_RE.test(value);

export const emailUndoUrl = (token: string): string => `${PUBLIC_ORIGIN}/undo-email#token=${token}`;

export function emailUndoLive(
    undo: FirebaseFirestore.DocumentSnapshot,
    user: FirebaseFirestore.DocumentData | undefined,
): boolean {
    const expiresAt: unknown = undo.get("expiresAt");
    if (!(expiresAt instanceof Timestamp) || expiresAt.toMillis() <= Date.now() || !user) return false;
    return undo.get("restoredAt")
        ? user.email === undo.get("oldEmail")
        : user.email === undo.get("newEmail");
}

export async function addressHeldForUndo(
    email: string,
    txn?: FirebaseFirestore.Transaction,
    exceptUid?: string,
): Promise<{uid: string; until: Timestamp} | null> {
    const query = db.collection("emailUndos").where("oldEmail", "==", email);
    const undos = txn ? await txn.get(query) : await query.get();
    for (const undo of undos.docs) {
        const uid: unknown = undo.get("uid");
        if (typeof uid !== "string" || uid === exceptUid) continue;
        const userRef = db.collection("users").doc(uid);
        const user = txn ? await txn.get(userRef) : await userRef.get();
        if (emailUndoLive(undo, user.data())) return {uid, until: undo.get("expiresAt")};
    }
    return null;
}

export async function liveEmailUndos(
    txn: FirebaseFirestore.Transaction,
    uid: string,
    user: FirebaseFirestore.DocumentData | undefined,
): Promise<FirebaseFirestore.QueryDocumentSnapshot[]> {
    const undos = await txn.get(db.collection("emailUndos").where("uid", "==", uid));
    return undos.docs.filter(undo => emailUndoLive(undo, user));
}
