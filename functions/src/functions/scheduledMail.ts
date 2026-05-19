import { onSchedule } from "firebase-functions/v2/scheduler";
import { FieldValue } from "firebase-admin/firestore";
import { recordExpiresAt } from "../utils/config";
import { db } from "../utils/firebase";
import {
    computeEmailQuota,
    computeEmailQuotaInTxn,
    reserveQuotaInTxn,
    rollbackQuotaReservation,
} from "../utils/quota";
import { countRecipients, RESEND_API_KEY, ResendEnvelope, ResendSendError, sendEmails } from "../utils/resendClient";

// Drains /scheduledMail into Resend's batch endpoint every 30 minutes.
//
// Why every-30-min instead of a single LA-midnight run: Resend's free-plan
// daily cap is a sliding 24h window with no calendar reset. The previous
// 00:05 LA schedule was a guess at when Resend's window would refresh; the
// docs explicitly say "wait until 24 hours have passed," which means
// consumption rolls off per-email rather than in a block. Periodic polling
// detects headroom as soon as it opens up.
//
// Each fire reads the cached consumed counter, computes remaining cap,
// pulls up to that many (capped at 100, Resend's batch limit) queued
// items, and ships them in one batch call. When the cache shows the cap
// is exhausted it still pulls a single envelope as a probe (see below);
// when the queue is empty it exits after one cheap read.
//
// Duplicate-delivery assumption: onSchedule v2 invokes via Pub/Sub, which
// is at-least-once. retryCount:0 disables retries on our side, but Pub/Sub
// can still deliver the same fire twice in rare cases. The 30-min cadence
// makes overlap unlikely; if it happens, both runs query the same FIFO
// docs and both try to ship them. Resend may double-deliver. Observed
// Pub/Sub dup rate is <0.1% and 30-min runs aren't long enough to compound
// often. If this becomes a problem, wrap the per-doc delete in a txn
// that re-reads the queue doc and bails if it's already gone.
export const scheduledMailDrain = onSchedule({
    schedule: "*/30 * * * *",
    timeZone: "UTC",
    timeoutSeconds: 540,
    memory: "256MiB",
    retryCount: 0,
    secrets: [RESEND_API_KEY],
}, async () => {
    const {sentToday, dailyCap} = await computeEmailQuota();
    // Headroom per the cached counter. When it is exhausted we still pull a
    // single envelope as a *probe* (drainLimit = 1): sendEmails refreshes
    // `confirmed` from Resend's x-resend-daily-quota header — even on a 429 —
    // and that is the only way the cache learns Resend's daily window has
    // recovered. Without the probe the cache pins at the cap forever and the
    // queue never drains. A genuine 429 just refreshes the cache and leaves
    // the doc queued for the next run.
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

    // Orphaned-attendee pre-check (parallel): a ticket-type queue entry's
    // attendee may have been deleted since queueing. Shipping the mail
    // would deliver unredeemable tickets, AND the post-send batch.update
    // would fail — leaving the queue entry stuck for the next run to retry
    // and fail again. Drop orphans here.
    const checks = await Promise.all(snap.docs.map(async (doc) => {
        const data = doc.data();
        const attendeePath = typeof data.attendeePath === "string" ? data.attendeePath : null;
        if (!attendeePath) return {doc, data, attendeePath: null, orphan: false};
        const attendeeSnap = await db.doc(attendeePath).get();
        return {doc, data, attendeePath, orphan: !attendeeSnap.exists};
    }));

    const candidates: Array<{
        doc: FirebaseFirestore.QueryDocumentSnapshot;
        envelope: ResendEnvelope;
        attendeePath: string | null;
    }> = [];
    let droppedOrphans = 0;
    let droppedMalformed = 0;
    for (const check of checks) {
        if (check.orphan) {
            try {
                await check.doc.ref.delete();
                droppedOrphans++;
                console.log("scheduledMailDrain: dropped orphan",
                    check.doc.id, check.attendeePath);
            } catch (err) {
                console.error("scheduledMailDrain: failed to drop orphan", check.doc.id, err);
            }
            continue;
        }
        const envelope = extractEnvelope(check.data);
        if (!envelope) {
            console.error("scheduledMailDrain: deleting malformed doc", check.doc.id);
            try {
                await check.doc.ref.delete();
            } catch { /* ignore */
            }
            droppedMalformed++;
            continue;
        }
        candidates.push({doc: check.doc, envelope, attendeePath: check.attendeePath});
    }

    if (candidates.length === 0) {
        console.log(`scheduledMailDrain: nothing to send ` +
            `(orphans=${droppedOrphans} malformed=${droppedMalformed})`);
        return;
    }

    // Pre-charge the cache so a concurrent admin send sees the
    // reservation immediately. The batch response header overwrites this
    // with Resend's authoritative count on success.
    const totalRecipients = countRecipients(candidates.map(c => c.envelope));
    await db.runTransaction(async (txn) => {
        const {reserved} = await computeEmailQuotaInTxn(txn);
        reserveQuotaInTxn(txn, totalRecipients, reserved);
    });

    // Single call for the whole drain — sendEmails uses POST /emails when
    // exactly one item is queued, the batch endpoint otherwise. All-or-
    // nothing; on success all N envelopes ship.
    let drained = 0;
    let sendError: unknown = null;
    try {
        const result = await sendEmails(candidates.map(c => c.envelope));
        drained = result.sentCount;
    } catch (err) {
        console.error("scheduledMailDrain: send failed", err);
        sendError = err;
        // Roll back the pre-charge only if Resend never answered.
        const headerArrived = err instanceof ResendSendError
            && err.dailyConsumed !== null;
        if (!headerArrived) {
            await rollbackQuotaReservation(totalRecipients);
        }
    }

    // Clean up successfully drained docs + flip emailScheduled on
    // their referenced attendees. Per-doc batch matches the previous
    // skip-on-failure pattern: one bad commit doesn't strand the rest.
    if (drained > 0) {
        for (let i = 0; i < drained; i++) {
            const {doc, attendeePath} = candidates[i];
            const batch = db.batch();
            batch.delete(doc.ref);
            if (attendeePath) {
                batch.update(db.doc(attendeePath), {
                    emailScheduled: false,
                    emailSentAt: FieldValue.serverTimestamp(),
                    updatedAt: FieldValue.serverTimestamp(),
                });
            }
            try {
                await batch.commit();
            } catch (err) {
                console.error("scheduledMailDrain: failed to clean up doc", doc.id, err);
            }
        }
    }

    if (drained > 0) {
        await db.collection("records").add({
            type: "scheduled-mail-drain",
            sentCount: drained,
            timestamp: FieldValue.serverTimestamp(),
            expiresAt: recordExpiresAt(),
        }).catch(err => {
            console.error("scheduledMailDrain: failed to write audit record", err);
        });
    }

    console.log(`scheduledMailDrain: drained=${drained} orphans=${droppedOrphans} ` +
        `malformed=${droppedMalformed} attempted=${candidates.length} ` +
        `probe=${probing} sendError=${sendError ? "yes" : "no"}`);
});

