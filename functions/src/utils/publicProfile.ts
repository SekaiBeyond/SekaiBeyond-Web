import { db } from "./firebase";
import { isoOrNull } from "./helpers";

export function toStringIds(raw: unknown): string[] {
    return Array.isArray(raw) ? raw.filter((id: unknown): id is string => typeof id === "string") : [];
}

export async function pastEventIds(...lists: unknown[]): Promise<Set<string>> {
    const ids = [...new Set(lists.flatMap(toStringIds))];
    if (ids.length === 0) return new Set();
    const snaps = await db.getAll(...ids.map(id => db.collection("pastEvents").doc(id)));
    return new Set(ids.filter((_, i) => snaps[i].exists));
}

interface ShelfPassport {
    id: string;
    designId: string;
    year: number;
    claimedAt: string | null;
}

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
                claimedAt: isoOrNull(data.claimedAt),
            };
        })
        .sort((a, b) => b.year - a.year || (b.claimedAt ?? "").localeCompare(a.claimedAt ?? ""));
}
