import { type CallableRequest, HttpsError } from "firebase-functions/v2/https";
import type { DecodedIdToken } from "firebase-admin/auth";
import { FieldValue } from "firebase-admin/firestore";
import { activeBan } from "./bans";
import { db } from "./firebase";
import { isSiteSignIn, sessionIdOf, sessionRef, signedInSinceSessionsEnded, UNLISTED_GRACE_SECONDS, } from "./sessions";

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 10;

const RATE_LIMIT_BUCKETS = {
    scan: 60,
    "hometown-import": 60,
    staff: 120,
    account: 60,
};
type RateLimitBucket = keyof typeof RATE_LIMIT_BUCKETS;

async function checkRateLimit(uid: string, requested?: RateLimitBucket): Promise<void> {
    let bucket = requested;
    if (bucket === "staff" && !isStaffOrAbove((await db.collection("users").doc(uid).get()).data()?.group)) {
        bucket = undefined;
    }
    await consumeRateLimit(bucket ? `${uid}_${bucket}` : uid, bucket ? RATE_LIMIT_BUCKETS[bucket] : RATE_LIMIT_MAX);
}

const API_KEY_RATE_LIMIT_MAX = 120;

export async function checkApiKeyRateLimit(keyId: string): Promise<void> {
    await consumeRateLimit(`apiKey_${keyId}`, API_KEY_RATE_LIMIT_MAX);
}

const rateLimitRef = (docId: string, windowStart: number) =>
    db.collection("rateLimits").doc(`${docId}_${windowStart}`);

export async function chargeRateLimit(
    docId: string,
    max: number,
    windowMs: number = RATE_LIMIT_WINDOW_MS,
): Promise<{allowed: boolean; retryAfterMs: number}> {
    const now = Date.now();
    const windowStart = now - now % windowMs;
    const ref = rateLimitRef(docId, windowStart);
    const expiresAt = new Date(windowStart + windowMs * 2);

    await ref.set({count: FieldValue.increment(1), expiresAt}, {merge: true});
    const count = (await ref.get()).get("count");
    return {allowed: !(typeof count === "number" && count > max), retryAfterMs: windowStart + windowMs - now};
}

export async function consumeRateLimit(
    docId: string,
    max: number,
    windowMs: number = RATE_LIMIT_WINDOW_MS,
): Promise<void> {
    const {allowed, retryAfterMs} = await chargeRateLimit(docId, max, windowMs);
    if (!allowed) {
        throw new HttpsError("resource-exhausted", "Too many requests. Please wait a moment.", {
            code: "rate-limited",
            retryAfterMs,
        });
    }
}

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

const USER_GROUPS = ["user", "staff", "core-staff", "president"] as const;
export type UserGroup = typeof USER_GROUPS[number];

export const MANAGEABLE_GROUPS: string[] = ["user", "staff"];

export function normalizeGroup(raw: unknown): UserGroup {
    return raw === "staff" || raw === "core-staff" || raw === "president" ? raw : "user";
}

export function isValidGroup(raw: unknown): raw is UserGroup {
    return typeof raw === "string" && (USER_GROUPS as readonly string[]).includes(raw);
}

export function isStaffOrAbove(rawGroup: unknown): boolean {
    return normalizeGroup(rawGroup) !== "user";
}

export function requireCanManage(callerGroup: unknown, targetGroup: unknown): void {
    if (callerGroup !== "president" && !MANAGEABLE_GROUPS.includes(normalizeGroup(targetGroup))) {
        throw new HttpsError("permission-denied", "Cannot manage users at or above your level.");
    }
}

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

async function requireLiveSession(uid: string, token: DecodedIdToken): Promise<boolean> {
    if (!isSiteSignIn(token)) {
        throw new HttpsError("unauthenticated", "This device isn't signed in properly.", {code: "session-ended"});
    }
    const sessionId = sessionIdOf(token);
    const snap = sessionId ? await sessionRef(uid, sessionId).get() : null;
    const unlistedLive = async () => {
        const user = (await db.collection("users").doc(uid).get()).data();
        return signedInSinceSessionsEnded(token, user) && !activeBan(user);
    };
    const live = snap?.exists
        ? !snap.get("endedAt")
        : !!sessionId && Date.now() / 1000 - token.auth_time < UNLISTED_GRACE_SECONDS && await unlistedLive();
    if (!live) {
        throw new HttpsError("unauthenticated", "This device has been signed out.", {code: "session-ended"});
    }
    return !!snap?.exists;
}

export async function requireAdmin(uid: string): Promise<FirebaseFirestore.DocumentSnapshot> {
    const snap = await db.collection("users").doc(uid).get();
    if (!ADMIN_GROUPS.includes(snap.data()?.group)) {
        throw new HttpsError("permission-denied", "Insufficient permissions.");
    }
    return snap;
}

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
