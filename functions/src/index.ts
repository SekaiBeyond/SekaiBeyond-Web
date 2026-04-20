import { initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { FieldValue, getFirestore, Timestamp } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { onDocumentDeleted } from "firebase-functions/v2/firestore";
import { type CallableRequest, HttpsError, onCall } from "firebase-functions/v2/https";

import * as crypto from "crypto";

// Records are audit logs. Firestore TTL policy on `records.expiresAt`
// auto-deletes documents past this point (configure in Firebase console).
const RECORD_RETENTION_DAYS = 30;

function recordExpiresAt(): Timestamp {
    return Timestamp.fromMillis(Date.now() + RECORD_RETENTION_DAYS * 24 * 60 * 60 * 1000);
}

// Account deletion cooldown. Firestore TTL policy on
// `users.deleteAt` fires the onUserDeleted trigger, which performs the actual wipe
// (configure TTL on the deleteAt field in the Firebase console).
const DELETION_COOLDOWN_HOURS = 48;

function deletionExpiresAt(): Timestamp {
    return Timestamp.fromMillis(Date.now() + DELETION_COOLDOWN_HOURS * 60 * 60 * 1000);
}

initializeApp();
const db = getFirestore();

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 10;

async function checkRateLimit(uid: string): Promise<void> {
    const ref = db.collection("rateLimits").doc(uid);
    const now = Date.now();
    // expiresAt is used by Firestore TTL policy to auto-delete stale documents.
    // Configure TTL on the "expiresAt" field in the Firebase console.
    const expiresAt = new Date(now + RATE_LIMIT_WINDOW_MS * 2);

    await db.runTransaction(async (txn) => {
        const snap = await txn.get(ref);
        const data = snap.data() as {count: number; windowStart: number} | undefined;

        if (!data || now - data.windowStart > RATE_LIMIT_WINDOW_MS) {
            txn.set(ref, {count: 1, windowStart: now, expiresAt});
            return;
        }

        if (data.count >= RATE_LIMIT_MAX) {
            throw new HttpsError("resource-exhausted", "Too many requests. Please wait a moment.", {code: "rate-limited"});
        }

        txn.update(ref, {count: FieldValue.increment(1)});
    });
}

const ADMIN_GROUPS = ["core-staff", "president"];

async function requireAuth(request: CallableRequest<unknown>): Promise<string> {
    if (!request.auth) {
        throw new HttpsError("unauthenticated", "Must be signed in.");
    }
    const uid = request.auth.uid;
    await checkRateLimit(uid);
    return uid;
}

async function requireAdmin(uid: string): Promise<FirebaseFirestore.DocumentSnapshot> {
    const snap = await db.collection("users").doc(uid).get();
    if (!ADMIN_GROUPS.includes(snap.data()?.group)) {
        throw new HttpsError("permission-denied", "Insufficient permissions.");
    }
    return snap;
}

const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

function generateSecureCode(length: number): string {
    for (let attempt = 0; attempt < 5; attempt++) {
        const raw = crypto.randomBytes(length * 2);
        const chars: string[] = [];
        for (const b of raw) {
            if (chars.length >= length) break;
            if (b >= 248) continue;
            chars.push(CODE_ALPHABET[b % CODE_ALPHABET.length]);
        }
        if (chars.length >= length) return chars.join("");
    }
    throw new HttpsError("internal", "code-generation-failed");
}

/**
 * Shared validation for claim code documents.
 * Checks active status, time window, and max uses inside a transaction.
 */
function validateCodeInTransaction(data: {
    active?: boolean;
    activeFrom?: string;
    activeUntil?: string;
    usedCount?: number;
    maxUses?: number;
}): void {
    if (!data.active) {
        throw new HttpsError("failed-precondition", "This code is inactive.", {code: "inactive"});
    }

    const now = new Date();
    if (data.activeFrom && new Date(data.activeFrom) > now) {
        throw new HttpsError("failed-precondition", "This code is not active yet.", {code: "not-active-yet"});
    }
    if (data.activeUntil && new Date(data.activeUntil) < now) {
        throw new HttpsError("failed-precondition", "This code has expired.", {code: "expired"});
    }

    const usedCount = data.usedCount ?? 0;
    const maxUses = data.maxUses ?? 0;
    if (maxUses > 0 && usedCount >= maxUses) {
        throw new HttpsError("resource-exhausted", "This code has reached its maximum uses.", {code: "max-uses"});
    }
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})?)?$/;

function validateISODate(value: unknown, name: string): string | null {
    if (value === undefined || value === null || value === "") return null;
    if (typeof value !== "string" || !ISO_DATE_RE.test(value) || isNaN(Date.parse(value))) {
        throw new HttpsError("invalid-argument", `Invalid ${name}: must be an ISO 8601 date string.`);
    }
    return value;
}

function validateMaxUses(value: unknown): number {
    if (value === undefined || value === null) return 0;
    if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
        throw new HttpsError("invalid-argument", "Invalid maxUses: must be a non-negative integer.");
    }
    return value;
}

function validateDocId(value: unknown, name: string): string {
    if (typeof value !== "string" || value.length === 0 || value.length > 128) {
        throw new HttpsError("invalid-argument", `Invalid ${name}.`);
    }
    if (/[\/\0]/.test(value)) {
        throw new HttpsError("invalid-argument", `Invalid ${name}: illegal characters.`);
    }
    return value;
}

function validateUrl(value: string, name: string): void {
    if (!value) return;
    try {
        const url = new URL(value);
        if (url.protocol !== "https:") {
            throw new HttpsError("invalid-argument", `${name} must use https://.`);
        }
    } catch (e) {
        if (e instanceof HttpsError) throw e;
        throw new HttpsError("invalid-argument", `${name} must be a valid URL.`);
    }
}

function validateStorageImageUrl(value: string, name: string): void {
    if (!value) return;
    try {
        const url = new URL(value);
        const expectedPrefix = `/v0/b/${getStorage().bucket().name}/o/`;
        if (
            url.protocol !== "https:"
            || url.hostname !== "firebasestorage.googleapis.com"
            || !url.pathname.startsWith(expectedPrefix)
        ) {
            throw new HttpsError("invalid-argument", `${name} must be a Firebase Storage URL for this project.`);
        }
    } catch (e) {
        if (e instanceof HttpsError) throw e;
        throw new HttpsError("invalid-argument", `${name} must be a valid URL.`);
    }
}

