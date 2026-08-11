import { Timestamp } from "firebase-admin/firestore";

const DAY_MS = 24 * 60 * 60 * 1000;

// Membership is a time-boxed attribute sitting alongside `group`, never inside it.
// Nothing is written to the user document when a membership starts, so nothing has
// to be unwound when it ends — `membershipExpiresAt <= now` *is* the lapsed state,
// which is why there is no scheduled sweep and no group ever changes on expiry.
export function isMembershipActive(data: FirebaseFirestore.DocumentData | undefined): boolean {
    const expiresAt = data?.membershipExpiresAt;
    return expiresAt instanceof Timestamp && expiresAt.toMillis() > Date.now();
}

// Grants stack: extending an active membership adds to its tail, while extending a
// lapsed or never-held one starts from today. Passport claims (#9) use this too, so
// claiming two passports the same day is two years rather than one.
export function extendedExpiry(current: unknown, days: number): Timestamp {
    const active = current instanceof Timestamp && current.toMillis() > Date.now();
    const base = active ? (current as Timestamp).toMillis() : Date.now();
    return Timestamp.fromMillis(base + days * DAY_MS);
}

// Ceiling on a single admin grant. Not a cap on total membership — stacked grants
// can carry someone past this — just a guard against a mistyped day count.
export const MAX_GRANT_DAYS = 3650;
