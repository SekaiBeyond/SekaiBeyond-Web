import { createHash, createHmac, randomInt, timingSafeEqual } from "node:crypto";
import { Timestamp } from "firebase-admin/firestore";
import { accountPepper } from "./credentials";
import { db } from "./firebase";

/**
 * The 6-digit codes that prove someone holds an address. One doc per purpose and
 * address in emailCodes, so a new code replaces the last, and they're stored
 * hashed with the pepper. A code is used up by the action it was for, and dies
 * after CODE_ATTEMPTS wrong tries, so guessing one is 5 in a million per code.
 */

export type CodePurpose = "signup" | "password" | "email-change";

export const CODE_TTL_MINUTES = 10;
const CODE_ATTEMPTS = 5;
const MIN_GAP_MS = 60_000;
const WINDOW_MS = 60 * 60_000;
const SENDS_PER_WINDOW = 5;

function codeRef(purpose: CodePurpose, email: string): FirebaseFirestore.DocumentReference {
    return db.collection("emailCodes").doc(createHash("sha256").update(`${purpose}|${email}`).digest("hex"));
}

const hashCode = (email: string, code: string): string =>
    createHmac("sha256", accountPepper()).update(`${email}|${code}`).digest("hex");

/**
 * A fresh code for `email`, or null when too many have gone to it lately. The
 * limits count against the address, not whoever's asking, so nobody can have it
 * flooded.
 */
export async function issueEmailCode(purpose: CodePurpose, email: string): Promise<string | null> {
    const ref = codeRef(purpose, email);
    const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
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
            // Outlives the code, or the limits above would reset with it.
            expiresAt: Timestamp.fromMillis(now + WINDOW_MS),
        });
        return code;
    });
}

/** Takes back a code whose email never went, so its address can ask again at once. */
export async function dropEmailCode(purpose: CodePurpose, email: string): Promise<void> {
    await codeRef(purpose, email).delete();
}

/**
 * Whether `code` is the live one for `email`, using it up if so. Call it last,
 * once everything else about the request has been checked, so a mistake
 * elsewhere doesn't cost the holder their code.
 */
export async function consumeEmailCode(purpose: CodePurpose, email: string, code: string): Promise<boolean> {
    const ref = codeRef(purpose, email);
    // Decided inside and acted on after, as throwing would undo the attempt count.
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
