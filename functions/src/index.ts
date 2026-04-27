import { initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { FieldPath, FieldValue, getFirestore, Timestamp } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { onDocumentDeleted } from "firebase-functions/v2/firestore";
import { type CallableRequest, HttpsError, onCall } from "firebase-functions/v2/https";

import * as crypto from "crypto";
import sanitizeHtml from "sanitize-html";

// Config read from process.env so non-interactive CI deploys work without a
// committed dotenv file. Override in production by setting env vars on the
// Cloud Function (functions/.env.<project>, gcloud functions deploy
// --update-env-vars, or the v2 parameterised config UI). Explicit empty
// PUBLIC_ORIGIN passes through so generateTicketQrPngBase64's
// failed-precondition guard still fires for misconfigured forks.
const PUBLIC_ORIGIN = process.env.PUBLIC_ORIGIN ?? "https://sekaibeyond.com";
const RESEND_DAILY_CAP = Number(process.env.RESEND_DAILY_CAP) || 100;
const SEND_CHUNK_SIZE = Number(process.env.SEND_CHUNK_SIZE) || 100;
const IMPORT_MAX_ROWS = Number(process.env.IMPORT_MAX_ROWS) || 1000;

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
    return db.runTransaction(async (txn) => {
        const snap = await txn.get(db.collection("users").doc(uid));
        if (!ADMIN_GROUPS.includes(snap.data()?.group)) {
            throw new HttpsError("permission-denied", "Insufficient permissions.");
        }
        return snap;
    });
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
            eventStaffEvents: [],
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

    // Restrict eventStaffEvents to past events only — upcoming-event ids would
    // leak unpublished events whose titles are otherwise gated by Firestore rules.
    const rawStaffEvents: string[] = data.eventStaffEvents ?? [];
    const eventStaffEvents: string[] = [];
    if (rawStaffEvents.length > 0) {
        const refs = rawStaffEvents.map(id => db.collection("pastEvents").doc(id));
        const snaps = await db.getAll(...refs);
        for (let i = 0; i < snaps.length; i++) {
            if (snaps[i].exists) eventStaffEvents.push(rawStaffEvents[i]);
        }
    }

    return {
        displayName: data.displayName ?? "",
        photoURL: data.photoURL ?? "",
        joinedAt: data.joinedAt?.toDate?.()?.toISOString() ?? new Date().toISOString(),
        attendedEvents: data.attendedEvents ?? [],
        eventStaffEvents,
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
        // Paid events use tickets — reject stale code URLs from before a paid toggle.
        if (eventData.paid === true) {
            throw new HttpsError("failed-precondition", "Invalid or deactivated code.", {code: "invalid"});
        }
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
    await checkRateLimit(uid);

    const userSnap = await db.collection("users").doc(uid).get();
    const group = userSnap.data()?.group;
    if (!group || group === "visitor") {
        throw new HttpsError("permission-denied", "Visitors cannot upload avatars.");
    }

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
    await checkRateLimit(uid);

    const userSnap = await db.collection("users").doc(uid).get();
    const group = userSnap.data()?.group;
    if (!group || group === "visitor") {
        throw new HttpsError("permission-denied", "Visitors cannot delete avatars.");
    }

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
                if (eventSnap.data()?.paid === true) {
                    throw new HttpsError("failed-precondition",
                        "Paid events use tickets, not check-in codes.");
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
                    txn.set(db.collection("records").doc(), {
                        type: "event-code-deactivate",
                        performedBy: uid,
                        performedByName: callerSnap.data()?.displayName ?? "",
                        eventTitle: eventSnap.data()?.title ?? eventSnap.data()?.name ?? eventId,
                        eventId,
                        code: oldDoc.data().code ?? oldDoc.id,
                        timestamp: FieldValue.serverTimestamp(),
                        expiresAt: recordExpiresAt(),
                    });
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
 * Cascades: deletes claim codes, removes from users' attendedEvents and
 * eventStaffEvents, deletes storage icon.
 */
export const onPastEventDeleted = onDocumentDeleted(
    {document: "pastEvents/{eventId}", maxInstances: 10},
    async (event) => {
        const data = event.data?.data();
        const eventId = event.params.eventId;
        if (!data?.deleteAt) return;

        try {
            const [codesSnap, attendeesSnap, staffSnap] = await Promise.all([
                db.collection("claimCodes").where("eventId", "==", eventId).get(),
                db.collection("users").where("attendedEvents", "array-contains", eventId).get(),
                db.collection("users").where("eventStaffEvents", "array-contains", eventId).get(),
            ]);
            const cascadeOps: ((b: FirebaseFirestore.WriteBatch) => void)[] = [
                ...codesSnap.docs.map(d => (b: FirebaseFirestore.WriteBatch) => b.delete(d.ref)),
                ...attendeesSnap.docs.map(d => (b: FirebaseFirestore.WriteBatch) =>
                    b.update(d.ref, {attendedEvents: FieldValue.arrayRemove(eventId)})
                ),
                ...staffSnap.docs.map(d => (b: FirebaseFirestore.WriteBatch) =>
                    b.update(d.ref, {eventStaffEvents: FieldValue.arrayRemove(eventId)})
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
    if (title != null && (typeof title !== "string" || title.length > 100)) {
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

    if (title != null && (typeof title !== "string" || title.length > 100)) {
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
 *
 * Paid toggle is asymmetric on purpose:
 *   - free → paid: claim codes for this event are purged (logged as
 *     `event-code-deactivate`). Tickets become the single source of truth.
 *   - paid → free: the `attendees` and `emailTemplate` subcollections are
 *     left intact so an accidental flip can be undone without re-importing
 *     attendees. The admin UI surfaces a confirmation when this is happening
 *     and attendees exist; if you genuinely want to delete them, do it via
 *     the tickets tab before flipping back to free.
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
    const paid = input.paid === true;

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
        customButtonText, customButtonTextCn, customButtonLink, paid,
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

        // Paid events use tickets, not check-in codes — purge any claim codes
        // that exist for this event (e.g., left over from a free→paid toggle).
        // Reads must happen before writes inside the transaction.
        let codesToDelete: FirebaseFirestore.QueryDocumentSnapshot[] = [];
        if (paid && eventId) {
            const codesSnap = await txn.get(
                db.collection("claimCodes").where("eventId", "==", eventId)
            );
            codesToDelete = codesSnap.docs;
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

        for (const codeDoc of codesToDelete) {
            txn.delete(codeDoc.ref);
            txn.set(db.collection("records").doc(), {
                type: "event-code-deactivate",
                performedBy: uid,
                performedByName: callerSnap.data()?.displayName ?? "",
                eventTitle: title,
                eventId: docId,
                code: codeDoc.data().code ?? codeDoc.id,
                timestamp: FieldValue.serverTimestamp(),
                expiresAt: recordExpiresAt(),
            });
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
        // record, and the past event reuses this ID (so eventStaffEvents
        // references stay valid and we must NOT purge them).
        let archived = false;
        try {
            archived = (await db.collection("pastEvents").doc(eventId).get()).exists;
        } catch (err) {
            console.error(`onUpcomingEventDeleted: archive check failed for ${eventId}`, err);
        }
        if (archived) return;

        // Hard delete (TTL-driven or admin abort) — purge eventStaffEvents
        // references from users so stale event IDs don't haunt assignments.
        try {
            const staffSnap = await db.collection("users")
                .where("eventStaffEvents", "array-contains", eventId).get();
            const staffOps = staffSnap.docs.map(d =>
                (b: FirebaseFirestore.WriteBatch) =>
                    b.update(d.ref, {eventStaffEvents: FieldValue.arrayRemove(eventId)})
            );
            if (staffOps.length > 0) await commitInChunks(staffOps);
        } catch (err) {
            console.error(`onUpcomingEventDeleted: eventStaffEvents cascade failed for ${eventId}`, err);
        }

        // Clean up any orphaned subcollection docs (can occur if archive fails
        // after Phase C partially completed, or on TTL-driven deletion).
        try {
            const orphanedOps: ((b: FirebaseFirestore.WriteBatch) => void)[] = [];
            for (const subCol of ["attendees", "emailTemplate"]) {
                const snap = await db.collection("upcomingEvents").doc(eventId)
                    .collection(subCol).get();
                for (const d of snap.docs) {
                    orphanedOps.push(b => b.delete(d.ref));
                }
            }
            if (orphanedOps.length > 0) await commitInChunks(orphanedOps);
        } catch (err) {
            console.error(`onUpcomingEventDeleted: subcollection cleanup failed for ${eventId}`, err);
        }

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
 * Migrates the event along with its attendees and emailTemplate subcollections.
 *
 * Subcollection docs are copied to pastEvents BEFORE the archive transaction
 * (which is required for the 500-op batch limit). If copy succeeds but the
 * transaction fails, the copied subcollection docs in pastEvents are simply
 * overwritten on the next retry (idempotent). The originals are deleted in
 * chunks AFTER the transaction commits so onUpcomingEventDeleted never sees
 * orphaned subcollection docs.
 */
export const archiveUpcomingEvent = onCall({maxInstances: 10}, async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Must be signed in.");
    const uid = request.auth.uid;
    await checkRateLimit(uid);

    const input = request.data as {eventId?: string; tagId?: string};
    const eventId = validateDocId(input.eventId, "eventId");
    const tagId = validateStr(input.tagId, "tagId", 128);
    const newDocRef = db.collection("pastEvents").doc(eventId);

    // ---- Phase A: stream-copy subcollections to pastEvents ----
    const attendeesSrc = db.collection("upcomingEvents").doc(eventId).collection("attendees");
    const emailTemplateSrc = db.collection("upcomingEvents").doc(eventId).collection("emailTemplate");

    const [attendeesSnap, emailTemplateSnap] = await Promise.all([
        attendeesSrc.get(),
        emailTemplateSrc.get(),
    ]);

    const pastAttendeesCol = newDocRef.collection("attendees");
    const pastEmailTemplateCol = newDocRef.collection("emailTemplate");

    const copyOps: ((b: FirebaseFirestore.WriteBatch) => void)[] = [];

    for (const doc of attendeesSnap.docs) {
        copyOps.push(b => b.set(pastAttendeesCol.doc(doc.id), doc.data()));
    }
    for (const doc of emailTemplateSnap.docs) {
        copyOps.push(b => b.set(pastEmailTemplateCol.doc(doc.id), doc.data()));
    }

    if (copyOps.length > 0) await commitInChunks(copyOps);

    // ---- Phase B: archive transaction (atomic) ----
    const {pastEventId} = await adminTransaction(uid, async (txn, callerSnap) => {
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
        const dateStr = new Intl.DateTimeFormat("en-CA", {
            timeZone: "America/Los_Angeles",
            year: "numeric", month: "2-digit", day: "2-digit",
        }).format(startDate);

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

    // ---- Phase C: delete original subcollections in chunks ----
    // Re-query the LIVE collections so any doc written between Phase A and
    // Phase B (a concurrent attendee import / template edit) still gets wiped.
    // Without this, late arrivals strand under upcomingEvents/{deletedId}/…
    // and onUpcomingEventDeleted's fallback cleanup is skipped because the
    // archive path wrote a pastEvents doc with the same id.
    const [liveAttendees, liveTemplate] = await Promise.all([
        attendeesSrc.get(),
        emailTemplateSrc.get(),
    ]);
    const deleteOps: ((b: FirebaseFirestore.WriteBatch) => void)[] = [];
    for (const doc of liveAttendees.docs) {
        deleteOps.push(b => b.delete(doc.ref));
    }
    for (const doc of liveTemplate.docs) {
        deleteOps.push(b => b.delete(doc.ref));
    }
    if (deleteOps.length > 0) await commitInChunks(deleteOps);

    // ---- Phase D: remove event from assigned users' eventStaffEvents ----
    // Once archived, event staff no longer need admin panel access for this event.
    try {
        const staffUsersSnap = await db.collection("users")
            .where("eventStaffEvents", "array-contains", eventId)
            .get();
        if (!staffUsersSnap.empty) {
            const cleanupOps: ((b: FirebaseFirestore.WriteBatch) => void)[] = staffUsersSnap.docs
                .map(d => (b: FirebaseFirestore.WriteBatch) =>
                    b.update(d.ref, {eventStaffEvents: FieldValue.arrayRemove(eventId)}));
            await commitInChunks(cleanupOps);
        }
    } catch (err) {
        console.error(`archiveUpcomingEvent: eventStaffEvents cleanup failed for ${eventId}`, err);
    }

    return {pastEventId};
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
 *
 * Looks up the event in `upcomingEvents` first, then `pastEvents`. Paid
 * upcoming events are rejected — their attendance is driven by tickets, so
 * admins must use the Tickets tab.
 *
 * Rejects grant=true with `has-staff` if the user is event-staff for this
 * event — staff and attendees are mutually exclusive (admin must remove the
 * staff role first).
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
        const [targetSnap, upcomingSnap, pastSnap] = await Promise.all([
            txn.get(db.collection("users").doc(targetUid)),
            txn.get(db.collection("upcomingEvents").doc(eventId)),
            txn.get(db.collection("pastEvents").doc(eventId)),
        ]);
        if (!targetSnap.exists) throw new HttpsError("not-found", "User not found.");
        const targetData = targetSnap.data()!;
        // Hierarchy guard, but allow self-edits — admins managing their own
        // attendance shouldn't be blocked by the "above your level" check.
        if (
            targetUid !== uid
            && callerGroup !== "president"
            && !["visitor", "member", "staff"].includes(targetData.group)
        ) {
            throw new HttpsError("permission-denied", "Cannot manage users at or above your level.");
        }

        let eventSnap;
        if (upcomingSnap.exists) {
            if (upcomingSnap.data()!.paid === true) {
                throw new HttpsError(
                    "failed-precondition",
                    "Paid events use tickets — manage attendance via the Tickets tab.",
                    {code: "paid-event"},
                );
            }
            eventSnap = upcomingSnap;
        } else if (pastSnap.exists) {
            eventSnap = pastSnap;
        } else {
            throw new HttpsError("not-found", "Event not found.");
        }

        if (grant) {
            const staffEvents: string[] = targetData.eventStaffEvents ?? [];
            if (staffEvents.includes(eventId)) {
                throw new HttpsError(
                    "failed-precondition",
                    "User is event staff for this event. Remove them as staff before adding as attendee.",
                    {code: "has-staff"},
                );
            }
        }

        txn.update(db.collection("users").doc(targetUid), {
            attendedEvents: grant ? FieldValue.arrayUnion(eventId) : FieldValue.arrayRemove(eventId),
        });
        txn.set(db.collection("records").doc(), {
            type: grant ? "event-attend" : "event-unattend",
            performedBy: uid,
            performedByName: callerSnap.data()!.displayName ?? "",
            targetUid,
            targetName: targetData.displayName ?? "",
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

// ---------------------------------------------------------------------------
// Paid event ticketing
// ---------------------------------------------------------------------------

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validateEmail(value: unknown, name: string): string {
    if (typeof value !== "string") {
        throw new HttpsError("invalid-argument", `Invalid ${name}.`);
    }
    const normalized = value.trim().toLowerCase();
    if (normalized.length === 0 || normalized.length > 320 || !EMAIL_RE.test(normalized)) {
        throw new HttpsError("invalid-argument", `Invalid ${name}.`);
    }
    return normalized;
}

function validateTicketCount(value: unknown): number {
    if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 50) {
        throw new HttpsError("invalid-argument", "ticketCount must be an integer between 1 and 50.");
    }
    return value;
}

interface NewTicket {
    ticketId: string;
    redeemed: boolean;
    redeemedAt: Timestamp | null;
    redeemedBy: string;
    redeemedByName: string;
    checkedIn: boolean;
    checkedInAt: Timestamp | null;
    voided: boolean;
}

function buildFreshTickets(count: number): {tickets: NewTicket[]; ticketIds: string[]} {
    const tickets: NewTicket[] = [];
    const ticketIds: string[] = [];
    for (let i = 0; i < count; i++) {
        const ticketId = crypto.randomUUID();
        ticketIds.push(ticketId);
        tickets.push({
            ticketId,
            redeemed: false,
            redeemedAt: null,
            redeemedBy: "",
            redeemedByName: "",
            checkedIn: false,
            checkedInAt: null,
            voided: false,
        });
    }
    return {tickets, ticketIds};
}

function formatEventDateForEmail(startAt: Timestamp | undefined, locale: string): string {
    if (!startAt) return "";
    try {
        return new Intl.DateTimeFormat(locale, {
            timeZone: "America/Los_Angeles",
            year: "numeric", month: "long", day: "numeric",
            hour: "numeric", minute: "2-digit",
        }).format(startAt.toDate());
    } catch {
        return "";
    }
}

interface EmailTemplateDoc {
    subject: string;
    bodyHtml: string;
    bodyCnHtml: string;
}

// Allowlist for the ticket-email template HTML. Applied at save time in
// updateEventEmailTemplate. Blocks <script>/<iframe>/<style>/event handlers and
// restricts href to https/mailto, img src to https/data. QR images for tickets
// are injected post-sanitize as cid: references (see renderTicketQrBlock) —
// Gmail strips data: URLs in img src, so QRs must ship as attachments.
//
// MUST STAY IN SYNC with app/lib/emailSanitize.ts EMAIL_HTML_SANITIZE_OPTIONS.
// We duplicate because functions/ and the web app are separate tsc projects
// with their own node_modules; any change here must also be applied there so
// admin preview matches what actually gets sent.
const EMAIL_HTML_SANITIZE_OPTIONS: sanitizeHtml.IOptions = {
    allowedTags: [
        "p", "div", "span", "strong", "em", "b", "i", "u", "br", "hr",
        "h1", "h2", "h3", "h4", "h5", "h6",
        "ul", "ol", "li",
        "a", "img",
        "table", "thead", "tbody", "tr", "td", "th",
        "code", "blockquote",
    ],
    allowedAttributes: {
        "*": ["style", "class", "align", "width", "height"],
        "a": ["href", "title", "target", "rel"],
        "img": ["src", "alt", "title", "width", "height"],
        "td": ["colspan", "rowspan", "valign"],
        "th": ["colspan", "rowspan", "valign"],
    },
    allowedSchemes: ["https", "mailto"],
    allowedSchemesByTag: {
        img: ["https", "data"],
    },
    allowedSchemesAppliedToAttributes: ["href", "src"],
    allowProtocolRelative: false,
    disallowedTagsMode: "discard",
};

function renderTicketQrBlock(ticketIds: string[]): string {
    // One <div> per ticket. Images reference CID attachments added to the mail
    // doc by sendTicketEmails — Gmail strips data: URLs in <img src>, so QRs
    // ship as multipart/related inline attachments instead.
    return ticketIds.map(id => {
        return `<div style="margin:16px 0;text-align:center;">` +
            `<img src="cid:ticket-${id}" alt="Ticket ${id}" style="width:200px;height:200px;display:inline-block;"/>` +
            `<div style="font-family:monospace;font-size:12px;color:#555;word-break:break-all;">${id}</div>` +
            `</div>`;
    }).join("\n");
}

async function generateTicketQrPngBase64(
    ticketIds: string[], eventId: string
): Promise<string[]> {
    // Returns base64-encoded PNG bytes (no data: prefix) suitable for
    // nodemailer attachments with encoding: "base64". Firestore stores the
    // string as-is; the Trigger Email extension forwards it to nodemailer,
    // which decodes it into the multipart/related MIME part.
    const QRCode = (await import("qrcode")).default;
    const origin = PUBLIC_ORIGIN;
    if (!origin) {
        throw new HttpsError(
            "failed-precondition",
            "PUBLIC_ORIGIN is not configured for this Cloud Functions deployment.",
        );
    }
    return Promise.all(ticketIds.map(async id => {
        const url = `${origin}/claim?ticket=${encodeURIComponent(id)}&event=${encodeURIComponent(eventId)}`;
        // 256 px keeps each ticket's QR comfortably under ~4 KB PNG (vs. ~12–20 KB
        // at 400 px), so a 50-ticket attendee fits well within Firestore's 1 MB
        // mail-doc limit. Error correction "M" still scans reliably at this size.
        const buf = await QRCode.toBuffer(url, {errorCorrectionLevel: "M", width: 256, margin: 1});
        return buf.toString("base64");
    }));
}

// Escape user-supplied strings before substitution into HTML email bodies.
// Template HTML itself is sanitized at save time (updateEventEmailTemplate),
// but substitutions land in the already-sanitized output, so we escape here
// to keep an attendee with name like '<img src=x onerror=...>' from injecting.
const escapeHtml = (s: string): string => s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

function renderTemplate(
    template: string,
    data: {
        attendeeEmail: string;
        attendeeName: string;
        eventTitle: string;
        eventTitleCn: string;
        eventDate: string;
        ticketCount: number;
        ticketBlock: string;
    },
    // True when rendering into HTML (body). False for plain-text contexts
    // (subject line) — entity-encoding subject text would surface literally
    // in inboxes (e.g. "Jones &amp; Co").
    htmlContext: boolean,
): string {
    const sub = htmlContext ? escapeHtml : (s: string) => s;
    return template
        .replace(/{{\s*attendeeEmail\s*}}/g, sub(data.attendeeEmail))
        .replace(/{{\s*attendeeName\s*}}/g, sub(data.attendeeName))
        .replace(/{{\s*eventTitle\s*}}/g, sub(data.eventTitle))
        .replace(/{{\s*eventTitleCn\s*}}/g, sub(data.eventTitleCn))
        .replace(/{{\s*eventDate\s*}}/g, sub(data.eventDate))
        .replace(/{{\s*ticketCount\s*}}/g, String(data.ticketCount))
        // {{ ticketIds[] }} — with optional surrounding <p>/<div> tags collapsed.
        // ticketBlock is server-built HTML, never escaped.
        .replace(/(<p>\s*|<div>\s*)?{{\s*ticketIds\[\]\s*}}(\s*<\/p>|\s*<\/div>)?/g, data.ticketBlock);
}

/**
 * Import attendees for a paid event from a CSV-parsed payload (admin only).
 *
 * Re-imports (same email) replace the existing attendee doc — old tickets' UUIDs
 * are overwritten with fresh ones, so any QR emails already sent for the old
 * UUIDs become invalid automatically (redeemTicket's ticketIds lookup fails).
 *
 * Maintains the invariant: `attendees[x].tickets[i].ticketId` equals
 * `attendees[x].ticketIds[i]`. `ticketIds` exists purely so we can
 * `array-contains` query by ticketId in `redeemTicket`.
 */
export const importEventAttendees = onCall({maxInstances: 10}, async (request) => {
    const uid = await requireAuth(request);

    const input = request.data as {eventId?: string; attendees?: unknown};
    const eventId = validateDocId(input.eventId, "eventId");
    if (!Array.isArray(input.attendees) || input.attendees.length === 0) {
        throw new HttpsError("invalid-argument", "attendees must be a non-empty array.");
    }
    const importMax = IMPORT_MAX_ROWS;
    if (input.attendees.length > importMax) {
        throw new HttpsError("invalid-argument",
            `Too many attendees in a single import (max ${importMax}).`);
    }

    // Validate + normalize + dedupe (later row wins)
    const normalized = new Map<string, {email: string; name: string; ticketCount: number}>();
    for (const row of input.attendees) {
        if (!row || typeof row !== "object") {
            throw new HttpsError("invalid-argument", "Each attendee row must be an object.");
        }
        const r = row as Record<string, unknown>;
        const email = validateEmail(r.email, "email");
        const name = sanitizeDisplayText(validateStr(r.name, "name", 100, true));
        if (!name) throw new HttpsError("invalid-argument", "name is required.");
        const ticketCount = validateTicketCount(r.ticketCount);
        normalized.set(email, {email, name, ticketCount});
    }

    // Admin check + event existence check in a lightweight transaction.
    // We can't fit the whole import in one transaction (would violate the 500-op
    // limit on large imports), so the big writes run as batched commits below.
    const eventTitle = await adminTransaction(uid, async (txn) => {
        const eventSnap = await txn.get(db.collection("upcomingEvents").doc(eventId));
        if (!eventSnap.exists) throw new HttpsError("not-found", "Event not found.");
        return (eventSnap.data()?.title ?? eventSnap.data()?.name ?? eventId) as string;
    });

    const attendeesCol = db.collection("upcomingEvents").doc(eventId).collection("attendees");

    // Look up existing docs by email in parallel (queries in chunks to avoid
    // the `in` operator's 30-value limit).
    const emails = Array.from(normalized.keys());
    const existingByEmail = new Map<string, FirebaseFirestore.QueryDocumentSnapshot>();
    for (let i = 0; i < emails.length; i += 30) {
        const chunk = emails.slice(i, i + 30);
        const snap = await attendeesCol.where("email", "in", chunk).get();
        for (const doc of snap.docs) {
            const email = doc.data().email;
            if (typeof email === "string") existingByEmail.set(email, doc);
        }
    }

    // Reject the whole import if any imported email belongs to a current
    // event-staff for this event — staff and attendees are mutually exclusive.
    const usersCol = db.collection("users");
    const staffConflicts: string[] = [];
    for (let i = 0; i < emails.length; i += 30) {
        const chunk = emails.slice(i, i + 30);
        const snap = await usersCol.where("email", "in", chunk).get();
        for (const doc of snap.docs) {
            const data = doc.data();
            const staffEvents: string[] = data.eventStaffEvents ?? [];
            if (staffEvents.includes(eventId) && typeof data.email === "string") {
                staffConflicts.push(data.email);
            }
        }
    }
    if (staffConflicts.length > 0) {
        throw new HttpsError(
            "failed-precondition",
            `${staffConflicts.length} user(s) are event staff for this event and cannot be imported as attendees: ${staffConflicts.join(", ")}. Remove them as staff first or omit them from the import.`,
            {code: "has-staff", emails: staffConflicts},
        );
    }

    const callerSnap = await db.collection("users").doc(uid).get();
    const callerName = callerSnap.data()?.displayName ?? "";

    let addedCount = 0;
    let replacedCount = 0;
    const ops: ((b: FirebaseFirestore.WriteBatch) => void)[] = [];

    for (const row of normalized.values()) {
        const {tickets, ticketIds} = buildFreshTickets(row.ticketCount);
        const now = FieldValue.serverTimestamp();
        const existing = existingByEmail.get(row.email);
        if (existing) {
            replacedCount++;
            ops.push(b => b.set(existing.ref, {
                email: row.email,
                name: row.name,
                ticketCount: row.ticketCount,
                tickets,
                ticketIds,
                emailSent: false,
                emailSentAt: null,
                updatedAt: now,
            }, {merge: true}));
        } else {
            addedCount++;
            const newRef = attendeesCol.doc();
            ops.push(b => b.set(newRef, {
                email: row.email,
                name: row.name,
                ticketCount: row.ticketCount,
                tickets,
                ticketIds,
                emailSent: false,
                emailSentAt: null,
                createdAt: now,
                updatedAt: now,
            }));
        }
    }

    ops.push(b => b.set(db.collection("records").doc(), {
        type: "ticket-import",
        performedBy: uid,
        performedByName: callerName,
        eventId,
        eventTitle,
        addedCount,
        replacedCount,
        timestamp: FieldValue.serverTimestamp(),
        expiresAt: recordExpiresAt(),
    }));

    await commitInChunks(ops);

    return {added: addedCount, replaced: replacedCount, total: normalized.size};
});

/**
 * Redeem a ticket (event-staff for this event, or core-staff+).
 *
 * If the attendee's email matches a registered user, also marks them as
 * checked-in and adds the event to their attendedEvents (writes `event-attend`
 * record in addition to `ticket-redeem`). Otherwise leaves the users collection
 * untouched — the attendee is still valid, just unregistered on-site.
 *
 * Already-redeemed tickets return a non-error success so the scanner can render
 * yellow-state info (who/when). Voided tickets throw with {code: 'voided'}.
 */
export const redeemTicket = onCall({maxInstances: 20}, async (request) => {
    const uid = await requireAuth(request);

    const input = request.data as {eventId?: string; ticketId?: string};
    const eventId = validateDocId(input.eventId, "eventId");
    const ticketId = validateStr(input.ticketId, "ticketId", 128, true);

    const attendeesCol = db.collection("upcomingEvents").doc(eventId).collection("attendees");

    return db.runTransaction(async (txn) => {
        const callerSnap = await txn.get(db.collection("users").doc(uid));
        const callerData = callerSnap.data() ?? {};
        const group = callerData.group ?? "visitor";
        const callerEventStaff: string[] = callerData.eventStaffEvents ?? [];
        const isCoreStaffOrAbove = ADMIN_GROUPS.includes(group);
        const isEventStaff = callerEventStaff.includes(eventId);
        if (!isCoreStaffOrAbove && !isEventStaff) {
            throw new HttpsError("permission-denied", "Not authorized to scan tickets for this event.",
                {code: "not-authorized"});
        }

        // Require event exists so stale eventIds can't haunt redemption.
        const eventSnap = await txn.get(db.collection("upcomingEvents").doc(eventId));
        if (!eventSnap.exists) {
            throw new HttpsError("not-found", "Event not found.", {code: "event-missing"});
        }

        const attendeeQuery = await txn.get(
            attendeesCol.where("ticketIds", "array-contains", ticketId).limit(1)
        );
        if (attendeeQuery.empty) {
            throw new HttpsError("not-found", "Ticket not found.", {code: "invalid"});
        }
        const attendeeDoc = attendeeQuery.docs[0];
        const attendeeData = attendeeDoc.data();
        const tickets: NewTicket[] = (attendeeData.tickets ?? []).map(
            (t: Record<string, unknown>) => t as unknown as NewTicket
        );
        const idx = tickets.findIndex(t => t.ticketId === ticketId);
        if (idx < 0) {
            throw new HttpsError("not-found", "Ticket not found.", {code: "invalid"});
        }
        const ticket = tickets[idx];

        if (ticket.voided) {
            throw new HttpsError("failed-precondition", "This ticket has been voided.",
                {code: "voided"});
        }

        const callerName: string = callerData.displayName ?? "";
        const attendeeEmail: string = attendeeData.email ?? "";
        const attendeeName: string = attendeeData.name ?? "";
        const eventTitle: string = eventSnap.data()?.title ?? eventSnap.data()?.name ?? "";

        if (ticket.redeemed) {
            return {
                alreadyRedeemed: true,
                attendeeName,
                attendeeEmail,
                eventTitle,
                ticketIndex: idx,
                redeemedBy: ticket.redeemedByName,
                redeemedAt: ticket.redeemedAt?.toDate?.()?.toISOString() ?? null,
            };
        }

        // Try to link to a registered user by email.
        const matchingUserSnap = await txn.get(
            db.collection("users").where("email", "==", attendeeEmail).limit(1)
        );
        const now = Timestamp.now();
        let userCheckedIn = false;
        if (!matchingUserSnap.empty) {
            const userDoc = matchingUserSnap.docs[0];
            const attended: string[] = userDoc.data().attendedEvents ?? [];
            if (!attended.includes(eventId)) {
                txn.update(userDoc.ref, {attendedEvents: FieldValue.arrayUnion(eventId)});
                txn.set(db.collection("records").doc(), {
                    type: "event-attend",
                    performedBy: uid,
                    performedByName: callerName,
                    targetUid: userDoc.id,
                    targetName: userDoc.data().displayName ?? "",
                    targetEmail: attendeeEmail,
                    eventId,
                    eventTitle,
                    timestamp: FieldValue.serverTimestamp(),
                    expiresAt: recordExpiresAt(),
                });
            }
            userCheckedIn = true;
        }

        tickets[idx] = {
            ...ticket,
            redeemed: true,
            redeemedAt: now,
            redeemedBy: uid,
            redeemedByName: callerName,
            checkedIn: userCheckedIn,
            checkedInAt: userCheckedIn ? now : null,
        };

        txn.update(attendeeDoc.ref, {
            tickets,
            updatedAt: FieldValue.serverTimestamp(),
        });
        txn.set(db.collection("records").doc(), {
            type: "ticket-redeem",
            performedBy: uid,
            performedByName: callerName,
            eventId,
            eventTitle,
            targetEmail: attendeeEmail,
            targetName: attendeeName,
            code: ticketId,
            timestamp: FieldValue.serverTimestamp(),
            expiresAt: recordExpiresAt(),
        });

        return {
            success: true,
            attendeeName,
            attendeeEmail,
            eventTitle,
            ticketIndex: idx,
            userCheckedIn,
        };
    });
});

/**
 * Void a single ticket (core-staff+). Idempotent; voiding a redeemed ticket
 * blocks future scans but does not rewind the user's attendedEvents.
 */
export const voidTicket = onCall({maxInstances: 10}, async (request) => {
    const uid = await requireAuth(request);

    const input = request.data as {eventId?: string; attendeeId?: string; ticketId?: string};
    const eventId = validateDocId(input.eventId, "eventId");
    const attendeeId = validateDocId(input.attendeeId, "attendeeId");
    const ticketId = validateStr(input.ticketId, "ticketId", 128, true);

    return adminTransaction(uid, async (txn, callerSnap) => {
        const eventRef = db.collection("upcomingEvents").doc(eventId);
        const attendeeRef = eventRef.collection("attendees").doc(attendeeId);
        const [eventSnap, attendeeSnap] = await Promise.all([
            txn.get(eventRef),
            txn.get(attendeeRef),
        ]);
        if (!attendeeSnap.exists) {
            throw new HttpsError("not-found", "Attendee not found.");
        }
        const data = attendeeSnap.data()!;
        const tickets: NewTicket[] = (data.tickets ?? []).map(
            (t: Record<string, unknown>) => t as unknown as NewTicket
        );
        const idx = tickets.findIndex(t => t.ticketId === ticketId);
        if (idx < 0) throw new HttpsError("not-found", "Ticket not found.");

        tickets[idx] = {...tickets[idx], voided: true};

        const eventTitle: string = eventSnap.exists
            ? (eventSnap.data()?.title ?? eventSnap.data()?.name ?? eventId)
            : eventId;

        txn.update(attendeeRef, {tickets, updatedAt: FieldValue.serverTimestamp()});
        txn.set(db.collection("records").doc(), {
            type: "ticket-void",
            performedBy: uid,
            performedByName: callerSnap.data()?.displayName ?? "",
            eventId,
            eventTitle,
            targetEmail: data.email ?? "",
            targetName: data.name ?? "",
            code: ticketId,
            timestamp: FieldValue.serverTimestamp(),
            expiresAt: recordExpiresAt(),
        });

        return {voided: true};
    });
});

/**
 * Update a single attendee's name and/or ticketCount (core-staff+).
 *
 * Name-only change: tickets and `emailSent` are left untouched.
 * ticketCount change: regenerates all ticket UUIDs (old QRs die because they
 * leave the `ticketIds` array) and resets `emailSent=false` so the admin knows
 * to resend.
 */
export const updateEventAttendee = onCall({maxInstances: 10}, async (request) => {
    const uid = await requireAuth(request);

    const input = request.data as {
        eventId?: string;
        attendeeId?: string;
        name?: unknown;
        ticketCount?: unknown;
    };
    const eventId = validateDocId(input.eventId, "eventId");
    const attendeeId = validateDocId(input.attendeeId, "attendeeId");
    const name = sanitizeDisplayText(validateStr(input.name, "name", 100, true));
    if (!name) throw new HttpsError("invalid-argument", "name is required.");
    const ticketCount = validateTicketCount(input.ticketCount);

    return adminTransaction(uid, async (txn, callerSnap) => {
        const eventRef = db.collection("upcomingEvents").doc(eventId);
        const attendeeRef = eventRef.collection("attendees").doc(attendeeId);
        const [eventSnap, attendeeSnap] = await Promise.all([
            txn.get(eventRef),
            txn.get(attendeeRef),
        ]);
        if (!attendeeSnap.exists) {
            throw new HttpsError("not-found", "Attendee not found.");
        }
        const data = attendeeSnap.data()!;
        const prevTicketCount: number = data.ticketCount ?? 0;
        const eventTitle: string = eventSnap.exists
            ? (eventSnap.data()?.title ?? eventSnap.data()?.name ?? eventId)
            : eventId;

        if (ticketCount === prevTicketCount) {
            if (name === data.name) {
                return {updated: false, regenerated: false};
            }
            txn.update(attendeeRef, {name, updatedAt: FieldValue.serverTimestamp()});
            txn.set(db.collection("records").doc(), {
                type: "ticket-attendee-edit",
                performedBy: uid,
                performedByName: callerSnap.data()?.displayName ?? "",
                eventId,
                eventTitle,
                targetEmail: data.email ?? "",
                oldName: data.name ?? "",
                newName: name,
                timestamp: FieldValue.serverTimestamp(),
                expiresAt: recordExpiresAt(),
            });
            return {updated: true, regenerated: false};
        }

        const {tickets, ticketIds} = buildFreshTickets(ticketCount);
        txn.update(attendeeRef, {
            name,
            ticketCount,
            tickets,
            ticketIds,
            emailSent: false,
            emailSentAt: null,
            updatedAt: FieldValue.serverTimestamp(),
        });
        txn.set(db.collection("records").doc(), {
            type: "ticket-regenerate",
            performedBy: uid,
            performedByName: callerSnap.data()?.displayName ?? "",
            eventId,
            eventTitle,
            targetEmail: data.email ?? "",
            targetName: name,
            timestamp: FieldValue.serverTimestamp(),
            expiresAt: recordExpiresAt(),
        });
        return {updated: true, regenerated: true};
    });
});

/**
 * Delete an attendee and void all their tickets (core-staff+).
 */
export const deleteEventAttendee = onCall({maxInstances: 10}, async (request) => {
    const uid = await requireAuth(request);

    const input = request.data as {eventId?: string; attendeeId?: string};
    const eventId = validateDocId(input.eventId, "eventId");
    const attendeeId = validateDocId(input.attendeeId, "attendeeId");

    return adminTransaction(uid, async (txn, callerSnap) => {
        const eventRef = db.collection("upcomingEvents").doc(eventId);
        const attendeeRef = eventRef.collection("attendees").doc(attendeeId);
        const [eventSnap, attendeeSnap] = await Promise.all([
            txn.get(eventRef),
            txn.get(attendeeRef),
        ]);
        if (!attendeeSnap.exists) {
            throw new HttpsError("not-found", "Attendee not found.");
        }
        const data = attendeeSnap.data()!;
        const tickets: NewTicket[] = (data.tickets ?? []).map(
            (t: Record<string, unknown>) => t as unknown as NewTicket
        );
        const eventTitle: string = eventSnap.exists
            ? (eventSnap.data()?.title ?? eventSnap.data()?.name ?? eventId)
            : eventId;
        txn.delete(attendeeRef);
        txn.set(db.collection("records").doc(), {
            type: "ticket-attendee-delete",
            performedBy: uid,
            performedByName: callerSnap.data()?.displayName ?? "",
            eventId,
            eventTitle,
            targetEmail: data.email ?? "",
            targetName: data.name ?? "",
            timestamp: FieldValue.serverTimestamp(),
            expiresAt: recordExpiresAt(),
        });
        return {deleted: true, ticketCount: tickets.length};
    });
});

/**
 * Returns today's sent-email count and the configured daily cap.
 * Day boundary is America/Los_Angeles midnight — matches the club's operating
 * timezone and keeps the reset time predictable for admins.
 */
async function computeTicketEmailQuota(): Promise<{sentToday: number; dailyCap: number}> {
    // Start of today in America/Los_Angeles, expressed as a UTC Timestamp.
    // UTC-now minus LA's elapsed-since-midnight equals LA midnight (UTC).
    // hourCycle:'h23' pins the range to 0–23 (en-US hour12:false can return "24").
    const now = new Date();
    const laParts = new Intl.DateTimeFormat("en-GB", {
        timeZone: "America/Los_Angeles",
        hour: "2-digit", minute: "2-digit", second: "2-digit",
        hourCycle: "h23",
    }).formatToParts(now);
    const part = (t: string) => Number(laParts.find(p => p.type === t)?.value ?? "0");
    const laMidnightMs = now.getTime()
        - part("hour") * 3600_000
        - part("minute") * 60_000
        - part("second") * 1000
        - now.getMilliseconds();
    const startOfTodayLA = Timestamp.fromMillis(laMidnightMs);

    // Uses the existing (type, timestamp) composite index.
    const snap = await db.collection("records")
        .where("type", "==", "ticket-email-send")
        .where("timestamp", ">=", startOfTodayLA)
        .get();
    let sentToday = 0;
    for (const d of snap.docs) {
        const c = d.data().sentCount;
        if (typeof c === "number" && Number.isFinite(c)) sentToday += c;
    }
    return {sentToday, dailyCap: RESEND_DAILY_CAP};
}

/**
 * Send ticket emails (core-staff+).
 *
 * Writes to `mail/{autoId}` documents consumed by the Firebase Trigger Email
 * extension. Renders the event's saved email template for each attendee with
 * their tickets embedded as data-URL QR images.
 *
 * Chunked: processes at most SEND_CHUNK_SIZE attendees per invocation. The
 * client loops until `hasMore === false`, passing back `nextCursor` for
 * mode='all' continuation. mode='unsent' drains naturally (sent attendees
 * leave the `emailSent==false` result set), so no cursor is needed there.
 *
 * Throws {code: 'no-template'} if the event's template hasn't been saved yet —
 * the client surfaces a banner prompting the admin to save it first.
 */
export const sendTicketEmails = onCall(
    {maxInstances: 5, timeoutSeconds: 300, memory: "512MiB"},
    async (request) => {
        const uid = await requireAuth(request);
        await requireAdmin(uid);

        const input = request.data as {
            eventId?: string;
            mode?: string;
            attendeeIds?: unknown;
            cursor?: unknown;
        };
        const eventId = validateDocId(input.eventId, "eventId");
        const mode = input.mode === "all" ? "all" : "unsent";
        const chunkSize = SEND_CHUNK_SIZE;
        let attendeeIds: string[] | null = null;
        if (Array.isArray(input.attendeeIds)) {
            attendeeIds = input.attendeeIds.map(id => validateDocId(id, "attendeeId"));
            if (attendeeIds.length > chunkSize) {
                throw new HttpsError("invalid-argument",
                    `Too many attendee ids in a single send (max ${chunkSize}).`);
            }
        }
        const cursor = typeof input.cursor === "string" && input.cursor.length > 0
            ? validateDocId(input.cursor, "cursor")
            : null;

        const eventSnap = await db.collection("upcomingEvents").doc(eventId).get();
        if (!eventSnap.exists) throw new HttpsError("not-found", "Event not found.");
        const eventData = eventSnap.data()!;

        // Load template — hard-fail if not saved. No server-side default.
        const templateRef = db.collection("upcomingEvents").doc(eventId)
            .collection("emailTemplate").doc("default");
        const templateSnap = await templateRef.get();
        if (!templateSnap.exists) {
            throw new HttpsError("failed-precondition",
                "Email template not saved for this event.", {code: "no-template"});
        }
        const templateData = templateSnap.data() ?? {};
        const template: EmailTemplateDoc = {
            subject: (templateData.subject as string) ?? "",
            bodyHtml: (templateData.bodyHtml as string) ?? "",
            bodyCnHtml: (templateData.bodyCnHtml as string) ?? "",
        };
        if (!template.subject.trim() || !template.bodyHtml.trim()) {
            throw new HttpsError("failed-precondition",
                "Email template is empty.", {code: "no-template"});
        }

        // Target attendees — capped at chunkSize.
        const attendeesCol = db.collection("upcomingEvents").doc(eventId).collection("attendees");
        let targets: FirebaseFirestore.QueryDocumentSnapshot[];
        let queriedCount: number;
        if (attendeeIds && attendeeIds.length > 0) {
            const snaps = await Promise.all(attendeeIds.map(id => attendeesCol.doc(id).get()));
            let filtered = snaps.filter(s => s.exists) as FirebaseFirestore.QueryDocumentSnapshot[];
            if (mode === "unsent") {
                filtered = filtered.filter(s => s.data()?.emailSent !== true);
            }
            targets = filtered.slice(0, chunkSize);
            queriedCount = filtered.length;
        } else if (mode === "unsent") {
            // Drain pattern: processed attendees leave the result set on next call.
            // orderBy createdAt gives FIFO fairness across chunks — uses the
            // existing (emailSent, createdAt) composite index.
            const snap = await attendeesCol
                .where("emailSent", "==", false)
                .orderBy("createdAt", "asc")
                .limit(chunkSize)
                .get();
            targets = snap.docs;
            queriedCount = snap.docs.length;
        } else {
            // Resend-all: cursor by doc id for stable chunked iteration.
            let q = attendeesCol.orderBy(FieldPath.documentId())
                .limit(chunkSize);
            if (cursor) q = q.startAfter(cursor);
            const snap = await q.get();
            targets = snap.docs;
            queriedCount = snap.docs.length;
        }

        const eventTitle: string = eventData.title ?? eventData.name ?? "";
        const eventTitleCn: string = eventData.titleCn ?? eventData.nameCn ?? "";
        const eventDateEn = formatEventDateForEmail(eventData.startAt, "en-US");
        const eventDateCn = formatEventDateForEmail(eventData.startAt, "zh-CN");

        // Enforce the Resend daily cap server-side so a buggy/malicious client
        // (or parallel admins) can't blow past it. Caps the chunk at whatever
        // is still available today.
        const {sentToday, dailyCap} = await computeTicketEmailQuota();
        const remainingToday = Math.max(0, dailyCap - sentToday);
        if (remainingToday === 0) {
            throw new HttpsError("resource-exhausted",
                "Daily Resend cap reached.", {code: "quota-exceeded"});
        }

        const ops: ((b: FirebaseFirestore.WriteBatch) => void)[] = [];
        let sentCount = 0;
        let lastProcessedId: string | null = null;

        // Walk targets in order to preserve the cap and cursor semantics, but
        // only collect work — actual QR generation runs in parallel below.
        // Defective attendees (no ticketIds) are marked sent without consuming
        // from remainingToday; matches the original sequential loop.
        const ticketlessTargets: FirebaseFirestore.QueryDocumentSnapshot[] = [];
        const sendableTargets: {
            target: FirebaseFirestore.QueryDocumentSnapshot;
            data: FirebaseFirestore.DocumentData;
            ticketIds: string[];
        }[] = [];
        for (const target of targets) {
            lastProcessedId = target.id;
            if (sentCount >= remainingToday) break;
            const data = target.data();
            const ticketIds: string[] = data.ticketIds ?? [];
            if (ticketIds.length === 0) {
                ticketlessTargets.push(target);
                continue;
            }
            sendableTargets.push({target, data, ticketIds});
            sentCount++;
        }

        // Parallelize QR PNG generation across all sendable attendees. Each
        // attendee's QRs are still generated in parallel inside
        // generateTicketQrPngBase64; this adds a second axis so 100 attendees
        // don't sit behind 99 sequential awaits.
        const qrPerAttendee = await Promise.all(
            sendableTargets.map(s => generateTicketQrPngBase64(s.ticketIds, eventId))
        );

        // Defective attendees: ticketCount validation prevents this at import
        // time, but a bad merge / failed partial batch could leave an attendee
        // with emailSent=false and no ticketIds. Mark sent so the mode='unsent'
        // drain doesn't spin on the same doc forever.
        for (const target of ticketlessTargets) {
            console.warn(
                `[sendTicketEmails] attendee ${target.id} has no ticketIds;` +
                " marking sent to avoid infinite drain"
            );
            ops.push(b => b.update(target.ref, {
                emailSent: true,
                emailSentAt: FieldValue.serverTimestamp(),
                updatedAt: FieldValue.serverTimestamp(),
            }));
        }

        for (let i = 0; i < sendableTargets.length; i++) {
            const {target, data, ticketIds} = sendableTargets[i];
            const qrPngBase64 = qrPerAttendee[i];
            const ticketBlock = renderTicketQrBlock(ticketIds);
            // Inline attachments referenced by cid:ticket-<id> in ticketBlock.
            // content + encoding:"base64" survives Firestore serialization as a
            // plain string; nodemailer decodes it into a multipart/related MIME
            // part so Gmail/Outlook/Apple Mail all render the QR inline.
            const attachments = ticketIds.map((id, j) => ({
                filename: `ticket-${id}.png`,
                content: qrPngBase64[j],
                encoding: "base64",
                cid: `ticket-${id}`,
                contentType: "image/png",
                contentDisposition: "inline",
            }));

            // Strip control chars (CR/LF in particular) from the rendered subject
            // so a stray newline in eventTitle/attendeeName can't escape the
            // Subject: header and inject extra fields. nodemailer's own header
            // encoder already guards against this; this is defense-in-depth.
            const renderedSubject = renderTemplate(template.subject, {
                attendeeEmail: data.email ?? "",
                attendeeName: data.name ?? "",
                eventTitle, eventTitleCn,
                eventDate: eventDateEn,
                ticketCount: data.ticketCount ?? ticketIds.length,
                ticketBlock: "",
            }, false).replace(/[\x00-\x1F\x7F]+/g, " ").trim();
            const renderedBodyEn = renderTemplate(template.bodyHtml, {
                attendeeEmail: data.email ?? "",
                attendeeName: data.name ?? "",
                eventTitle, eventTitleCn,
                eventDate: eventDateEn,
                ticketCount: data.ticketCount ?? ticketIds.length,
                ticketBlock,
            }, true);
            const renderedBodyCn = renderTemplate(template.bodyCnHtml, {
                attendeeEmail: data.email ?? "",
                attendeeName: data.name ?? "",
                eventTitle, eventTitleCn,
                eventDate: eventDateCn,
                ticketCount: data.ticketCount ?? ticketIds.length,
                ticketBlock,
            }, true);

            // Bilingual: EN first, CN below, separated by a thin hr.
            const html = renderedBodyCn
                ? `${renderedBodyEn}\n<hr style="border:none;border-top:1px solid #ddd;margin:24px 0;"/>\n${renderedBodyCn}`
                : renderedBodyEn;

            const mailRef = db.collection("mail").doc();
            ops.push(b => b.set(mailRef, {
                to: data.email,
                message: {subject: renderedSubject, html, attachments},
            }));
            ops.push(b => b.update(target.ref, {
                emailSent: true,
                emailSentAt: FieldValue.serverTimestamp(),
                updatedAt: FieldValue.serverTimestamp(),
            }));
        }

        // Only write an audit record when we actually sent something. Otherwise
        // chunked loops would fill `records` with zero-count noise.
        if (sentCount > 0) {
            const callerSnap = await db.collection("users").doc(uid).get();
            ops.push(b => b.set(db.collection("records").doc(), {
                type: "ticket-email-send",
                performedBy: uid,
                performedByName: callerSnap.data()?.displayName ?? "",
                eventId,
                eventTitle,
                sentCount,
                timestamp: FieldValue.serverTimestamp(),
                expiresAt: recordExpiresAt(),
            }));
        }

        if (ops.length > 0) await commitInChunks(ops);

        // hasMore: the query returned a full chunk (there may be more).
        // For attendeeIds, client controls chunking — never set hasMore.
        const hasMore = !attendeeIds && queriedCount >= chunkSize;
        const nextCursor = mode === "all" && hasMore && lastProcessedId
            ? lastProcessedId
            : undefined;

        return {sentCount, hasMore, ...(nextCursor ? {nextCursor} : {})};
    });

/**
 * Return today's count of sent ticket emails across ALL events (core-staff+)
 * plus the server's per-invocation chunk size. Clients use the quota to surface
 * the Resend free-tier cap and chunkSize to match the server's chunk loop.
 */
export const getTicketEmailQuota = onCall({maxInstances: 5}, async (request) => {
    const uid = await requireAuth(request);
    await requireAdmin(uid);

    const {sentToday, dailyCap} = await computeTicketEmailQuota();
    return {sentToday, dailyCap, chunkSize: SEND_CHUNK_SIZE};
});

/**
 * Upsert the event's email template (core-staff+).
 *
 * Body HTML is sanitized server-side with a narrow allowlist
 * (EMAIL_HTML_SANITIZE_OPTIONS): strips <script>, <iframe>, <style>, event
 * handlers, javascript: URLs, and any http:-scheme links. Even though editors
 * are trusted, this bounds the blast radius if a core-staff account is
 * compromised — attacker can't inject phishing-via-DKIM-signed-email.
 */
export const updateEventEmailTemplate = onCall({maxInstances: 10}, async (request) => {
    const uid = await requireAuth(request);

    const input = request.data as {
        eventId?: string;
        subject?: unknown;
        bodyHtml?: unknown;
        bodyCnHtml?: unknown;
    };
    const eventId = validateDocId(input.eventId, "eventId");
    const subject = validateStr(input.subject, "subject", 500, true);
    const rawBodyHtml = validateStr(input.bodyHtml, "bodyHtml", 20000);
    const rawBodyCnHtml = validateStr(input.bodyCnHtml, "bodyCnHtml", 20000);

    const bodyHtml = sanitizeHtml(rawBodyHtml, EMAIL_HTML_SANITIZE_OPTIONS);
    const bodyCnHtml = rawBodyCnHtml
        ? sanitizeHtml(rawBodyCnHtml, EMAIL_HTML_SANITIZE_OPTIONS)
        : "";

    return adminTransaction(uid, async (txn, callerSnap) => {
        const eventSnap = await txn.get(db.collection("upcomingEvents").doc(eventId));
        if (!eventSnap.exists) throw new HttpsError("not-found", "Event not found.");
        const templateRef = db.collection("upcomingEvents").doc(eventId)
            .collection("emailTemplate").doc("default");
        txn.set(templateRef, {
            subject, bodyHtml, bodyCnHtml,
            updatedAt: FieldValue.serverTimestamp(),
            updatedBy: uid,
        }, {merge: true});
        txn.set(db.collection("records").doc(), {
            type: "upcoming-event-email-template-update",
            performedBy: uid,
            performedByName: callerSnap.data()?.displayName ?? "",
            eventId,
            eventTitle: eventSnap.data()?.title ?? eventSnap.data()?.name ?? eventId,
            timestamp: FieldValue.serverTimestamp(),
            expiresAt: recordExpiresAt(),
        });
        return {saved: true};
    });
});

/**
 * Grant event-staff access for a specific event (core-staff+).
 *
 * Event-staff is independent of the global staff group — assigning here does
 * not change the user's group. The role only grants ticket-scanning and
 * attendee-viewing access for this specific event.
 *
 * Staff and attendees are mutually exclusive in the admin UI. The two
 * "attendees" sources we have to keep in sync:
 *   - paid events: per-event `attendees` subcollection (one doc per email,
 *     holds tickets);
 *   - free events: each user's `attendedEvents` array (driven by claim codes
 *     or admin toggleAttendance).
 *
 * Behavior by event lifecycle:
 *   - upcoming + has attendee subcollection doc: reject with `has-ticket` —
 *     live tickets may already be distributed and must be voided explicitly
 *     via the tickets tab.
 *   - upcoming, no attendee doc: auto-mark the staffer as attended (they will
 *     be there). Existing semantic, preserved.
 *   - past: scrub attendee state so the user only appears as staff. Deletes
 *     any attendee subcollection doc (logged as `ticket-attendee-delete` with
 *     reason `staff-assignment`) and removes eventId from `attendedEvents`
 *     (logged as `event-unattend`). Skips the auto-attend write path.
 *
 * `removeEventStaff` does NOT re-add attendance — converting back is a manual
 * step via toggleAttendance / re-import.
 */
export const assignEventStaff = onCall({maxInstances: 10}, async (request) => {
    const uid = await requireAuth(request);

    const input = request.data as {targetUid?: string; eventId?: string};
    const targetUid = validateDocId(input.targetUid, "targetUid");
    const eventId = validateDocId(input.eventId, "eventId");

    return adminTransaction(uid, async (txn, callerSnap) => {
        const [targetSnap, upcomingSnap, pastSnap] = await Promise.all([
            txn.get(db.collection("users").doc(targetUid)),
            txn.get(db.collection("upcomingEvents").doc(eventId)),
            txn.get(db.collection("pastEvents").doc(eventId)),
        ]);
        if (!targetSnap.exists) throw new HttpsError("not-found", "User not found.");
        const eventSnap = upcomingSnap.exists ? upcomingSnap : pastSnap;
        if (!eventSnap.exists) throw new HttpsError("not-found", "Event not found.");
        const eventCollection = upcomingSnap.exists ? "upcomingEvents" : "pastEvents";
        const isPastEvent = !upcomingSnap.exists;

        const targetData = targetSnap.data()!;
        const targetEmail: string = targetData.email ?? "";
        const existing: string[] = targetData.eventStaffEvents ?? [];
        const alreadyStaff = existing.includes(eventId);

        // Past events delete the attendee doc(s) to enforce the staff/attendee
        // exclusivity; upcoming events reject so the admin voids live tickets
        // explicitly. Enumerate all matches without a limit so a partial-import
        // failure that left duplicate attendee docs for the same email is fully
        // cleaned up here, not just the first hit.
        const attendeesToRemove: FirebaseFirestore.QueryDocumentSnapshot[] = [];
        if (targetEmail) {
            const attendeeQuery = await txn.get(
                db.collection(eventCollection).doc(eventId).collection("attendees")
                    .where("email", "==", targetEmail)
            );
            if (!attendeeQuery.empty) {
                if (isPastEvent) {
                    attendeesToRemove.push(...attendeeQuery.docs);
                } else {
                    throw new HttpsError(
                        "failed-precondition",
                        "User already has a ticket for this event. Delete their attendee record before assigning as staff.",
                        {code: "has-ticket"},
                    );
                }
            }
        }

        const eventTitle: string = eventSnap.data()?.title ?? eventSnap.data()?.name ?? eventId;
        const callerName: string = callerSnap.data()?.displayName ?? "";
        const targetName: string = targetData.displayName ?? "";
        const attendedEvents: string[] = targetData.attendedEvents ?? [];
        const alreadyAttended = attendedEvents.includes(eventId);

        // Past: pull eventId out of attendedEvents so the user doesn't show in
        // the free-event attendees list. Upcoming: auto-attend (legacy).
        const attendanceAction: "add" | "remove" | "none" = isPastEvent
            ? (alreadyAttended ? "remove" : "none")
            : (alreadyAttended ? "none" : "add");

        if (alreadyStaff && attendanceAction === "none" && attendeesToRemove.length === 0) {
            return {added: false, attendeeRemoved: false};
        }

        const userUpdates: Record<string, unknown> = {};
        if (!alreadyStaff) userUpdates.eventStaffEvents = FieldValue.arrayUnion(eventId);
        if (attendanceAction === "add") {
            userUpdates.attendedEvents = FieldValue.arrayUnion(eventId);
        } else if (attendanceAction === "remove") {
            userUpdates.attendedEvents = FieldValue.arrayRemove(eventId);
        }
        if (Object.keys(userUpdates).length > 0) {
            txn.update(db.collection("users").doc(targetUid), userUpdates);
        }

        for (const attendeeDoc of attendeesToRemove) {
            const attendeeData = attendeeDoc.data();
            txn.delete(attendeeDoc.ref);
            txn.set(db.collection("records").doc(), {
                type: "ticket-attendee-delete",
                performedBy: uid,
                performedByName: callerName,
                eventId,
                eventTitle,
                targetEmail: attendeeData.email ?? targetEmail,
                targetName: attendeeData.name ?? targetName,
                reason: "staff-assignment",
                // Snapshot per-ticket state so the audit trail is self-contained
                // — staff-assignment on a past event is the one path that erases
                // redemption/check-in history, and we still want to be able to
                // answer "did this person actually attend?" later. Bounded by
                // record TTL (RECORD_RETENTION_DAYS).
                ticketSnapshot: {
                    ticketCount: attendeeData.ticketCount ?? 0,
                    tickets: attendeeData.tickets ?? [],
                },
                timestamp: FieldValue.serverTimestamp(),
                expiresAt: recordExpiresAt(),
            });
        }

        if (!alreadyStaff) {
            txn.set(db.collection("records").doc(), {
                type: "event-staff-assign",
                performedBy: uid,
                performedByName: callerName,
                targetUid,
                targetName,
                eventId,
                eventTitle,
                timestamp: FieldValue.serverTimestamp(),
                expiresAt: recordExpiresAt(),
            });
        }
        if (attendanceAction === "add") {
            txn.set(db.collection("records").doc(), {
                type: "event-attend",
                performedBy: uid,
                performedByName: callerName,
                targetUid,
                targetName,
                targetEmail,
                eventId,
                eventTitle,
                timestamp: FieldValue.serverTimestamp(),
                expiresAt: recordExpiresAt(),
            });
        } else if (attendanceAction === "remove") {
            txn.set(db.collection("records").doc(), {
                type: "event-unattend",
                performedBy: uid,
                performedByName: callerName,
                targetUid,
                targetName,
                targetEmail,
                eventId,
                eventTitle,
                reason: "staff-assignment",
                timestamp: FieldValue.serverTimestamp(),
                expiresAt: recordExpiresAt(),
            });
        }
        return {
            added: !alreadyStaff,
            attendeeRemoved: attendeesToRemove.length > 0 || attendanceAction === "remove",
        };
    });
});

/**
 * Revoke event-staff access for a specific event (core-staff+).
 * Does not downgrade the user's group — they remain staff for other events (or,
 * if they have no remaining eventStaffEvents, still explicitly staff until an
 * admin reassigns them).
 */
export const removeEventStaff = onCall({maxInstances: 10}, async (request) => {
    const uid = await requireAuth(request);

    const input = request.data as {targetUid?: string; eventId?: string};
    const targetUid = validateDocId(input.targetUid, "targetUid");
    const eventId = validateDocId(input.eventId, "eventId");

    return adminTransaction(uid, async (txn, callerSnap) => {
        const [targetSnap, upcomingSnap, pastSnap] = await Promise.all([
            txn.get(db.collection("users").doc(targetUid)),
            txn.get(db.collection("upcomingEvents").doc(eventId)),
            txn.get(db.collection("pastEvents").doc(eventId)),
        ]);
        if (!targetSnap.exists) throw new HttpsError("not-found", "User not found.");
        const targetData = targetSnap.data()!;
        const existing: string[] = targetData.eventStaffEvents ?? [];
        if (!existing.includes(eventId)) {
            return {removed: false};
        }

        const eventSnap = upcomingSnap.exists ? upcomingSnap : pastSnap;
        const eventTitle: string = eventSnap.exists
            ? (eventSnap.data()?.title ?? eventSnap.data()?.name ?? eventId)
            : eventId;

        txn.update(db.collection("users").doc(targetUid), {
            eventStaffEvents: FieldValue.arrayRemove(eventId),
        });
        txn.set(db.collection("records").doc(), {
            type: "event-staff-remove",
            performedBy: uid,
            performedByName: callerSnap.data()?.displayName ?? "",
            targetUid,
            targetName: targetData.displayName ?? "",
            eventId,
            eventTitle,
            timestamp: FieldValue.serverTimestamp(),
            expiresAt: recordExpiresAt(),
        });
        return {removed: true};
    });
});

export const savePolicy = onCall({maxInstances: 10}, async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Must be signed in.");
    const uid = request.auth.uid;
    await checkRateLimit(uid);

    const input = request.data as Record<string, unknown>;
    const contentEn = validateStr(input.contentEn, "contentEn", 20000);
    const contentCn = validateStr(input.contentCn, "contentCn", 20000);

    return adminTransaction(uid, async (txn, callerSnap) => {
        txn.set(db.collection("policy").doc("main"), {
            contentEn,
            contentCn,
            updatedBy: uid,
            updatedByName: callerSnap.data()?.displayName ?? "",
            updatedAt: FieldValue.serverTimestamp(),
        });
        txn.set(db.collection("records").doc(), {
            type: "policy-update",
            performedBy: uid,
            performedByName: callerSnap.data()?.displayName ?? "",
            timestamp: FieldValue.serverTimestamp(),
            expiresAt: recordExpiresAt(),
        });
        return {saved: true};
    });
});

export const saveSiteConfig = onCall({maxInstances: 10}, async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Must be signed in.");
    const uid = request.auth.uid;
    await checkRateLimit(uid);

    const input = request.data as Record<string, unknown>;
    const bvid = validateStr(input.bilibiliVideoBvid, "bilibiliVideoBvid", 100);

    if (bvid && !/^BV[a-zA-Z0-9]+$/.test(bvid)) {
        throw new HttpsError("invalid-argument", "Invalid Bilibili BV ID format.");
    }

    let coverUrl = '';
    if (bvid) {
        try {
            const apiResp = await fetch(`https://api.bilibili.com/x/web-interface/view?bvid=${bvid}`, {
                headers: {'User-Agent': 'Mozilla/5.0'},
                signal: AbortSignal.timeout(5000),
            });
            if (apiResp.ok) {
                const json = await apiResp.json() as {code: number; data?: {pic?: string}};
                const pic = json?.data?.pic ?? '';
                const picUrl = pic.startsWith('http:') ? 'https:' + pic.slice(5) : pic;
                if (picUrl) {
                    const imgResp = await fetch(picUrl, {
                        headers: {'User-Agent': 'Mozilla/5.0', 'Referer': 'https://www.bilibili.com/'},
                        signal: AbortSignal.timeout(10000),
                    });
                    if (imgResp.ok) {
                        const contentType = imgResp.headers.get('content-type') ?? 'image/jpeg';
                        const buffer = Buffer.from(await imgResp.arrayBuffer());
                        const bucket = getStorage().bucket();
                        const file = bucket.file('config/video-cover');
                        await file.save(buffer, {
                            metadata: {contentType, cacheControl: 'public, max-age=31536000, immutable'},
                        });
                        coverUrl = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent('config/video-cover')}?alt=media&t=${Date.now()}`;
                    }
                }
            }
        } catch {
            // Cover fetch is best-effort; proceed without it
        }
    }

    return adminTransaction(uid, async (txn, callerSnap) => {
        txn.set(db.collection("config").doc("main"), {
            bilibiliVideoBvid: bvid,
            bilibiliVideoCoverUrl: coverUrl,
            updatedBy: uid,
            updatedByName: callerSnap.data()?.displayName ?? "",
            updatedAt: FieldValue.serverTimestamp(),
        }, {merge: true});
        txn.set(db.collection("records").doc(), {
            type: "config-update",
            performedBy: uid,
            performedByName: callerSnap.data()?.displayName ?? "",
            timestamp: FieldValue.serverTimestamp(),
            expiresAt: recordExpiresAt(),
        });
        return {saved: true};
    });
});

/**
 * Generate a staff claim code for an upcoming event (admin only).
 * Deactivates existing active staff codes for the same event.
 */
export const generateStaffCode = onCall({maxInstances: 10}, async (request) => {
    if (!request.auth) {
        throw new HttpsError("unauthenticated", "Must be signed in.");
    }
    const uid = request.auth.uid;
    await checkRateLimit(uid);

    const input = request.data as {eventId?: string; activeFrom?: string; activeUntil?: string; maxUses?: number};
    const eventId = validateDocId(input.eventId, "eventId");
    const activeFrom = validateISODate(input.activeFrom, "activeFrom");
    const activeUntil = validateISODate(input.activeUntil, "activeUntil");
    const maxUses = validateMaxUses(input.maxUses);
    const expiresAt = activeUntil ? Timestamp.fromDate(new Date(activeUntil)) : null;

    let code = "";

    for (let attempt = 0; attempt < 5; attempt++) {
        code = generateSecureCode(12);
        const codeRef = db.collection("staffClaimCodes").doc(code);

        try {
            await db.runTransaction(async (txn) => {
                const callerSnap = await txn.get(db.collection("users").doc(uid));
                if (!ADMIN_GROUPS.includes(callerSnap.data()?.group)) {
                    throw new HttpsError("permission-denied", "Insufficient permissions.");
                }

                const eventSnap = await txn.get(db.collection("upcomingEvents").doc(eventId));
                if (!eventSnap.exists) throw new HttpsError("not-found", "Event not found.");

                const [existing, existingCodes] = await Promise.all([
                    txn.get(codeRef),
                    txn.get(
                        db.collection("staffClaimCodes")
                            .where("eventId", "==", eventId)
                            .where("active", "==", true)
                    ),
                ]);
                if (existing.exists) throw new Error("duplicate");

                for (const oldDoc of existingCodes.docs) {
                    txn.update(oldDoc.ref, {active: false});
                    txn.set(db.collection("records").doc(), {
                        type: "staff-code-deactivate",
                        performedBy: uid,
                        performedByName: callerSnap.data()?.displayName ?? "",
                        eventTitle: eventSnap.data()?.title ?? eventSnap.data()?.name ?? eventId,
                        eventId,
                        code: oldDoc.data().code ?? oldDoc.id,
                        timestamp: FieldValue.serverTimestamp(),
                        expiresAt: recordExpiresAt(),
                    });
                }
                txn.set(codeRef, {
                    code,
                    eventId,
                    createdBy: uid,
                    createdAt: FieldValue.serverTimestamp(),
                    active: true,
                    usedCount: 0,
                    maxUses,
                    ...(activeFrom ? {activeFrom} : {}),
                    ...(activeUntil ? {activeUntil} : {}),
                    ...(expiresAt ? {expiresAt} : {}),
                });
                txn.set(db.collection("records").doc(), {
                    type: "staff-code-create",
                    performedBy: uid,
                    performedByName: callerSnap.data()?.displayName ?? "",
                    eventTitle: eventSnap.data()?.title ?? eventSnap.data()?.name ?? eventId,
                    eventId,
                    code,
                    timestamp: FieldValue.serverTimestamp(),
                    expiresAt: recordExpiresAt(),
                });
            });
            return {id: code, code};
        } catch (err) {
            if (err instanceof Error && err.message === "duplicate") continue;
            throw err;
        }
    }

    throw new HttpsError("internal", "code-generation-failed");
});

/**
 * Claim a staff code to become event staff for an upcoming event.
 * Adds the event to both eventStaffEvents[] and attendedEvents[].
 */
export const claimStaffCode = onCall({maxInstances: 20}, async (request) => {
    const uid = await requireAuth(request);

    const code = (request.data as {code?: string})?.code?.trim().toUpperCase();
    if (!code || !/^[A-Z0-9]{6,20}$/.test(code)) {
        throw new HttpsError("invalid-argument", "Invalid or deactivated code.", {code: "invalid"});
    }

    const codeRef = db.collection("staffClaimCodes").doc(code);
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
        if (!eventSnap.exists) throw new HttpsError("not-found", "Invalid or deactivated code.", {code: "invalid"});
        if (!userSnap.exists) throw new HttpsError("not-found", "Invalid or deactivated code.", {code: "invalid"});

        const eventData = eventSnap.data()!;
        const eventTitle: string = eventData.title ?? eventData.name ?? "";
        const eventTitleCn: string = eventData.titleCn ?? eventData.nameCn ?? "";
        const eventPoster: string = eventData.poster ?? "";

        const staffEvents: string[] = userSnap.data()!.eventStaffEvents ?? [];
        if (staffEvents.includes(eventId)) {
            throw new HttpsError("already-exists", "You are already staff for this event.", {
                code: "already-have",
                eventId,
                eventTitle,
                eventTitleCn,
                eventPoster,
            });
        }

        txn.update(codeRef, {usedCount: FieldValue.increment(1)});
        txn.update(userRef, {
            eventStaffEvents: FieldValue.arrayUnion(eventId),
            attendedEvents: FieldValue.arrayUnion(eventId),
        });
        txn.set(db.collection("records").doc(), {
            type: "event-staff-assign",
            performedBy: uid,
            performedByName: userSnap.data()?.displayName ?? "",
            targetUid: uid,
            targetName: userSnap.data()?.displayName ?? "",
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
 * Toggle active status on a staff claim code (admin only).
 */
export const toggleStaffCodeActive = onCall({maxInstances: 10}, async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Must be signed in.");
    const uid = request.auth.uid;
    await checkRateLimit(uid);

    const input = request.data as {codeId?: string; active?: boolean};
    const codeId = validateDocId(input.codeId, "codeId");
    if (typeof input.active !== "boolean") {
        throw new HttpsError("invalid-argument", "active must be a boolean.");
    }

    return adminTransaction(uid, async (txn, callerSnap) => {
        const codeSnap = await txn.get(db.collection("staffClaimCodes").doc(codeId));
        if (!codeSnap.exists) throw new HttpsError("not-found", "Code not found.");
        const codeData = codeSnap.data()!;

        const eventSnap = codeData.eventId
            ? await txn.get(db.collection("upcomingEvents").doc(codeData.eventId))
            : null;

        txn.update(db.collection("staffClaimCodes").doc(codeId), {active: input.active});
        txn.set(db.collection("records").doc(), {
            type: input.active ? "staff-code-activate" : "staff-code-deactivate",
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
 * Update time window on a staff claim code (admin only).
 */
export const saveStaffCodeTimeWindow = onCall({maxInstances: 10}, async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Must be signed in.");
    const uid = request.auth.uid;
    await checkRateLimit(uid);

    const input = request.data as {codeId?: string; activeFrom?: string; activeUntil?: string; maxUses?: number};
    const codeId = validateDocId(input.codeId, "codeId");
    const activeFrom = validateISODate(input.activeFrom, "activeFrom");
    const activeUntil = validateISODate(input.activeUntil, "activeUntil");
    const maxUses = validateMaxUses(input.maxUses);

    return adminTransaction(uid, async (txn, callerSnap) => {
        const codeSnap = await txn.get(db.collection("staffClaimCodes").doc(codeId));
        if (!codeSnap.exists) throw new HttpsError("not-found", "Code not found.");
        const codeData = codeSnap.data()!;

        const eventSnap = codeData.eventId
            ? await txn.get(db.collection("upcomingEvents").doc(codeData.eventId))
            : null;

        const updates: Record<string, unknown> = {
            activeFrom: activeFrom ?? null,
            activeUntil: activeUntil ?? null,
            expiresAt: activeUntil ? Timestamp.fromDate(new Date(activeUntil)) : null,
        };
        if (input.maxUses !== undefined) {
            updates.maxUses = maxUses;
        }
        txn.update(db.collection("staffClaimCodes").doc(codeId), updates);
        txn.set(db.collection("records").doc(), {
            type: "staff-code-time-window",
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