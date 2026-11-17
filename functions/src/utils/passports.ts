import * as crypto from "crypto";
import { HttpsError } from "firebase-functions/v2/https";
import { FieldValue } from "firebase-admin/firestore";
import { BATCH_LIMIT, PUBLIC_ORIGIN, SEND_CHUNK_SIZE } from "./config";
import { accountEmails, maskEmail } from "./accountEmail";
import { db } from "./firebase";
import { type BatchOp, CODE_ALPHABET, generateSecureCode } from "./helpers";
import { extendedExpiry, startedAtAfter } from "./membership";
import { recordDoc, recordRef } from "./records";
import { sanitizeDisplayText, validateStr } from "./validation";

const PASSPORT_ID_LENGTH = 10;
const ACTIVATION_KEY_LENGTH = 12;

export const PASSPORT_TERM_DAYS = 365;

export const MAX_GENERATE_COUNT = Math.min(200, Math.floor(BATCH_LIMIT / 2));

export const MAX_DELETE_COUNT = MAX_GENERATE_COUNT;

export const MAX_KEY_EXPORT_COUNT = 500;

export const MAX_EMAIL_COUNT = Math.min(MAX_GENERATE_COUNT, SEND_CHUNK_SIZE, Math.floor(BATCH_LIMIT / 4));

const PASSPORT_NOTE_MAX = 500;

export function validatePassportNote(value: unknown): string {
    return sanitizeDisplayText(validateStr(value, "note", PASSPORT_NOTE_MAX));
}

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

export function formatActivationKey(key: string): string {
    return (key.match(/.{1,4}/g) ?? [key]).join("-");
}

function hashActivationKey(key: string, salt: string): string {
    return crypto.createHash("sha256").update(`${salt}:${key}`).digest("hex");
}

export function newActivationKey(): {key: string; salt: string; secretHash: string} {
    const key = generateSecureCode(ACTIVATION_KEY_LENGTH);
    const salt = crypto.randomBytes(16).toString("hex");
    return {key, salt, secretHash: hashActivationKey(key, salt)};
}

function activationKeyMatches(key: string, secret: {salt?: unknown; secretHash?: unknown}): boolean {
    if (typeof secret.salt !== "string" || typeof secret.secretHash !== "string") return false;
    const expected = Buffer.from(secret.secretHash, "hex");
    const actual = Buffer.from(hashActivationKey(key, secret.salt), "hex");
    if (expected.length !== actual.length || expected.length === 0) return false;
    return crypto.timingSafeEqual(expected, actual);
}

export function isPassportYear(value: unknown): value is number {
    return typeof value === "number" && Number.isInteger(value) && value >= 2000 && value <= 2100;
}

export const PASSPORTS = "passports";
export const SECRETS = "passportSecrets";

export const passportNoteRef = (passportId: string) => db.collection("passportNotes").doc(passportId);

export function passportNoteDoc(designId: string, note: string, by: {uid: string; name: string}) {
    return {
        designId,
        note,
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: by.uid,
        updatedByName: by.name,
    };
}

export interface MintingDesign {
    designId: string;
    year: number;
    name: string;
    nameCn: string;
    coverImageUrl: string;
    termDays: number;
}

export async function readMintingDesign(designId: string): Promise<MintingDesign> {
    const snap = await db.collection("passportDesigns").doc(designId).get();
    if (!snap.exists) {
        throw new HttpsError("failed-precondition", "That passport design doesn't exist.", {code: "no-design"});
    }
    const data = snap.data()!;
    return {
        designId,
        year: data.year,
        name: data.name ?? "",
        nameCn: data.nameCn ?? "",
        coverImageUrl: data.coverImageUrl ?? "",
        termDays: data.termDays,
    };
}