async function adminTransaction<T>(
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

function validateStr(value: unknown, name: string, maxLen: number, required = false): string {
    if (value === undefined || value === null) value = "";
    if (typeof value !== "string") {
        throw new HttpsError("invalid-argument", `Invalid ${name}.`);
    }
    if (required && value.trim().length === 0) {
        throw new HttpsError("invalid-argument", `${name} is required.`);
    }
    if (value.length > maxLen) {
        throw new HttpsError("invalid-argument", `${name} exceeds maximum length.`);
    }
    return value;
}

function sanitizeDisplayText(value: string): string {
    return value.replace(/<[^>]*>/g, "").replace(/[\x00-\x1F\x7F]/g, " ").trim();
}

const ALLOWED_UPLOAD_PREFIXES = ["events/", "upcoming-events/", "badges/"];
const MAX_UPLOAD_SIZE = 5 * 1024 * 1024; // 5MB

function validateStoragePath(path: string): void {
    if (path.includes("..") || path.includes("\0") || path.includes("//")) {
        throw new HttpsError("invalid-argument", "Invalid path characters.");
    }
    if (!ALLOWED_UPLOAD_PREFIXES.some(prefix => path.startsWith(prefix))) {
        throw new HttpsError("invalid-argument", "Invalid path.");
    }
}

const IMAGE_SIGNATURES: {mime: string; magic: Buffer}[] = [
    {mime: "image/jpeg", magic: Buffer.from([0xFF, 0xD8, 0xFF])},
    {mime: "image/png", magic: Buffer.from([0x89, 0x50, 0x4E, 0x47])},
    {mime: "image/gif", magic: Buffer.from([0x47, 0x49, 0x46, 0x38])},
];

function detectImageMime(buffer: Buffer): string | null {
    // WebP uses a RIFF container — check bytes 0-3 for "RIFF" and bytes 8-11 for "WEBP"
    // to avoid false positives from other RIFF formats (WAV, AVI, etc.)
    if (buffer.length >= 12 &&
        buffer.subarray(0, 4).equals(Buffer.from([0x52, 0x49, 0x46, 0x46])) &&
        buffer.subarray(8, 12).equals(Buffer.from([0x57, 0x45, 0x42, 0x50]))) {
        return "image/webp";
    }
    const match = IMAGE_SIGNATURES.find(sig => buffer.length >= sig.magic.length &&
        buffer.subarray(0, sig.magic.length).equals(sig.magic));
    return match?.mime ?? null;
}

/**
 * Create a user profile (called on first sign-in).
 * Sets joinedAt and email server-side so they can't be faked.
 * Idempotent — uses a transaction to avoid race conditions on concurrent first-logins.
 */
export const createUserProfile = onCall({maxInstances: 20}, async (request) => {
    if (!request.auth) {
        throw new HttpsError("unauthenticated", "Must be signed in.");
    }

    const uid = request.auth.uid;
    await checkRateLimit(uid);

    const userRef = db.collection("users").doc(uid);

    const rawName = request.auth.token.name ?? "";
    const email = request.auth.token.email ?? "";
    const photoURL = request.auth.token.picture ?? "";

    const displayName = sanitizeDisplayText(typeof rawName === "string" ? rawName : "").slice(0, 50);

    let alreadyExists = false;

    await db.runTransaction(async (txn) => {
        const snap = await txn.get(userRef);
        if (snap.exists) {
            alreadyExists = true;
            return;
        }
        txn.set(userRef, {
            displayName,
            email: typeof email === "string" ? email : "",
            photoURL: typeof photoURL === "string" ? photoURL.slice(0, 500) : "",
            joinedAt: FieldValue.serverTimestamp(),
            attendedEvents: [],
            badges: [],
            group: "visitor",
        });
    });

    return {alreadyExists};
});

/**
 * Get a user's public profile (no email).
 * Used by the profile page when viewing another user.
 * Admin SDK bypasses Firestore rules, so this function controls which fields are exposed.
 */
export const getPublicProfile = onCall({maxInstances: 20}, async (request) => {
    if (!request.auth) {
        throw new HttpsError("unauthenticated", "Must be signed in.");
    }

    await checkRateLimit(request.auth.uid);

    const targetUid = validateDocId((request.data as {uid?: string})?.uid, "uid");
    const userSnap = await db.collection("users").doc(targetUid).get();
    if (!userSnap.exists) {
        throw new HttpsError("not-found", "User not found.");
    }

    const data = userSnap.data()!;
    const rawEarnedAt = (data.badgeEarnedAt ?? {}) as Record<string, Timestamp>;
    const badgeEarnedAt: Record<string, string> = {};
    for (const [k, v] of Object.entries(rawEarnedAt)) {
        const iso = v?.toDate?.()?.toISOString();
        if (iso) badgeEarnedAt[k] = iso;
    }
    return {
        displayName: data.displayName ?? "",
        photoURL: data.photoURL ?? "",
        joinedAt: data.joinedAt?.toDate?.()?.toISOString() ?? new Date().toISOString(),
        attendedEvents: data.attendedEvents ?? [],
        badges: data.badges ?? [],
        badgeEarnedAt,
        group: data.group ?? "visitor",
        title: data.title ?? "",
    };
});

/**
 * Update a user's display name.
 * Sanitizes input (strips control characters and HTML tags).
 */
export const updateDisplayName = onCall({maxInstances: 20}, async (request) => {
    if (!request.auth) {
        throw new HttpsError("unauthenticated", "Must be signed in.");
    }

    const uid = request.auth.uid;
    await checkRateLimit(uid);

    const raw = (request.data as {displayName?: string})?.displayName;
    if (typeof raw !== "string") {
        throw new HttpsError("invalid-argument", "displayName must be a string.");
    }

    const sanitized = sanitizeDisplayText(raw);
    if (sanitized.length === 0) {
        throw new HttpsError("invalid-argument", "displayName is required.");
    }
    if (sanitized.length > 50) {
        throw new HttpsError("invalid-argument", "displayName exceeds maximum length.");
    }

    const userRef = db.collection("users").doc(uid);
    const userSnap = await userRef.get();
    if (!userSnap.exists) {
        throw new HttpsError("not-found", "User not found.");
    }

    await userRef.update({displayName: sanitized});
    return {displayName: sanitized};
});

/**
 * Upload an image to Firebase Storage (admin only).
 * Verifies caller is core-staff+ before writing. Client sends base64-encoded image data.
 */
export const uploadAdminImage = onCall({maxInstances: 10}, async (request) => {
    const uid = await requireAuth(request);
    await requireAdmin(uid);

    const input = request.data as {
        path?: string;
        data?: string;
        contentType?: string;
    };

    const path = input.path;
    const dataBase64 = input.data;
    const contentType = input.contentType;

    if (!path || !dataBase64 || !contentType) {
        throw new HttpsError("invalid-argument", "Missing path, data, or contentType.");
    }
    validateStoragePath(path);

    if (contentType !== "image/webp") {
        throw new HttpsError("invalid-argument", "Only image/webp is allowed.");
    }

    const buffer = Buffer.from(dataBase64, "base64");
    if (buffer.length > MAX_UPLOAD_SIZE) {
        throw new HttpsError("invalid-argument", "Image exceeds 5MB limit.");
    }

    const detectedMime = detectImageMime(buffer);
    if (!detectedMime || detectedMime !== contentType) {
        throw new HttpsError("invalid-argument", "File content does not match claimed content type.");
    }

    const bucket = getStorage().bucket();
    const file = bucket.file(path);
    await file.save(buffer, {
        metadata: {contentType, cacheControl: "public, max-age=31536000, immutable"},
    });

    const downloadUrl = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(path)}?alt=media`;
    return {url: downloadUrl};
});

/**
 * Claim an event attendance code.
 * Validates the code server-side and atomically increments usedCount + adds event to user's attendedEvents.
 */
export const claimEventCode = onCall({maxInstances: 20}, async (request) => {
    const uid = await requireAuth(request);

    const code = (request.data as {code?: string})?.code?.trim().toUpperCase();
    if (!code || !/^[A-Z0-9]{6,20}$/.test(code)) {
        throw new HttpsError("invalid-argument", "Invalid or deactivated code.", {code: "invalid"});
    }

    const codeRef = db.collection("claimCodes").doc(code);
    const userRef = db.collection("users").doc(uid);

    return db.runTransaction(async (txn) => {
        const freshCode = await txn.get(codeRef);
        if (!freshCode.exists) throw new HttpsError("not-found", "Invalid or deactivated code.", {code: "invalid"});
        const data = freshCode.data()!;
        validateCodeInTransaction(data);

        const eventId: string = data.eventId;
        if (!eventId) throw new HttpsError("not-found", "Invalid or deactivated code.", {code: "invalid"});

        const [eventSnap, userSnap] = await Promise.all([
            txn.get(db.collection("upcomingEvents").doc(eventId)),
            txn.get(userRef),
        ]);
        // Forces retry if the event is concurrently deleted mid-claim
        if (!eventSnap.exists) throw new HttpsError("not-found", "Invalid or deactivated code.", {code: "invalid"});
        if (!userSnap.exists) throw new HttpsError("not-found", "Invalid or deactivated code.", {code: "invalid"});

        const eventData = eventSnap.data()!;
        const eventTitle: string = eventData.title ?? eventData.name ?? "";
        const eventTitleCn: string = eventData.titleCn ?? eventData.nameCn ?? "";
        const eventPoster: string = eventData.poster ?? "";

        const attendedEvents: string[] = userSnap.data()!.attendedEvents ?? [];
        if (attendedEvents.includes(eventId)) {
            throw new HttpsError("already-exists", "You already have this event.", {
                code: "already-have",
                eventId,
                eventTitle,
                eventTitleCn,
                eventPoster,
            });
        }

        txn.update(codeRef, {usedCount: FieldValue.increment(1)});
        txn.update(userRef, {attendedEvents: FieldValue.arrayUnion(eventId)});
        txn.set(db.collection("records").doc(), {
            type: "event-claim",
            performedBy: uid,
            performedByName: userSnap.data()?.displayName ?? "",
            eventId,
            eventTitle: eventTitle || eventId,
            code,
            timestamp: FieldValue.serverTimestamp(),
            expiresAt: recordExpiresAt(),
        });
        return {eventId, eventTitle, eventTitleCn, eventPoster};
    });
});

/**
 * Claim a badge activation code.
 * Validates the code server-side and atomically increments usedCount + adds badge to user's badges.
 * Returns badge metadata so the client doesn't need a separate fetch.
 */
export const claimBadgeActivationCode = onCall({maxInstances: 20}, async (request) => {
    const uid = await requireAuth(request);

    const code = (request.data as {code?: string})?.code?.trim().toUpperCase();
    if (!code || !/^[A-Z0-9]{6,20}$/.test(code)) {
        throw new HttpsError("invalid-argument", "Invalid or deactivated code.", {code: "invalid"});
    }

    const codeRef = db.collection("badgeActivationCodes").doc(code);
    const userRef = db.collection("users").doc(uid);

    return db.runTransaction(async (txn) => {
        const freshCode = await txn.get(codeRef);
        if (!freshCode.exists) throw new HttpsError("not-found", "Invalid or deactivated code.", {code: "invalid"});
        const data = freshCode.data()!;
        validateCodeInTransaction(data);

        const badgeId: string = data.badgeId;
        if (!badgeId) throw new HttpsError("not-found", "Invalid or deactivated code.", {code: "invalid"});

        const [badgeSnap, userSnap] = await Promise.all([
            txn.get(db.collection("badges").doc(badgeId)),
            txn.get(userRef),
        ]);
        if (!badgeSnap.exists) throw new HttpsError("not-found", "Invalid or deactivated code.", {code: "invalid"});
        if (!userSnap.exists) throw new HttpsError("not-found", "Invalid or deactivated code.", {code: "invalid"});
        const badgeData = badgeSnap.data()!;

        const userBadges: string[] = userSnap.data()!.badges ?? [];
        if (userBadges.includes(badgeId)) {
            throw new HttpsError("already-exists", "You already have this badge.", {code: "already-have"});
        }

        txn.update(codeRef, {usedCount: FieldValue.increment(1)});
        txn.update(userRef, {
            badges: FieldValue.arrayUnion(badgeId),
            [`badgeEarnedAt.${badgeId}`]: FieldValue.serverTimestamp(),
        });
        txn.set(db.collection("records").doc(), {
            type: "badge-claim",
            performedBy: uid,
            performedByName: userSnap.data()?.displayName ?? "",
            badgeId,
            badgeName: badgeData.name ?? badgeId,
            code,
            timestamp: FieldValue.serverTimestamp(),
            expiresAt: recordExpiresAt(),
        });

        return {
            badgeId,
            badgeName: badgeData.name ?? "",
            badgeNameCn: badgeData.nameCn ?? "",
            badgeDescription: badgeData.description ?? "",
            badgeDescriptionCn: badgeData.descriptionCn ?? "",
            badgeImageUrl: badgeData.imageUrl ?? "",
        };
    });
});

/**
 * Generate a badge activation code (admin only).
 * Verifies caller is core-staff+, generates a unique code atomically via transaction.
 */
export const generateBadgeActivationCode = onCall({maxInstances: 10}, async (request) => {
    if (!request.auth) {
        throw new HttpsError("unauthenticated", "Must be signed in.");
    }

    const uid = request.auth.uid;
    await checkRateLimit(uid);

    const input = request.data as {
        badgeId?: string;
        maxUses?: number;
        activeFrom?: string;
        activeUntil?: string;
    };
    const badgeId = validateDocId(input.badgeId, "badgeId");
    const maxUses = validateMaxUses(input.maxUses);
    const activeFrom = validateISODate(input.activeFrom, "activeFrom");
    const activeUntil = validateISODate(input.activeUntil, "activeUntil");
    const expiresAt = activeUntil ? Timestamp.fromDate(new Date(activeUntil)) : null;

    let code = "";

    for (let attempt = 0; attempt < 5; attempt++) {
        code = generateSecureCode(12);
        const codeRef = db.collection("badgeActivationCodes").doc(code);

        try {
            await db.runTransaction(async (txn) => {
                // Verify admin inside the transaction for atomicity
                const callerSnap = await txn.get(db.collection("users").doc(uid));
                if (!ADMIN_GROUPS.includes(callerSnap.data()?.group)) {
                    throw new HttpsError("permission-denied", "Insufficient permissions.");
                }

                const badgeSnap = await txn.get(db.collection("badges").doc(badgeId));
                if (!badgeSnap.exists) {
                    throw new HttpsError("not-found", "Badge not found.");
                }

                const existing = await txn.get(codeRef);
                if (existing.exists) {
                    throw new Error("duplicate");
                }
                txn.set(codeRef, {
                    code,
                    badgeId,
                    createdBy: uid,
                    createdAt: FieldValue.serverTimestamp(),
                    active: true,
                    maxUses,
                    usedCount: 0,
                    ...(activeFrom ? {activeFrom} : {}),
                    ...(activeUntil ? {activeUntil} : {}),
                    ...(expiresAt ? {expiresAt} : {}),
                });
                txn.set(db.collection("records").doc(), {
                    type: "code-create",
                    performedBy: uid,
                    performedByName: callerSnap.data()?.displayName ?? "",
                    badgeId,
                    badgeName: badgeSnap.data()!.name ?? badgeId,
                    code,
                    timestamp: FieldValue.serverTimestamp(),
                    expiresAt: recordExpiresAt(),
                });
            });
            return {id: codeRef.id, code};
        } catch (err) {
            if (err instanceof Error && err.message === "duplicate") {
                if (attempt === 4) throw new HttpsError("internal", "code-generation-failed");
                continue;
            }
            throw err;
        }
    }

    throw new HttpsError("internal", "code-generation-failed");
});

/**
 * Upload a user avatar (non-visitor only).
 * Validates group, checks magic bytes, enforces size limit, and saves to avatars/{uid}.
 */
export const uploadAvatar = onCall({maxInstances: 10}, async (request) => {
    if (!request.auth) {
        throw new HttpsError("unauthenticated", "Must be signed in.");
    }

    const uid = request.auth.uid;
    const userSnap = await db.collection("users").doc(uid).get();
    const group = userSnap.data()?.group;
    if (!group || group === "visitor") {
        throw new HttpsError("permission-denied", "Visitors cannot upload avatars.");
    }

    await checkRateLimit(uid);

    const input = request.data as {data?: string; contentType?: string};
    const dataBase64 = input.data;
    const contentType = input.contentType;

    if (!dataBase64 || !contentType) {
        throw new HttpsError("invalid-argument", "Missing data or contentType.");
    }

    if (contentType !== "image/webp") {
        throw new HttpsError("invalid-argument", "Only image/webp is allowed.");
    }

    const buffer = Buffer.from(dataBase64, "base64");
    if (buffer.length > MAX_UPLOAD_SIZE) {
        throw new HttpsError("invalid-argument", "Image exceeds 5MB limit.");
    }

    const detectedMime = detectImageMime(buffer);
    if (!detectedMime || detectedMime !== contentType) {
        throw new HttpsError("invalid-argument", "File content does not match claimed content type.");
    }

    const bucket = getStorage().bucket();
    const path = `avatars/${uid}`;
    const file = bucket.file(path);
    await file.save(buffer, {
        metadata: {contentType, cacheControl: "public, max-age=31536000, immutable"},
    });

    const downloadUrl = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(path)}?alt=media&t=${Date.now()}`;

    // Atomically set photoURL on the user doc so clients can't set arbitrary URLs
    await db.collection("users").doc(uid).update({photoURL: downloadUrl});

    return {url: downloadUrl};
});

