import { createHash, randomBytes } from "node:crypto";
import { Timestamp } from "firebase-admin/firestore";
import { PUBLIC_ORIGIN } from "./config";
import { db } from "./firebase";

/**
 * The link in the notice an old address gets when an account moves off it, for
 * an owner who didn't make that change. One doc per change in emailUndos, named
 * by a hash of the token, so a copy of the database can't be used to follow one.
 *
 * It's the mailbox the account was on that counts, so whoever holds that mailbox
 * can use the link for EMAIL_UNDO_DAYS, even someone who is why the owner moved.
 * That's why the new address is told when it's used, and why staff moves, made
 * because a mailbox is lost or compromised, don't get a link at all.
 */

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

// After the #, so it never reaches a server's logs or anyone's Referer header.
export const emailUndoUrl = (token: string): string => `${PUBLIC_ORIGIN}/undo-email#token=${token}`;

/**
 * Whether an emailUndos doc can still be followed, given its account's user doc
 * `user`: it hasn't expired, and the account is still where the link left it. A
 * link not yet used needs the account on the address it moved to. One whose
 * restore went through but whose signing out didn't (`restoredAt`) needs it back
 * on the old one, so following it again can finish the job.
 */
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

/**
 * The account `email` is held for by a link that can still undo its move off
 * that address (see emailUndoLive), and when the hold ends, or null. Read inside
 * `txn` when given one. Links of `exceptUid` don't count.
 *
 * An address an account moves off stays that account's while the link works. The
 * link is how an owner whose sign-in was stolen gets the account back, and it
 * needs the address free: anyone taking it meanwhile would leave the link dead,
 * the owner included, when they can't sign in and make a new account instead.
 */
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

/** The account's links that can still be followed (see emailUndoLive), read inside `txn`. */
export async function liveEmailUndos(
    txn: FirebaseFirestore.Transaction,
    uid: string,
    user: FirebaseFirestore.DocumentData | undefined,
): Promise<FirebaseFirestore.QueryDocumentSnapshot[]> {
    const undos = await txn.get(db.collection("emailUndos").where("uid", "==", uid));
    return undos.docs.filter(undo => emailUndoLive(undo, user));
}
