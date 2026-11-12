import { type CallableRequest, HttpsError } from "firebase-functions/v2/https";
import type { DecodedIdToken } from "firebase-admin/auth";
import { FieldValue } from "firebase-admin/firestore";
import { db } from "./firebase";
import { sessionIdOf, sessionRef, signedInSinceSessionsEnded, UNLISTED_GRACE_SECONDS } from "./sessions";

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 10;

/**
 * Calls that run at a pace of their own, each with a per-minute budget kept
 * apart from the shared one: a door scans a ticket every few seconds, a large
 * HomeTown file goes up in dozens of chunks, and staff at work in the admin
 * panel make many calls a minute, account lookups and quota checks among them.
 *
 * The shared budget is there to stop code guessing, so the calls anyone can
 * make keep it, account calls aside; the staff one is only a ceiling on a
 * runaway loop.
 */
const RATE_LIMIT_BUCKETS = {
    scan: 60,
    "hometown-import": 60,
    staff: 120,
    // The Settings tab loads an account's sign-in methods each time it opens, so
    // this keeps reloading it from spending what a redeem code needs. What these
    // calls protect has limits of its own (utils/emailCodes.ts).
    account: 60,
};
type RateLimitBucket = keyof typeof RATE_LIMIT_BUCKETS;

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

const rateLimitRef = (docId: string, windowStart: number) =>
    db.collection("rateLimits").doc(`${docId}_${windowStart}`);

/**
 * Counts a call against a budget of `max` a window (a minute unless given), one
 * doc per budget per window, and says whether it's within it and, if not, how
 * long until the window reopens. An increment and then a read rather than a
 * transaction: calls made at once on one budget would fight over a transaction's
 * lock, and the losers fail with ABORTED instead of a rate limit. A refused call
 * still counts, which only holds until the window is up.
 *
 * consumeRateLimit refuses for you; this is for a caller that refuses in its
 * own words.
 */
export async function chargeRateLimit(
    docId: string,
    max: number,
    windowMs: number = RATE_LIMIT_WINDOW_MS,
): Promise<{allowed: boolean; retryAfterMs: number}> {
    const now = Date.now();
    const windowStart = now - now % windowMs;
    const ref = rateLimitRef(docId, windowStart);
    // expiresAt lets the TTL policy in firestore.indexes.json delete stale documents.
    const expiresAt = new Date(windowStart + windowMs * 2);

    await ref.set({count: FieldValue.increment(1), expiresAt}, {merge: true});
    const count = (await ref.get()).get("count");
    return {allowed: !(typeof count === "number" && count > max), retryAfterMs: windowStart + windowMs - now};
}

/** Counts a call against a budget (see chargeRateLimit), refusing it once over. */
export async function consumeRateLimit(
    docId: string,
    max: number,
    windowMs: number = RATE_LIMIT_WINDOW_MS,
): Promise<void> {
    const {allowed, retryAfterMs} = await chargeRateLimit(docId, max, windowMs);
    if (!allowed) {
        // retryAfterMs: until the window reopens, so a caller can say how long to wait.
        throw new HttpsError("resource-exhausted", "Too many requests. Please wait a moment.", {
            code: "rate-limited",
            retryAfterMs,
        });
    }
}

/** Whether a budget kept by chargeRateLimit has room for one more call, without using any. */
export async function rateLimitHasRoom(
    docId: string,
    max: number,
    windowMs: number = RATE_LIMIT_WINDOW_MS,
): Promise<boolean> {
    const now = Date.now();
    const count = (await rateLimitRef(docId, now - now % windowMs).get()).get("count");
    return !(typeof count === "number" && count >= max);
}

export const ADMIN_GROUPS = ["core-staff", "president"];

// `group` is a role ladder only; membership lives in membershipExpiresAt.
const USER_GROUPS = ["user", "staff", "core-staff", "president"] as const;
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

/** The caller, and whether their device is on the account's device list yet. */
async function authenticate(
    request: CallableRequest<unknown>,
    bucket?: RateLimitBucket,
): Promise<{uid: string; listed: boolean}> {
    if (!request.auth) {
        throw new HttpsError("unauthenticated", "Must be signed in.");
    }
    const uid = request.auth.uid;
    const [, listed] = await Promise.all([checkRateLimit(uid, bucket), requireLiveSession(uid, request.auth.token)]);
    return {uid, listed};
}

export async function requireAuth(request: CallableRequest<unknown>, bucket?: RateLimitBucket): Promise<string> {
    return (await authenticate(request, bucket)).uid;
}

/**
 * The caller, for a call that changes how an account signs in or ends it, which
 * only a device on the account's list may make. requireAuth gives a new sign-in
 * a few minutes to list itself (touchSession); here it has to have, as one that
 * hasn't is one its owner can't see to sign out. Any real device has by the time
 * it can open Settings.
 */
export async function requireRegisteredSession(
    request: CallableRequest<unknown>,
    bucket?: RateLimitBucket,
): Promise<string> {
    const {uid, listed} = await authenticate(request, bucket);
    if (!listed) {
        throw new HttpsError("unauthenticated", "This device isn't signed in properly.", {code: "session-ended"});
    }
    return uid;
}

/**
 * Refuses a call from a device signed out from the device list, whose token
 * still works with Firebase Auth, or from a sign-in that has gone unlisted for
 * longer than a new device needs to list itself (UNLISTED_GRACE_SECONDS), or
 * one unlisted from before the account's devices were last signed out
 * (signedInSinceSessionsEnded). firestore.rules holds reads to the same
 * (liveSession). Says whether the device is listed.
 */
async function requireLiveSession(uid: string, token: DecodedIdToken): Promise<boolean> {
    const sessionId = sessionIdOf(token);
    const snap = sessionId ? await sessionRef(uid, sessionId).get() : null;
    const live = snap?.exists
        ? !snap.get("endedAt")
        : !!sessionId && Date.now() / 1000 - token.auth_time < UNLISTED_GRACE_SECONDS
        && signedInSinceSessionsEnded(token, (await db.collection("users").doc(uid).get()).data());
    if (!live) {
        throw new HttpsError("unauthenticated", "This device has been signed out.", {code: "session-ended"});
    }
    return !!snap?.exists;
}

/** The caller's user doc, refused unless they're core staff or above. */
export async function requireAdmin(uid: string): Promise<FirebaseFirestore.DocumentSnapshot> {
    const snap = await db.collection("users").doc(uid).get();
    if (!ADMIN_GROUPS.includes(snap.data()?.group)) {
        throw new HttpsError("permission-denied", "Insufficient permissions.");
    }
    return snap;
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
