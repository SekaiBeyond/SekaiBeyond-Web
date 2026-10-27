import type { Timestamp } from "firebase-admin/firestore";
import { db } from "./firebase";

/** The string ids in a raw Firestore array field, ignoring anything else. */
export function toStringIds(raw: unknown): string[] {
    return Array.isArray(raw) ? raw.filter((id: unknown): id is string => typeof id === "string") : [];
}

/**
 * Which of the given ids name an existing past event. Public profiles only
 * publish past-event ids: an upcoming id would leak an unpublished event's
 * title. Takes every list at once, since attended and staffed events overlap.
 */
export async function pastEventIds(...lists: unknown[]): Promise<Set<string>> {
    const ids = [...new Set(lists.flatMap(toStringIds))];
    if (ids.length === 0) return new Set();
    const snaps = await db.getAll(...ids.map(id => db.collection("pastEvents").doc(id)));
    return new Set(ids.filter((_, i) => snaps[i].exists));
}

/** One passport on a public profile: what its shelf card shows, and no more. */
export interface ShelfPassport {
    id: string;
    designId: string;
    year: number;
    claimedAt: string | null;
}

/**
 * The passports bound to a member, newest year first and then latest activated,
 * as their own shelf orders them. Their keys, delivery and generation stay out.
 */
export async function shelfPassports(uid: string): Promise<ShelfPassport[]> {
    const snap = await db.collection("passports").where("ownerUid", "==", uid).get();
    return snap.docs
        .filter(doc => doc.data().status === "claimed")
        .map(doc => {
            const data = doc.data();
            return {
                id: doc.id,
                designId: typeof data.designId === "string" ? data.designId : "",
                year: typeof data.year === "number" ? data.year : 0,
                claimedAt: (data.claimedAt as Timestamp | null)?.toDate?.()?.toISOString() ?? null,
            };
        })
        .sort((a, b) => b.year - a.year || (b.claimedAt ?? "").localeCompare(a.claimedAt ?? ""));
}
