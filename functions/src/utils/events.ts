import { HttpsError } from "firebase-functions/v2/https";
import { Timestamp } from "firebase-admin/firestore";
import { db } from "./firebase";
import { toStringIds } from "./publicProfile";
import { validateDocId, validateStr, validateStringArray } from "./validation";

export const staffEventsIn = (user: FirebaseFirestore.DocumentSnapshot): string[] =>
    toStringIds(user.get("eventStaffEvents"));

export const RESERVED_ID_RE = /^__.*__$/;

export function soonestFirst<T extends FirebaseFirestore.DocumentSnapshot>(snaps: T[]): T[] {
    const startMs = (snap: T) => (snap.get("startAt") as Timestamp).toMillis();
    return snaps
        .filter(snap => snap.get("startAt") instanceof Timestamp)
        .sort((a, b) => startMs(a) - startMs(b) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

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

export function validateVenueId(raw: unknown): string {
    const venueId = validateStr(raw, "venueId", 128);
    return venueId ? validateDocId(venueId, "venueId") : "";
}

export const MAX_ROOMS = 50;
export const ROOM_ID_RE = /^[A-Za-z0-9-]{1,64}$/;

export interface Room {
    id: string;
    nameEn: string;
    nameCn: string;
}

const text = (v: unknown): string => typeof v === "string" ? v.trim() : "";

export function venueRooms(venue: FirebaseFirestore.DocumentData | undefined): Room[] {
    const raw: unknown[] = Array.isArray(venue?.rooms) ? venue.rooms : [];
    return raw
        .map((r: any) => ({id: text(r?.id), nameEn: text(r?.nameEn), nameCn: text(r?.nameCn)}))
        .filter(r => r.id.length > 0);
}

export function validateRoomIds(raw: unknown, venueId: string): string[] {
    if (!Array.isArray(raw)) throw new HttpsError("invalid-argument", "roomIds must be a list.");
    const roomIds = validateStringArray(raw, "roomIds", MAX_ROOMS, 64);
    for (const id of roomIds) {
        if (!ROOM_ID_RE.test(id)) throw new HttpsError("invalid-argument", "Invalid roomIds.");
    }
    if (roomIds.length > 0 && !venueId) {
        throw new HttpsError("invalid-argument", "Pick a venue for the rooms.");
    }
    return roomIds;
}

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

interface ConInfo {
    year: number;
}

export function conForDay(day: string): ConInfo {
    return {year: Number(day.slice(0, 4))};
}

export function validateConInput(raw: unknown): boolean {
    if (typeof raw === "boolean") return raw;
    throw new HttpsError("invalid-argument", "Invalid con.");
}

export function readConInfo(raw: unknown): ConInfo | null {
    if (!raw || typeof raw !== "object") return null;
    const {year} = raw as Record<string, unknown>;
    if (typeof year !== "number" || !Number.isInteger(year)) return null;
    return {year};
}

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
