import { Timestamp } from "firebase-admin/firestore";
import { addSiteDays } from "./siteTime";

const DAY_MS = 24 * 60 * 60 * 1000;

export function isMembershipActive(data: FirebaseFirestore.DocumentData | undefined): boolean {
    const expiresAt = data?.membershipExpiresAt;
    return expiresAt instanceof Timestamp && expiresAt.toMillis() > Date.now();
}

export function extendedExpiry(current: unknown, days: number): Timestamp {
    const active = current instanceof Timestamp && current.toMillis() > Date.now();
    const base = active ? (current as Timestamp).toMillis() : Date.now();
    return Timestamp.fromMillis(addSiteDays(base, days));
}

export function reducedExpiry(current: unknown, days: number): {expiresAt: Timestamp; daysRemoved: number} | null {
    if (!(current instanceof Timestamp)) return null;
    const now = Date.now();
    if (current.toMillis() <= now) return null;
    const floored = Math.max(now, addSiteDays(current.toMillis(), -days));
    return {
        expiresAt: Timestamp.fromMillis(floored),
        daysRemoved: Math.round((current.toMillis() - floored) / DAY_MS),
    };
}

export function startedAtAfter(current: FirebaseFirestore.DocumentData, next: Timestamp | null): Timestamp | null {
    if (!next || next.toMillis() <= Date.now()) return null;
    return isMembershipActive(current) ? current.membershipStartedAt : Timestamp.now();
}

export const MAX_GRANT_DAYS = 3650;
