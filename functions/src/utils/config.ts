import { Timestamp } from "firebase-admin/firestore";

export const PUBLIC_ORIGIN = process.env.PUBLIC_ORIGIN ?? "https://sekaibeyond.com";
// Resend's daily cap, a sliding 24-hour window on their side; the used count is
// read from Resend (fetchProviderUsage) and cached in system/resendQuota.
export const RESEND_DAILY_CAP = Number(process.env.RESEND_DAILY_CAP) || 100;
// Also sendTicketEmails' per-call attendee ceiling, so clamped to the batch
// endpoint's 100.
export const SEND_CHUNK_SIZE = Math.min(100, Number(process.env.SEND_CHUNK_SIZE) || 100);
// Once /scheduledMail is this deep, sends past the daily cap fail with
// resource-exhausted rather than vanish. scheduledMailDrain empties it every 30
// minutes.
export const RESEND_QUEUE_CAP = Number(process.env.RESEND_QUEUE_CAP) || 500;
// Mail goes from <prefix>@SENDER_DOMAIN (see getSenderAddress): the
// PUBLIC_ORIGIN host less "www.", which must be the domain verified on the
// Resend account. The prefix comes from Site Config, or DEFAULT_SENDER_PREFIX
// while blank.
export const SENDER_DOMAIN = (() => {
    try {
        return new URL(PUBLIC_ORIGIN).hostname.replace(/^www\./, "");
    } catch {
        // A bad PUBLIC_ORIGIN mustn't crash every function at load; sends fail
        // at Resend instead.
        return "";
    }
})();
export const DEFAULT_SENDER_PREFIX = "no-reply";
// A whole number from the environment, 0 allowed, or `fallback` when unset.
function envCount(name: string, fallback: number): number {
    const raw = Number(process.env[name]);
    return process.env[name] && Number.isFinite(raw) ? Math.max(0, Math.floor(raw)) : fallback;
}
// Wallet passes made in a calendar month (UTC), after which Add to Wallet says
// so until the 1st; WalletWallet's own plan limit applies too, whichever is
// lower. Defaults to the free plan's 1,000.
export const WALLET_PASS_MONTHLY_CAP = envCount("WALLET_PASS_MONTHLY_CAP", 1000);
// New passes one ticket can make in a day (SITE_TIME_ZONE). Opening its link
// again reuses its pass, so this only counts when there's none to reuse.
export const WALLET_PASS_DAILY_CAP_PER_TICKET = envCount("WALLET_PASS_DAILY_CAP_PER_TICKET", 2);
// Either cap at 0 turns passes off, and ticket emails leave out the button.
export const WALLET_PASSES_ON = WALLET_PASS_MONTHLY_CAP > 0 && WALLET_PASS_DAILY_CAP_PER_TICKET > 0;
// Who a wallet pass says issued it.
export const WALLET_PASS_ORGANIZATION = process.env.WALLET_PASS_ORGANIZATION || "Sekai Beyond";
export const IMPORT_MAX_ROWS = Number(process.env.IMPORT_MAX_ROWS) || 1000;
const RECORD_RETENTION_DAYS = 30;

export function recordExpiresAt(): Timestamp {
    return Timestamp.fromMillis(Date.now() + RECORD_RETENTION_DAYS * 24 * 60 * 60 * 1000);
}

// Kept a year so trend charts cover a full event season. The TTL policy is on
// the `scans` collection group (firestore.indexes.json).
const SCAN_RETENTION_DAYS = 365;

export function scanExpiresAt(): Timestamp {
    return Timestamp.fromMillis(Date.now() + SCAN_RETENTION_DAYS * 24 * 60 * 60 * 1000);
}

const DELETION_COOLDOWN_HOURS = 48;

export function deletionExpiresAt(): Timestamp {
    return Timestamp.fromMillis(Date.now() + DELETION_COOLDOWN_HOURS * 60 * 60 * 1000);
}

export const BATCH_LIMIT = 500;