/**
 * Delete a user's avatar and reset photoURL to their Google profile picture.
 * Deletes the storage file and resets photoURL to the OAuth picture or empty string.
 */
export const deleteAvatar = onCall({maxInstances: 10}, async (request) => {
    if (!request.auth) {
        throw new HttpsError("unauthenticated", "Must be signed in.");
    }

    const uid = request.auth.uid;
    const userSnap = await db.collection("users").doc(uid).get();
    const group = userSnap.data()?.group;
    if (!group || group === "visitor") {
        throw new HttpsError("permission-denied", "Visitors cannot delete avatars.");
    }

    await checkRateLimit(uid);

    const userRef = db.collection("users").doc(uid);

    const bucket = getStorage().bucket();
    const file = bucket.file(`avatars/${uid}`);
    const [exists] = await file.exists();
    if (exists) {
        await file.delete();
    }

    // Reset to Google OAuth photo or empty string
    const googlePhoto = request.auth.token.picture ?? "";
    const photoURL = typeof googlePhoto === "string" ? googlePhoto.slice(0, 500) : "";
    await userRef.update({photoURL});

    return {photoURL};
});

/**
 * Generate an event check-in code (admin only).
 * Verifies caller is core-staff+, deactivates any existing active code for the event,
 * and generates a unique code atomically.
 */
export const generateEventCode = onCall({maxInstances: 10}, async (request) => {
    if (!request.auth) {
        throw new HttpsError("unauthenticated", "Must be signed in.");
    }

    const uid = request.auth.uid;
    await checkRateLimit(uid);

    const input = request.data as {
        eventId?: string;
        activeFrom?: string;
        activeUntil?: string;
    };
    const eventId = validateDocId(input.eventId, "eventId");
    const activeFrom = validateISODate(input.activeFrom, "activeFrom");
    const activeUntil = validateISODate(input.activeUntil, "activeUntil");
    const expiresAt = activeUntil ? Timestamp.fromDate(new Date(activeUntil)) : null;

    let code = "";

    for (let attempt = 0; attempt < 5; attempt++) {
        code = generateSecureCode(12);
        const codeRef = db.collection("claimCodes").doc(code);

        try {
            await db.runTransaction(async (txn) => {
                // Verify admin inside the transaction for atomicity
                const callerSnap = await txn.get(db.collection("users").doc(uid));
                if (!ADMIN_GROUPS.includes(callerSnap.data()?.group)) {
                    throw new HttpsError("permission-denied", "Insufficient permissions.");
                }

                const eventSnap = await txn.get(db.collection("upcomingEvents").doc(eventId));
                if (!eventSnap.exists) {
                    throw new HttpsError("not-found", "Event not found.");
                }

                const [existing, existingCodes] = await Promise.all([
                    txn.get(codeRef),
                    txn.get(
                        db.collection("claimCodes")
                            .where("eventId", "==", eventId)
                            .where("active", "==", true)
                    ),
                ]);
                if (existing.exists) {
                    throw new Error("duplicate");
                }
                // Deactivate old codes
                for (const oldDoc of existingCodes.docs) {
                    txn.update(oldDoc.ref, {active: false});
                }
                txn.set(codeRef, {
                    code,
                    eventId,
                    createdBy: uid,
                    createdAt: FieldValue.serverTimestamp(),
                    active: true,
                    usedCount: 0,
                    ...(activeFrom ? {activeFrom} : {}),
                    ...(activeUntil ? {activeUntil} : {}),
                    ...(expiresAt ? {expiresAt} : {}),
                });
                txn.set(db.collection("records").doc(), {
                    type: "code-create",
                    performedBy: uid,
                    performedByName: callerSnap.data()?.displayName ?? "",
                    eventTitle: eventSnap.data()?.title ?? eventSnap.data()?.name ?? eventId,
                    eventId,
                    code,
                    timestamp: FieldValue.serverTimestamp(),
                    expiresAt: recordExpiresAt(),
                });
            });
            return {id: codeRef.id, code};
        } catch (err) {
            if (err instanceof Error && err.message === "duplicate") {
                if (attempt === 4) throw new HttpsError("internal", "code-generation-failed");
                continue;
            }
            throw err;
        }
    }

    throw new HttpsError("internal", "code-generation-failed");
});

const BATCH_LIMIT = 500;

async function commitInChunks(
    ops: ((batch: FirebaseFirestore.WriteBatch) => void)[]
): Promise<void> {
    for (let i = 0; i < ops.length; i += BATCH_LIMIT) {
        const chunk = ops.slice(i, i + BATCH_LIMIT);
        const batch = db.batch();
        for (const op of chunk) op(batch);
        try {
            await batch.commit();
        } catch (err) {
            // If a chunk fails after a previous chunk succeeded, data is partially committed.
            // Log the failure so it can be investigated and cleaned up.
            console.error(
                `commitInChunks: batch ${i / BATCH_LIMIT + 1} of ${Math.ceil(ops.length / BATCH_LIMIT)} failed after previous chunks committed.`,
                err
            );
            throw err;
        }
    }
}

function extractStoragePath(downloadUrl: string): string | null {
    const match = downloadUrl.match(
        /firebasestorage\.googleapis\.com\/v0\/b\/[^/]+\/o\/([^?]+)/
    );
    if (!match) return null;
    return decodeURIComponent(match[1]);
}

async function deleteStorageFile(downloadUrl: string, allowedPrefixes?: string[]): Promise<void> {
    const path = extractStoragePath(downloadUrl);
    if (!path) return;
    if (allowedPrefixes && !allowedPrefixes.some(p => path.startsWith(p))) return;
    const file = getStorage().bucket().file(path);
    const [exists] = await file.exists();
    if (exists) await file.delete();
}

function logStorageCleanupError(context: string): (err: unknown) => void {
    return (err) => console.error(`Storage cleanup failed (${context}):`, err);
}

/**
 * Request deletion of a past event with a 48-hour cooldown (admin only).
 * Sets deleteAt on the pastEvents doc. Firestore TTL on deleteAt triggers onPastEventDeleted,
 * which handles cascading cleanup (claim codes, user attendance, storage).
 */
export const requestEventDeletion = onCall({maxInstances: 10}, async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Must be signed in.");
    const uid = request.auth.uid;
    await checkRateLimit(uid);

    const eventId = validateDocId((request.data as {eventId?: string})?.eventId, "eventId");
    const deleteAt = deletionExpiresAt();

    await adminTransaction(uid, async (txn, callerSnap) => {
        const eventSnap = await txn.get(db.collection("pastEvents").doc(eventId));
        if (!eventSnap.exists) throw new HttpsError("not-found", "Event not found.");
        const data = eventSnap.data()!;

        if (data.deleteAt && data.deleteAt.toMillis() > Date.now()) {
            throw new HttpsError("already-exists", "deletion-already-pending");
        }

        txn.update(db.collection("pastEvents").doc(eventId), {deleteAt});
        txn.set(db.collection("records").doc(), {
            type: "event-deletion-requested",
            performedBy: uid,
            performedByName: callerSnap.data()?.displayName ?? "",
            eventTitle: data.title ?? eventId,
            eventId,
            timestamp: FieldValue.serverTimestamp(),
            expiresAt: recordExpiresAt(),
        });
    });

    return {deleteAt: deleteAt.toDate().toISOString()};
});

