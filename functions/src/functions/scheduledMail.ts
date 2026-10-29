import { onSchedule } from "firebase-functions/v2/scheduler";
import { FieldValue } from "firebase-admin/firestore";
import { syncProviderUsage } from "../utils/emailProvider";
import { db } from "../utils/firebase";
import { fillActivationKey } from "../utils/passports";
import { recordDoc, recordRef } from "../utils/records";
import {
    computeEmailQuota,
    computeEmailQuotaInTxn,
    reserveQuotaInTxn,
    rollbackQuotaReservation,
} from "../utils/quota";
import {
    countRecipients,
    RESEND_API_KEY,
    type ResendEnvelope,
    ResendSendError,
    sendEmails
} from "../utils/resendClient";

// Exported so the admin quota view states the same cadence as the schedule.
export const DRAIN_INTERVAL_MINUTES = 30;

// Drains /scheduledMail into Resend's batch endpoint every 30 minutes. Resend's
// daily cap is a sliding 24-hour window, so polling picks up headroom as it
// opens rather than waiting for a reset that never comes.
//
// Each run pulls as many queued items as the cached counter allows (at most
// 100, the batch limit) and sends them in one call. With the cap exhausted it
// still pulls one as a probe (see below); with nothing queued it exits after
// one read.
//
// Pub/Sub is at-least-once, so the same fire can rarely arrive twice and
// double-send. The observed rate is under 0.1%; if it becomes a problem, delete
// each doc in a transaction that bails when it's already gone.
export const scheduledMailDrain = onSchedule({
    schedule: `*/${DRAIN_INTERVAL_MINUTES} * * * *`,
    timeZone: "UTC",
    timeoutSeconds: 540,
    memory: "256MiB",
    retryCount: 0,
    secrets: [RESEND_API_KEY],
}, async () => {
    // Re-anchor `confirmed` against the provider, so headroom reflects the
    // window now rather than the last send's high-water mark.
    await syncProviderUsage();
    const {sentToday, dailyCap} = await computeEmailQuota();
    // With the cap exhausted, still pull one envelope as a probe. The sync
    // above is what normally notices the window recovering, but it returns null
    // when the provider can't be read; the probe's send also refreshes
    // `confirmed` from the quota header, even on a 429, so the queue can't stay
    // pinned at the cap. A real 429 leaves the doc queued.
    const headroom = Math.min(100, Math.max(0, dailyCap - sentToday));
    const probing = headroom === 0;
    const drainLimit = probing ? 1 : headroom;

    const snap = await db.collection("scheduledMail")
        .orderBy("queuedAt", "asc")
        .limit(drainLimit)
        .get();
    if (snap.empty) {
        console.log("scheduledMailDrain: queue empty");
        return;
    }

    // Drop entries whose attendee or passport was deleted since queueing: the
    // mail would carry dead tickets or a dead key, and the post-send update
    // would fail and leave the entry stuck. A passport claimed meanwhile has no
    // use for its key either.
    const checks = await Promise.all(snap.docs.map(async (doc) => {
        const data = doc.data();
        const targetPath = typeof data.targetPath === "string" ? data.targetPath : null;
        const check = {
            doc, data, targetPath,
            isPassport: data.type === "passport",
            targetExists: false,
            key: null as string | null,
            orphan: false,
        };
        if (!targetPath) return check;
        const targetSnap = await db.doc(targetPath).get();
        check.targetExists = targetSnap.exists;
        check.orphan = !targetSnap.exists;
        if (check.isPassport && targetSnap.exists) {
            // The key is filled in only now (see emailPassports), so the one
            // current at sending goes.
            const key = (await db.collection("passportSecrets").doc(targetSnap.id).get()).data()?.key;
            if (typeof key === "string" && targetSnap.data()?.status !== "claimed") check.key = key;
            else check.orphan = true;
        }
        return check;
    }));

    const candidates: Array<{
        doc: FirebaseFirestore.QueryDocumentSnapshot;
        envelope: ResendEnvelope;
        targetPath: string | null;
        isPassport: boolean;
    }> = [];
    let droppedOrphans = 0;
    let droppedMalformed = 0;
    for (const check of checks) {
        if (check.orphan) {
            try {
                const batch = db.batch();
                batch.delete(check.doc.ref);
                // A passport claimed meanwhile, or left keyless, isn't waiting
                // on this any more.
                if (check.targetExists && check.targetPath) {
                    batch.update(db.doc(check.targetPath), {emailScheduled: false});
                }
                await batch.commit();
                droppedOrphans++;
                console.log("scheduledMailDrain: dropped orphan",
                    check.doc.id, check.targetPath);
            } catch (err) {
                console.error("scheduledMailDrain: failed to drop orphan", check.doc.id, err);
            }
            continue;
        }
        const parsed = extractEnvelope(check.data);
        const envelope = parsed && check.key
            ? {
                ...parsed,
                subject: fillActivationKey(parsed.subject, check.key),
                html: fillActivationKey(parsed.html, check.key)
            }
            : parsed;
        if (!envelope) {
            console.error("scheduledMailDrain: deleting malformed doc", check.doc.id);
            await check.doc.ref.delete().catch(() => {
                // The next run tries again.
            });
            droppedMalformed++;
            continue;
        }
        candidates.push({doc: check.doc, envelope, targetPath: check.targetPath, isPassport: check.isPassport});
    }

    if (candidates.length === 0) {
        console.log(`scheduledMailDrain: nothing to send ` +
            `(orphans=${droppedOrphans} malformed=${droppedMalformed})`);
        return;
    }

    // Pre-charge, so a concurrent admin send sees the reservation. Released
    // once the send settles, by sendEmails or the catch below.
    const totalRecipients = countRecipients(candidates.map(c => c.envelope));
    await db.runTransaction(async (txn) => {
        const {reserved} = await computeEmailQuotaInTxn(txn);
        reserveQuotaInTxn(txn, totalRecipients, reserved);
    });

    // One call for the whole drain, all or nothing.
    let drained = 0;
    let sendError: unknown = null;
    try {
        const result = await sendEmails(candidates.map(c => c.envelope));
        drained = result.sentCount;
    } catch (err) {
        console.error("scheduledMailDrain: send failed", err);
        sendError = err;
        // Roll back the pre-charge unless a quota header came back.
        const headerArrived = err instanceof ResendSendError
            && err.dailyConsumed !== null;
        if (!headerArrived) {
            await rollbackQuotaReservation(totalRecipients);
        }
    }

    // Delete drained docs and clear emailScheduled on their attendees and
    // passports, one commit each so a bad one doesn't strand the rest.
    for (const {doc, targetPath, isPassport} of candidates.slice(0, drained)) {
        const batch = db.batch();
        batch.delete(doc.ref);
        if (targetPath) {
            batch.update(db.doc(targetPath), {
                emailScheduled: false,
                emailSentAt: FieldValue.serverTimestamp(),
                // Passports keep no updatedAt.
                ...(isPassport ? {} : {updatedAt: FieldValue.serverTimestamp()}),
            });
        }
        try {
            await batch.commit();
        } catch (err) {
            console.error("scheduledMailDrain: failed to clean up doc", doc.id, err);
        }
    }

    if (drained > 0) {
        await recordRef().set(recordDoc("scheduled-mail-drain", {
            sentCount: drained,
        })).catch(err => {
            console.error("scheduledMailDrain: failed to write audit record", err);
        });
    }

    console.log(`scheduledMailDrain: drained=${drained} orphans=${droppedOrphans} ` +
        `malformed=${droppedMalformed} attempted=${candidates.length} ` +
        `probe=${probing} sendError=${sendError ? "yes" : "no"}`);
});

