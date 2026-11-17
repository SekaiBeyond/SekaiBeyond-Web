import { Timestamp } from "firebase-admin/firestore";

export const PUBLIC_ORIGIN = process.env.PUBLIC_ORIGIN ?? "https://sekaibeyond.com";
export const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID ?? "";
export const RESEND_DAILY_CAP = Number(process.env.RESEND_DAILY_CAP) || 100;
export const SEND_CHUNK_SIZE = Math.min(100, Number(process.env.SEND_CHUNK_SIZE) || 100);
export const RESEND_QUEUE_CAP = Number(process.env.RESEND_QUEUE_CAP) || 500;
export const SENDER_DOMAIN = (() => {
    try {
        return new URL(PUBLIC_ORIGIN).hostname.replace(/^www\./, "");
    } catch {
        return "";
    }
})();
export const DEFAULT_SENDER_PREFIX = "no-reply";

function envCount(name: string, fallback: number): number {
    const raw = Number(process.env[name]);
    return process.env[name] && Number.isFinite(raw) ? Math.max(0, Math.floor(raw)) : fallback;
}

const ACCOUNT_MAIL_RESERVE = Math.min(envCount("ACCOUNT_MAIL_RESERVE", 20), Math.floor(RESEND_DAILY_CAP / 2));
export const BULK_MAIL_CAP = RESEND_DAILY_CAP - ACCOUNT_MAIL_RESERVE;
export const NOTICE_MAIL_RESERVE = Math.min(envCount("NOTICE_MAIL_RESERVE", 10), Math.floor(RESEND_DAILY_CAP / 5));
export const CODE_MAIL_HOURLY_CAP = Math.max(1, envCount("CODE_MAIL_HOURLY_CAP",
    Math.max(10, Math.floor(RESEND_DAILY_CAP / 5))));

export const WALLET_PASS_MONTHLY_CAP = envCount("WALLET_PASS_MONTHLY_CAP", 1000);
export const WALLET_PASS_DAILY_CAP_PER_TICKET = envCount("WALLET_PASS_DAILY_CAP_PER_TICKET", 2);
export const WALLET_PASSES_ON = WALLET_PASS_MONTHLY_CAP > 0 && WALLET_PASS_DAILY_CAP_PER_TICKET > 0;
export const WALLET_PASS_ORGANIZATION = process.env.WALLET_PASS_ORGANIZATION || "Sekai Beyond";
export const IMPORT_MAX_ROWS = Number(process.env.IMPORT_MAX_ROWS) || 1000;
const RECORD_RETENTION_DAYS = 30;

export function recordExpiresAt(): Timestamp {
    return Timestamp.fromMillis(Date.now() + RECORD_RETENTION_DAYS * 24 * 60 * 60 * 1000);
}

const SCAN_RETENTION_DAYS = 365;

export function scanExpiresAt(): Timestamp {
    return Timestamp.fromMillis(Date.now() + SCAN_RETENTION_DAYS * 24 * 60 * 60 * 1000);
}

const DELETION_COOLDOWN_HOURS = 48;

export function deletionExpiresAt(): Timestamp {
    return Timestamp.fromMillis(Date.now() + DELETION_COOLDOWN_HOURS * 60 * 60 * 1000);
}

export const BATCH_LIMIT = 500;