/**
 * Cancel a pending past-event deletion (admin only).
 * Clears deleteAt so Firestore TTL never fires.
 */
export const cancelEventDeletion = onCall({maxInstances: 10}, async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Must be signed in.");
    const uid = request.auth.uid;
    await checkRateLimit(uid);

    const eventId = validateDocId((request.data as {eventId?: string})?.eventId, "eventId");

    await adminTransaction(uid, async (txn, callerSnap) => {
        const eventSnap = await txn.get(db.collection("pastEvents").doc(eventId));
        if (!eventSnap.exists) throw new HttpsError("not-found", "Event not found.");
        const data = eventSnap.data()!;

        if (!data.deleteAt || data.deleteAt.toMillis() <= Date.now()) {
            throw new HttpsError("not-found", "No pending deletion.");
        }

        txn.update(db.collection("pastEvents").doc(eventId), {deleteAt: FieldValue.delete()});
        txn.set(db.collection("records").doc(), {
            type: "event-deletion-cancelled",
            performedBy: uid,
            performedByName: callerSnap.data()?.displayName ?? "",
            eventTitle: data.title ?? eventId,
            eventId,
            timestamp: FieldValue.serverTimestamp(),
            expiresAt: recordExpiresAt(),
        });
    });

    return {cancelled: true};
});

/**
 * Firestore trigger fired when a past event is deleted.
 * Only runs cleanup for TTL-triggered deletions (deleteAt was set).
 * Cascades: deletes claim codes, removes from users' attendedEvents, deletes storage icon.
 */
export const onPastEventDeleted = onDocumentDeleted(
    {document: "pastEvents/{eventId}", maxInstances: 10},
    async (event) => {
        const data = event.data?.data();
        const eventId = event.params.eventId;
        if (!data?.deleteAt) return;

        try {
            const [codesSnap, attendeesSnap] = await Promise.all([
                db.collection("claimCodes").where("eventId", "==", eventId).get(),
                db.collection("users").where("attendedEvents", "array-contains", eventId).get(),
            ]);
            const cascadeOps: ((b: FirebaseFirestore.WriteBatch) => void)[] = [
                ...codesSnap.docs.map(d => (b: FirebaseFirestore.WriteBatch) => b.delete(d.ref)),
                ...attendeesSnap.docs.map(d => (b: FirebaseFirestore.WriteBatch) =>
                    b.update(d.ref, {attendedEvents: FieldValue.arrayRemove(eventId)})
                ),
            ];
            if (cascadeOps.length > 0) await commitInChunks(cascadeOps);
        } catch (err) {
            console.error(`onPastEventDeleted: cascade failed for ${eventId}`, err);
        }

        await deleteStorageFile(data.icon ?? "", ["events/", "upcoming-events/"])
            .catch(logStorageCleanupError(`onPastEventDeleted ${eventId}`));

        try {
            await db.collection("records").add({
                type: "event-deleted",
                eventId,
                eventTitle: data.title ?? "",
                timestamp: FieldValue.serverTimestamp(),
                expiresAt: recordExpiresAt(),
            });
        } catch (err) {
            console.error(`onPastEventDeleted: record write failed for ${eventId}`, err);
        }
    }
);

/**
 * Request deletion of a badge with a 48-hour cooldown (admin only).
 * Sets deleteAt on the badges doc. Firestore TTL triggers onBadgeDeleted,
 * which handles cascading cleanup (activation codes, user badges, storage).
 */
export const requestBadgeDeletion = onCall({maxInstances: 10}, async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Must be signed in.");
    const uid = request.auth.uid;
    await checkRateLimit(uid);

    const badgeId = validateDocId((request.data as {badgeId?: string})?.badgeId, "badgeId");
    const deleteAt = deletionExpiresAt();

    await adminTransaction(uid, async (txn, callerSnap) => {
        const badgeSnap = await txn.get(db.collection("badges").doc(badgeId));
        if (!badgeSnap.exists) throw new HttpsError("not-found", "Badge not found.");
        const data = badgeSnap.data()!;

        if (data.deleteAt && data.deleteAt.toMillis() > Date.now()) {
            throw new HttpsError("already-exists", "deletion-already-pending");
        }

        txn.update(db.collection("badges").doc(badgeId), {deleteAt});
        txn.set(db.collection("records").doc(), {
            type: "badge-deletion-requested",
            performedBy: uid,
            performedByName: callerSnap.data()?.displayName ?? "",
            badgeId,
            badgeName: data.name ?? badgeId,
            timestamp: FieldValue.serverTimestamp(),
            expiresAt: recordExpiresAt(),
        });
    });

    return {deleteAt: deleteAt.toDate().toISOString()};
});

/**
 * Cancel a pending badge deletion (admin only).
 * Clears deleteAt so Firestore TTL never fires.
 */
export const cancelBadgeDeletion = onCall({maxInstances: 10}, async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Must be signed in.");
    const uid = request.auth.uid;
    await checkRateLimit(uid);

    const badgeId = validateDocId((request.data as {badgeId?: string})?.badgeId, "badgeId");

    await adminTransaction(uid, async (txn, callerSnap) => {
        const badgeSnap = await txn.get(db.collection("badges").doc(badgeId));
        if (!badgeSnap.exists) throw new HttpsError("not-found", "Badge not found.");
        const data = badgeSnap.data()!;

        if (!data.deleteAt || data.deleteAt.toMillis() <= Date.now()) {
            throw new HttpsError("not-found", "No pending deletion.");
        }

        txn.update(db.collection("badges").doc(badgeId), {deleteAt: FieldValue.delete()});
        txn.set(db.collection("records").doc(), {
            type: "badge-deletion-cancelled",
            performedBy: uid,
            performedByName: callerSnap.data()?.displayName ?? "",
            badgeId,
            badgeName: data.name ?? badgeId,
            timestamp: FieldValue.serverTimestamp(),
            expiresAt: recordExpiresAt(),
        });
    });

    return {cancelled: true};
});

/**
 * Firestore trigger fired when a badge is deleted.
 * Only runs cleanup for TTL-triggered deletions (deleteAt was set).
 * Cascades: deletes activation codes, removes badge from users' badges, deletes storage image.
 */
export const onBadgeDeleted = onDocumentDeleted(
    {document: "badges/{badgeId}", maxInstances: 10},
    async (event) => {
        const data = event.data?.data();
        const badgeId = event.params.badgeId;
        if (!data?.deleteAt) return;

        try {
            const [codesSnap, holdersSnap] = await Promise.all([
                db.collection("badgeActivationCodes").where("badgeId", "==", badgeId).get(),
                db.collection("users").where("badges", "array-contains", badgeId).get(),
            ]);
            const cascadeOps: ((b: FirebaseFirestore.WriteBatch) => void)[] = [
                ...codesSnap.docs.map(d => (b: FirebaseFirestore.WriteBatch) => b.delete(d.ref)),
                ...holdersSnap.docs.map(d => (b: FirebaseFirestore.WriteBatch) =>
                    b.update(d.ref, {badges: FieldValue.arrayRemove(badgeId)})
                ),
            ];
            if (cascadeOps.length > 0) await commitInChunks(cascadeOps);
        } catch (err) {
            console.error(`onBadgeDeleted: cascade failed for ${badgeId}`, err);
        }

        await deleteStorageFile(data.imageUrl ?? "", ["badges/"])
            .catch(logStorageCleanupError(`onBadgeDeleted ${badgeId}`));

        try {
            await db.collection("records").add({
                type: "badge-deleted",
                badgeId,
                badgeName: data.name ?? "",
                timestamp: FieldValue.serverTimestamp(),
                expiresAt: recordExpiresAt(),
            });
        } catch (err) {
            console.error(`onBadgeDeleted: record write failed for ${badgeId}`, err);
        }
    }
);

const VALID_GROUPS = ["visitor", "member", "staff", "core-staff", "president"];

/**
 * Change a user's group (admin only).
 * Runs in a transaction to guarantee the audit record's oldGroup is accurate.
 * Enforces the same hierarchy rules as Firestore rules:
 * - Cannot change own group
 * - Core-staff can only manage visitor/member/staff and assign up to staff
 * - President can manage and assign any group
 */
export const changeUserGroup = onCall({maxInstances: 10}, async (request) => {
    if (!request.auth) {
        throw new HttpsError("unauthenticated", "Must be signed in.");
    }

    const uid = request.auth.uid;

    const input = request.data as {targetUid?: string; newGroup?: string; title?: string};
    const targetUid = validateDocId(input.targetUid, "targetUid");
    const newGroup = input.newGroup;

    if (!newGroup || !VALID_GROUPS.includes(newGroup)) {
        throw new HttpsError("invalid-argument", "Invalid group.");
    }

    if (uid === targetUid) {
        throw new HttpsError("permission-denied", "Cannot change your own group.");
    }

    // Title can only be set when assigning staff or core-staff
    const title = input.title;
    if (title !== undefined && (typeof title !== "string" || title.length > 100)) {
        throw new HttpsError("invalid-argument", "Invalid title.");
    }
    if (title && !["staff", "core-staff"].includes(newGroup)) {
        throw new HttpsError("invalid-argument", "Title can only be set for staff or core-staff.");
    }

    await checkRateLimit(uid);

    let oldGroup: string = "";
    let oldTitle: string = "";

    await db.runTransaction(async (txn) => {
        const [callerSnap, targetSnap] = await Promise.all([
            txn.get(db.collection("users").doc(uid)),
            txn.get(db.collection("users").doc(targetUid)),
        ]);

        if (!callerSnap.exists) throw new HttpsError("not-found", "Caller not found.");
        if (!targetSnap.exists) throw new HttpsError("not-found", "Target user not found.");

        const callerGroup = callerSnap.data()!.group;
        if (!ADMIN_GROUPS.includes(callerGroup)) {
            throw new HttpsError("permission-denied", "Insufficient permissions.");
        }

        oldGroup = targetSnap.data()!.group;
        oldTitle = targetSnap.data()!.title ?? "";

        if (callerGroup !== "president") {
            if (!["visitor", "member", "staff"].includes(oldGroup)) {
                throw new HttpsError("permission-denied",
                    "Cannot manage users at or above your level.");
            }
            if (!["visitor", "member", "staff"].includes(newGroup)) {
                throw new HttpsError("permission-denied",
                    "Cannot assign this group.");
            }
        }

        const shouldHaveTitle = ["staff", "core-staff"].includes(newGroup);
        const newTitle = shouldHaveTitle ? (title ?? "") : "";
        const updateData: Record<string, unknown> = {group: newGroup};
        if (shouldHaveTitle) {
            updateData.title = newTitle;
        } else {
            updateData.title = FieldValue.delete();
        }

        txn.update(db.collection("users").doc(targetUid), updateData);
        txn.set(db.collection("records").doc(), {
            type: "group-assign",
            performedBy: uid,
            performedByName: callerSnap.data()!.displayName ?? "",
            targetUid,
            targetName: targetSnap.data()!.displayName ?? "",
            oldGroup,
            newGroup,
            timestamp: FieldValue.serverTimestamp(),
            expiresAt: recordExpiresAt(),
        });

        if (oldTitle !== newTitle) {
            txn.set(db.collection("records").doc(), {
                type: "title-set",
                performedBy: uid,
                performedByName: callerSnap.data()!.displayName ?? "",
                targetUid,
                targetName: targetSnap.data()!.displayName ?? "",
                oldTitle,
                newTitle,
                timestamp: FieldValue.serverTimestamp(),
                expiresAt: recordExpiresAt(),
            });
        }
    });

    return {oldGroup, newGroup};
});

