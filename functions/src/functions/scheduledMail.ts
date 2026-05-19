import { onSchedule } from "firebase-functions/v2/scheduler";
import { FieldValue } from "firebase-admin/firestore";
import { recordExpiresAt, RESEND_SEND_INTERVAL_MS, } from "../utils/config";
import { db } from "../utils/firebase";
import { computeEmailQuota } from "../utils/quota";

// Drains /scheduledMail into /mail at 00:05 America/Los_Angeles. The 5-minute
// offset gives the daily quota counter (which keys off LA midnight) time to
// roll over before we start writing the new day's records.
//
// Pacing matches sendTicketEmails: one mail-doc create per
// RESEND_SEND_INTERVAL_MS (default 300ms) so the email extension's onCreate
// triggers don't burst past Resend's 5 req/sec POST /emails limit.
//
// Cap: at most dailyCap - sentToday items per run. Normally sentToday is 0
// right after midnight LA, but checking it defends against the edge case
// where an admin sends in the 00:00–00:05 window before the drain fires.
// Leftover items stay queued and get drained the next day.
//
// Duplicate-delivery assumption: onSchedule v2 invokes via Pub/Sub, which is
// at-least-once. retryCount:0 disables retries on our side, but Pub/Sub can
// still deliver the same fire twice in rare cases. If two instances run
// concurrently, both query the same FIFO docs and both eagerly write their
// own audit (over-counting today's cap) and both commit batches against
// each doc — `batch.delete` on the already-deleted scheduled doc is a no-op,
// so each instance's `batch.set(mailRef, ...)` creates a fresh mail doc and
// the recipient gets the email twice. Not guarding against this because the
// observed Pub/Sub dup rate is well under 0.1% and this fires once per day;
// expected incident rate is ~once per several years. If that becomes a
// problem, the fix is to wrap each per-item commit in a transaction that
// re-reads the scheduled doc and bails if it's already gone.
export const scheduledMailDrain = onSchedule({
    schedule: "5 0 * * *",
    timeZone: "America/Los_Angeles",
    timeoutSeconds: 540,
    memory: "256MiB",
    retryCount: 0,
}, async () => {
    const {sentToday, dailyCap} = await computeEmailQuota();
    const drainLimit = Math.max(0, dailyCap - sentToday);
    if (drainLimit === 0) {
        console.log("scheduledMailDrain: daily cap already consumed before drain");
        return;
    }

    const snap = await db.collection("scheduledMail")
        .orderBy("queuedAt", "asc")
        .limit(drainLimit)
        .get();

    if (snap.empty) {
        console.log("scheduledMailDrain: queue empty");
        return;
    }

    // Reserve the budget eagerly: write the audit record with the planned
    // count before the pacing loop starts, so concurrent admin sends
    // overlapping the drain window see this work in computeEmailQuota right
    // away. Reconciled at the end with the actual drained count (delete if
    // 0, update if partial).
    const expectedDrain = snap.docs.length;
    const auditRef = db.collection("records").doc();
    await auditRef.set({
        type: "scheduled-mail-drain",
        sentCount: expectedDrain,
        timestamp: FieldValue.serverTimestamp(),
        expiresAt: recordExpiresAt(),
    });

    let drained = 0;
    let pacedSends = 0;
    let droppedOrphans = 0;
    for (const doc of snap.docs) {
        const data = doc.data();
        const payload = data.payload as Record<string, unknown> | undefined;
        if (!payload) {
            // Defensive: malformed queue entry. Surface it in logs (would
            // otherwise vanish silently), then delete so the next run
            // doesn't get blocked behind it.
            console.error("scheduledMailDrain: deleting malformed queue doc", doc.id);
            await doc.ref.delete();
            continue;
        }

        // Orphaned-attendee pre-check: if a ticket-type queue entry's
        // attendee was deleted after queueing, the QR codes in `payload`
        // point at ticketIds that no longer exist (deleteEventAttendee
        // removes the whole attendee doc, and redemption joins on
        // attendee.ticketIds array-contains). Shipping the mail would
        // deliver unredeemable tickets, AND the batch below would fail
        // its attendee.update — leaving the queue entry stuck for the
        // next run to retry-and-fail again. Drop the orphan instead.
        const attendeePath = typeof data.attendeePath === "string" ? data.attendeePath : "";
        if (attendeePath) {
            const attendeeSnap = await db.doc(attendeePath).get();
            if (!attendeeSnap.exists) {
                try {
                    await doc.ref.delete();
                    droppedOrphans++;
                    console.log("scheduledMailDrain: dropped orphaned queue entry",
                        doc.id, attendeePath);
                } catch (err) {
                    console.error("scheduledMailDrain: failed to drop orphan", doc.id, err);
                }
                continue;
            }
        }

        if (pacedSends > 0 && RESEND_SEND_INTERVAL_MS > 0) {
            await new Promise(r => setTimeout(r, RESEND_SEND_INTERVAL_MS));
        }

        try {
            // Mail doc create + scheduled doc delete in one batch so a crash
            // can't leave the item double-sent or stuck in the queue. For
            // ticket-type entries, also clear emailScheduled on the
            // referenced attendee so the admin UI flips from "Queued" to
            // "Sent".
            const batch = db.batch();
            const mailRef = db.collection("mail").doc();
            batch.set(mailRef, payload);
            batch.delete(doc.ref);
            if (attendeePath) {
                batch.update(db.doc(attendeePath), {
                    emailScheduled: false,
                    emailSentAt: FieldValue.serverTimestamp(),
                    updatedAt: FieldValue.serverTimestamp(),
                });
            }
            await batch.commit();
            drained++;
            pacedSends++;
        } catch (err) {
            console.error("scheduledMailDrain: failed to drain doc", doc.id, err);
            // Continue: skipping this doc means it'll be retried on the next
            // scheduled run (since we delete on success only). If the failure
            // was a TOCTOU attendee deletion between the pre-check and this
            // commit, the next run's pre-check will catch and drop it.
        }
    }

    // Reconcile the eager reservation with what actually shipped.
    if (drained === 0) {
        await auditRef.delete();
    } else if (drained !== expectedDrain) {
        await auditRef.update({sentCount: drained});
    }

    console.log(`scheduledMailDrain: drained=${drained} dropped=${droppedOrphans} attempted=${snap.docs.length}`);
});

export async function getScheduledMailQueueDepth(): Promise<number> {
    const snap = await db.collection("scheduledMail").count().get();
    return snap.data().count;
}
