import { initializeApp } from "firebase-admin/app";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
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

    const uid = request.auth.uid;

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
    let codeDocId = "";

    for (let attempt = 0; attempt < 5; attempt++) {
        code = generateSecureCode(12);
        const dupSnap = await db.collection("badgeActivationCodes")
            .where("code", "==", code).limit(1).get();
        if (!dupSnap.empty) {
            if (attempt === 4) throw new HttpsError("internal", "code-generation-failed");
            continue;
        }

        const codeRef = db.collection("badgeActivationCodes").doc();
        codeDocId = codeRef.id;

        const batch = db.batch();
        batch.set(codeRef, {
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
        batch.set(db.collection("records").doc(), {
            type: "code-create",
            performedBy: uid,
            performedByName: userSnap.data()?.displayName ?? "",
            badgeId,
            badgeName: badgeSnap.data()!.name ?? badgeId,
            code,
            timestamp: FieldValue.serverTimestamp(),
        });
        await batch.commit();
        break;
    }

    return {id: codeDocId, code};
});

/**
 * Generate an event check-in code (admin only).
 * Verifies caller is core-staff+, deactivates any existing active code for the event,
 * and generates a unique code atomically.
 */
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

    // Deactivate existing active codes for this event
    const existingCodes = await db.collection("badgeCodes")
        .where("eventId", "==", eventId)
        .where("active", "==", true)
        .get();

    let code = "";
    let codeDocId = "";

    for (let attempt = 0; attempt < 5; attempt++) {
        code = generateSecureCode(12);
        const dupSnap = await db.collection("badgeCodes")
            .where("code", "==", code).limit(1).get();
        if (!dupSnap.empty) {
            if (attempt === 4) throw new HttpsError("internal", "code-generation-failed");
            continue;
        }

        const codeRef = db.collection("badgeCodes").doc();
        codeDocId = codeRef.id;

        const batch = db.batch();
        // Deactivate old codes
        for (const oldDoc of existingCodes.docs) {
            batch.update(oldDoc.ref, {active: false});
        }
        batch.set(codeRef, {
            code,
            eventId,
            createdBy: uid,
            createdAt: FieldValue.serverTimestamp(),
            active: true,
            usedCount: 0,
            ...(activeFrom ? {activeFrom} : {}),
            ...(activeUntil ? {activeUntil} : {}),
        });
        batch.set(db.collection("records").doc(), {
            type: "code-create",
            performedBy: uid,
            performedByName: userSnap.data()?.displayName ?? "",
            eventTitle: eventSnap.data()?.title ?? eventId,
            eventId,
            code,
            timestamp: FieldValue.serverTimestamp(),
        });
        await batch.commit();
        break;
    }

    return {id: codeDocId, code};
});