/**
 * Set or clear a user's title.
 * Only president/core-staff can set title for staff/core-staff users.
 * Title is cleared automatically when group changes to visitor/member/president.
 */
export const setUserTitle = onCall({maxInstances: 10}, async (request) => {
    if (!request.auth) {
        throw new HttpsError("unauthenticated", "Must be signed in.");
    }

    const uid = request.auth.uid;
    const input = request.data as {targetUid?: string; title?: string};
    const targetUid = validateDocId(input.targetUid, "targetUid");
    const title = input.title;

    if (title !== undefined && (typeof title !== "string" || title.length > 100)) {
        throw new HttpsError("invalid-argument", "Invalid title.");
    }

    await checkRateLimit(uid);

    await db.runTransaction(async (txn) => {
        const [callerSnap, targetSnap] = await Promise.all([
            txn.get(db.collection("users").doc(uid)),
            txn.get(db.collection("users").doc(targetUid)),
        ]);

        if (!callerSnap.exists) throw new HttpsError("not-found", "Caller not found.");
        if (!targetSnap.exists) throw new HttpsError("not-found", "Target user not found.");

        const callerGroup = callerSnap.data()!.group;
        const targetGroup = targetSnap.data()!.group;

        if (!ADMIN_GROUPS.includes(callerGroup)) {
            throw new HttpsError("permission-denied", "Insufficient permissions.");
        }

        if (!["staff", "core-staff"].includes(targetGroup)) {
            throw new HttpsError("invalid-argument", "Title can only be set for staff or core-staff.");
        }

        // Only president can set title for core-staff; core-staff can only set title for staff
        if (targetGroup === "core-staff" && callerGroup !== "president") {
            throw new HttpsError("permission-denied",
                "Only the president can set the title of a core-staff member.");
        }

        const updateData: Record<string, unknown> = {};
        if (title) {
            updateData.title = title;
        } else {
            updateData.title = FieldValue.delete();
        }

        txn.update(db.collection("users").doc(targetUid), updateData);
        txn.set(db.collection("records").doc(), {
            type: "title-set",
            performedBy: uid,
            performedByName: callerSnap.data()!.displayName ?? "",
            targetUid,
            targetName: targetSnap.data()!.displayName ?? "",
            oldTitle: targetSnap.data()!.title ?? "",
            newTitle: title ?? "",
            timestamp: FieldValue.serverTimestamp(),
            expiresAt: recordExpiresAt(),
        });
    });

    return {success: true};
});

/**
 * Create or update a past event (admin only).
 * Server-side validation, audit record with server timestamp.
 */
export const savePastEvent = onCall({maxInstances: 10}, async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Must be signed in.");
    const uid = request.auth.uid;
    await checkRateLimit(uid);

    const input = request.data as Record<string, unknown>;
    const eventId = input.eventId ? validateDocId(input.eventId, "eventId") : null;
    const title = validateStr(input.title, "title", 200, true);
    const titleCn = validateStr(input.titleCn, "titleCn", 200);
    const tagId = validateStr(input.tagId, "tagId", 128);
    const date = validateStr(input.date, "date", 50, true);
    const location = validateStr(input.location, "location", 200);
    const locationCn = validateStr(input.locationCn, "locationCn", 200);
    const description = validateStr(input.description, "description", 2000);
    const descriptionCn = validateStr(input.descriptionCn, "descriptionCn", 2000);
    const icon = validateStr(input.icon, "icon", 500);
    validateStorageImageUrl(icon, "icon");

    const data = {title, titleCn, tagId, date, location, locationCn, description, descriptionCn, icon};
    const docId = eventId ?? db.collection("pastEvents").doc().id;

    const {result, oldIcon} = await adminTransaction(uid, async (txn, callerSnap) => {
        let prevIcon = "";
        if (eventId) {
            const existing = await txn.get(db.collection("pastEvents").doc(eventId));
            if (!existing.exists) throw new HttpsError("not-found", "Event not found.");
            prevIcon = existing.data()?.icon ?? "";
        }
        const ref = db.collection("pastEvents").doc(docId);
        if (eventId) {
            txn.update(ref, data);
        } else {
            txn.set(ref, {...data, published: false});
        }
        txn.set(db.collection("records").doc(), {
            type: eventId ? "event-edit" : "event-create",
            performedBy: uid,
            performedByName: callerSnap.data()?.displayName ?? "",
            eventTitle: title,
            eventId: docId,
            timestamp: FieldValue.serverTimestamp(),
            expiresAt: recordExpiresAt(),
        });
        return {result: {eventId: docId}, oldIcon: prevIcon};
    });

    if (oldIcon && oldIcon !== icon) {
        await deleteStorageFile(oldIcon, ["events/", "upcoming-events/"])
            .catch(logStorageCleanupError(`savePastEvent ${docId}`));
    }

    return result;
});

/**
 * Publish or unpublish a past event (admin only).
 * Unpublished events are hidden from the public site.
 */
export const setPastEventPublished = onCall({maxInstances: 10}, async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Must be signed in.");
    const uid = request.auth.uid;
    await checkRateLimit(uid);

    const input = request.data as {eventId?: string; published?: boolean};
    const eventId = validateDocId(input.eventId, "eventId");
    if (typeof input.published !== "boolean") {
        throw new HttpsError("invalid-argument", "published must be a boolean.");
    }

    return adminTransaction(uid, async (txn, callerSnap) => {
        const ref = db.collection("pastEvents").doc(eventId);
        const snap = await txn.get(ref);
        if (!snap.exists) throw new HttpsError("not-found", "Event not found.");
        txn.update(ref, {published: input.published});
        txn.set(db.collection("records").doc(), {
            type: input.published ? "past-event-publish" : "past-event-unpublish",
            performedBy: uid,
            performedByName: callerSnap.data()?.displayName ?? "",
            eventTitle: snap.data()?.title ?? eventId,
            eventId,
            timestamp: FieldValue.serverTimestamp(),
            expiresAt: recordExpiresAt(),
        });
        return {published: input.published};
    });
});

/**
 * Create or update an upcoming event (admin only).
 * Accepts ISO date strings for startAt/endAt, converts to Firestore Timestamps.
 */
export const saveUpcomingEvent = onCall({maxInstances: 10}, async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Must be signed in.");
    const uid = request.auth.uid;
    await checkRateLimit(uid);

    const input = request.data as Record<string, unknown>;
    const eventId = input.eventId ? validateDocId(input.eventId, "eventId") : null;
    const title = validateStr(input.title, "title", 200, true);
    const titleCn = validateStr(input.titleCn, "titleCn", 200);
    const description = validateStr(input.description, "description", 2000);
    const descriptionCn = validateStr(input.descriptionCn, "descriptionCn", 2000);
    const location = validateStr(input.location, "location", 200);
    const locationCn = validateStr(input.locationCn, "locationCn", 200);
    const poster = validateStr(input.poster, "poster", 500);
    const posterCredit = validateStr(input.posterCredit, "posterCredit", 200);
    const buyTicket = validateStr(input.buyTicket, "buyTicket", 500);
    const learnMore = validateStr(input.learnMore, "learnMore", 500);
    const customButtonText = validateStr(input.customButtonText, "customButtonText", 100);
    const customButtonTextCn = validateStr(input.customButtonTextCn, "customButtonTextCn", 100);
    const customButtonLink = validateStr(input.customButtonLink, "customButtonLink", 500);

    validateStorageImageUrl(poster, "poster");
    validateUrl(buyTicket, "buyTicket");
    validateUrl(learnMore, "learnMore");
    validateUrl(customButtonLink, "customButtonLink");

    const startAtStr = validateISODate(input.startAt, "startAt");
    if (!startAtStr) throw new HttpsError("invalid-argument", "startAt is required.");
    const endAtStr = validateISODate(input.endAt, "endAt");
    if (!endAtStr) throw new HttpsError("invalid-argument", "endAt is required.");
    const startAt = Timestamp.fromDate(new Date(startAtStr));
    const endAt = Timestamp.fromDate(new Date(endAtStr));
    if (endAt.toMillis() <= startAt.toMillis()) {
        throw new HttpsError("invalid-argument", "End time must be after start time.");
    }

    const data = {
        title, titleCn, description, descriptionCn, location, locationCn,
        startAt, endAt, poster, posterCredit, buyTicket, learnMore,
        customButtonText, customButtonTextCn, customButtonLink,
    };
    const docId = eventId ?? db.collection("upcomingEvents").doc().id;

    const {result, oldPoster} = await adminTransaction(uid, async (txn, callerSnap) => {
        let prevPoster = "";
        let wasPublished = false;
        if (eventId) {
            const existing = await txn.get(db.collection("upcomingEvents").doc(eventId));
            if (!existing.exists) throw new HttpsError("not-found", "Event not found.");
            prevPoster = existing.data()?.poster ?? "";
            wasPublished = existing.data()?.published ?? false;
        }
        const ref = db.collection("upcomingEvents").doc(docId);
        if (eventId) {
            // Delete legacy name/nameCn fields on edit so pre-rename docs migrate cleanly.
            txn.update(ref, {
                ...data,
                published: wasPublished,
                name: FieldValue.delete(),
                nameCn: FieldValue.delete(),
            });
        } else {
            txn.set(ref, {...data, published: false});
        }
        txn.set(db.collection("records").doc(), {
            type: eventId ? "upcoming-event-edit" : "upcoming-event-create",
            performedBy: uid,
            performedByName: callerSnap.data()?.displayName ?? "",
            eventTitle: title,
            eventId: docId,
            timestamp: FieldValue.serverTimestamp(),
            expiresAt: recordExpiresAt(),
        });
        return {result: {eventId: docId}, oldPoster: prevPoster};
    });

    if (oldPoster && oldPoster !== poster) {
        await deleteStorageFile(oldPoster, ["upcoming-events/"])
            .catch(logStorageCleanupError(`saveUpcomingEvent ${docId}`));
    }

    return result;
});

