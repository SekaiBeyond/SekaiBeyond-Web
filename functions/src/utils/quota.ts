import { FieldValue } from "firebase-admin/firestore";
import { RESEND_DAILY_CAP } from "./config";
import { db } from "./firebase";

// The quota cache (system/resendQuota), as two counters.
//
// `confirmed` is Resend's own used count, written only by applyProviderUsage from
// the send-response header or a GET /emails count (see fetchProviderUsage). It
// falls as the 24-hour window rolls on, which is how headroom reopens.
//
// `reserved` is the pre-charge of sends decided but not yet answered:
// reserveQuotaInTxn adds, rollbackQuotaReservation and applyProviderUsage
// subtract.
//
// sentToday = confirmed + reserved. Keeping them apart means a finishing send
// releases only its own delta, never a concurrent admin's reservation.
const QUOTA_DOC = db.collection("system").doc("resendQuota");

function num(v: unknown): number {
    return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

// Read both counters off the doc, clamped non-negative.
function parseQuotaDoc(
    data: FirebaseFirestore.DocumentData | undefined,
): {confirmed: number; reserved: number} {
    return {
        confirmed: Math.max(0, num(data?.confirmed)),
        reserved: Math.max(0, num(data?.reserved)),
    };
}

export async function computeEmailQuota(): Promise<{sentToday: number; dailyCap: number}> {
    const {confirmed, reserved} = parseQuotaDoc((await QUOTA_DOC.get()).data());
    return {sentToday: confirmed + reserved, dailyCap: RESEND_DAILY_CAP};
}

// computeEmailQuota plus the raw counters and the cache's age, for the admin
// quota view: mail Resend accepted versus mail in flight, and how stale the
// reading is (null before any send).
export async function computeEmailQuotaDetail(): Promise<{
    sentToday: number;
    dailyCap: number;
    confirmed: number;
    reserved: number;
    observedAt: string | null;
}> {
    const data = (await QUOTA_DOC.get()).data();
    const {confirmed, reserved} = parseQuotaDoc(data);
    return {
        sentToday: confirmed + reserved,
        dailyCap: RESEND_DAILY_CAP,
        confirmed,
        reserved,
        observedAt: data?.observedAt?.toDate?.()?.toISOString?.() ?? null,
    };
}

// Read inside the reservation transaction, so a competing reservation forces a
// retry. Returns `reserved` for reserveQuotaInTxn on the same transaction.
export async function computeEmailQuotaInTxn(
    txn: FirebaseFirestore.Transaction,
): Promise<{sentToday: number; dailyCap: number; reserved: number}> {
    const {confirmed, reserved} = parseQuotaDoc((await txn.get(QUOTA_DOC)).data());
    return {sentToday: confirmed + reserved, dailyCap: RESEND_DAILY_CAP, reserved};
}

// Pre-charge `delta` onto `reserved`. `currentReserved` must come from
// computeEmailQuotaInTxn on the same transaction. merge leaves `confirmed`
// alone.
export function reserveQuotaInTxn(
    txn: FirebaseFirestore.Transaction,
    delta: number,
    currentReserved: number,
): void {
    if (delta <= 0) return;
    txn.set(QUOTA_DOC, {
        reserved: Math.max(0, currentReserved) + delta,
        observedAt: FieldValue.serverTimestamp(),
    }, {merge: true});
}

// Release a pre-charge when no quota header came back (a failed send, or a plan
// without the header). Never after one did: applyProviderUsage already released
// it. Increment-based, with a read-side clamp at zero. Errors are logged and
// swallowed; a failed rollback stays in `reserved` until fixed by hand.
export async function rollbackQuotaReservation(amount: number): Promise<void> {
    if (amount <= 0) return;
    try {
        await QUOTA_DOC.set({
            reserved: FieldValue.increment(-amount),
            observedAt: FieldValue.serverTimestamp(),
        }, {merge: true});
    } catch (err) {
        console.error("rollbackQuotaReservation: failed", err);
    }
}

// Fold a provider reading into the cache: set `confirmed` and release this send's
// own `sentDelta` from `reserved`, in a transaction so a concurrent reservation
// survives. Called by sendEmails on any response with the header, 429s included.
// Errors are logged and swallowed.
//
// sentDelta = 0 for a reading not tied to a send (a fetchProviderUsage scan).
export async function applyProviderUsage(
    headerConsumed: number,
    sentDelta: number,
): Promise<void> {
    try {
        await db.runTransaction(async (txn) => {
            const {reserved} = parseQuotaDoc((await txn.get(QUOTA_DOC)).data());
            txn.set(QUOTA_DOC, {
                confirmed: Math.max(0, headerConsumed),
                reserved: Math.max(0, reserved - Math.max(0, sentDelta)),
                observedAt: FieldValue.serverTimestamp(),
            });
        });
    } catch (err) {
        console.error("applyProviderUsage: failed", err);
    }
}
