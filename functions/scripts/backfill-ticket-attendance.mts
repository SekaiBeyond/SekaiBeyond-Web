// One-off: credit accounts with the paid events their email was scanned into
// but that never reached them, because the account was made after the event
// ended. createUserProfile does this at sign-up from now on; this catches the
// accounts made before it did.
//
// Dry run by default; --apply writes. Runs as you, through Application Default
// Credentials (`gcloud auth application-default login`), from functions/:
//
//   node scripts/backfill-ticket-attendance.mts [--project <id>] [--apply]
//
// Safe to re-run: an account already credited, or staff for the event, is
// skipped, and the write is an arrayUnion.
import { readFileSync } from "node:fs";
import { initializeApp } from "firebase-admin/app";
import { type DocumentReference, FieldValue, getFirestore, type QueryDocumentSnapshot } from "firebase-admin/firestore";

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const projectFlag = args.indexOf("--project");

function defaultProject(): string | undefined {
    try {
        const rc = JSON.parse(readFileSync(new URL("../../.firebaserc", import.meta.url), "utf-8"));
        return rc.projects?.default;
    } catch {
        return undefined;
    }
}

const projectId = (projectFlag >= 0 ? args[projectFlag + 1] : undefined)
    ?? process.env.GOOGLE_CLOUD_PROJECT
    ?? defaultProject();
if (!projectId) {
    console.error("No project: pass --project <id> or set GOOGLE_CLOUD_PROJECT.");
    process.exit(1);
}

initializeApp({projectId});
const db = getFirestore();

// Scanned-in emails per event, from every ticket list. Same test as
// getMyTickets and createUserProfile: redeemed and not voided.
const scannedEmails = new Map<string, {ref: DocumentReference; emails: Set<string>}>();
for (const doc of (await db.collectionGroup("attendees").get()).docs) {
    const eventRef = doc.ref.parent.parent;
    const root = eventRef?.parent.id;
    if (!eventRef || (root !== "pastEvents" && root !== "upcomingEvents")) continue;
    const data = doc.data();
    const email = typeof data.email === "string" ? data.email.trim().toLowerCase() : "";
    const tickets: unknown[] = Array.isArray(data.tickets) ? data.tickets : [];
    const scanned = tickets.some(raw => {
        const t = raw as {redeemed?: unknown; voided?: unknown} | null;
        return t?.redeemed === true && t.voided !== true;
    });
    if (!email || !scanned) continue;
    const entry = scannedEmails.get(eventRef.id) ?? {ref: eventRef, emails: new Set<string>()};
    entry.emails.add(email);
    scannedEmails.set(eventRef.id, entry);
}

if (scannedEmails.size === 0) {
    console.log(`${projectId}: no scanned tickets found.`);
    process.exit(0);
}

const usersByEmail = new Map<string, QueryDocumentSnapshot[]>();
for (const user of (await db.collection("users").get()).docs) {
    const email = typeof user.data().email === "string" ? user.data().email.trim().toLowerCase() : "";
    if (!email) continue;
    usersByEmail.set(email, [...(usersByEmail.get(email) ?? []), user]);
}

const events = await db.getAll(...[...scannedEmails.values()].map(e => e.ref));
const credits = new Map<string, {ref: DocumentReference; eventIds: string[]}>();
for (const event of events) {
    // A deleted event's ticket list outlives it when its cleanup fails.
    if (!event.exists) continue;
    const found: string[] = [];
    for (const email of scannedEmails.get(event.id)!.emails) {
        for (const user of usersByEmail.get(email) ?? []) {
            const attended: string[] = user.data().attendedEvents ?? [];
            // Staff and attendee are exclusive; toggleAttendance refuses the pair.
            const staffed: string[] = user.data().eventStaffEvents ?? [];
            if (attended.includes(event.id) || staffed.includes(event.id)) continue;
            const eventIds = credits.get(user.id)?.eventIds ?? [];
            credits.set(user.id, {ref: user.ref, eventIds: [...eventIds, event.id]});
            found.push(user.data().displayName || user.id);
        }
    }
    if (found.length > 0) {
        const title = event.data()?.title || event.id;
        console.log(`${title} (${event.ref.parent.id}/${event.id}): ${found.length} to credit`);
        for (const name of found) console.log(`  ${name}`);
    }
}

const total = [...credits.values()].reduce((n, c) => n + c.eventIds.length, 0);
if (total === 0) {
    console.log(`${projectId}: every scanned-in account is already credited.`);
    process.exit(0);
}
if (!apply) {
    console.log(`\n${projectId}: dry run; ${total} credit(s) across ${credits.size} account(s). Re-run with --apply to write.`);
    process.exit(0);
}

const pending = [...credits.values()];
for (let i = 0; i < pending.length; i += 500) {
    const batch = db.batch();
    for (const c of pending.slice(i, i + 500)) {
        batch.update(c.ref, {attendedEvents: FieldValue.arrayUnion(...c.eventIds)});
    }
    await batch.commit();
}
console.log(`\n${projectId}: wrote ${total} credit(s) across ${credits.size} account(s).`);