/**
 * Publish or unpublish an upcoming event (admin only).
 * Unpublished events are hidden from the public site.
 */
export const setUpcomingEventPublished = onCall({maxInstances: 10}, async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Must be signed in.");
    const uid = request.auth.uid;
    await checkRateLimit(uid);

    const input = request.data as {eventId?: string; published?: boolean};
    const eventId = validateDocId(input.eventId, "eventId");
    if (typeof input.published !== "boolean") {
        throw new HttpsError("invalid-argument", "published must be a boolean.");
    }

    return adminTransaction(uid, async (txn, callerSnap) => {
        const ref = db.collection("upcomingEvents").doc(eventId);
        const snap = await txn.get(ref);
        if (!snap.exists) throw new HttpsError("not-found", "Event not found.");
        txn.update(ref, {published: input.published});
        txn.set(db.collection("records").doc(), {
            type: input.published ? "upcoming-event-publish" : "upcoming-event-unpublish",
            performedBy: uid,
            performedByName: callerSnap.data()?.displayName ?? "",
            eventTitle: snap.data()?.title ?? snap.data()?.name ?? eventId,
            eventId,
            timestamp: FieldValue.serverTimestamp(),
            expiresAt: recordExpiresAt(),
        });
        return {published: input.published};
    });
});

/**
 * Request deletion of an upcoming event with a 48-hour cooldown (admin only).
 * Sets deleteAt on the upcomingEvents doc. Firestore TTL triggers onUpcomingEventDeleted,
 * which handles cleanup (claim codes, storage poster).
 */
export const requestUpcomingEventDeletion = onCall({maxInstances: 10}, async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Must be signed in.");
    const uid = request.auth.uid;
    await checkRateLimit(uid);

    const eventId = validateDocId((request.data as {eventId?: string})?.eventId, "eventId");
    const deleteAt = deletionExpiresAt();

    await adminTransaction(uid, async (txn, callerSnap) => {
        const eventSnap = await txn.get(db.collection("upcomingEvents").doc(eventId));
        if (!eventSnap.exists) throw new HttpsError("not-found", "Event not found.");
        const data = eventSnap.data()!;

        if (data.deleteAt && data.deleteAt.toMillis() > Date.now()) {
            throw new HttpsError("already-exists", "deletion-already-pending");
        }

        txn.update(db.collection("upcomingEvents").doc(eventId), {deleteAt});
        txn.set(db.collection("records").doc(), {
            type: "upcoming-event-deletion-requested",
            performedBy: uid,
            performedByName: callerSnap.data()?.displayName ?? "",
            eventTitle: data.title ?? data.name ?? eventId,
            eventId,
            timestamp: FieldValue.serverTimestamp(),
            expiresAt: recordExpiresAt(),
        });
    });

    return {deleteAt: deleteAt.toDate().toISOString()};
});

/**
 * Cancel a pending upcoming-event deletion (admin only).
 * Clears deleteAt so Firestore TTL never fires.
 */
export const cancelUpcomingEventDeletion = onCall({maxInstances: 10}, async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Must be signed in.");
    const uid = request.auth.uid;
    await checkRateLimit(uid);

    const eventId = validateDocId((request.data as {eventId?: string})?.eventId, "eventId");

    await adminTransaction(uid, async (txn, callerSnap) => {
        const eventSnap = await txn.get(db.collection("upcomingEvents").doc(eventId));
        if (!eventSnap.exists) throw new HttpsError("not-found", "Event not found.");
        const data = eventSnap.data()!;

        if (!data.deleteAt || data.deleteAt.toMillis() <= Date.now()) {
            throw new HttpsError("not-found", "No pending deletion.");
        }

        txn.update(db.collection("upcomingEvents").doc(eventId), {deleteAt: FieldValue.delete()});
        txn.set(db.collection("records").doc(), {
            type: "upcoming-event-deletion-cancelled",
            performedBy: uid,
            performedByName: callerSnap.data()?.displayName ?? "",
            eventTitle: data.title ?? data.name ?? eventId,
            eventId,
            timestamp: FieldValue.serverTimestamp(),
            expiresAt: recordExpiresAt(),
        });
    });

    return {cancelled: true};
});

/**
 * Firestore trigger fired when an upcoming event is deleted.
 * Always cascades claim-code and poster cleanup — both archive and TTL delete
 * fully remove the upcoming event. The "upcoming-event-deleted" audit record is
 * skipped when an archive happened (a pastEvents doc with the same ID exists),
 * because archiveUpcomingEvent writes its own "upcoming-event-archive" record.
 */
export const onUpcomingEventDeleted = onDocumentDeleted(
    {document: "upcomingEvents/{eventId}", maxInstances: 10},
    async (event) => {
        const data = event.data?.data();
        const eventId = event.params.eventId;
        if (!data) return;

        try {
            const codesSnap = await db.collection("claimCodes")
                .where("eventId", "==", eventId).get();
            const cascadeOps = codesSnap.docs.map(d =>
                (b: FirebaseFirestore.WriteBatch) => b.delete(d.ref)
            );
            if (cascadeOps.length > 0) await commitInChunks(cascadeOps);
        } catch (err) {
            console.error(`onUpcomingEventDeleted: cascade failed for ${eventId}`, err);
        }

        await deleteStorageFile(data.poster ?? "", ["upcoming-events/"])
            .catch(logStorageCleanupError(`onUpcomingEventDeleted ${eventId}`));

        // Skip the deleted-record write if this delete was the tail end of an
        // archive — archiveUpcomingEvent already wrote an "upcoming-event-archive"
        // record, and the past event reuses this ID.
        let archived = false;
        try {
            archived = (await db.collection("pastEvents").doc(eventId).get()).exists;
        } catch (err) {
            console.error(`onUpcomingEventDeleted: archive check failed for ${eventId}`, err);
        }
        if (archived) return;

        try {
            await db.collection("records").add({
                type: "upcoming-event-deleted",
                eventId,
                eventTitle: data.title ?? data.name ?? "",
                timestamp: FieldValue.serverTimestamp(),
                expiresAt: recordExpiresAt(),
            });
        } catch (err) {
            console.error(`onUpcomingEventDeleted: record write failed for ${eventId}`, err);
        }
    }
);

/**
 * Archive an upcoming event to past events (admin only).
 * Creates a past-event template (text fields only — no icon, since the upcoming
 * event's poster is hard-deleted by onUpcomingEventDeleted), then deletes the
 * upcoming event and writes an audit record. Admin uploads a new icon later.
 */
export const archiveUpcomingEvent = onCall({maxInstances: 10}, async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Must be signed in.");
    const uid = request.auth.uid;
    await checkRateLimit(uid);

    const input = request.data as {eventId?: string; tagId?: string};
    const eventId = validateDocId(input.eventId, "eventId");
    const tagId = validateStr(input.tagId, "tagId", 128);
    // Reuse the upcoming event's ID for the past event so users' attendedEvents
    // and claim-code records remain valid across the archive boundary.
    const newDocRef = db.collection("pastEvents").doc(eventId);

    return adminTransaction(uid, async (txn, callerSnap) => {
        const [eventSnap, pastCollisionSnap] = await Promise.all([
            txn.get(db.collection("upcomingEvents").doc(eventId)),
            txn.get(newDocRef),
        ]);
        if (!eventSnap.exists) throw new HttpsError("not-found", "Event not found.");
        if (pastCollisionSnap.exists) {
            throw new HttpsError("already-exists", "A past event with this ID already exists.");
        }
        const eventData = eventSnap.data()!;

        const startDate: Date = eventData.startAt?.toDate?.() ?? new Date();
        const pad = (n: number) => String(n).padStart(2, "0");
        const dateStr = `${startDate.getFullYear()}-${pad(startDate.getMonth() + 1)}-${pad(startDate.getDate())}`;

        txn.set(newDocRef, {
            title: eventData.title ?? eventData.name ?? "",
            titleCn: eventData.titleCn ?? eventData.nameCn ?? "",
            date: dateStr,
            location: eventData.location ?? "",
            locationCn: eventData.locationCn ?? "",
            description: eventData.description ?? "",
            descriptionCn: eventData.descriptionCn ?? "",
            icon: "",
            tagId,
            published: false,
        });
        txn.delete(db.collection("upcomingEvents").doc(eventId));
        txn.set(db.collection("records").doc(), {
            type: "upcoming-event-archive",
            performedBy: uid,
            performedByName: callerSnap.data()?.displayName ?? "",
            eventTitle: eventData.title ?? eventData.name ?? eventId,
            eventId: newDocRef.id,
            timestamp: FieldValue.serverTimestamp(),
            expiresAt: recordExpiresAt(),
        });
        return {pastEventId: newDocRef.id};
    });
});

/**
 * Create or update a badge definition (admin only).
 * On create, sets createdBy to the caller's UID and createdAt to server timestamp.
 */
