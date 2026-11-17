import { defineSecret } from "firebase-functions/params";
import { DEFAULT_SENDER_PREFIX, SENDER_DOMAIN } from "./config";
import { db } from "./firebase";
import { applyProviderUsage, rollbackQuotaReservation } from "./quota";

export const RESEND_API_KEY = defineSecret("RESEND_API_KEY");

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
    dailyConsumed: number | null;
}

export function countRecipients(envelopes: ResendEnvelope[]): number {
    let total = 0;
    for (const e of envelopes) {
        total += (Array.isArray(e.to) ? e.to.length : 1);
        total += e.cc?.length ?? 0;
        total += e.bcc?.length ?? 0;
    }
    return total;
}

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

export async function getSenderAddress(): Promise<string> {
    const saved = (await db.collection("config").doc("main").get()).get("senderPrefix");
    const prefix = typeof saved === "string" && saved ? saved : DEFAULT_SENDER_PREFIX;
    return `${prefix}@${SENDER_DOMAIN}`;
}

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

export async function sendEmails(envelopes: ResendEnvelope[], timeoutMs?: number): Promise<SendResult> {
    if (envelopes.length === 0) {
        return {sentCount: 0, ids: [], dailyConsumed: null};
    }
    if (envelopes.length > RESEND_BATCH_MAX) {
        throw new Error(`Send size ${envelopes.length} exceeds Resend's ${RESEND_BATCH_MAX} cap.`);
    }

    for (let i = 0; i < envelopes.length; i++) {
        const e = envelopes[i];
        const recipients = Array.isArray(e.to) ? e.to : [e.to];
        const badTo = recipients.length === 0
            || recipients.some(r => typeof r !== "string" || r.trim() === "");
        if (badTo || !e.subject || !e.html) {
            throw new Error(`sendEmails: envelope ${i} is malformed (empty to/subject/html).`);
        }
    }

    const from = await getSenderAddress();

    if (process.env.FUNCTIONS_EMULATOR === "true") {
        for (const e of envelopes) {
            const to = Array.isArray(e.to) ? e.to : [e.to];
            const links = [...e.html.matchAll(/href="([^"]+)"/g)].map(match => match[1]).join(" ");
            console.log(`Emulator, not sent: "${e.subject}" from ${from} to ${to.join(", ")}${links ? ` links: ${links}` : ""}`);
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
        throw new ResendSendError(
            `Resend send network error: ${err instanceof Error ? err.message : String(err)}`,
            null,
        );
    }

    const dailyHeader = resp.headers.get("x-resend-daily-quota");
    const dailyConsumed = dailyHeader !== null && !Number.isNaN(Number(dailyHeader))
        ? Number(dailyHeader)
        : null;

    const totalRecipients = countRecipients(envelopes);

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

    const json: any = await resp.json().catch(err => {
        console.error("sendEmails: sent, but the response couldn't be read", err);
        return null;
    });
    const ids: string[] = single
        ? (json?.id ? [json.id] : [])
        : (Array.isArray(json?.data) ? json.data.map((d: {id: string}) => d.id) : []);
    if (dailyConsumed === null) await rollbackQuotaReservation(totalRecipients);
    return {sentCount: envelopes.length, ids, dailyConsumed};
}
