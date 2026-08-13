import { db } from "./firebase";

/** The string ids in a raw Firestore array field, ignoring anything else. */
export function toStringIds(raw: unknown): string[] {
    return Array.isArray(raw) ? raw.filter((id: unknown): id is string => typeof id === "string") : [];
}

/**
 * Which of the given ids name an existing past event.
 *
 * A public profile publishes past-event ids only: an upcoming-event id would
 * leak an unpublished event whose title is otherwise gated by Firestore rules.
 * Both public projections (getPublicProfile, and getPassportPublicProfile, which
 * a signed-out scanner reaches) filter through here, so that rule has exactly
 * one implementation.
 *
 * Callers hand over every list they need resolved at once: a member's attended
 * and staffed events overlap almost entirely, and the union is read once.
 */
export async function pastEventIds(...lists: unknown[]): Promise<Set<string>> {
    const ids = [...new Set(lists.flatMap(toStringIds))];
    if (ids.length === 0) return new Set();
    const snaps = await db.getAll(...ids.map(id => db.collection("pastEvents").doc(id)));
    return new Set(ids.filter((_, i) => snaps[i].exists));
}
