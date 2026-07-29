import { RESEND_DAILY_CAP, RESEND_FROM_ADDRESS } from "./config";
import { applyProviderUsage } from "./quota";
import { RESEND_API_KEY } from "./resendClient";

// Describes the platform outbound mail goes through, for anything that needs
// to *talk about* sending rather than do it. The admin quota view renders
// entirely from this descriptor, so switching providers is a change here plus
// a new usage implementation — not a hunt for hardcoded "Resend" strings
// through the UI. (The send path itself still lives in resendClient.)
export interface EmailProviderInfo {
    id: string;
    // Shown to admins verbatim.
    name: string;
    dailyCap: number;
    // How the allowance refills. The panel explains "rolling24h" as capacity
    // returning gradually and "calendarDay" as a reset at a fixed boundary, so
    // a provider with different semantics only needs the right value here.
    // Also picks the window fetchProviderUsage counts over.
    windowKind: "rolling24h" | "calendarDay";
    fromAddress: string;
}

export const EMAIL_PROVIDER: EmailProviderInfo = {
    id: "resend",
    name: "Resend",
    dailyCap: RESEND_DAILY_CAP,
    // Resend's free-plan daily quota is a sliding 24h window, not a calendar
    // day — their docs say to "wait until 24 hours have passed," so allowance
    // rolls off per-email rather than resetting in a block.
    windowKind: "rolling24h",
    fromAddress: RESEND_FROM_ADDRESS,
};

const WINDOW_MS = 24 * 60 * 60 * 1000;
const LIST_URL = "https://api.resend.com/emails";
// Resend caps `limit` at 100.
const PAGE_SIZE = 100;
// Stop after this many pages so a large account can't stall the admin panel or
// burn through the request rate limit. 10 pages = 1000 emails, far above a
// plausible 24h volume here; blowing past it sets `truncated` rather than
// silently under-reporting.
const MAX_PAGES = 10;

export interface ProviderUsage {
    // Recipients charged against the current window. Counts every to/cc/bcc
    // address separately, which is how the provider meters a send: one POST
    // with 1 to + 24 cc consumes 25, not 1.
    used: number;
    // The scan stopped before reaching the window edge, so `used` is a floor
    // rather than an exact count. Callers should present it as "at least".
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

// Resend stamps `created_at` as "2026-07-25 05:22:42.561515+00" — a space
// separator and a two-digit offset, neither of which is ISO-8601. V8 happens
// to accept it today, but a parser that didn't recognize "+00" as an offset
// would read the value as *local* time and silently shift the window by the
// server's UTC offset. Normalize to something unambiguous instead of trusting
// the engine. Returns NaN on anything unparseable, which the caller skips.
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

// Read how much of the sending allowance the current window has consumed, by
// counting the provider's own record of sent mail.
//
// This replaces an earlier probe that read the x-resend-daily-quota response
// header off a cheap GET. That never worked: Resend attaches the quota headers
// to *send* responses only, and per their docs sends them "only to free plan
// users." A GET carries `ratelimit-*` (the per-second request limit) and
// nothing else, so the probe returned null on every call and the panel showed
// "Not reported" no matter what the dashboard said.
//
// GET /emails is the account-wide sent log — the same data the dashboard
// renders — so counting it works on free and paid plans alike and matches what
// an admin sees there. Results come back newest-first, so the scan stops at the
// first record older than the window instead of paging through all history.
//
// Returns null when no reading is available, which the caller must treat as
// "unknown" rather than zero:
//   - no API key bound to this function
//   - the request failed outright (network/DNS)
//   - the key lacks permission to list emails (a sending-only key gets 401/403)
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
            // A sending-only key can't list emails. Unknown, not zero — the
            // caller falls back to the cached counter rather than claiming the
            // window is empty.
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
            // Newest-first ordering means the first in-window miss ends the
            // scan. An unparseable stamp is skipped rather than ending it, so
            // one odd record can't truncate the count.
            if (Number.isNaN(createdAt)) continue;
            // Deliberately open-ended at the top: the window is [cutoff, ∞),
            // not [cutoff, now]. A send that lands while this scan is running,
            // or one stamped slightly ahead of us by clock skew, has still
            // consumed allowance. Counting it errs toward over-reporting,
            // which is the safe direction for a cap.
            if (createdAt < cutoff) return {used, truncated: false};
            // A send scheduled for later hasn't been charged yet, and a
            // canceled one never will be. Neither is in the dashboard's count.
            const scheduledAt = parseProviderTimestamp(email.scheduled_at ?? undefined);
            if (!Number.isNaN(scheduledAt) && scheduledAt > now) continue;
            if (email.last_event === "canceled") continue;

            used += countRecipientsOf(email);
        }

        if (!json.has_more) return {used, truncated: false};
        // More pages exist and we haven't reached the window edge, so whatever
        // happens from here the count is a floor. Set before the cursor check
        // so bailing on a missing id can't report a partial count as exact.
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
// The cache is only ever written as a side effect of sending, so between sends
// it drifts: Resend's window keeps rolling and old sends age out, while the
// cached number stays at its high-water mark. Worse, the reading that used to
// feed it — the x-resend-daily-quota header — never arrives on this account, so
// `confirmed` sat at 0 and the cap was effectively unenforced. Re-reading here
// closes both gaps: what gates a send is the same number the panel shows.
//
// Failure is non-fatal by design. A null reading leaves the cache untouched and
// the caller falls back to it, so a provider outage degrades to the old
// stale-cache behaviour instead of blocking mail or claiming a fresh zero.
export async function syncProviderUsage(): Promise<ProviderUsage | null> {
    const usage = await fetchProviderUsage();
    if (usage === null) return null;
    // sentDelta = 0: a scan releases no reservation of its own.
    await applyProviderUsage(usage.used, 0);
    return usage;
}
