import { Timestamp } from "firebase-admin/firestore";
import { addSiteDays } from "./siteTime";

const DAY_MS = 24 * 60 * 60 * 1000;

// Membership sits beside `group`, never inside it. `membershipExpiresAt <= now` is
// the lapsed state, so nothing needs unwinding on expiry: no sweep, no group
// change.
export function isMembershipActive(data: FirebaseFirestore.DocumentData | undefined): boolean {
    const expiresAt = data?.membershipExpiresAt;
    return expiresAt instanceof Timestamp && expiresAt.toMillis() > Date.now();
}

// Grants stack: an active membership extends from its end, a lapsed or new one from
// today, so two passports claimed the same day give two years. Days are counted on
// the Pacific calendar, so an end-of-day expiry stays there across DST.
export function extendedExpiry(current: unknown, days: number): Timestamp {
    const active = current instanceof Timestamp && current.toMillis() > Date.now();
    const base = active ? (current as Timestamp).toMillis() : Date.now();
    return Timestamp.fromMillis(addSiteDays(base, days));
}

/**
 * Take days back off a membership, never past today.
 *
 * Unlike extendedExpiry, this stops at zero: nobody is left owing membership, and
 * it can't eat days another grant paid for. A lapsed membership comes back
 * untouched.
 *
 * `daysRemoved` is what was actually taken: less than asked at the floor, 0 when
 * there was nothing. Callers then write nothing.
 */
export function reducedExpiry(current: unknown, days: number): {expiresAt: Timestamp; daysRemoved: number} | null {
    if (!(current instanceof Timestamp)) return null;
    const now = Date.now();
    if (current.toMillis() <= now) return null;
    const floored = Math.max(now, addSiteDays(current.toMillis(), -days));
    return {
        expiresAt: Timestamp.fromMillis(floored),
        // Rounded, as a day across DST is 23 or 25 hours; the expiry itself is
        // exact.
        daysRemoved: Math.round((current.toMillis() - floored) / DAY_MS),
    };
}

// When the membership running to `next` began: kept for one still running, today
// for a new one, null (written as a delete) when none is left.
export function startedAtAfter(current: FirebaseFirestore.DocumentData, next: Timestamp | null): Timestamp | null {
    if (!next || next.toMillis() <= Date.now()) return null;
    return isMembershipActive(current) ? current.membershipStartedAt : Timestamp.now();
}

// A guard against a mistyped day count, not a cap on total membership.
export const MAX_GRANT_DAYS = 3650;