export const saveBadge = onCall({maxInstances: 10}, async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Must be signed in.");
    const uid = request.auth.uid;
    await checkRateLimit(uid);

    const input = request.data as Record<string, unknown>;
    const badgeId = input.badgeId ? validateDocId(input.badgeId, "badgeId") : null;
    const name = validateStr(input.name, "name", 200, true);
    const nameCn = validateStr(input.nameCn, "nameCn", 200);
    const description = validateStr(input.description, "description", 2000);
    const descriptionCn = validateStr(input.descriptionCn, "descriptionCn", 2000);
    const imageUrl = validateStr(input.imageUrl, "imageUrl", 500);
    validateStorageImageUrl(imageUrl, "imageUrl");
    // createdByUid/Name/Link are for crediting the badge designer (not the admin who enters it).
    // The actual admin who performed the action is recorded as createdBy/performedBy.
    const createdByUid = validateStr(input.createdByUid, "createdByUid", 128);
    const createdByName = sanitizeDisplayText(validateStr(input.createdByName, "createdByName", 100));
    const createdByLink = validateStr(input.createdByLink, "createdByLink", 500);
    validateUrl(createdByLink, "createdByLink");

    const newRef = badgeId ? null : db.collection("badges").doc();

    const {result, oldImageUrl} = await adminTransaction(uid, async (txn, callerSnap) => {
        // Validate createdByUid references an existing user if provided
        if (createdByUid) {
            const creatorSnap = await txn.get(db.collection("users").doc(createdByUid));
            if (!creatorSnap.exists) {
                throw new HttpsError("invalid-argument", "createdByUid does not reference an existing user.");
            }
        }

        if (badgeId) {
            const existing = await txn.get(db.collection("badges").doc(badgeId));
            if (!existing.exists) throw new HttpsError("not-found", "Badge not found.");
            const prevImageUrl: string = existing.data()?.imageUrl ?? "";

            txn.update(db.collection("badges").doc(badgeId), {
                name, nameCn, description, descriptionCn, imageUrl,
                createdByUid, createdByName, createdByLink,
            });
            txn.set(db.collection("records").doc(), {
                type: "badge-edit",
                performedBy: uid,
                performedByName: callerSnap.data()?.displayName ?? "",
                badgeId,
                badgeName: name,
                timestamp: FieldValue.serverTimestamp(),
                expiresAt: recordExpiresAt(),
            });
            return {result: {badgeId}, oldImageUrl: prevImageUrl};
        }

        txn.set(newRef!, {
            name, nameCn, description, descriptionCn, imageUrl,
            createdBy: uid,
            createdByUid, createdByName, createdByLink,
            createdAt: FieldValue.serverTimestamp(),
        });
        txn.set(db.collection("records").doc(), {
            type: "badge-create",
            performedBy: uid,
            performedByName: callerSnap.data()?.displayName ?? "",
            badgeId: newRef!.id,
            badgeName: name,
            timestamp: FieldValue.serverTimestamp(),
            expiresAt: recordExpiresAt(),
        });
        return {result: {badgeId: newRef!.id}, oldImageUrl: ""};
    });

    if (oldImageUrl && oldImageUrl !== imageUrl) {
        await deleteStorageFile(oldImageUrl, ["badges/"])
            .catch(logStorageCleanupError(`saveBadge ${result.badgeId}`));
    }

    return result;
});

/**
 * Toggle event attendance for a user (admin only).
 * Enforces hierarchy: core-staff can only manage visitor/member/staff.
 */
export const toggleAttendance = onCall({maxInstances: 10}, async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Must be signed in.");
    const uid = request.auth.uid;
    await checkRateLimit(uid);

    const input = request.data as {targetUid?: string; eventId?: string; grant?: boolean};
    const targetUid = validateDocId(input.targetUid, "targetUid");
    const eventId = validateDocId(input.eventId, "eventId");
    if (typeof input.grant !== "boolean") {
        throw new HttpsError("invalid-argument", "grant must be a boolean.");
    }
    const grant = input.grant;

    return adminTransaction(uid, async (txn, callerSnap) => {
        const callerGroup = callerSnap.data()!.group;
        const targetSnap = await txn.get(db.collection("users").doc(targetUid));
        if (!targetSnap.exists) throw new HttpsError("not-found", "User not found.");
        if (callerGroup !== "president" && !["visitor", "member", "staff"].includes(targetSnap.data()!.group)) {
            throw new HttpsError("permission-denied", "Cannot manage users at or above your level.");
        }

        const eventSnap = await txn.get(db.collection("pastEvents").doc(eventId));
        if (!eventSnap.exists) throw new HttpsError("not-found", "Event not found.");

        txn.update(db.collection("users").doc(targetUid), {
            attendedEvents: grant ? FieldValue.arrayUnion(eventId) : FieldValue.arrayRemove(eventId),
        });
        txn.set(db.collection("records").doc(), {
            type: grant ? "event-attend" : "event-unattend",
            performedBy: uid,
            performedByName: callerSnap.data()!.displayName ?? "",
            targetUid,
            targetName: targetSnap.data()!.displayName ?? "",
            eventTitle: eventSnap.data()!.title ?? eventId,
            eventId,
            timestamp: FieldValue.serverTimestamp(),
            expiresAt: recordExpiresAt(),
        });
        return {granted: grant};
    });
});

/**
 * Toggle a badge on a user (admin only).
 * Enforces hierarchy: core-staff can only manage visitor/member/staff.
 */
export const toggleUserBadge = onCall({maxInstances: 10}, async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Must be signed in.");
    const uid = request.auth.uid;
    await checkRateLimit(uid);

    const input = request.data as {targetUid?: string; badgeId?: string; grant?: boolean};
    const targetUid = validateDocId(input.targetUid, "targetUid");
    const badgeId = validateDocId(input.badgeId, "badgeId");
    if (typeof input.grant !== "boolean") {
        throw new HttpsError("invalid-argument", "grant must be a boolean.");
    }
    const grant = input.grant;

    return adminTransaction(uid, async (txn, callerSnap) => {
        const callerGroup = callerSnap.data()!.group;
        const targetSnap = await txn.get(db.collection("users").doc(targetUid));
        if (!targetSnap.exists) throw new HttpsError("not-found", "User not found.");
        if (callerGroup !== "president" && !["visitor", "member", "staff"].includes(targetSnap.data()!.group)) {
            throw new HttpsError("permission-denied", "Cannot manage users at or above your level.");
        }

        const badgeSnap = await txn.get(db.collection("badges").doc(badgeId));
        if (!badgeSnap.exists) throw new HttpsError("not-found", "Badge not found.");

        txn.update(db.collection("users").doc(targetUid), {
            badges: grant ? FieldValue.arrayUnion(badgeId) : FieldValue.arrayRemove(badgeId),
            [`badgeEarnedAt.${badgeId}`]: grant ? FieldValue.serverTimestamp() : FieldValue.delete(),
        });
        txn.set(db.collection("records").doc(), {
            type: grant ? "achievement-grant" : "achievement-revoke",
            performedBy: uid,
            performedByName: callerSnap.data()!.displayName ?? "",
            targetUid,
            targetName: targetSnap.data()!.displayName ?? "",
            badgeId,
            badgeName: badgeSnap.data()?.name ?? badgeId,
            timestamp: FieldValue.serverTimestamp(),
            expiresAt: recordExpiresAt(),
        });
        return {granted: grant};
    });
});

/**
 * Toggle active status on an event claim code (admin only).
 */
export const toggleClaimCodeActive = onCall({maxInstances: 10}, async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Must be signed in.");
    const uid = request.auth.uid;
    await checkRateLimit(uid);

    const input = request.data as {codeId?: string; active?: boolean};
    const codeId = validateDocId(input.codeId, "codeId");
    if (typeof input.active !== "boolean") {
        throw new HttpsError("invalid-argument", "active must be a boolean.");
    }

    return adminTransaction(uid, async (txn, callerSnap) => {
        const codeSnap = await txn.get(db.collection("claimCodes").doc(codeId));
        if (!codeSnap.exists) throw new HttpsError("not-found", "Code not found.");
        const codeData = codeSnap.data()!;

        const eventSnap = codeData.eventId
            ? await txn.get(db.collection("upcomingEvents").doc(codeData.eventId))
            : null;

        txn.update(db.collection("claimCodes").doc(codeId), {active: input.active});
        txn.set(db.collection("records").doc(), {
            type: input.active ? "event-code-activate" : "event-code-deactivate",
            performedBy: uid,
            performedByName: callerSnap.data()?.displayName ?? "",
            eventTitle: eventSnap?.data()?.title ?? eventSnap?.data()?.name ?? codeData.eventId ?? "",
            eventId: codeData.eventId ?? "",
            code: codeData.code ?? "",
            timestamp: FieldValue.serverTimestamp(),
            expiresAt: recordExpiresAt(),
        });
        return {active: input.active};
    });
});

/**
 * Update time window on an event claim code (admin only).
 */
export const saveClaimCodeTimeWindow = onCall({maxInstances: 10}, async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Must be signed in.");
    const uid = request.auth.uid;
    await checkRateLimit(uid);

    const input = request.data as {codeId?: string; activeFrom?: string; activeUntil?: string};
    const codeId = validateDocId(input.codeId, "codeId");
    const activeFrom = validateISODate(input.activeFrom, "activeFrom");
    const activeUntil = validateISODate(input.activeUntil, "activeUntil");

    return adminTransaction(uid, async (txn, callerSnap) => {
        const codeSnap = await txn.get(db.collection("claimCodes").doc(codeId));
        if (!codeSnap.exists) throw new HttpsError("not-found", "Code not found.");
        const codeData = codeSnap.data()!;

        const eventSnap = codeData.eventId
            ? await txn.get(db.collection("upcomingEvents").doc(codeData.eventId))
            : null;

        txn.update(db.collection("claimCodes").doc(codeId), {
            activeFrom: activeFrom ?? null,
            activeUntil: activeUntil ?? null,
            expiresAt: activeUntil ? Timestamp.fromDate(new Date(activeUntil)) : null,
        });
        txn.set(db.collection("records").doc(), {
            type: "event-code-time-window",
            performedBy: uid,
            performedByName: callerSnap.data()?.displayName ?? "",
            eventTitle: eventSnap?.data()?.title ?? eventSnap?.data()?.name ?? codeData.eventId ?? "",
            eventId: codeData.eventId ?? "",
            code: codeData.code ?? "",
            timestamp: FieldValue.serverTimestamp(),
            expiresAt: recordExpiresAt(),
        });
        return {saved: true};
    });
});

/**
 * Toggle active status on a badge activation code (admin only).
 */
export const toggleBadgeCodeActive = onCall({maxInstances: 10}, async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Must be signed in.");
    const uid = request.auth.uid;
    await checkRateLimit(uid);

    const input = request.data as {codeId?: string; active?: boolean};
    const codeId = validateDocId(input.codeId, "codeId");
    if (typeof input.active !== "boolean") {
        throw new HttpsError("invalid-argument", "active must be a boolean.");
    }

    return adminTransaction(uid, async (txn, callerSnap) => {
        const codeSnap = await txn.get(db.collection("badgeActivationCodes").doc(codeId));
        if (!codeSnap.exists) throw new HttpsError("not-found", "Code not found.");
        const codeData = codeSnap.data()!;

        const badgeSnap = codeData.badgeId
            ? await txn.get(db.collection("badges").doc(codeData.badgeId))
            : null;

        txn.update(db.collection("badgeActivationCodes").doc(codeId), {active: input.active});
        txn.set(db.collection("records").doc(), {
            type: input.active ? "badge-code-activate" : "badge-code-deactivate",
            performedBy: uid,
            performedByName: callerSnap.data()?.displayName ?? "",
            badgeId: codeData.badgeId ?? "",
            badgeName: badgeSnap?.data()?.name ?? codeData.badgeId ?? "",
            code: codeData.code ?? "",
            timestamp: FieldValue.serverTimestamp(),
            expiresAt: recordExpiresAt(),
        });
        return {active: input.active};
    });
});

