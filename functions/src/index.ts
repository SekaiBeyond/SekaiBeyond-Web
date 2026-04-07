import { initializeApp } from "firebase-admin/app";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { HttpsError, onCall } from "firebase-functions/v2/https";

import * as crypto from "crypto";

initializeApp();
const db = getFirestore();

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 10;
const rateLimitMap = new Map<string, {count: number; windowStart: number}>();

function checkRateLimit(uid: string): void {
    const now = Date.now();
    const entry = rateLimitMap.get(uid);
    if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
        rateLimitMap.set(uid, {count: 1, windowStart: now});
        return;
    }
    entry.count++;
    if (entry.count > RATE_LIMIT_MAX) {
        throw new HttpsError("resource-exhausted", "rate-limited");
    }
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

const ALLOWED_UPLOAD_PREFIXES = ["events/", "upcoming-events/", "badges/"];
const MAX_UPLOAD_SIZE = 5 * 1024 * 1024; // 5MB

const IMAGE_SIGNATURES: {mime: string; magic: Buffer}[] = [
    {mime: "image/jpeg", magic: Buffer.from([0xFF, 0xD8, 0xFF])},
    {mime: "image/png", magic: Buffer.from([0x89, 0x50, 0x4E, 0x47])},
    {mime: "image/gif", magic: Buffer.from([0x47, 0x49, 0x46, 0x38])},
    {mime: "image/webp", magic: Buffer.from([0x52, 0x49, 0x46, 0x46])},
];

function isValidImage(buffer: Buffer): boolean {
    return IMAGE_SIGNATURES.some(sig => buffer.length >= sig.magic.length &&
        buffer.subarray(0, sig.magic.length).equals(sig.magic));
}

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

    if (!ALLOWED_UPLOAD_PREFIXES.some(prefix => path.startsWith(prefix))) {
        throw new HttpsError("invalid-argument", "Invalid upload path.");
    }

    if (contentType !== "image/webp") {
        throw new HttpsError("invalid-argument", "Only image/webp is allowed.");
    }

    const buffer = Buffer.from(dataBase64, "base64");
    if (buffer.length > MAX_UPLOAD_SIZE) {
        throw new HttpsError("invalid-argument", "Image exceeds 5MB limit.");
    }

    if (!isValidImage(buffer)) {
        throw new HttpsError("invalid-argument", "File is not a valid image.");
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
export const claimEventCode = onCall(async (request) => {
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
    checkRateLimit(uid);

    const codesRef = db.collection("badgeCodes");
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
export const claimBadgeActivationCode = onCall(async (request) => {
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
    checkRateLimit(uid);

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
export const generateBadgeActivationCode = onCall(async (request) => {
    if (!request.auth) {
        throw new HttpsError("unauthenticated", "Must be signed in.");
    }

    const uid = request.auth.uid;
    const userSnap = await db.collection("users").doc(uid).get();
    const group = userSnap.data()?.group;
    if (!ADMIN_GROUPS.includes(group)) {
        throw new HttpsError("permission-denied", "Insufficient permissions.");
    }

    const input = request.data as {
        badgeId?: string;
        maxUses?: number;
        activeFrom?: string;
        activeUntil?: string;
    };
    const badgeId = input.badgeId;
    if (!badgeId) {
        throw new HttpsError("invalid-argument", "Missing badgeId.");
    }

    const badgeSnap = await db.collection("badges").doc(badgeId).get();
    if (!badgeSnap.exists) {
        throw new HttpsError("not-found", "Badge not found.");
    }

    const maxUses = input.maxUses ?? 0;
    const activeFrom = input.activeFrom ?? null;
    const activeUntil = input.activeUntil ?? null;

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

    const input = request.data as {data?: string; contentType?: string};
    const dataBase64 = input.data;
    const contentType = input.contentType;

    if (!dataBase64 || !contentType) {
        throw new HttpsError("invalid-argument", "Missing data or contentType.");
    }

    const allowedTypes = ["image/webp", "image/jpeg", "image/png", "image/gif"];
    if (!allowedTypes.includes(contentType)) {
        throw new HttpsError("invalid-argument", "Only webp, jpeg, png, and gif are allowed.");
    }

    const buffer = Buffer.from(dataBase64, "base64");
    if (buffer.length > MAX_UPLOAD_SIZE) {
        throw new HttpsError("invalid-argument", "Image exceeds 5MB limit.");
    }

    if (!isValidImage(buffer)) {
        throw new HttpsError("invalid-argument", "File is not a valid image.");
    }

    const bucket = getStorage().bucket();
    const path = `avatars/${uid}`;
    const file = bucket.file(path);
    await file.save(buffer, {metadata: {contentType}});

    const downloadUrl = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(path)}?alt=media`;
    return {url: downloadUrl};
});

export const generateEventCode = onCall(async (request) => {
    if (!request.auth) {
        throw new HttpsError("unauthenticated", "Must be signed in.");
    }

    const uid = request.auth.uid;
    const userSnap = await db.collection("users").doc(uid).get();
    const group = userSnap.data()?.group;
    if (!ADMIN_GROUPS.includes(group)) {
        throw new HttpsError("permission-denied", "Insufficient permissions.");
    }

    const input = request.data as {
        eventId?: string;
        activeFrom?: string;
        activeUntil?: string;
    };
    const eventId = input.eventId;
    if (!eventId) {
        throw new HttpsError("invalid-argument", "Missing eventId.");
    }

    const eventSnap = await db.collection("pastEvents").doc(eventId).get();
    if (!eventSnap.exists) {
        throw new HttpsError("not-found", "Event not found.");
    }

    const activeFrom = input.activeFrom ?? null;
    const activeUntil = input.activeUntil ?? null;

    let code = "";

    for (let attempt = 0; attempt < 5; attempt++) {
        code = generateSecureCode(12);
        const codeRef = db.collection("badgeCodes").doc(code);

        try {
            await db.runTransaction(async (txn) => {
                const [existing, existingCodes] = await Promise.all([
                    txn.get(codeRef),
                    txn.get(
                        db.collection("badgeCodes")
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