export function mintPassport(
    design: MintingDesign,
    seen: Set<string>,
    by: {uid: string; name: string},
    extra: Record<string, unknown> = {},
    note = "",
): {
    passportId: string;
    key: string;
    write: BatchOp;
    noteWrite: BatchOp | null;
} {
    let passportId = generateSecureCode(PASSPORT_ID_LENGTH);
    while (seen.has(passportId)) passportId = generateSecureCode(PASSPORT_ID_LENGTH);
    seen.add(passportId);

    const {key, salt, secretHash} = newActivationKey();
    return {
        passportId,
        key,
        noteWrite: note
            ? (batch) => batch.create(passportNoteRef(passportId), passportNoteDoc(design.designId, note, by))
            : null,
        write: (batch) => {
            batch.create(db.collection(PASSPORTS).doc(passportId), {
                designId: design.designId,
                year: design.year,
                status: "unclaimed",
                ownerUid: null,
                claimedAt: null,
                termDays: design.termDays,
                createdAt: FieldValue.serverTimestamp(),
                createdBy: by.uid,
                createdByName: by.name,
                keyIssuedAt: FieldValue.serverTimestamp(),
                keyReissueCount: 0,
                ...extra,
            });
            batch.create(db.collection(SECRETS).doc(passportId), {salt, secretHash, key});
        },
    };
}

export const ACTIVATION_CODE_PLACEHOLDER = /{{\s*activationCode\s*}}/g;
export const ACTIVATE_URL_PLACEHOLDER = /{{\s*activateUrl\s*}}/g;

export function fillActivationKey(text: string, key: string): string {
    const activationCode = formatActivationKey(key);
    const activateUrl = `${PUBLIC_ORIGIN}/profile?redeem=${encodeURIComponent(activationCode)}`;
    return text
        .replace(ACTIVATION_CODE_PLACEHOLDER, () => activationCode)
        .replace(ACTIVATE_URL_PLACEHOLDER, () => activateUrl);
}

export async function findPassportByKey(key: string): Promise<string | null> {
    const snap = await db.collection(SECRETS).where("key", "==", key).limit(1).get();
    return snap.empty ? null : snap.docs[0].id;
}

interface PassportGrant {
    passportId: string;
    designId: string;
    membershipExpiresAt: string;
    daysGranted: number;
    year: number;
}

export async function claimPassportWithKey(
    uid: string,
    passportId: string,
    activationCode: string,
    confirmEmailMismatch: boolean,
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
        if (!userSnap.exists) {
            throw new HttpsError(
                "failed-precondition",
                "Your account isn't set up yet. Sign out and back in, then try again.",
                {code: "no-profile"},
            );
        }

        if (!activationKeyMatches(activationCode, secretSnap.data()!)) {
            throw new HttpsError("permission-denied", "That activation key is not correct.", {code: "bad-key"});
        }

        const userData = userSnap.data()!;
        const accountEmail: string = userData.email ?? "";
        const sentTo = typeof passport.sentTo === "string" ? passport.sentTo : "";
        const emailMismatch = sentTo !== "" && !accountEmails(userData).includes(sentTo);
        if (emailMismatch && !confirmEmailMismatch) {
            throw new HttpsError("failed-precondition", "This passport was emailed to a different address.", {
                code: "email-mismatch",
                sentTo: maskEmail(sentTo),
                accountEmail,
            });
        }

        const daysGranted = typeof passport.termDays === "number" ? passport.termDays : PASSPORT_TERM_DAYS;
        const membershipExpiresAt = extendedExpiry(userData.membershipExpiresAt ?? null, daysGranted);
        const membershipStartedAt = startedAtAfter(userData, membershipExpiresAt);

        txn.update(passportRef, {
            status: "claimed",
            ownerUid: uid,
            claimedAt: FieldValue.serverTimestamp(),
            claimedEmail: accountEmail,
        });
        txn.update(userRef, {
            membershipExpiresAt,
            membershipStartedAt: membershipStartedAt ?? FieldValue.delete(),
        });
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
            ...(emailMismatch ? {passportSentTo: sentTo} : {}),
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