// A queue doc's envelope, dropping optional fields of the wrong type. Null for
// a malformed entry.
function extractEnvelope(data: FirebaseFirestore.DocumentData): ResendEnvelope | null {
    if (!data.envelope || typeof data.envelope !== "object") return null;
    const e = data.envelope as Record<string, unknown>;
    if (typeof e.subject !== "string" || typeof e.html !== "string") return null;
    if (typeof e.to !== "string" && !Array.isArray(e.to)) return null;
    const out: ResendEnvelope = {
        to: e.to as string | string[],
        subject: e.subject,
        html: e.html,
    };
    if (typeof e.replyTo === "string") out.replyTo = e.replyTo;
    if (Array.isArray(e.cc)) out.cc = e.cc as string[];
    if (Array.isArray(e.bcc)) out.bcc = e.bcc as string[];
    return out;
}

export async function getScheduledMailQueueDepth(): Promise<number> {
    const snap = await db.collection("scheduledMail").count().get();
    return snap.data().count;
}

// Queue depth and the head's queuedAt, for the admin quota view: a queue that
// isn't draining shows as a head that keeps getting older. Ordered as
// scheduledMailDrain pulls.
export async function getScheduledMailQueueStatus(): Promise<{
    queuedCount: number;
    oldestQueuedAt: string | null;
}> {
    const [queuedCount, oldestSnap] = await Promise.all([
        getScheduledMailQueueDepth(),
        db.collection("scheduledMail").orderBy("queuedAt", "asc").limit(1).get(),
    ]);
    const queuedAt = oldestSnap.docs[0]?.data()?.queuedAt;
    return {
        queuedCount,
        oldestQueuedAt: queuedAt?.toDate?.()?.toISOString?.() ?? null,
    };
}
