import { defineSecret } from "firebase-functions/params";
import { RESEND_FROM_ADDRESS } from "./config";
import { applyResendHeaderQuota, rollbackQuotaReservation } from "./quota";

// Bind to functions that send mail. Without the binding, value() returns "".
export const RESEND_API_KEY = defineSecret("RESEND_API_KEY");

// Normalized envelope — one outbound email. Callers convert their own shapes
// (attendee row, queue doc, admin form) into this.
export interface ResendEnvelope {
    to: string | string[];
    subject: string;
    html: string;
    replyTo?: string;
    cc?: string[];
    bcc?: string[];
}

export interface SendResult {
    sentCount: number;
    ids: string[];
    // x-resend-daily-quota — Resend's authoritative consumed counter for the
    // free plan's sliding 24h window. Absent on paid plans. Returned by both
    // the single and the batch endpoint.
    dailyConsumed: number | null;
}

// Resend's free-plan daily limit counts every to/cc/bcc address as a separate
// email — a single POST with 1 to + 24 cc consumes 25 quota slots, not 1. The
// x-resend-daily-quota header reflects this. Use this helper to compute quota
// deltas on both reserve and release so the cache matches Resend's bookkeeping.
export function countRecipients(envelopes: ResendEnvelope[]): number {
    let total = 0;
    for (const e of envelopes) {
        total += (Array.isArray(e.to) ? e.to.length : 1);
        total += e.cc?.length ?? 0;
        total += e.bcc?.length ?? 0;
    }
    return total;
}

// Custom error carrying the daily-quota header value (if Resend responded).
// Callers use `dailyConsumed !== null` to decide whether to roll back any
// pre-charge they wrote before the call: a null value means Resend never
// answered, so the cache still holds whatever the caller wrote and needs
// to be rolled back. A non-null value means resendClient already updated
// the cache with the authoritative count, so no rollback is safe.
export class ResendSendError extends Error {
    dailyConsumed: number | null;

    constructor(message: string, dailyConsumed: number | null) {
        super(message);
        this.name = "ResendSendError";
        this.dailyConsumed = dailyConsumed;
    }
}

const RESEND_SINGLE_URL = "https://api.resend.com/emails";
const RESEND_BATCH_URL = "https://api.resend.com/emails/batch";
const RESEND_BATCH_MAX = 100;

// Build the Resend API JSON for one envelope. `reply_to` is snake_case —
// the camelCase form is silently ignored by the REST API.
function toPayload(e: ResendEnvelope): Record<string, unknown> {
    const payload: Record<string, unknown> = {
        from: RESEND_FROM_ADDRESS,
        to: Array.isArray(e.to) ? e.to : [e.to],
        subject: e.subject,
        html: e.html,
    };
    if (e.replyTo) payload.reply_to = e.replyTo;
    if (e.cc && e.cc.length > 0) payload.cc = e.cc;
    if (e.bcc && e.bcc.length > 0) payload.bcc = e.bcc;
    return payload;
}

// Send one or more emails through Resend, picking the endpoint by count:
//   - exactly 1  -> POST /emails        (single send; body is one object,
//                                        response is {id})
//   - 2 to 100   -> POST /emails/batch  (batch send;  body is an array,
//                                        response is {data:[{id}]})
// A lone email is a genuine single send rather than a batch-of-one — that
// keeps it on the endpoint that supports attachments/scheduled_at, should a
// caller ever need them (the batch endpoint supports neither). Both
// endpoints return x-resend-daily-quota, so quota tracking is identical.
//
// All-or-nothing: a malformed envelope fails the whole call (the batch
// endpoint has no per-email error reporting). Validation happens upstream.
// On any response carrying the quota header, the cache is updated before
// returning/throwing so reservation reads see the authoritative count.
export async function sendEmails(envelopes: ResendEnvelope[]): Promise<SendResult> {
    if (envelopes.length === 0) {
        return {sentCount: 0, ids: [], dailyConsumed: null};
    }
    if (envelopes.length > RESEND_BATCH_MAX) {
        throw new Error(`Send size ${envelopes.length} exceeds Resend's ${RESEND_BATCH_MAX} cap.`);
    }

    const apiKey = RESEND_API_KEY.value();
    if (!apiKey) {
        throw new Error("RESEND_API_KEY is not set on this function.");
    }

    // Per-envelope shape guard. The batch endpoint is all-or-nothing with no
    // per-email error reporting, so one structurally bad envelope would fail
    // the whole call with an opaque 422. Catch it here with a message that
    // names the offender. (Shape only — a well-formed address that Resend
    // rejects server-side still fails the batch; that's inherent to batching.)
    for (let i = 0; i < envelopes.length; i++) {
        const e = envelopes[i];
        const recipients = Array.isArray(e.to) ? e.to : [e.to];
        const badTo = recipients.length === 0
            || recipients.some(r => typeof r !== "string" || r.trim() === "");
        if (badTo || !e.subject || !e.html) {
            throw new Error(`sendEmails: envelope ${i} is malformed (empty to/subject/html).`);
        }
    }

    const single = envelopes.length === 1;
    const url = single ? RESEND_SINGLE_URL : RESEND_BATCH_URL;
    // Single endpoint takes one object; batch takes an array of them.
    const body = single ? toPayload(envelopes[0]) : envelopes.map(toPayload);

    let resp: Response;
    try {
        resp = await fetch(url, {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${apiKey}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify(body),
        });
    } catch (err) {
        // Network error / DNS failure / timeout — Resend never responded,
        // so no quota header arrived. dailyConsumed=null signals to the
        // caller that any pre-charge they did is still in place and needs
        // to be rolled back.
        throw new ResendSendError(
            `Resend send network error: ${err instanceof Error ? err.message : String(err)}`,
            null,
        );
    }

    // Read header even on error — Resend documents quota headers as
    // "following every request," so reservation accuracy survives a 4xx
    // (a 429 in particular wants the freshest consumed count).
    const dailyHeader = resp.headers.get("x-resend-daily-quota");
    const dailyConsumed = dailyHeader !== null && !Number.isNaN(Number(dailyHeader))
        ? Number(dailyHeader)
        : null;

    const totalRecipients = countRecipients(envelopes);

    // Fold the reading into the quota cache: record Resend's authoritative
    // count and release this send's own reservation (totalRecipients, what
    // the caller pre-charged). Done before returning/throwing so reservation
    // reads see the fresh count.
    if (dailyConsumed !== null) {
        await applyResendHeaderQuota(dailyConsumed, totalRecipients);
    } else if (resp.ok) {
        // Send succeeded but no header arrived (e.g. on paid plans). Release
        // the pre-charge to prevent the reservation from leaking permanently.
        await rollbackQuotaReservation(totalRecipients);
    }

    if (!resp.ok) {
        const text = await resp.text().catch(() => "");
        throw new ResendSendError(
            `Resend send failed: ${resp.status} ${text}`,
            dailyConsumed,
        );
    }

    // Single endpoint returns {id}; batch returns {data:[{id}]}.
    let ids: string[];
    let json: any;
    try {
        json = await resp.json();
    } catch (parseErr) {
        throw new ResendSendError(
            `Resend response parse failed: ${parseErr instanceof Error ? parseErr.message : String(parseErr)}`,
            dailyConsumed
        );
    }

    if (single) {
        const singleJson = json as {id?: string};
        ids = singleJson.id ? [singleJson.id] : [];
    } else {
        const batchJson = json as {data?: Array<{id: string}>};
        ids = (batchJson.data ?? []).map(d => d.id);
    }
    return {sentCount: ids.length, ids, dailyConsumed};
}
