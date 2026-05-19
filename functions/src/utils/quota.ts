import { Timestamp } from "firebase-admin/firestore";
import { RESEND_DAILY_CAP } from "./config";
import { db } from "./firebase";

// Counted record types share the same daily Resend budget: direct ticket
// sends, custom admin sends, and the per-run audit record that
// scheduledMailDrain writes after pushing queued items into /mail. Keeping
// these in one budget means a big drain at 00:05 correctly throttles
// daytime sends from `sendTicketEmails` / `sendCustomEmail` for the rest
// of the day. Queue-only audit types (ticket-email-queue / custom-email-queue)
// are intentionally excluded — they don't actually consume Resend slots
// until the drain ships them, at which point scheduled-mail-drain counts.
export const EMAIL_RECORD_TYPES = [
    "ticket-email-send",
    "custom-email-send",
    "scheduled-mail-drain",
] as const;

// Start of today in America/Los_Angeles, expressed as a UTC Timestamp.
// UTC-now minus LA's elapsed-since-midnight equals LA midnight (UTC).
// hourCycle:'h23' pins the range to 0–23 (en-US hour12:false can return "24").
function startOfTodayLATimestamp(): Timestamp {
    const now = new Date();
    const laParts = new Intl.DateTimeFormat("en-GB", {
        timeZone: "America/Los_Angeles",
        hour: "2-digit", minute: "2-digit", second: "2-digit",
        hourCycle: "h23",
    }).formatToParts(now);
    const part = (t: string) => Number(laParts.find(p => p.type === t)?.value ?? "0");
    const laMidnightMs = now.getTime()
        - part("hour") * 3600_000
        - part("minute") * 60_000
        - part("second") * 1000
        - now.getMilliseconds();
    return Timestamp.fromMillis(laMidnightMs);
}

function sumSentCount(docs: FirebaseFirestore.QueryDocumentSnapshot[]): number {
    let total = 0;
    for (const d of docs) {
        const c = d.data().sentCount;
        if (typeof c === "number" && Number.isFinite(c)) total += c;
    }
    return total;
}

export async function computeEmailQuota(): Promise<{sentToday: number; dailyCap: number}> {
    // `in` runs as parallel equality queries; with the (type, timestamp)
    // composite index each one is index-served.
    const snap = await db.collection("records")
        .where("type", "in", [...EMAIL_RECORD_TYPES])
        .where("timestamp", ">=", startOfTodayLATimestamp())
        .get();
    return {sentToday: sumSentCount(snap.docs), dailyCap: RESEND_DAILY_CAP};
}

// Transactional variant: reads sentToday inside an open transaction so the
// read and any audit-record writes made later in the same txn commit
// atomically. Use this when reserving cap slots — the plain
// `computeEmailQuota` plus a separate `auditRef.set(...)` leaves a race
// window between read and write where two concurrent admin sends both
// observe pre-reservation state and double-spend the daily cap. With this
// variant, Firestore's optimistic concurrency on the records query
// guarantees that if any concurrent reservation lands first, our txn
// retries against the new total.
export async function computeEmailQuotaInTxn(
    txn: FirebaseFirestore.Transaction,
): Promise<{sentToday: number; dailyCap: number}> {
    const snap = await txn.get(db.collection("records")
        .where("type", "in", [...EMAIL_RECORD_TYPES])
        .where("timestamp", ">=", startOfTodayLATimestamp())
    );
    return {sentToday: sumSentCount(snap.docs), dailyCap: RESEND_DAILY_CAP};
}
