import type { DecodedIdToken } from "firebase-admin/auth";
import { db } from "./firebase";
import { recordDoc, recordRef } from "./records";

/**
 * An account is its uid, not its email: users/{uid}.email is a copy of the
 * Google account's address, which can change, so two accounts may hold the
 * same one, a live account and one its owner's Google account has since moved
 * off. Matching by email (a ticket's buyer to the account checked in) must
 * never pick one of two at random, so:
 *
 * - every sign-in brings the account's copy up to date and takes the address
 *   off any other account still holding it (claimAccountEmail), since Firebase
 *   Auth lets only one account sign in with an address at a time;
 * - a lookup names an account only when exactly one holds the address
 *   (accountByEmail), so a tie left from before credits nobody until one of
 *   the two signs in.
 *
 * Addresses are stored and matched trimmed and lowercased.
 */

export const normalizeEmail = (email: string): string => email.trim().toLowerCase();

/** The token's address, normalized, once Google says it's the holder's; "" otherwise. */
export function verifiedEmail(token: DecodedIdToken): string {
    return token.email && token.email_verified === true ? normalizeEmail(token.email) : "";
}

/** Holders past this are a corrupt list, not stale copies: claiming takes it off the first few. */
const EMAIL_HOLDERS_MAX = 10;

/**
 * The one account holding `email`, or null when none does or more than one
 * does. Reads inside `txn` when given one, so a credit locks what it read.
 */
export async function accountByEmail(
    email: string,
    txn?: FirebaseFirestore.Transaction,
): Promise<FirebaseFirestore.QueryDocumentSnapshot | null> {
    if (!email) return null;
    const query = db.collection("users").where("email", "==", normalizeEmail(email)).limit(2);
    const snap = txn ? await txn.get(query) : await query.get();
    return snap.size === 1 ? snap.docs[0] : null;
}

/**
 * Makes `email` the address of `uid`'s account alone, in two steps so it fits
 * a transaction's reads-then-writes: this reads the other accounts holding it,
 * and the function it returns writes. Each account it's taken off gets a
 * record, as nobody asked for that.
 */
export async function claimAccountEmail(
    txn: FirebaseFirestore.Transaction,
    uid: string,
    email: string,
): Promise<(callerName: string) => void> {
    const snap = await txn.get(db.collection("users").where("email", "==", email).limit(EMAIL_HOLDERS_MAX));
    const others = snap.docs.filter(doc => doc.id !== uid);
    return (callerName: string) => {
        for (const other of others) {
            txn.update(other.ref, {email: ""});
            txn.set(recordRef(), recordDoc("account-email-release", {
                performedBy: uid,
                performedByName: callerName,
                targetUid: other.id,
                targetName: other.data().displayName ?? "",
                targetEmail: email,
            }));
        }
    };
}
