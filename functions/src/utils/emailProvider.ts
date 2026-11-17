import { RESEND_DAILY_CAP } from "./config";
import { applyProviderUsage } from "./quota";
import { RESEND_API_KEY } from "./resendClient";

interface EmailProviderInfo {
    name: string;
    dailyCap: number;
    windowKind: "rolling24h" | "calendarDay";
}

export const EMAIL_PROVIDER: EmailProviderInfo = {
    name: "Resend",
    dailyCap: RESEND_DAILY_CAP,
    windowKind: "rolling24h",
};

const WINDOW_MS = 24 * 60 * 60 * 1000;
const LIST_URL = "https://api.resend.com/emails";
const PAGE_SIZE = 100;
const MAX_PAGES = 10;

interface ProviderUsage {
    used: number;
    truncated: boolean;
}

interface ListedEmail {
    id?: string;
    created_at?: string;
    scheduled_at?: string | null;
    last_event?: string | null;
    to?: string[] | null;
    cc?: string[] | null;
    bcc?: string[] | null;
}

function parseProviderTimestamp(raw: string | undefined): number {
    if (!raw) return NaN;
    const iso = raw
        .replace(" ", "T")
        .replace(/([+-]\d{2})$/, "$1:00");
    return Date.parse(iso);
}

function countRecipientsOf(email: ListedEmail): number {
    return (email.to?.length ?? 0)
        + (email.cc?.length ?? 0)
        + (email.bcc?.length ?? 0);
}

async function fetchProviderUsage(): Promise<ProviderUsage | null> {
    if (process.env.FUNCTIONS_EMULATOR === "true") return null;

    const apiKey = RESEND_API_KEY.value();
    if (!apiKey) return null;

    const now = Date.now();
    const cutoff = EMAIL_PROVIDER.windowKind === "rolling24h"
        ? now - WINDOW_MS
        : new Date(new Date(now).toISOString().slice(0, 10) + "T00:00:00Z").getTime();

    let used = 0;
    let after: string | undefined;
    let truncated = false;

    for (let page = 0; page < MAX_PAGES; page++) {
        const url = `${LIST_URL}?limit=${PAGE_SIZE}${after ? `&after=${after}` : ""}`;

        let resp: Response;
        try {
            resp = await fetch(url, {
                method: "GET",
                headers: {Authorization: `Bearer ${apiKey}`},
            });
        } catch (err) {
            console.error("fetchProviderUsage: request failed", err);
            return null;
        }

        if (!resp.ok) {
            console.error(`fetchProviderUsage: list failed ${resp.status}`);
            return null;
        }

        let json: {data?: ListedEmail[]; has_more?: boolean};
        try {
            json = await resp.json() as typeof json;
        } catch (err) {
            console.error("fetchProviderUsage: parse failed", err);
            return null;
        }

        const batch = json.data ?? [];
        if (batch.length === 0) return {used, truncated};

        for (const email of batch) {
            const createdAt = parseProviderTimestamp(email.created_at);
            if (Number.isNaN(createdAt)) continue;
            if (createdAt < cutoff) return {used, truncated: false};
            const scheduledAt = parseProviderTimestamp(email.scheduled_at ?? undefined);
            if (!Number.isNaN(scheduledAt) && scheduledAt > now) continue;
            if (email.last_event === "canceled") continue;

            used += countRecipientsOf(email);
        }

        if (!json.has_more) return {used, truncated: false};
        truncated = true;
        after = batch[batch.length - 1]?.id;
        if (!after) break;
    }

    return {used, truncated};
}

export async function syncProviderUsage(): Promise<ProviderUsage | null> {
    const usage = await fetchProviderUsage();
    if (usage === null) return null;
    await applyProviderUsage(usage.used, 0);
    return usage;
}
