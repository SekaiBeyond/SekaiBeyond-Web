import { createHash, randomBytes } from "node:crypto";
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
