import { Timestamp } from "firebase-admin/firestore";

export const PUBLIC_ORIGIN = process.env.PUBLIC_ORIGIN ?? "https://sekaibeyond.com";
// Resend free-plan daily cap. Tracked as a sliding 24h window on Resend's
// side — we don't reset this on calendar boundaries; we read the consumed
// count back from response headers and store it in system/resendQuota.
export const RESEND_DAILY_CAP = Number(process.env.RESEND_DAILY_CAP) || 100;
// Resend's batch endpoint caps at 100 envelopes per call; SEND_CHUNK_SIZE
// is also the per-call attendee ceiling for sendTicketEmails, so it is
// clamped to 100 — a larger value would make sendEmails reject the batch.
export const SEND_CHUNK_SIZE = Math.min(100, Number(process.env.SEND_CHUNK_SIZE) || 100);
// Hard cap on /scheduledMail depth. Once full, sends past the daily cap are
// rejected (callable throws resource-exhausted) rather than silently swallowed.
// Drained every 30 min by the scheduledMailDrain function.
export const RESEND_QUEUE_CAP = Number(process.env.RESEND_QUEUE_CAP) || 500;
// Verified sender address on the Resend account. All outbound mail uses this
// as the From header — direct API calls don't accept anything that isn't a
// verified domain.
export const RESEND_FROM_ADDRESS = process.env.RESEND_FROM_ADDRESS ?? "mika@sekaibeyond.com";
export const IMPORT_MAX_ROWS = Number(process.env.IMPORT_MAX_ROWS) || 1000;
export const RECORD_RETENTION_DAYS = 30;

export function recordExpiresAt(): Timestamp {
    return Timestamp.fromMillis(Date.now() + RECORD_RETENTION_DAYS * 24 * 60 * 60 * 1000);
}

// Individual QR-scan events are kept for a year so trend charts stay useful
// across a full event season, then auto-expire via the `scans` TTL policy.
export const QR_SCAN_RETENTION_DAYS = 365;

export function qrScanExpiresAt(): Timestamp {
    return Timestamp.fromMillis(Date.now() + QR_SCAN_RETENTION_DAYS * 24 * 60 * 60 * 1000);
}

export const DELETION_COOLDOWN_HOURS = 48;

export function deletionExpiresAt(): Timestamp {
    return Timestamp.fromMillis(Date.now() + DELETION_COOLDOWN_HOURS * 60 * 60 * 1000);
}

export const BATCH_LIMIT = 500;
