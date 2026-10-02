import * as crypto from "crypto";
import { HttpsError } from "firebase-functions/v2/https";
import { FieldValue } from "firebase-admin/firestore";
import { BATCH_LIMIT, recordExpiresAt } from "./config";
import { db } from "./firebase";
import { CODE_ALPHABET, generateSecureCode } from "./helpers";
import { extendedExpiry, startedAtAfter } from "./membership";

/**
 * A physical passport is two pieces of paper: a sticker carrying the public
 * `passportId` (this doc's id, printed as a QR pointing at /p/<id>) and a
 * separate slip carrying the secret activation key. Claiming needs only the
 * slip — its key finds its own passport — and scanning after the claim needs
 * only the sticker.
 */

// Printed on the sticker and visible in every scan URL, so it only has to be
// long enough that ids can't be guessed — 31^10 ≈ 8.2e14.
export const PASSPORT_ID_LENGTH = 10;
// The secret on the slip: 31^12 ≈ 7.9e17 (~59 bits) — the same as a badge code,
// which is also redeemed on its own from the same box under the same per-account
// rate limit. That length is what keeps the key safe to accept without the sticker.
export const ACTIVATION_KEY_LENGTH = 12;

// Each design sets its own term, copied onto its passports at generation. This
// only stands in when reading a passport that somehow has none.
export const PASSPORT_TERM_DAYS = 365;

// Per-call ceiling on how many passports one generate request may mint. Each
// passport writes two documents (the passport and its secret), so this must stay
// at or under half of BATCH_LIMIT for one call to commit in a single chunk.
export const MAX_GENERATE_COUNT = Math.min(200, Math.floor(BATCH_LIMIT / 2));

// Per-call ceiling on a bulk delete, for the same reason and with the same
// arithmetic: a deleted passport erases the passport and its secret.
export const MAX_DELETE_COUNT = MAX_GENERATE_COUNT;

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
 * A fresh key plus the server-only material that verifies it. Claims check the
 * salted hash; the plaintext is stored beside it in the same server-only doc so
 * an admin can reprint the current slip (revealPassportKey) without re-keying.
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

export function isPassportYear(value: unknown): value is number {
    return typeof value === "number" && Number.isInteger(value) && value >= 2000 && value <= 2100;
}

const PASSPORTS = "passports";
const SECRETS = "passportSecrets";

/**
 * The passport whose current key is `key`, or null when none has it. Found
 * through the plaintext kept beside the hash for revealPassportKey; a claim
 * leaves that in place, so a spent key still finds its passport and is answered
 * "already activated" rather than "invalid".
 *
 * Keys aren't checked for uniqueness when minted: across even tens of thousands
 * of passports, a repeat among 31^12 keys is around a one-in-a-billion event.
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
 * Claim `passportId` for `uid` with the key from its slip. Grants the passport's
 * term (set by its design), stacked onto any membership the caller already has,
 * and binds the passport permanently. Throws an HttpsError for anything short of
 * that.
 *
 * The passport is found by the key itself (findPassportByKey), from Redeem
 * Code. There is no per-passport lockout on wrong keys: a guess isn't aimed at
 * any one passport, so there is nothing to lock, and what stops guessing is the
 * key's length, the per-account rate limit, and App Check — the same as for a
 * badge code.
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
        // Distinct from "invalid": the key is fine, the account is the problem
        // (profile creation failed on first sign-in, or the doc was deleted under
        // an open tab). Answering "invalid" here sends the holder off to retype a
        // key that was never wrong.
        if (!userSnap.exists) {
            throw new HttpsError(
                "failed-precondition",
                "Your account isn't set up yet. Sign out and back in, then try again.",
                {code: "no-profile"},
            );
        }

        // The passport was found by this very key, so a mismatch means the key
        // was reissued in between.
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
        // Membership only. `group` is never touched here — see the comment at the
        // top of functions/passports.ts.
        txn.update(userRef, {
            membershipExpiresAt,
            membershipStartedAt: membershipStartedAt ?? FieldValue.delete(),
        });
        // The binding is permanent, so the hash has done its one job and is
        // dropped. The key stays so an admin can still look up what was on the
        // slip (revealPassportKey).
        txn.update(secretRef, {salt: FieldValue.delete(), secretHash: FieldValue.delete()});
        txn.set(db.collection("records").doc(), {
            type: "passport-claim",
            performedBy: uid,
            performedByName: userData.displayName ?? "",
            targetUid: uid,
            targetName: userData.displayName ?? "",
            passportId,
            passportYear: passport.year ?? null,
            newExpiresAt: membershipExpiresAt.toDate().toISOString(),
            extendDays: daysGranted,
            timestamp: FieldValue.serverTimestamp(),
            expiresAt: recordExpiresAt(),
        });

        return {
            passportId,
            designId: typeof passport.designId === "string" ? passport.designId : "",
            membershipExpiresAt: membershipExpiresAt.toDate().toISOString(),
            daysGranted,
            year: typeof passport.year === "number" ? passport.year : 0,
        };
    });
}
