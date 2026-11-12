import { HttpsError } from "firebase-functions/v2/https";
import { Timestamp } from "firebase-admin/firestore";
import { db } from "./firebase";
import { toStringIds } from "./publicProfile";
import { validateDocId, validateStr, validateStringArray } from "./validation";

/** The events a user is event staff for, from their user doc, archived ones too. */
export const staffEventsIn = (user: FirebaseFirestore.DocumentSnapshot): string[] =>
    toStringIds(user.get("eventStaffEvents"));

/** Firestore keeps IDs like __x__ for itself and refuses to read one, so no event has one. */
export const RESERVED_ID_RE = /^__.*__$/;

/**
 * Unarchived events (upcomingEvents docs) in the site's order: soonest start
 * first, then by ID, as a query ordered by startAt has them. One missing its
 * start isn't one, as on the site's lists.
 */
export function soonestFirst<T extends FirebaseFirestore.DocumentSnapshot>(snaps: T[]): T[] {
    const startMs = (snap: T) => (snap.get("startAt") as Timestamp).toMillis();
    return snaps
        .filter(snap => snap.get("startAt") instanceof Timestamp)
        .sort((a, b) => startMs(a) - startMs(b) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

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

/** The most rooms a venue has. */
export const MAX_ROOMS = 50;
/** A room's ID, which the venue editor makes up: a UUID. */
export const ROOM_ID_RE = /^[A-Za-z0-9-]{1,64}$/;

/** A venue's room, as saveVenue stores it. Mirrors Room in app/lib/venues.ts. */
export interface Room {
    id: string;
    nameEn: string;
    nameCn: string;
}

const text = (v: unknown): string => typeof v === "string" ? v.trim() : "";

/** A venue doc's rooms, in order, skipping any without an ID. */
export function venueRooms(venue: FirebaseFirestore.DocumentData | undefined): Room[] {
    const raw: unknown[] = Array.isArray(venue?.rooms) ? venue.rooms : [];
    return raw
        .map((r: any) => ({id: text(r?.id), nameEn: text(r?.nameEn), nameCn: text(r?.nameCn)}))
        .filter(r => r.id.length > 0);
}

/**
 * An event's `roomIds` from a save: rooms of its venue, so none without one.
 * null when the save sends none, as one from an editor older than rooms does
 * (see roomIdsKept).
 */
export function validateRoomIds(raw: unknown, venueId: string): string[] | null {
    if (raw === undefined) return null;
    const roomIds = validateStringArray(raw, "roomIds", MAX_ROOMS, 64);
    for (const id of roomIds) {
        if (!ROOM_ID_RE.test(id)) throw new HttpsError("invalid-argument", "Invalid roomIds.");
    }
    if (roomIds.length > 0 && !venueId) {
        throw new HttpsError("invalid-argument", "Pick a venue for the rooms.");
    }
    return roomIds;
}

/**
 * The rooms a save that sends none keeps: the event's own, while its venue
 * stays. `existing` is the saved event, or undefined for a new one.
 */
export function roomIdsKept(existing: FirebaseFirestore.DocumentData | undefined, venueId: string): string[] {
    if (!existing || existing.venueId !== venueId || !Array.isArray(existing.roomIds)) return [];
    return existing.roomIds.filter((id: unknown): id is string => typeof id === "string");
}

/**
 * Refuses a venue that's gone, as one deleted since the form loaded
 * (deleteVenue takes it off the events using it), or a room it no longer has
 * (saveVenue takes a removed room off them). Returns `roomIds` in the venue's
 * order. "" is no venue. Reads in `txn`, so call it before the transaction's
 * writes.
 */
export async function requireVenueRooms(
    txn: FirebaseFirestore.Transaction,
    venueId: string,
    roomIds: string[],
): Promise<string[]> {
    if (!venueId) return [];
    const snap = await txn.get(db.collection("venues").doc(venueId));
    if (!snap.exists) {
        throw new HttpsError("not-found", "That venue has been deleted. Reload and pick another.");
    }
    const rooms = venueRooms(snap.data()).map(r => r.id);
    if (roomIds.some(id => !rooms.includes(id))) {
        throw new HttpsError("not-found", "A room you picked has been removed from that venue. Reload and pick again.");
    }
    return rooms.filter(id => roomIds.includes(id));
}

/**
 * An event's location in one language, as the site shows it
 * (eventLocationDisplay in app/lib/venues.ts): its venue's name and rooms,
 * "Husky Union Building · 214, 250", else its own text. Chinese falls back to
 * English piece by piece. `venue` is the event's venue doc, or undefined for none.
 */
export function eventLocationText(
    event: FirebaseFirestore.DocumentData,
    venue: FirebaseFirestore.DocumentData | undefined,
    isEnglish: boolean,
): string {
    const pick = (en: unknown, cn: unknown) => isEnglish ? text(en) : (text(cn) || text(en));
    if (!venue) return pick(event.location, event.locationCn);
    const roomIds: unknown[] = Array.isArray(event.roomIds) ? event.roomIds : [];
    const rooms = venueRooms(venue).filter(r => roomIds.includes(r.id)).map(r => pick(r.nameEn, r.nameCn));
    const name = pick(venue.nameEn, venue.nameCn);
    return rooms.length > 0 ? `${name} · ${rooms.join(isEnglish ? ", " : "、")}` : name;
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
