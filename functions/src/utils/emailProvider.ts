import { RESEND_DAILY_CAP, RESEND_FROM_ADDRESS } from "./config";
import { RESEND_API_KEY } from "./resendClient";

// Describes the platform outbound mail goes through, for anything that needs
// to *talk about* sending rather than do it. The admin quota view renders
// entirely from this descriptor, so switching providers is a change here plus
// a new probe implementation — not a hunt for hardcoded "Resend" strings
// through the UI. (The send path itself still lives in resendClient.)
export interface EmailProviderInfo {
    id: string;
    // Shown to admins verbatim.
    name: string;
    dailyCap: number;
    // How the allowance refills. The panel explains "rolling24h" as capacity
    // returning gradually and "calendarDay" as a reset at a fixed boundary, so
    // a provider with different semantics only needs the right value here.
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

// Any authenticated endpoint works — we want the response headers, not the
// body. /domains is a plain read with no side effects.
const PROBE_URL = "https://api.resend.com/domains";
const DAILY_QUOTA_HEADER = "x-resend-daily-quota";

// Read the provider's own used-quota count *without sending mail*.
//
// This exists because the cached counter in system/resendQuota is only written
// as a side effect of a send: it is a high-water snapshot from the last time we
// posted to Resend, and it never decays. Resend's rolling window keeps rolling
// after that, so between sends the cache drifts above the real usage — which is
// exactly the gap an admin sees against the Resend dashboard. Probing on read
// closes it.
//
// Resend documents the rate-limit/quota headers as accompanying every request,
// so a cheap GET carries the same x-resend-daily-quota value a send would. The
// header is read regardless of status code (the send path does the same — a 401
// or 429 still carries it), so an API key scoped to sending-only, which can't
// list domains, still yields a usable reading.
//
// Returns null when no reading is available, which the caller must treat as
// "unknown" rather than zero:
//   - no API key bound to this function
//   - the request failed outright (network/DNS)
//   - the provider sent no quota header. Normal on Resend's paid plans, where
//     the daily quota — and therefore this whole cap — stops applying.
export async function probeProviderQuota(): Promise<number | null> {
    const apiKey = RESEND_API_KEY.value();
    if (!apiKey) return null;

    let resp: Response;
    try {
        resp = await fetch(PROBE_URL, {
            method: "GET",
            headers: {Authorization: `Bearer ${apiKey}`},
        });
    } catch (err) {
        console.error("probeProviderQuota: request failed", err);
        return null;
    }

    const raw = resp.headers.get(DAILY_QUOTA_HEADER);
    if (raw === null) return null;
    const used = Number(raw);
    return Number.isFinite(used) ? Math.max(0, used) : null;
}
