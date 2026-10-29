import { defineSecret } from "firebase-functions/params";
import { DEFAULT_SENDER_PREFIX, SENDER_DOMAIN } from "./config";
import { db } from "./firebase";
import { applyProviderUsage, rollbackQuotaReservation } from "./quota";

// Bind to functions that send mail. Without the binding, value() returns "".
export const RESEND_API_KEY = defineSecret("RESEND_API_KEY");

// One outbound email. Callers convert their own shapes into this.
export interface ResendEnvelope {
    to: string | string[];
    subject: string;
    html: string;
    replyTo?: string;
    cc?: string[];
    bcc?: string[];
}

interface SendResult {
    sentCount: number;
    ids: string[];
    // x-resend-daily-quota: Resend's own count for the free plan's 24-hour
    // window, on both endpoints. Absent on paid plans.
    dailyConsumed: number | null;
}

// Resend counts every to/cc/bcc address as one email (1 to + 24 cc uses 25), so
// reserve and release both count this way.
export function countRecipients(envelopes: ResendEnvelope[]): number {
    let total = 0;
    for (const e of envelopes) {
        total += (Array.isArray(e.to) ? e.to.length : 1);
        total += e.cc?.length ?? 0;
        total += e.bcc?.length ?? 0;
    }
    return total;
}

// Carries the quota header, if one came back, so callers can settle their
// pre-charge: null means it's still in place and must be rolled back; non-null
// means resendClient already folded it in, and rolling back would release it
// twice. `status` is Resend's error status, null when it never answered.
export class ResendSendError extends Error {
    dailyConsumed: number | null;
    status: number | null;

    constructor(message: string, dailyConsumed: number | null, status: number | null = null) {
        super(message);
        this.name = "ResendSendError";
        this.dailyConsumed = dailyConsumed;
        this.status = status;
    }
}

const RESEND_SINGLE_URL = "https://api.resend.com/emails";
const RESEND_BATCH_URL = "https://api.resend.com/emails/batch";
const RESEND_BATCH_MAX = 100;

// From: the Site Config prefix, or DEFAULT_SENDER_PREFIX while blank, at
// SENDER_DOMAIN. Read per send, so a change applies without a deploy.
export async function getSenderAddress(): Promise<string> {
    const saved = (await db.collection("config").doc("main").get()).get("senderPrefix");
    const prefix = typeof saved === "string" && saved ? saved : DEFAULT_SENDER_PREFIX;
    return `${prefix}@${SENDER_DOMAIN}`;
}

// `reply_to` must be snake_case; the REST API ignores camelCase.
function toPayload(e: ResendEnvelope, from: string): Record<string, unknown> {
    const payload: Record<string, unknown> = {
        from,
        to: Array.isArray(e.to) ? e.to : [e.to],
        subject: e.subject,
        html: e.html,
    };
    if (e.replyTo) payload.reply_to = e.replyTo;
    if (e.cc && e.cc.length > 0) payload.cc = e.cc;
    if (e.bcc && e.bcc.length > 0) payload.bcc = e.bcc;
    return payload;
}

// Send one or more emails: exactly one through POST /emails ({id}), 2 to 100
// through POST /emails/batch ({data: [{id}]}). A lone email is a real single
// send, the endpoint that supports attachments and scheduled_at. Both carry the
// quota header the same way.
//
// All or nothing: the batch endpoint has no per-email errors, so one bad
// envelope fails the call. The cache is updated from any quota header before
// returning or throwing.
//
// With `timeoutMs`, a Resend that hasn't answered by then counts as a network
// error, though the email may still go.
export async function sendEmails(envelopes: ResendEnvelope[], timeoutMs?: number): Promise<SendResult> {
    if (envelopes.length === 0) {
        return {sentCount: 0, ids: [], dailyConsumed: null};
    }
    if (envelopes.length > RESEND_BATCH_MAX) {
        throw new Error(`Send size ${envelopes.length} exceeds Resend's ${RESEND_BATCH_MAX} cap.`);
    }

    // Shape check per envelope, so a bad one fails with a message naming it
    // rather than an opaque 422 for the batch. An address Resend rejects still
    // fails the whole batch.
    for (let i = 0; i < envelopes.length; i++) {
        const e = envelopes[i];
        const recipients = Array.isArray(e.to) ? e.to : [e.to];
        const badTo = recipients.length === 0
            || recipients.some(r => typeof r !== "string" || r.trim() === "");
        if (badTo || !e.subject || !e.html) {
            throw new Error(`sendEmails: envelope ${i} is malformed (empty to/subject/html).`);
        }
    }

    // A failed read throws before Resend is called; callers treat that like a
    // network error.
    const from = await getSenderAddress();

    // The emulator never reaches Resend, whatever key it has: each email is
    // logged and counted as sent, releasing the pre-charge as a paid plan does.
    if (process.env.FUNCTIONS_EMULATOR === "true") {
        for (const e of envelopes) {
            const to = Array.isArray(e.to) ? e.to : [e.to];
            console.log(`Emulator, not sent: "${e.subject}" from ${from} to ${to.join(", ")}`);
        }
        await rollbackQuotaReservation(countRecipients(envelopes));
        return {sentCount: envelopes.length, ids: [], dailyConsumed: null};
    }

    const apiKey = RESEND_API_KEY.value();
    if (!apiKey) {
        throw new Error("RESEND_API_KEY is not set on this function.");
    }

    const single = envelopes.length === 1;
    const url = single ? RESEND_SINGLE_URL : RESEND_BATCH_URL;
    // Single endpoint takes one object; batch takes an array of them.
    const body = single ? toPayload(envelopes[0], from) : envelopes.map(e => toPayload(e, from));

    let resp: Response;
    try {
        resp = await fetch(url, {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${apiKey}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify(body),
            signal: timeoutMs ? AbortSignal.timeout(timeoutMs) : undefined,
        });
    } catch (err) {
        // Resend never answered, so no header: dailyConsumed=null tells the
        // caller its pre-charge needs rolling back.
        throw new ResendSendError(
            `Resend send network error: ${err instanceof Error ? err.message : String(err)}`,
            null,
        );
    }

    // Read even on an error: a 429 especially wants the freshest count. Often
    // absent (free plan, send responses only), so it's a bonus re-anchor;
    // fetchProviderUsage is what keeps `confirmed` honest.
    const dailyHeader = resp.headers.get("x-resend-daily-quota");
    const dailyConsumed = dailyHeader !== null && !Number.isNaN(Number(dailyHeader))
        ? Number(dailyHeader)
        : null;

    const totalRecipients = countRecipients(envelopes);

    // Record Resend's count and release this send's own reservation, before
    // returning or throwing.
    if (dailyConsumed !== null) {
        await applyProviderUsage(dailyConsumed, totalRecipients);
    }

    if (!resp.ok) {
        const text = await resp.text().catch(() => "");
        throw new ResendSendError(
            `Resend send failed: ${resp.status} ${text}`,
            dailyConsumed,
            resp.status,
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
    // Sent, but no header (e.g. a paid plan): release the pre-charge. Last,
    // because if anything above throws the caller releases it, and doing it
    // here too would double it.
    if (dailyConsumed === null) await rollbackQuotaReservation(totalRecipients);
    return {sentCount: ids.length, ids, dailyConsumed};
}
