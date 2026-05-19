import { Timestamp } from "firebase-admin/firestore";

export const PUBLIC_ORIGIN = process.env.PUBLIC_ORIGIN ?? "https://sekaibeyond.com";
export const RESEND_DAILY_CAP = Number(process.env.RESEND_DAILY_CAP) || 100;
export const SEND_CHUNK_SIZE = Number(process.env.SEND_CHUNK_SIZE) || 100;
// Hard cap on /scheduledMail depth. Once full, sends past the daily cap are
// rejected (callable throws resource-exhausted) rather than silently swallowed.
// Drained by the scheduledMailDrain function at 00:05 America/Los_Angeles.
export const RESEND_QUEUE_CAP = Number(process.env.RESEND_QUEUE_CAP) || 500;
// Spacing between mail-doc writes so the email extension's onCreate triggers
// don't fan out faster than Resend's POST /emails limit (5 req/sec). 300ms ≈
// 3.3/sec — safe headroom even when two admins send at once.
export const RESEND_SEND_INTERVAL_MS = Number(process.env.RESEND_SEND_INTERVAL_MS) || 300;
export const IMPORT_MAX_ROWS = Number(process.env.IMPORT_MAX_ROWS) || 1000;
export const RECORD_RETENTION_DAYS = 30;

export function recordExpiresAt(): Timestamp {
    return Timestamp.fromMillis(Date.now() + RECORD_RETENTION_DAYS * 24 * 60 * 60 * 1000);
}

export const DELETION_COOLDOWN_HOURS = 48;

export function deletionExpiresAt(): Timestamp {
    return Timestamp.fromMillis(Date.now() + DELETION_COOLDOWN_HOURS * 60 * 60 * 1000);
}

export const BATCH_LIMIT = 500;
