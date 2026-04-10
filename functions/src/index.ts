import { initializeApp } from "firebase-admin/app";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { HttpsError, onCall } from "firebase-functions/v2/https";

import * as crypto from "crypto";

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
            throw new HttpsError("resource-exhausted", "rate-limited");
        }

        txn.update(ref, {count: FieldValue.increment(1)});
    });
}

const ADMIN_GROUPS = ["core-staff", "president"];

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
    if (!data.active) throw new HttpsError("failed-precondition", "inactive");

    const now = new Date();
    if (data.activeFrom && new Date(data.activeFrom) > now) {
        throw new HttpsError("failed-precondition", "not-active-yet");
    }
    if (data.activeUntil && new Date(data.activeUntil) < now) {
        throw new HttpsError("failed-precondition", "expired");
    }

    const usedCount = data.usedCount ?? 0;
    const maxUses = data.maxUses ?? 0;
    if (maxUses > 0 && usedCount >= maxUses) {
        throw new HttpsError("resource-exhausted", "max-uses");
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
 * Idempotent — returns existing profile if already created.
 */
export const createUserProfile = onCall({maxInstances: 20}, async (request) => {
    if (!request.auth) {
        throw new HttpsError("unauthenticated", "Must be signed in.");
    }

    const uid = request.auth.uid;
    const userRef = db.collection("users").doc(uid);

    const existing = await userRef.get();
    if (existing.exists) {
        return {alreadyExists: true};
    }

    const displayName = request.auth.token.name ?? "";
    const email = request.auth.token.email ?? "";
    const photoURL = request.auth.token.picture ?? "";

    await userRef.set({
        displayName: typeof displayName === "string" ? displayName.slice(0, 50) : "",
        email: typeof email === "string" ? email : "",
        photoURL: typeof photoURL === "string" ? photoURL.slice(0, 500) : "",
        joinedAt: FieldValue.serverTimestamp(),
        attendedEvents: [],
        badges: [],
        group: "visitor",
    });

    return {alreadyExists: false};
});

/**
 * Delete an image from Firebase Storage (admin only).
 * Verifies caller is core-staff+ before deleting. Client sends the storage path.
 */
export const deleteAdminImage = onCall({maxInstances: 10}, async (request) => {
    if (!request.auth) {
        throw new HttpsError("unauthenticated", "Must be signed in.");
    }

    const uid = request.auth.uid;
    const userSnap = await db.collection("users").doc(uid).get();
    const group = userSnap.data()?.group;
    if (!ADMIN_GROUPS.includes(group)) {
        throw new HttpsError("permission-denied", "Insufficient permissions.");
    }

    await checkRateLimit(uid);

    const path = (request.data as {path?: string})?.path;
    if (!path) {
        throw new HttpsError("invalid-argument", "Missing path.");
    }
    validateStoragePath(path);

    const bucket = getStorage().bucket();
    const file = bucket.file(path);
    const [exists] = await file.exists();
    if (exists) {
        await file.delete();
    }

    return {deleted: exists};
});

/**
 * Upload an image to Firebase Storage (admin only).
 * Verifies caller is core-staff+ before writing. Client sends base64-encoded image data.
 */
export const uploadAdminImage = onCall({maxInstances: 10}, async (request) => {
    if (!request.auth) {
        throw new HttpsError("unauthenticated", "Must be signed in.");
    }

    const uid = request.auth.uid;
    const userSnap = await db.collection("users").doc(uid).get();
    const group = userSnap.data()?.group;
    if (!ADMIN_GROUPS.includes(group)) {
        throw new HttpsError("permission-denied", "Insufficient permissions.");
    }

    await checkRateLimit(uid);

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
    await file.save(buffer, {metadata: {contentType}});

    const downloadUrl = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(path)}?alt=media`;
    return {url: downloadUrl};
});

/**
 * Claim an event attendance code.
 * Validates the code server-side and atomically increments usedCount + adds event to user's attendedEvents.
 */
export const claimEventCode = onCall({maxInstances: 20}, async (request) => {
    if (!request.auth) {
        throw new HttpsError("unauthenticated", "Must be signed in.");
    }

    const code = (request.data as {code?: string})?.code?.trim();
    if (!code) {
        throw new HttpsError("invalid-argument", "Missing code.");
    }
    if (!/^[A-Z0-9]{6,20}$/i.test(code)) {
        throw new HttpsError("invalid-argument", "invalid");
    }

    const uid = request.auth.uid;
    await checkRateLimit(uid);

    const codesRef = db.collection("claimCodes");
    const snapshot = await codesRef
        .where("code", "==", code)
        .where("active", "==", true)
        .get();

    if (snapshot.empty) {
        throw new HttpsError("not-found", "invalid");
    }

    const codeDoc = snapshot.docs[0];
    const codeRef = codeDoc.ref;
    const userRef = db.collection("users").doc(uid);

    const eventId: string = codeDoc.data().eventId ?? codeDoc.data().eventTitle;

    await db.runTransaction(async (txn) => {
        const [freshCode, freshUser] = await Promise.all([
            txn.get(codeRef),
            txn.get(userRef),
        ]);

        if (!freshCode.exists) throw new HttpsError("not-found", "invalid");
        const data = freshCode.data()!;

        validateCodeInTransaction(data);

        const attendedEvents: string[] = freshUser.data()?.attendedEvents ?? [];
        if (attendedEvents.includes(eventId)) {
            throw new HttpsError("already-exists", "already-have");
        }

        txn.update(codeRef, {usedCount: FieldValue.increment(1)});
        txn.update(userRef, {attendedEvents: FieldValue.arrayUnion(eventId)});
    });

    return {eventId};
});

/**
 * Claim a badge activation code.
 * Validates the code server-side and atomically increments usedCount + adds badge to user's badges.
 * Returns badge metadata so the client doesn't need a separate fetch.
 */
export const claimBadgeActivationCode = onCall({maxInstances: 20}, async (request) => {
    if (!request.auth) {
        throw new HttpsError("unauthenticated", "Must be signed in.");
    }

    const code = (request.data as {code?: string})?.code?.trim();
    if (!code) {
        throw new HttpsError("invalid-argument", "Missing code.");
    }
    if (!/^[A-Z0-9]{6,20}$/i.test(code)) {
        throw new HttpsError("invalid-argument", "invalid");
    }

    const uid = request.auth.uid;
    await checkRateLimit(uid);

    const codesRef = db.collection("badgeActivationCodes");
    const snapshot = await codesRef
        .where("code", "==", code)
        .where("active", "==", true)
        .get();

    if (snapshot.empty) {
        throw new HttpsError("not-found", "invalid");
    }

    const codeDoc = snapshot.docs[0];
    const codeRef = codeDoc.ref;
    const userRef = db.collection("users").doc(uid);
    const badgeId: string = codeDoc.data().badgeId;

    let badgeData: FirebaseFirestore.DocumentData;

    await db.runTransaction(async (txn) => {
        const [freshCode, freshUser, badgeSnap] = await Promise.all([
            txn.get(codeRef),
            txn.get(userRef),
            txn.get(db.collection("badges").doc(badgeId)),
        ]);

        if (!freshCode.exists) throw new HttpsError("not-found", "invalid");
        if (!badgeSnap.exists) throw new HttpsError("not-found", "invalid");
        badgeData = badgeSnap.data()!;
        const data = freshCode.data()!;

        validateCodeInTransaction(data);

        const userBadges: string[] = freshUser.data()?.badges ?? [];
        if (userBadges.includes(badgeId)) {
            throw new HttpsError("already-exists", "already-have");
        }

        txn.update(codeRef, {usedCount: FieldValue.increment(1)});
        txn.update(userRef, {badges: FieldValue.arrayUnion(badgeId)});
    });

    return {
        badgeId,
        badgeName: badgeData!.name ?? "",
        badgeNameCn: badgeData!.nameCn ?? "",
        badgeDescription: badgeData!.description ?? "",
        badgeDescriptionCn: badgeData!.descriptionCn ?? "",
        badgeImageUrl: badgeData!.imageUrl ?? "",
    };
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
    const userSnap = await db.collection("users").doc(uid).get();
    const group = userSnap.data()?.group;
    if (!ADMIN_GROUPS.includes(group)) {
        throw new HttpsError("permission-denied", "Insufficient permissions.");
    }

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

    const badgeSnap = await db.collection("badges").doc(badgeId).get();
    if (!badgeSnap.exists) {
        throw new HttpsError("not-found", "Badge not found.");
    }

    let code = "";

    for (let attempt = 0; attempt < 5; attempt++) {
        code = generateSecureCode(12);
        const codeRef = db.collection("badgeActivationCodes").doc(code);

        try {
            await db.runTransaction(async (txn) => {
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
                });
                txn.set(db.collection("records").doc(), {
                    type: "code-create",
                    performedBy: uid,
                    performedByName: userSnap.data()?.displayName ?? "",
                    badgeId,
                    badgeName: badgeSnap.data()!.name ?? badgeId,
                    code,
                    timestamp: FieldValue.serverTimestamp(),
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
 * Generate an event check-in code (admin only).
 * Verifies caller is core-staff+, deactivates any existing active code for the event,
 * and generates a unique code atomically.
 */
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
    await file.save(buffer, {metadata: {contentType}});

    const downloadUrl = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(path)}?alt=media`;
    return {url: downloadUrl};
});