// Convert a queue doc into a ResendEnvelope. Handles both the current
// `envelope` shape and the legacy `payload` shape — {to, message:{subject,
// html}, cc?, bcc?, replyTo?} — written before the direct-Resend migration,
// so queue docs that predate the deploy still get delivered instead of being
// dropped as malformed. Returns null for genuinely malformed entries.
function extractEnvelope(data: FirebaseFirestore.DocumentData): ResendEnvelope | null {
    if (data.envelope && typeof data.envelope === "object") {
        return parseEnvelopeShape(data.envelope as Record<string, unknown>);
    }
    // Legacy: the pre-migration queue stored a Trigger-Email mail doc whose
    // subject/html sat under a nested `message` object.
    if (data.payload && typeof data.payload === "object") {
        const p = data.payload as Record<string, unknown>;
        if (!p.message || typeof p.message !== "object") return null;
        const m = p.message as Record<string, unknown>;
        return parseEnvelopeShape({
            to: p.to, subject: m.subject, html: m.html,
            replyTo: p.replyTo, cc: p.cc, bcc: p.bcc,
        });
    }
    return null;
}

// Validate a raw object against the ResendEnvelope shape, dropping any
// optional field that isn't the right type.
function parseEnvelopeShape(e: Record<string, unknown>): ResendEnvelope | null {
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
