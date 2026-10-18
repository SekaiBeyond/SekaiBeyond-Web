import * as crypto from "crypto";
import { HttpsError } from "firebase-functions/v2/https";
import { FieldValue } from "firebase-admin/firestore";
import { BATCH_LIMIT } from "./config";
import { db } from "./firebase";
import { CODE_ALPHABET, generateSecureCode } from "./helpers";
import { extendedExpiry, startedAtAfter } from "./membership";
import { recordDoc, recordRef } from "./records";

/**
 * A physical passport is a sticker with the public `passportId` (this doc's id,
 * as a QR to /p/<id>) and a separate slip with the secret activation key.
 * Claiming needs only the slip; scanning afterwards needs only the sticker.
 */

// Printed and in every scan URL, so it only needs to be unguessable: 31^10 ≈
// 8.2e14.
export const PASSPORT_ID_LENGTH = 10;
// The slip's secret: 31^12 ≈ 7.9e17 (~59 bits), like a badge code, redeemed from
// the same box under the same rate limit. The length is what makes it safe to
// accept without the sticker.
const ACTIVATION_KEY_LENGTH = 12;

// Each design sets its own term; this only stands in for a passport that has
// none.
export const PASSPORT_TERM_DAYS = 365;

// Each passport writes two docs (passport and secret), so this stays within half
// of BATCH_LIMIT to commit in one chunk.
export const MAX_GENERATE_COUNT = Math.min(200, Math.floor(BATCH_LIMIT / 2));

// Same arithmetic: a delete erases the passport and its secret.
export const MAX_DELETE_COUNT = MAX_GENERATE_COUNT;

// Reads only, so bounded by one getAll; the client splits bigger selections.
export const MAX_KEY_EXPORT_COUNT = 500;

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
 * A fresh key and the server-only material that verifies it. Claims check the
 * salted hash; the plaintext sits beside it so an admin can reprint the slip
 * (revealPassportKey).
 */
export function newActivationKey(): {key: string; salt: string; secretHash: string} {
    const key = generateSecureCode(ACTIVATION_KEY_LENGTH);
    const salt = crypto.randomBytes(16).toString("hex");
    return {key, salt, secretHash: hashActivationKey(key, salt)};
}

function activationKeyMatches(key: string, secret: {salt?: unknown; secretHash?: unknown}): boolean {
    if (typeof secret.salt !== "string" || typeof secret.secretHash !== "string") return false;
    const expected = Buffer.from(secret.secretHash, "hex");
    const actual = Buffer.from(hashActivationKey(key, secret.salt), "hex");
    // timingSafeEqual throws on a length mismatch.
    if (expected.length !== actual.length || expected.length === 0) return false;
    return crypto.timingSafeEqual(expected, actual);
}

export function isPassportYear(value: unknown): value is number {
    return typeof value === "number" && Number.isInteger(value) && value >= 2000 && value <= 2100;
}

const PASSPORTS = "passports";
const SECRETS = "passportSecrets";

/**
 * The passport whose current key is `key`, or null. Found through the plaintext
 * kept for revealPassportKey, which a claim leaves in place, so a spent key
 * answers "already activated" rather than "invalid". Keys aren't checked for
 * uniqueness: a repeat among 31^12 is about one in a billion.
 */
export async function findPassportByKey(key: string): Promise<string | null> {
    const snap = await db.collection(SECRETS).where("key", "==", key).limit(1).get();
    return snap.empty ? null : snap.docs[0].id;
}

export interface PassportGrant {
    passportId: string;
    designId: string;
    membershipExpiresAt: string;
    daysGranted: number;
    year: number;
}

/**
 * Claim `passportId` for `uid` with its slip's key: grants the passport's term
 * on top of any membership and binds it for good. Throws an HttpsError
 * otherwise.
 *
 * There's no per-passport lockout: a wrong key isn't aimed at any one passport.
 * Guessing is stopped by the key's length, the per-account rate limit and App
 * Check.
 */
export async function claimPassportWithKey(
    uid: string,
    passportId: string,
    activationCode: string,
): Promise<PassportGrant> {
    const passportRef = db.collection(PASSPORTS).doc(passportId);
    const secretRef = db.collection(SECRETS).doc(passportId);
    const userRef = db.collection("users").doc(uid);

    return db.runTransaction(async (txn): Promise<PassportGrant> => {
        const [passportSnap, secretSnap, userSnap] = await Promise.all([
            txn.get(passportRef),
            txn.get(secretRef),
            txn.get(userRef),
        ]);

        if (!passportSnap.exists) {
            throw new HttpsError("not-found", "This passport code is not valid.", {code: "invalid"});
        }
        const passport = passportSnap.data()!;
        if (passport.status === "claimed") {
            throw new HttpsError("already-exists", "This passport has already been activated.", {
                code: "already-claimed",
            });
        }
        if (!secretSnap.exists) {
            throw new HttpsError(
                "failed-precondition",
                "This passport has no activation key on file. Please contact us.",
                {code: "no-key"},
            );
        }
        // Not "invalid": the key is fine but the account has no profile, so the
        // holder shouldn't be sent to retype it.
        if (!userSnap.exists) {
            throw new HttpsError(
                "failed-precondition",
                "Your account isn't set up yet. Sign out and back in, then try again.",
                {code: "no-profile"},
            );
        }

        // Found by this key, so a mismatch means it was reissued in between.
        if (!activationKeyMatches(activationCode, secretSnap.data()!)) {
            throw new HttpsError("permission-denied", "That activation key is not correct.", {code: "bad-key"});
        }

        const userData = userSnap.data()!;
        const daysGranted = typeof passport.termDays === "number" ? passport.termDays : PASSPORT_TERM_DAYS;
        const membershipExpiresAt = extendedExpiry(userData.membershipExpiresAt ?? null, daysGranted);
        const membershipStartedAt = startedAtAfter(userData, membershipExpiresAt);

        txn.update(passportRef, {
            status: "claimed",
            ownerUid: uid,
            claimedAt: FieldValue.serverTimestamp(),
        });
        // Membership only; `group` is never touched (see the top of
        // functions/passports.ts).
        txn.update(userRef, {
            membershipExpiresAt,
            membershipStartedAt: membershipStartedAt ?? FieldValue.delete(),
        });
        // The hash has done its one job. The key stays for revealPassportKey.
        txn.update(secretRef, {salt: FieldValue.delete(), secretHash: FieldValue.delete()});
        txn.set(recordRef(), recordDoc("passport-claim", {
            performedBy: uid,
            performedByName: userData.displayName ?? "",
            targetUid: uid,
            targetName: userData.displayName ?? "",
            passportId,
            passportYear: passport.year ?? null,
            newExpiresAt: membershipExpiresAt.toDate().toISOString(),
            extendDays: daysGranted,
        }));

        return {
            passportId,
            designId: typeof passport.designId === "string" ? passport.designId : "",
            membershipExpiresAt: membershipExpiresAt.toDate().toISOString(),
            daysGranted,
            year: typeof passport.year === "number" ? passport.year : 0,
        };
    });
}
