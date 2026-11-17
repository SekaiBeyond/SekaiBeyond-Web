import { createHash } from "node:crypto";
import { Resolver } from "node:dns/promises";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { db } from "./firebase";
import { isApiOrder, isScannedTicket } from "./tickets";

export const normalizeEmail = (email: string): string => email.trim().toLowerCase();

const resolver = new Resolver({timeout: 2_000, tries: 2});

const NO_RECORD = new Set(["ENODATA", "ENOTFOUND"]);

const dnsErrorCode = (err: unknown): string => (err as {code?: string} | null)?.code ?? "";

export async function domainTakesMail(email: string): Promise<boolean> {
    if (process.env.FUNCTIONS_EMULATOR === "true") return true;
    const domain = email.slice(email.lastIndexOf("@") + 1);
    try {
        return (await resolver.resolveMx(domain)).some(mx => mx.exchange !== "");
    } catch (err) {
        if (dnsErrorCode(err) === "ENOTFOUND") return false;
        if (dnsErrorCode(err) !== "ENODATA") return true;
    }
    const answers = await Promise.allSettled([resolver.resolve4(domain), resolver.resolve6(domain)]);
    return !answers.every(answer => answer.status === "fulfilled"
        ? answer.value.length === 0
        : NO_RECORD.has(dnsErrorCode(answer.reason)));
}

export function maskEmail(email: string): string {
    const at = email.lastIndexOf("@");
    if (at < 1) return "•••";
    const local = email.slice(0, at);
    return `${local.slice(0, local.length > 3 ? 2 : 1)}•••${email.slice(at)}`;
}

const FORMER_EMAILS_MAX = 10;

const emailKey = (email: string): string => createHash("sha256").update(normalizeEmail(email)).digest("hex");

export function emailIndexRef(email: string): FirebaseFirestore.DocumentReference {
    return db.collection("emailIndex").doc(emailKey(email));
}

export function nextEmailChangeAt(changedAt: Date): Date {
    const year = changedAt.getUTCFullYear();
    const month = changedAt.getUTCMonth() + 1;
    const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    const next = new Date(changedAt);
    next.setUTCFullYear(year, month, Math.min(changedAt.getUTCDate(), lastDay));
    return next;
}

export function accountEmails(user: FirebaseFirestore.DocumentData | undefined): string[] {
    const former: unknown = user?.formerEmails;
    return [user?.email, ...(Array.isArray(former) ? former : [])]
        .filter((email): email is string => typeof email === "string" && email !== "");
}

export function addressLedToAccount(
    user: FirebaseFirestore.DocumentData | undefined,
    email: unknown,
    boughtAt: unknown,
): boolean {
    if (typeof email !== "string" || !email) return false;
    if (email === user?.email) return true;
    if (!accountEmails(user).includes(email)) return false;
    const leftAt: unknown = user?.formerEmailsLeftAt?.[emailKey(email)];
    return !(leftAt instanceof Timestamp)
        || (boughtAt instanceof Timestamp && boughtAt.toMillis() <= leftAt.toMillis());
}

export function formerEmailsAfter(
    user: FirebaseFirestore.DocumentData | undefined,
    {left = "", gone}: {left?: string; gone: string[]},
): {formerEmails: string[]; formerEmailsLeftAt: Record<string, Timestamp>} {
    const had: unknown = user?.formerEmails;
    const kept = (address: unknown): address is string =>
        typeof address === "string" && address !== "" && !gone.includes(address);
    const formerEmails = [left, ...(Array.isArray(had) ? had : [])]
        .filter(kept)
        .filter((address, i, all) => all.indexOf(address) === i)
        .slice(0, FORMER_EMAILS_MAX);

    const saidLeftAt: Record<string, unknown> = user?.formerEmailsLeftAt ?? {};
    const now = Timestamp.now();
    const formerEmailsLeftAt: Record<string, Timestamp> = {};
    for (const address of formerEmails) {
        const leftAt = address === left ? now : saidLeftAt[emailKey(address)];
        if (leftAt instanceof Timestamp) formerEmailsLeftAt[emailKey(address)] = leftAt;
    }
    return {formerEmails, formerEmailsLeftAt};
}

export async function accountByEmail(
    email: string,
    boughtAt: unknown,
    txn?: FirebaseFirestore.Transaction,
): Promise<FirebaseFirestore.QueryDocumentSnapshot | null> {
    if (!email) return null;
    const normalized = normalizeEmail(email);
    const users = db.collection("users");
    const read = (query: FirebaseFirestore.Query) => txn ? txn.get(query) : query.get();

    const current = await read(users.where("email", "==", normalized).limit(2));
    if (current.size > 0) return current.size === 1 ? current.docs[0] : null;

    const former = await read(users.where("formerEmails", "array-contains", normalized).limit(2));
    if (former.size !== 1) return null;
    return addressLedToAccount(former.docs[0].data(), normalized, boughtAt) ? former.docs[0] : null;
}

export async function creditScannedTickets(
    userRef: FirebaseFirestore.DocumentReference,
    email: string,
): Promise<void> {
    const snap = await db.collectionGroup("attendees").where("email", "==", email).get();
    const eventRefs = new Map<string, FirebaseFirestore.DocumentReference>();
    for (const doc of snap.docs) {
        if (isApiOrder(doc.data())) continue;
        const eventRef = doc.ref.parent.parent;
        const root = eventRef?.parent.id;
        if (!eventRef || (root !== "pastEvents" && root !== "upcomingEvents")) continue;
        const tickets: unknown[] = Array.isArray(doc.data().tickets) ? doc.data().tickets : [];
        if (tickets.some(isScannedTicket)) eventRefs.set(eventRef.id, eventRef);
    }
    if (eventRefs.size === 0) return;

    const events = await db.getAll(...eventRefs.values());
    const ids = events.filter(e => e.exists).map(e => e.id);
    if (ids.length > 0) await userRef.update({attendedEvents: FieldValue.arrayUnion(...ids)});
}
