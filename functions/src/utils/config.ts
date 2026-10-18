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
