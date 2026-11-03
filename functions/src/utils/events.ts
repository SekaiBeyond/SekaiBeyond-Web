import { HttpsError } from "firebase-functions/v2/https";
import { db } from "./firebase";

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
 * Whether a save request marks the event as a Con, or undefined when it left
 * `con` out. A form from before Cons leaves it out, and must not clear a
 * stored one, so an update then keeps the mark and a new event isn't a Con.
 * The year isn't sent: the save takes it from the event's date.
 */
export function validateConInput(raw: unknown): boolean | undefined {
    if (raw === undefined) return undefined;
    if (raw === null || typeof raw === "boolean") return raw === true;
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