export const generateEventCode = onCall({maxInstances: 10}, async (request) => {
    if (!request.auth) {
        throw new HttpsError("unauthenticated", "Must be signed in.");
    }

    const uid = request.auth.uid;
    const userSnap = await db.collection("users").doc(uid).get();
    const group = userSnap.data()?.group;
    if (!ADMIN_GROUPS.includes(group)) {
        throw new HttpsError("permission-denied", "Insufficient permissions.");
    }

    await checkRateLimit(uid);

    const input = request.data as {
        eventId?: string;
        activeFrom?: string;
        activeUntil?: string;
    };
    const eventId = validateDocId(input.eventId, "eventId");
    const activeFrom = validateISODate(input.activeFrom, "activeFrom");
    const activeUntil = validateISODate(input.activeUntil, "activeUntil");

    const eventSnap = await db.collection("pastEvents").doc(eventId).get();
    if (!eventSnap.exists) {
        throw new HttpsError("not-found", "Event not found.");
    }

    let code = "";

    for (let attempt = 0; attempt < 5; attempt++) {
        code = generateSecureCode(12);
        const codeRef = db.collection("claimCodes").doc(code);

        try {
            await db.runTransaction(async (txn) => {
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
                });
                txn.set(db.collection("records").doc(), {
                    type: "code-create",
                    performedBy: uid,
                    performedByName: userSnap.data()?.displayName ?? "",
                    eventTitle: eventSnap.data()?.title ?? eventId,
                    eventId,
                    code,
                    timestamp: FieldValue.serverTimestamp(),
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
        await batch.commit();
    }
}

function extractStoragePath(downloadUrl: string): string | null {
    const match = downloadUrl.match(
        /firebasestorage\.googleapis\.com\/v0\/b\/[^/]+\/o\/([^?]+)/
    );
    if (!match) return null;
    return decodeURIComponent(match[1]);
}

async function deleteStorageFile(downloadUrl: string): Promise<void> {
    const path = extractStoragePath(downloadUrl);
    if (!path) return;
    const file = getStorage().bucket().file(path);
    const [exists] = await file.exists();
    if (exists) await file.delete();
}

/**
 * Delete a past event and all related data (admin only).
 * Atomically deletes the event, its claim codes, removes from users' attendedEvents,
 * deletes the storage image, and creates an audit record.
 */
export const deleteEvent = onCall({maxInstances: 10}, async (request) => {
    if (!request.auth) {
        throw new HttpsError("unauthenticated", "Must be signed in.");
    }

    const uid = request.auth.uid;
    const callerSnap = await db.collection("users").doc(uid).get();
    const callerGroup = callerSnap.data()?.group;
    if (!ADMIN_GROUPS.includes(callerGroup)) {
        throw new HttpsError("permission-denied", "Insufficient permissions.");
    }

    await checkRateLimit(uid);

    const eventId = validateDocId(
        (request.data as {eventId?: string})?.eventId, "eventId"
    );

    const eventSnap = await db.collection("pastEvents").doc(eventId).get();
    if (!eventSnap.exists) {
        throw new HttpsError("not-found", "Event not found.");
    }
    const eventData = eventSnap.data()!;

    const [codesSnap, attendeesSnap] = await Promise.all([
        db.collection("claimCodes").where("eventId", "==", eventId).get(),
        db.collection("users").where("attendedEvents", "array-contains", eventId).get(),
    ]);

    const ops: ((b: FirebaseFirestore.WriteBatch) => void)[] = [
        b => b.delete(db.collection("pastEvents").doc(eventId)),
        b => b.set(db.collection("records").doc(), {
            type: "event-delete",
            performedBy: uid,
            performedByName: callerSnap.data()?.displayName ?? "",
            eventTitle: eventData.title ?? eventId,
            eventId,
            timestamp: FieldValue.serverTimestamp(),
        }),
        ...codesSnap.docs.map(d => (b: FirebaseFirestore.WriteBatch) => b.delete(d.ref)),
        ...attendeesSnap.docs.map(d => (b: FirebaseFirestore.WriteBatch) =>
            b.update(d.ref, {attendedEvents: FieldValue.arrayRemove(eventId)})
        ),
    ];
    await commitInChunks(ops);

    await deleteStorageFile(eventData.icon ?? "").catch(() => {
    });

    return {deleted: true};
});

/**
 * Delete a badge and all related data (admin only).
 * Atomically deletes the badge, its activation codes, removes from users' badges,
 * deletes the storage image, and creates an audit record.
 */
export const deleteBadge = onCall({maxInstances: 10}, async (request) => {
    if (!request.auth) {
        throw new HttpsError("unauthenticated", "Must be signed in.");
    }

    const uid = request.auth.uid;
    const callerSnap = await db.collection("users").doc(uid).get();
    const callerGroup = callerSnap.data()?.group;
    if (!ADMIN_GROUPS.includes(callerGroup)) {
        throw new HttpsError("permission-denied", "Insufficient permissions.");
    }

    await checkRateLimit(uid);

    const badgeId = validateDocId(
        (request.data as {badgeId?: string})?.badgeId, "badgeId"
    );

    const badgeSnap = await db.collection("badges").doc(badgeId).get();
    if (!badgeSnap.exists) {
        throw new HttpsError("not-found", "Badge not found.");
    }
    const badgeData = badgeSnap.data()!;

    const [codesSnap, holdersSnap] = await Promise.all([
        db.collection("badgeActivationCodes").where("badgeId", "==", badgeId).get(),
        db.collection("users").where("badges", "array-contains", badgeId).get(),
    ]);

    const ops: ((b: FirebaseFirestore.WriteBatch) => void)[] = [
        b => b.delete(db.collection("badges").doc(badgeId)),
        b => b.set(db.collection("records").doc(), {
            type: "badge-delete",
            performedBy: uid,
            performedByName: callerSnap.data()?.displayName ?? "",
            badgeId,
            badgeName: badgeData.name ?? badgeId,
            timestamp: FieldValue.serverTimestamp(),
        }),
        ...codesSnap.docs.map(d => (b: FirebaseFirestore.WriteBatch) => b.delete(d.ref)),
        ...holdersSnap.docs.map(d => (b: FirebaseFirestore.WriteBatch) =>
            b.update(d.ref, {badges: FieldValue.arrayRemove(badgeId)})
        ),
    ];
    await commitInChunks(ops);

    await deleteStorageFile(badgeData.imageUrl ?? "").catch(() => {
    });

    return {deleted: true};
});

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

    const input = request.data as {targetUid?: string; newGroup?: string};
    const targetUid = validateDocId(input.targetUid, "targetUid");
    const newGroup = input.newGroup;

    if (!newGroup || !VALID_GROUPS.includes(newGroup)) {
        throw new HttpsError("invalid-argument", "Invalid group.");
    }

    if (uid === targetUid) {
        throw new HttpsError("permission-denied", "Cannot change your own group.");
    }

    await checkRateLimit(uid);

    let oldGroup: string = "";

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

        txn.update(db.collection("users").doc(targetUid), {group: newGroup});
        txn.set(db.collection("records").doc(), {
            type: "group-assign",
            performedBy: uid,
            performedByName: callerSnap.data()!.displayName ?? "",
            targetUid,
            targetName: targetSnap.data()!.displayName ?? "",
            oldGroup,
            newGroup,
            timestamp: FieldValue.serverTimestamp(),
        });
    });

    return {oldGroup, newGroup};
});
