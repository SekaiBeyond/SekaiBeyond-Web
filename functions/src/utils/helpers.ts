import * as crypto from "crypto";
import { HttpsError } from "firebase-functions/v2/https";
import { BATCH_LIMIT } from "./config";
import { db } from "./firebase";

export const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export function generateSecureCode(length: number): string {
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

export function validateCodeInTransaction(data: {
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

export async function commitInChunks(
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
