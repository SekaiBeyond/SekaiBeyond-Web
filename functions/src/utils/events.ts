import { HttpsError } from "firebase-functions/v2/https";
import { db } from "./firebase";
import { validateDocId, validateStr } from "./validation";

/**
 * An event's doc from whichever collection holds it: upcomingEvents, or
 * pastEvents once archived, which keeps the ID. Archiving refuses an ID a past
 * event already has, so the two never both hold one. `snap` doesn't exist when
 * neither does. Read in `txn` when given one.
 */
export async function getEventDoc(
    eventId: string,
    txn?: FirebaseFirestore.Transaction,
): Promise<{snap: FirebaseFirestore.DocumentSnapshot; archived: boolean}> {
    const read = (ref: FirebaseFirestore.DocumentReference) => txn ? txn.get(ref) : ref.get();
    const [upcoming, past] = await Promise.all([
        read(db.collection("upcomingEvents").doc(eventId)),
        read(db.collection("pastEvents").doc(eventId)),
    ]);
    return upcoming.exists ? {snap: upcoming, archived: false} : {snap: past, archived: true};
}

/**
 * `tagIds` without the ones whose tag is gone, so a tag deleted since the form
 * loaded isn't saved back onto an event (deleteTag takes it off the events
 * holding it). Reads in `txn`, so call it before the transaction's writes.
 */
export async function existingTagIds(
    txn: FirebaseFirestore.Transaction,
    tagIds: string[],
): Promise<string[]> {
    const unique = [...new Set(tagIds)];
    if (unique.length === 0) return [];
    const snaps = await txn.getAll(...unique.map(id => db.collection("eventLabels").doc(id)));
    const found = new Set(snaps.filter(s => s.exists).map(s => s.id));
    return unique.filter(id => found.has(id));
}

/** An event's `venueId` from a save: "" for none, else a venue's doc ID. */
export function validateVenueId(raw: unknown): string {
    const venueId = validateStr(raw, "venueId", 128);
    return venueId ? validateDocId(venueId, "venueId") : "";
}

/**
 * Refuses a venue that's gone, as one deleted since the form loaded
 * (deleteVenue takes it off the events using it). "" is no venue. Reads in
 * `txn`, so call it before the transaction's writes.
 */
export async function requireVenueExists(txn: FirebaseFirestore.Transaction, venueId: string): Promise<void> {
    if (!venueId) return;
    if (!(await txn.get(db.collection("venues").doc(venueId))).exists) {
        throw new HttpsError("not-found", "That venue has been deleted. Reload and pick another.");
    }
}

/**
 * Marks an event, upcoming or past, as that year's Sekai Beyond Con. Mirrors
 * ConInfo in app/lib/conEditions.ts. Archiving carries it across.
 */
export interface ConInfo {
    year: number;
}

/** The Con an event on `day` (YYYY-MM-DD) is: one a year, so its year is its date's. */
export function conForDay(day: string): ConInfo {
    return {year: Number(day.slice(0, 4))};
}

/**
 * Whether a save request marks the event as a Con. The year isn't sent: the
 * save takes it from the event's date.
 */
export function validateConInput(raw: unknown): boolean {
    if (typeof raw === "boolean") return raw;
    throw new HttpsError("invalid-argument", "Invalid con.");
}

/** A stored `con` as the site reads it. */
export function readConInfo(raw: unknown): ConInfo | null {
    if (!raw || typeof raw !== "object") return null;
    const {year} = raw as Record<string, unknown>;
    if (typeof year !== "number" || !Number.isInteger(year)) return null;
    return {year};
}

/**
 * Refuses a second Con for `year`: one edition a year, upcoming or archived.
 * `eventId` is the event being saved, which may already hold it. Reads in
 * `txn`, so call it before the transaction's writes.
 */
export async function requireConYearFree(
    txn: FirebaseFirestore.Transaction,
    year: number,
    eventId: string,
): Promise<void> {
    const [upcoming, past] = await Promise.all([
        txn.get(db.collection("upcomingEvents").where("con.year", "==", year)),
        txn.get(db.collection("pastEvents").where("con.year", "==", year)),
    ]);
    const other = [...upcoming.docs, ...past.docs].find(d => d.id !== eventId);
    if (other) {
        const title = other.data().title || other.id;
        throw new HttpsError("already-exists", `Sekai Beyond Con ${year} is already "${title}".`);
    }
}
