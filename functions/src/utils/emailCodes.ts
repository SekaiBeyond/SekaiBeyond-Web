import { createHash, createHmac, randomInt, timingSafeEqual } from "node:crypto";
import { Timestamp } from "firebase-admin/firestore";
import { accountPepper } from "./credentials";
import { db } from "./firebase";

export type CodePurpose = "signup" | "password" | "email-change";

export const CODE_LENGTH = 8;
export const CODE_TTL_MINUTES = 10;
export const CODE_ATTEMPTS = 5;
const MIN_GAP_MS = 60_000;
const WINDOW_MS = 60 * 60_000;
const SENDS_PER_WINDOW = 5;

export const emailCodeKey = (purpose: CodePurpose, email: string): string =>
    createHash("sha256").update(`${purpose}|${email}`).digest("hex");

function codeRef(purpose: CodePurpose, email: string): FirebaseFirestore.DocumentReference {
    return db.collection("emailCodes").doc(emailCodeKey(purpose, email));
}

const hashCode = (email: string, code: string): string =>
    createHmac("sha256", accountPepper()).update(`${email}|${code}`).digest("hex");

interface IssuedCode {
    code: string;
    previous: FirebaseFirestore.DocumentData | null;
}

export async function issueEmailCode(purpose: CodePurpose, email: string): Promise<IssuedCode | null> {
    const ref = codeRef(purpose, email);
    const code = String(randomInt(0, 10 ** CODE_LENGTH)).padStart(CODE_LENGTH, "0");
    const now = Date.now();

    return db.runTransaction(async (txn) => {
        const data = (await txn.get(ref)).data();
        const windowStart: number = data && now - data.windowStart < WINDOW_MS ? data.windowStart : now;
        const sends: number = windowStart === data?.windowStart ? data.sends : 0;
        if (data && now - data.sentAt < MIN_GAP_MS) return null;
        if (sends >= SENDS_PER_WINDOW) return null;

        txn.set(ref, {
            codeHash: hashCode(email, code),
            attempts: 0,
            sentAt: now,
            windowStart,
            sends: sends + 1,
            validUntil: now + CODE_TTL_MINUTES * 60_000,
            expiresAt: Timestamp.fromMillis(now + WINDOW_MS),
        });
        return {code, previous: data ?? null};
    });
}

export async function withdrawEmailCode(purpose: CodePurpose, email: string, issued: IssuedCode): Promise<void> {
    const ref = codeRef(purpose, email);
    await db.runTransaction(async (txn) => {
        const data = (await txn.get(ref)).data();
        if (data?.codeHash !== hashCode(email, issued.code)) return;
        if (issued.previous) txn.set(ref, issued.previous);
        else txn.delete(ref);
    });
}

export async function consumeEmailCode(purpose: CodePurpose, email: string, code: string): Promise<boolean> {
    const ref = codeRef(purpose, email);
    return db.runTransaction(async (txn) => {
        const data = (await txn.get(ref)).data();
        if (!data?.codeHash || Date.now() > data.validUntil || data.attempts >= CODE_ATTEMPTS) return false;

        const expected = Buffer.from(data.codeHash, "hex");
        const given = Buffer.from(hashCode(email, code), "hex");
        if (!timingSafeEqual(expected, given)) {
            txn.update(ref, {attempts: data.attempts + 1});
            return false;
        }
        txn.delete(ref);
        return true;
    });
}
