import { createHash } from "node:crypto";
import type { DecodedIdToken } from "firebase-admin/auth";
import { FieldValue } from "firebase-admin/firestore";
import { db } from "./firebase";
import { recordDoc, recordRef } from "./records";
import { isApiOrder, isScannedTicket } from "./tickets";

/**
 * An account is its uid, and its address is users/{uid}.email: ours, verified
 * when it was set, and nothing a sign-in provider can change. emailIndex holds
 * one doc per address in use, so that two accounts can't take the same one.
 *
 * An account keeps the addresses it has moved off in users/{uid}.formerEmails,
 * since tickets are matched by address: one bought under an old address stays
 * its holder's. Taking an address off one account's former list is part of
 * another claiming it, so an address only ever leads to one account.
 *
 * Addresses are stored and matched trimmed and lowercased.
 */

export const normalizeEmail = (email: string): string => email.trim().toLowerCase();

/** The token's address, normalized, once Google says it's the holder's; "" otherwise. */
export function verifiedEmail(token: DecodedIdToken): string {
    return token.email && token.email_verified === true ? normalizeEmail(token.email) : "";
}

/**
 * An address shown to someone who may not own it, such as whoever holds a
 * passport key emailed to it: enough for its owner to know it, and no more.
 * "alice@gmail.com" becomes "al•••@gmail.com".
 */
export function maskEmail(email: string): string {
    const at = email.lastIndexOf("@");
    if (at < 1) return "•••";
    const local = email.slice(0, at);
    return `${local.slice(0, local.length > 3 ? 2 : 1)}•••${email.slice(at)}`;
}

/** Old addresses an account remembers, the oldest going first. Well within a Firestore `in` query's 30. */
export const FORMER_EMAILS_MAX = 10;

/** The doc that says who holds `email`, named by a hash since an address can hold a "/". */
export function emailIndexRef(email: string): FirebaseFirestore.DocumentReference {
    return db.collection("emailIndex").doc(createHash("sha256").update(normalizeEmail(email)).digest("hex"));
}

/** Every address tickets may be matched to an account by, its own first. */
export function accountEmails(user: FirebaseFirestore.DocumentData | undefined): string[] {
    const former: unknown = user?.formerEmails;
    return [user?.email, ...(Array.isArray(former) ? former : [])]
        .filter((email): email is string => typeof email === "string" && email !== "");
}

/**
 * The account `email` leads to, its current holder before a former one, or null
 * when none does or more than one does. Reads inside `txn` when given one, so a
 * credit locks what it read.
 */
export async function accountByEmail(
    email: string,
    txn?: FirebaseFirestore.Transaction,
): Promise<FirebaseFirestore.QueryDocumentSnapshot | null> {
    if (!email) return null;
    const normalized = normalizeEmail(email);
    const users = db.collection("users");
    const read = (query: FirebaseFirestore.Query) => txn ? txn.get(query) : query.get();

    const current = await read(users.where("email", "==", normalized).limit(2));
    if (current.size > 0) return current.size === 1 ? current.docs[0] : null;

    const former = await read(users.where("formerEmails", "array-contains", normalized).limit(2));
    return former.size === 1 ? former.docs[0] : null;
}

/** Holders past this are a corrupt list, not stale copies: claiming takes it off the first few. */
const EMAIL_HOLDERS_MAX = 10;

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

/**
 * Credit a new account with the paid events its email was scanned into. The
 * scanner only credits accounts that already existed, and getMyTickets only
 * while the event is live, so a sign-up after the event ends is caught here.
 *
 * Only a verified email may claim its tickets, which every account address is.
 * The collection-group query uses the attendees.email override in
 * firestore.indexes.json.
 */
export async function creditScannedTickets(
    userRef: FirebaseFirestore.DocumentReference,
    email: string,
): Promise<void> {
    const snap = await db.collectionGroup("attendees").where("email", "==", email).get();
    const eventRefs = new Map<string, FirebaseFirestore.DocumentReference>();
    for (const doc of snap.docs) {
        // An app order is its app user's, not the account's (see creditedEmail).
        if (isApiOrder(doc.data())) continue;
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
