import { Timestamp } from "firebase-admin/firestore";

export const PUBLIC_ORIGIN = process.env.PUBLIC_ORIGIN ?? "https://sekaibeyond.com";
export const RESEND_DAILY_CAP = Number(process.env.RESEND_DAILY_CAP) || 100;
export const SEND_CHUNK_SIZE = Number(process.env.SEND_CHUNK_SIZE) || 100;
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