/**
 * Delete a badge activation code (admin only).
 */
export const deleteBadgeActivationCode = onCall({maxInstances: 10}, async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Must be signed in.");
    const uid = request.auth.uid;
    await checkRateLimit(uid);

    const codeId = validateDocId((request.data as {codeId?: string})?.codeId, "codeId");

    return adminTransaction(uid, async (txn, callerSnap) => {
        const codeSnap = await txn.get(db.collection("badgeActivationCodes").doc(codeId));
        if (!codeSnap.exists) throw new HttpsError("not-found", "Code not found.");
        const codeData = codeSnap.data()!;

        const badgeSnap = codeData.badgeId
            ? await txn.get(db.collection("badges").doc(codeData.badgeId))
            : null;

        txn.delete(db.collection("badgeActivationCodes").doc(codeId));
        txn.set(db.collection("records").doc(), {
            type: "code-delete",
            performedBy: uid,
            performedByName: callerSnap.data()?.displayName ?? "",
            badgeId: codeData.badgeId ?? "",
            badgeName: badgeSnap?.data()?.name ?? codeData.badgeId ?? "",
            code: codeData.code ?? "",
            timestamp: FieldValue.serverTimestamp(),
            expiresAt: recordExpiresAt(),
        });
        return {deleted: true};
    });
});

/**
 * Create or update an event label/tag (admin only).
 */
export const saveTag = onCall({maxInstances: 10}, async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Must be signed in.");
    const uid = request.auth.uid;
    await checkRateLimit(uid);

    const input = request.data as Record<string, unknown>;
    const tagId = input.tagId ? validateDocId(input.tagId, "tagId") : null;
    const name = sanitizeDisplayText(validateStr(input.name, "name", 100, true));
    const nameCn = sanitizeDisplayText(validateStr(input.nameCn, "nameCn", 100));
    if (!name) throw new HttpsError("invalid-argument", "name is required.");
    const nameLower = name.toLowerCase();
    const docId = tagId ?? db.collection("eventLabels").doc().id;

    return adminTransaction(uid, async (txn, callerSnap) => {
        if (tagId) {
            const existing = await txn.get(db.collection("eventLabels").doc(tagId));
            if (!existing.exists) throw new HttpsError("not-found", "Tag not found.");
        }

        const existingByNameLower = await txn.get(
            db.collection("eventLabels").where("nameLower", "==", nameLower).limit(1),
        );
        if (!existingByNameLower.empty && existingByNameLower.docs[0].id !== tagId) {
            throw new HttpsError("already-exists", "A tag with this name already exists.");
        }

        const ref = db.collection("eventLabels").doc(docId);
        if (tagId) {
            txn.update(ref, {name, nameLower, nameCn});
        } else {
            txn.set(ref, {name, nameLower, nameCn});
        }
        txn.set(db.collection("records").doc(), {
            type: tagId ? "tag-edit" : "tag-create",
            performedBy: uid,
            performedByName: callerSnap.data()?.displayName ?? "",
            tagName: name,
            timestamp: FieldValue.serverTimestamp(),
            expiresAt: recordExpiresAt(),
        });
        return {tagId: docId};
    });
});

/**
 * Delete an event label/tag (admin only).
 */
export const deleteTag = onCall({maxInstances: 10}, async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Must be signed in.");
    const uid = request.auth.uid;
    await checkRateLimit(uid);

    const tagId = validateDocId((request.data as {tagId?: string})?.tagId, "tagId");

    return adminTransaction(uid, async (txn, callerSnap) => {
        const tagSnap = await txn.get(db.collection("eventLabels").doc(tagId));
        if (!tagSnap.exists) throw new HttpsError("not-found", "Tag not found.");

        txn.delete(db.collection("eventLabels").doc(tagId));
        txn.set(db.collection("records").doc(), {
            type: "tag-delete",
            performedBy: uid,
            performedByName: callerSnap.data()?.displayName ?? "",
            tagName: tagSnap.data()?.name ?? tagId,
            timestamp: FieldValue.serverTimestamp(),
            expiresAt: recordExpiresAt(),
        });
        return {deleted: true};
    });
});

/**
 * Request account deletion with a 48-hour cooldown.
 * Self-request when targetUid is omitted; admin-request requires hierarchy auth.
 * Sets deleteAt on the user doc. Firestore TTL on deleteAt triggers onUserDeleted.
 */
export const requestAccountDeletion = onCall({maxInstances: 10}, async (request) => {
    const callerUid = await requireAuth(request);
    const inputTarget = (request.data as {targetUid?: string})?.targetUid;
    const targetUid = inputTarget ? validateDocId(inputTarget, "targetUid") : callerUid;

    const deleteAt = deletionExpiresAt();

    await db.runTransaction(async (txn) => {
        const [callerSnap, targetSnap] = await Promise.all([
            txn.get(db.collection("users").doc(callerUid)),
            txn.get(db.collection("users").doc(targetUid)),
        ]);

        if (!targetSnap.exists) {
            throw new HttpsError("not-found", "User not found.");
        }
        const targetData = targetSnap.data()!;

        if (callerUid === targetUid) {
            if (targetData.group === "visitor") {
                throw new HttpsError("permission-denied", "Visitors cannot delete.");
            }
        } else {
            if (!callerSnap.exists) {
                throw new HttpsError("permission-denied", "Insufficient permissions.");
            }
            const callerGroup = callerSnap.data()!.group;
            if (!ADMIN_GROUPS.includes(callerGroup)) {
                throw new HttpsError("permission-denied", "Insufficient permissions.");
            }
            if (callerGroup !== "president"
                && !["visitor", "member", "staff"].includes(targetData.group)) {
                throw new HttpsError("permission-denied", "Cannot manage users at or above your level.");
            }
        }

        if (targetData.deleteAt && targetData.deleteAt.toMillis() > Date.now()) {
            throw new HttpsError("already-exists", "deletion-already-pending");
        }

        const callerName = callerSnap.exists
            ? (callerSnap.data()!.displayName ?? "")
            : (targetData.displayName ?? "");

        txn.update(db.collection("users").doc(targetUid), {deleteAt});
        txn.set(db.collection("records").doc(), {
            type: "account-deletion-requested",
            performedBy: callerUid,
            performedByName: callerName,
            targetUid,
            targetName: targetData.displayName ?? "",
            timestamp: FieldValue.serverTimestamp(),
            expiresAt: recordExpiresAt(),
        });
    });

    return {deleteAt: deleteAt.toDate().toISOString()};
});

/**
 * Cancel a pending account deletion.
 * Target user can always cancel their own; admins must pass hierarchy check.
 * Clears deleteAt on the user doc so Firestore TTL never fires.
 */
export const cancelAccountDeletion = onCall({maxInstances: 10}, async (request) => {
    const callerUid = await requireAuth(request);
    const inputTarget = (request.data as {targetUid?: string})?.targetUid;
    const targetUid = inputTarget ? validateDocId(inputTarget, "targetUid") : callerUid;

    await db.runTransaction(async (txn) => {
        const [callerSnap, targetSnap] = await Promise.all([
            txn.get(db.collection("users").doc(callerUid)),
            txn.get(db.collection("users").doc(targetUid)),
        ]);

        if (!targetSnap.exists) {
            throw new HttpsError("not-found", "User not found.");
        }
        const targetData = targetSnap.data()!;
        if (!targetData.deleteAt || targetData.deleteAt.toMillis() <= Date.now()) {
            throw new HttpsError("not-found", "No pending deletion.");
        }

        if (callerUid !== targetUid) {
            if (!callerSnap.exists || !ADMIN_GROUPS.includes(callerSnap.data()!.group)) {
                throw new HttpsError("permission-denied", "Insufficient permissions.");
            }
            const callerGroup = callerSnap.data()!.group;
            if (callerGroup !== "president"
                && !["visitor", "member", "staff"].includes(targetData.group)) {
                throw new HttpsError("permission-denied", "Cannot manage users at or above your level.");
            }
        }

        const callerName = callerSnap.exists
            ? (callerSnap.data()!.displayName ?? "")
            : (targetData.displayName ?? "");

        txn.update(db.collection("users").doc(targetUid), {deleteAt: FieldValue.delete()});
        txn.set(db.collection("records").doc(), {
            type: "account-deletion-cancelled",
            performedBy: callerUid,
            performedByName: callerName,
            targetUid,
            targetName: targetData.displayName ?? "",
            timestamp: FieldValue.serverTimestamp(),
            expiresAt: recordExpiresAt(),
        });
    });

    return {cancelled: true};
});

/**
 * Firestore trigger that fires when a user doc is deleted via Firestore TTL.
 * TTL on users.deleteAt triggers this after the 48-hour cooldown passes.
 */
export const onUserDeleted = onDocumentDeleted(
    {document: "users/{uid}", maxInstances: 10},
    async (event) => {
        const data = event.data?.data();
        const uid = event.params.uid;

        try {
            await getAuth().deleteUser(uid);
        } catch (err: unknown) {
            const code = (err as {code?: string})?.code;
            if (code !== "auth/user-not-found") {
                console.error(`onUserDeleted: deleteUser failed for ${uid}`, err);
                throw err;
            }
        }

        try {
            await getStorage().bucket().file(`avatars/${uid}`).delete({ignoreNotFound: true});
        } catch (err) {
            console.error(`onUserDeleted: avatar delete failed for ${uid}`, err);
        }

        try {
            await db.collection("records").add({
                type: "account-deleted",
                targetUid: uid,
                targetName: data?.displayName ?? "",
                targetEmail: data?.email ?? "",
                timestamp: FieldValue.serverTimestamp(),
                expiresAt: recordExpiresAt(),
            });
        } catch (err) {
            console.error(`onUserDeleted: record write failed for ${uid}`, err);
        }
    }
);