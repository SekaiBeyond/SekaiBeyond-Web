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
    /** Total to/cc/bcc recipients charged against the current window. */
    used: number;
    /** True when pagination stopped before reaching the start of the window. */
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

// Resend stamps `created_at` as "2026-07-25 05:22:42.561515+00", which isn't
// ISO-8601; a parser that missed the "+00" would read local time and shift the
// window. Normalized rather than trusting the engine. NaN when unparseable.
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

// How much of the allowance the current window has used, counted from GET
// /emails, the account-wide sent log the dashboard shows. It works on every
// plan, unlike the quota header, which comes only on free-plan send responses.
// Newest first, so the scan stops at the first record older than the window.
//
// Null means unknown, never zero: no API key bound, the request failed, or the
// key can't list emails (a sending-only key gets 401/403).
export async function fetchProviderUsage(): Promise<ProviderUsage | null> {
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
            // A sending-only key can't list emails: unknown, so the caller
            // falls back to the cache.
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
            // An unparseable stamp is skipped, so one odd record can't cut the
            // count short.
            if (Number.isNaN(createdAt)) continue;
            // Open-ended at the top: a send landing mid-scan, or stamped ahead
            // by clock skew, has still used allowance. Over-counting is the
            // safe side for a cap.
            if (createdAt < cutoff) return {used, truncated: false};
            // Scheduled and canceled sends aren't charged, and the dashboard
            // doesn't count them.
            const scheduledAt = parseProviderTimestamp(email.scheduled_at ?? undefined);
            if (!Number.isNaN(scheduledAt) && scheduledAt > now) continue;
            if (email.last_event === "canceled") continue;

            used += countRecipientsOf(email);
        }

        if (!json.has_more) return {used, truncated: false};
        // More pages and no window edge yet: the count is a floor. Set before
        // the cursor check, so bailing on a missing id can't report it as
        // exact.
        truncated = true;
        after = batch[batch.length - 1]?.id;
        // No cursor to advance on — bail rather than refetch page 0 forever.
        if (!after) break;
    }

    return {used, truncated};
}

// Re-anchor the cached `confirmed` counter against the provider before a quota
// decision, and report the reading.
//
// The cache is otherwise only written by sends, so between them it sits at its
// high-water mark while the window rolls on, and without the quota header it is
// never written at all. Re-reading means what gates a send is the number the
// panel shows.
//
// A null reading leaves the cache as it is for the caller to fall back on, so
// an outage neither blocks mail nor claims a fresh zero.
export async function syncProviderUsage(): Promise<ProviderUsage | null> {
    const usage = await fetchProviderUsage();
    if (usage === null) return null;
    // sentDelta = 0: a scan releases no reservation of its own.
    await applyProviderUsage(usage.used, 0);
    return usage;
}
