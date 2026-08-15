import * as crypto from "crypto";
import { Timestamp } from "firebase-admin/firestore";
import { BATCH_LIMIT } from "./config";
import { CODE_ALPHABET, generateSecureCode } from "./helpers";

/**
 * A physical passport is two pieces of paper: a sticker carrying the public
 * `passportId` (this doc's id, printed as a QR pointing at /p/<id>) and a
 * separate slip carrying the secret activation key. Claiming needs both;
 * scanning after the claim needs only the sticker.
 */

// Printed on the sticker and visible in every scan URL, so it only has to be
// long enough that ids can't be guessed — 31^10 ≈ 8.2e14.
export const PASSPORT_ID_LENGTH = 10;
// The secret on the slip: 31^12 ≈ 7.9e17 (~59 bits). The lockout below matters
// anyway, because the passportId is public and tells an attacker which door to knock on.
export const ACTIVATION_KEY_LENGTH = 12;

export const PASSPORT_TERM_DAYS = 365;

// Brute-force guard on the key. Per-passport rather than per-caller: the uid
// rate limit in requireAuth doesn't stop a pool of accounts working one sticker.
export const MAX_FAILED_ATTEMPTS = 5;
export const LOCKOUT_MS = 15 * 60 * 1000;

// Per-call ceiling on batch generation. Each passport writes two documents
// (the passport and its secret), so this must stay at or under half of
// BATCH_LIMIT for a batch to commit in one chunk.
export const MAX_BATCH_COUNT = Math.min(200, Math.floor(BATCH_LIMIT / 2));

// Codes are printed and read back by hand, so input is normalized before it is
// compared: lowercase is folded, and the dashes we print for legibility (plus
// any spaces the reader adds) are dropped.
const SEPARATORS_RE = /[\s-]+/g;

function normalizeCode(raw: unknown, length: number): string | null {
    if (typeof raw !== "string") return null;
    const cleaned = raw.replace(SEPARATORS_RE, "").toUpperCase();
    if (cleaned.length !== length) return null;
    for (const ch of cleaned) {
        if (!CODE_ALPHABET.includes(ch)) return null;
    }
    return cleaned;
}

/** The canonical id, or null when the input can't be one (unknown vs. malformed
 * is deliberately not distinguished by callers — both are just "invalid"). */
export function normalizePassportId(raw: unknown): string | null {
    return normalizeCode(raw, PASSPORT_ID_LENGTH);
}

export function normalizeActivationKey(raw: unknown): string | null {
    return normalizeCode(raw, ACTIVATION_KEY_LENGTH);
}

/** Grouped in fours for the printed slip. Normalization strips the dashes again. */
export function formatActivationKey(key: string): string {
    return (key.match(/.{1,4}/g) ?? [key]).join("-");
}

function hashActivationKey(key: string, salt: string): string {
    return crypto.createHash("sha256").update(`${salt}:${key}`).digest("hex");
}

/**
 * A fresh key plus the server-only material that verifies it. The plaintext is
 * returned to the generating admin once and never stored — a lost slip is
 * reprinted with a new key (reissuePassportKey), not recovered.
 */
export function newActivationKey(): {key: string; salt: string; secretHash: string} {
    const key = generateSecureCode(ACTIVATION_KEY_LENGTH);
    const salt = crypto.randomBytes(16).toString("hex");
    return {key, salt, secretHash: hashActivationKey(key, salt)};
}

export function activationKeyMatches(key: string, secret: {salt?: unknown; secretHash?: unknown}): boolean {
    if (typeof secret.salt !== "string" || typeof secret.secretHash !== "string") return false;
    const expected = Buffer.from(secret.secretHash, "hex");
    const actual = Buffer.from(hashActivationKey(key, secret.salt), "hex");
    // A stored hash of the wrong width can't match anything, and timingSafeEqual
    // throws on a length mismatch.
    if (expected.length !== actual.length || expected.length === 0) return false;
    return crypto.timingSafeEqual(expected, actual);
}

export function lockedUntilMillis(data: FirebaseFirestore.DocumentData | undefined): number {
    const until = data?.lockedUntil;
    return until instanceof Timestamp ? until.toMillis() : 0;
}

export function isLockedOut(data: FirebaseFirestore.DocumentData | undefined): boolean {
    return lockedUntilMillis(data) > Date.now();
}

export function isPassportYear(value: unknown): value is number {
    return typeof value === "number" && Number.isInteger(value) && value >= 2000 && value <= 2100;
}
