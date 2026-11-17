import { FieldValue } from "firebase-admin/firestore";
import { BULK_MAIL_CAP, RESEND_DAILY_CAP } from "./config";
import { db } from "./firebase";
import { isoOrNull } from "./helpers";

const QUOTA_DOC = db.collection("system").doc("resendQuota");

function num(v: unknown): number {
    return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

function parseQuotaDoc(
    data: FirebaseFirestore.DocumentData | undefined,
): {confirmed: number; reserved: number} {
    return {
        confirmed: Math.max(0, num(data?.confirmed)),
        reserved: Math.max(0, num(data?.reserved)),
    };
}

export async function computeEmailQuota(): Promise<{sentToday: number; dailyCap: number}> {
    const {sentToday} = await computeEmailQuotaDetail();
    return {sentToday, dailyCap: BULK_MAIL_CAP};
}

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
        observedAt: isoOrNull(data?.observedAt),
    };
}

export async function computeEmailQuotaInTxn(
    txn: FirebaseFirestore.Transaction,
): Promise<{sentToday: number; dailyCap: number; reserved: number}> {
    const {confirmed, reserved} = parseQuotaDoc((await txn.get(QUOTA_DOC)).data());
    return {sentToday: confirmed + reserved, dailyCap: BULK_MAIL_CAP, reserved};
}

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
