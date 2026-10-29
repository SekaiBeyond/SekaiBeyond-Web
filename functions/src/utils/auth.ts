import { type CallableRequest, HttpsError } from "firebase-functions/v2/https";
import { FieldValue } from "firebase-admin/firestore";
import { db } from "./firebase";

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 10;

/**
 * Calls that run at a pace of their own, each with a per-minute budget kept
 * apart from the shared one: a door scans a ticket every few seconds, a large
 * HomeTown file goes up in dozens of chunks, and staff at work in the admin
 * panel make many calls a minute, account lookups and quota checks among them.
 *
 * The shared budget is there to stop code guessing, so the calls anyone can
 * make keep it; the staff one is only a ceiling on a runaway loop.
 */
const RATE_LIMIT_BUCKETS = {
    scan: 60,
    "hometown-import": 60,
    staff: 120,
};
export type RateLimitBucket = keyof typeof RATE_LIMIT_BUCKETS;

async function checkRateLimit(uid: string, requested?: RateLimitBucket): Promise<void> {
    // The staff budget is for staff and above only: anyone else trying a staff
    // call is charged the shared one, as for any other call.
    let bucket = requested;
    if (bucket === "staff" && !isStaffOrAbove((await db.collection("users").doc(uid).get()).data()?.group)) {
        bucket = undefined;
    }
    await consumeRateLimit(bucket ? `${uid}_${bucket}` : uid, bucket ? RATE_LIMIT_BUCKETS[bucket] : RATE_LIMIT_MAX);
}

/** Calls one API key may make a minute. A seller's server, not a person, so well above the shared budget. */
const API_KEY_RATE_LIMIT_MAX = 120;

/** Charges a call to an API key's own budget, named by its ID so it can't share a counter with an account. */
export async function checkApiKeyRateLimit(keyId: string): Promise<void> {
    await consumeRateLimit(`apiKey_${keyId}`, API_KEY_RATE_LIMIT_MAX);
}

async function consumeRateLimit(docId: string, max: number): Promise<void> {
    const ref = db.collection("rateLimits").doc(docId);
    const now = Date.now();
    // expiresAt lets the TTL policy in firestore.indexes.json delete stale documents.
    const expiresAt = new Date(now + RATE_LIMIT_WINDOW_MS * 2);

    await db.runTransaction(async (txn) => {
        const snap = await txn.get(ref);
        const data = snap.data() as {count: number; windowStart: number} | undefined;

        if (!data || now - data.windowStart > RATE_LIMIT_WINDOW_MS) {
            txn.set(ref, {count: 1, windowStart: now, expiresAt});
            return;
        }

        if (data.count >= max) {
            // retryAfterMs: until the window reopens, so a caller can say how long to wait.
            throw new HttpsError("resource-exhausted", "Too many requests. Please wait a moment.", {
                code: "rate-limited",
                retryAfterMs: data.windowStart + RATE_LIMIT_WINDOW_MS - now,
            });
        }

        txn.update(ref, {count: FieldValue.increment(1)});
    });
}

export const ADMIN_GROUPS = ["core-staff", "president"];

// `group` is a role ladder only; membership lives in membershipExpiresAt.
export const USER_GROUPS = ["user", "staff", "core-staff", "president"] as const;
export type UserGroup = typeof USER_GROUPS[number];

// Groups core-staff may act on. President may act on anyone.
export const MANAGEABLE_GROUPS: string[] = ["user", "staff"];

// Anything that isn't a known group reads as the base group.
export function normalizeGroup(raw: unknown): UserGroup {
    return raw === "staff" || raw === "core-staff" || raw === "president" ? raw : "user";
}

// Unlike normalizeGroup this rejects rather than coerces, so `changeUserGroup`
// can't silently treat an unknown value as "user".
export function isValidGroup(raw: unknown): raw is UserGroup {
    return typeof raw === "string" && (USER_GROUPS as readonly string[]).includes(raw);
}

/** Staff, core-staff or president: anyone above the base group. */
export function isStaffOrAbove(rawGroup: unknown): boolean {
    return normalizeGroup(rawGroup) !== "user";
}

/**
 * Refuses unless a caller in `callerGroup` may act on a user in
 * `targetGroup`: the president on anyone, core-staff on MANAGEABLE_GROUPS.
 */
export function requireCanManage(callerGroup: unknown, targetGroup: unknown): void {
    if (callerGroup !== "president" && !MANAGEABLE_GROUPS.includes(normalizeGroup(targetGroup))) {
        throw new HttpsError("permission-denied", "Cannot manage users at or above your level.");
    }
}

export async function requireAuth(request: CallableRequest<unknown>, bucket?: RateLimitBucket): Promise<string> {
    if (!request.auth) {
        throw new HttpsError("unauthenticated", "Must be signed in.");
    }
    const uid = request.auth.uid;
    await checkRateLimit(uid, bucket);
    return uid;
}

export async function requireAdmin(uid: string): Promise<FirebaseFirestore.DocumentSnapshot> {
    return adminTransaction(uid, async (_txn, callerSnap) => callerSnap);
}

/** The caller's user doc, refused unless they're staff or above. */
export async function requireStaff(uid: string): Promise<FirebaseFirestore.DocumentSnapshot> {
    const snap = await db.collection("users").doc(uid).get();
    if (!isStaffOrAbove(snap.data()?.group)) {
        throw new HttpsError("permission-denied", "Insufficient permissions.");
    }
    return snap;
}

export async function adminTransaction<T>(
    uid: string,
    fn: (txn: FirebaseFirestore.Transaction, callerSnap: FirebaseFirestore.DocumentSnapshot) => Promise<T>
): Promise<T> {
    return db.runTransaction(async (txn) => {
        const callerSnap = await txn.get(db.collection("users").doc(uid));
        if (!ADMIN_GROUPS.includes(callerSnap.data()?.group)) {
            throw new HttpsError("permission-denied", "Insufficient permissions.");
        }
        return fn(txn, callerSnap);
    });
}
