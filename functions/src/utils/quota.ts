import { FieldValue } from "firebase-admin/firestore";
import { RESEND_DAILY_CAP } from "./config";
import { db } from "./firebase";

// Quota cache doc (system/resendQuota). Two independent counters:
//
//   confirmed — Resend's authoritative "used daily quota": the value of the
//               x-resend-daily-quota response header. Only applyProviderHeaderQuota
//               writes it. It can move *down* as Resend's sliding 24h window
//               rolls off old sends — that is how the cache observes headroom
//               reopening.
//   reserved  — sum of in-flight pre-charges for sends that have been decided
//               but whose Resend response hasn't landed yet. reserveQuotaInTxn
//               adds to it; rollbackQuotaReservation and applyProviderHeaderQuota
//               subtract from it.
//
// sentToday = confirmed + reserved. Keeping the two separate is what stops a
// completing send from clobbering a concurrent admin's reservation: a header
// write only ever releases its *own* delta from `reserved`, never the whole
// counter. Exported so resendClient shares the exact same doc reference.
export const QUOTA_DOC = db.collection("system").doc("resendQuota");

function num(v: unknown): number {
    return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

// Read both counters off the doc. `confirmed` falls back to the pre-migration
// `dailyConsumed` field so the counter survives the schema change without a
// one-window reset; both counters are clamped non-negative.
function parseQuotaDoc(
    data: FirebaseFirestore.DocumentData | undefined,
): {confirmed: number; reserved: number} {
    return {
        confirmed: Math.max(0, num(data?.confirmed ?? data?.dailyConsumed)),
        reserved: Math.max(0, num(data?.reserved)),
    };
}

export async function computeEmailQuota(): Promise<{sentToday: number; dailyCap: number}> {
    const {confirmed, reserved} = parseQuotaDoc((await QUOTA_DOC.get()).data());
    return {sentToday: confirmed + reserved, dailyCap: RESEND_DAILY_CAP};
}

// Read-only expansion of computeEmailQuota for the admin quota view: the same
// totals plus the raw counters behind them and the age of the cache. Splitting
// `confirmed` from `reserved` is what lets the panel distinguish mail Resend
// has actually accepted from sends still in flight, and `observedAt` says how
// stale the reading is — null on a cache that has never been written (no mail
// sent yet since the counters were introduced).
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

// Transactional variant for atomic send-vs-queue reservation. Reading the
// quota doc inside the txn means a competing reservation triggers a retry
// rather than double-spending the cap. Returns `reserved` so the caller can
// hand it straight to reserveQuotaInTxn on the same txn.
export async function computeEmailQuotaInTxn(
    txn: FirebaseFirestore.Transaction,
): Promise<{sentToday: number; dailyCap: number; reserved: number}> {
    const {confirmed, reserved} = parseQuotaDoc((await txn.get(QUOTA_DOC)).data());
    return {sentToday: confirmed + reserved, dailyCap: RESEND_DAILY_CAP, reserved};
}

// Pre-charge `delta` slots onto `reserved` inside the caller's txn.
// `currentReserved` must come from computeEmailQuotaInTxn on the *same* txn so
// Firestore's optimistic concurrency forces a retry if a competing reservation
// lands first. merge:true so the write leaves `confirmed` untouched.
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

// Release a `reserveQuotaInTxn` pre-charge when the send never reached Resend
// (network error, no response header). When Resend *did* respond,
// applyProviderHeaderQuota already released the reservation and this must NOT be
// called. Uses increment so it composes with concurrent writes; the read-side
// clamp keeps `reserved` from going negative. Logs and swallows errors — a
// failed rollback self-heals on the next header write.
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

// Fold a fresh used-quota reading from the provider into the cache: set
// `confirmed` to its authoritative count and release this send's own
// reservation (`sentDelta`, the envelope count it pre-charged) from `reserved`.
// Runs in a txn so a reservation racing the write isn't lost — only this send's
// delta is removed, never a concurrent admin's. Called by resendClient.sendEmails
// on any response that carried the quota header, success or 4xx/429 alike.
// Logs and swallows errors; the next header write self-heals.
//
// Pass sentDelta = 0 for a reading that wasn't attached to a send (the admin
// view's probeProviderQuota): it refreshes `confirmed` while leaving in-flight
// reservations alone, since a probe releases nothing.
export async function applyProviderHeaderQuota(
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
        console.error("applyProviderHeaderQuota: failed", err);
    }
}
