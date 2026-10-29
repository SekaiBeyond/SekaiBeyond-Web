import { HttpsError } from "firebase-functions/v2/https";
import { getStorage } from "firebase-admin/storage";
import { STORAGE_ORIGIN } from "./storage";

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})?)?$/;

export function validateISODate(value: unknown, name: string): string | null {
    if (value === undefined || value === null || value === "") return null;
    if (typeof value !== "string" || !ISO_DATE_RE.test(value) || isNaN(Date.parse(value))) {
        throw new HttpsError("invalid-argument", `Invalid ${name}: must be an ISO 8601 date string.`);
    }
    return value;
}

/**
 * A day as YYYY-MM-DD, as a date input gives it, that's on the calendar. The
 * padding is what lets past events sort as strings.
 */
export function validateDay(value: unknown, name: string): string {
    const day = typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : "";
    // Date.parse rolls 2024-02-30 over into March, so the round trip catches it.
    const parsed = day ? new Date(`${day}T00:00:00Z`) : null;
    if (!parsed || isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== day) {
        throw new HttpsError("invalid-argument", `Invalid ${name}: must be a date as YYYY-MM-DD.`);
    }
    return day;
}

/**
 * An ISO date-time that names its zone (Z or an offset). A zoneless one is
 * refused rather than read as UTC, which is never the clock it was typed on.
 * Null when absent.
 */
export function validateInstant(value: unknown, name: string): string | null {
    const iso = validateISODate(value, name);
    if (iso && !/(Z|[+-]\d{2}:\d{2})$/.test(iso)) {
        throw new HttpsError("invalid-argument", `Invalid ${name}: must name its time zone.`);
    }
    return iso;
}

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Trimmed and lowercased. */
export function validateEmail(value: unknown, name: string): string {
    if (typeof value !== "string") {
        throw new HttpsError("invalid-argument", `Invalid ${name}.`);
    }
    const normalized = value.trim().toLowerCase();
    if (normalized.length === 0 || normalized.length > 320 || !EMAIL_RE.test(normalized)) {
        throw new HttpsError("invalid-argument", `Invalid ${name}.`);
    }
    return normalized;
}

/** validateEmail for an address that may be left out: "" when missing or blank. */
export function validateOptionalEmail(value: unknown, name: string): string {
    if (value == null || (typeof value === "string" && value.trim() === "")) return "";
    return validateEmail(value, name);
}

// The part before the @ on our own domain: letters, digits and single . _ + -
// between them, narrower than RFC 5322 so every mail system accepts it.
const SENDER_PREFIX_RE = /^[a-z0-9]+(?:[._+-][a-z0-9]+)*$/;

/** Trimmed and lowercased. */
export function validateSenderPrefix(value: unknown, name: string): string {
    if (typeof value !== "string") {
        throw new HttpsError("invalid-argument", `Invalid ${name}.`);
    }
    const normalized = value.trim().toLowerCase();
    if (normalized.length === 0 || normalized.length > 64 || !SENDER_PREFIX_RE.test(normalized)) {
        throw new HttpsError("invalid-argument",
            `Invalid ${name}: use letters, digits, and . _ + - between them.`);
    }
    return normalized;
}

export function validateCoordinate(value: unknown, name: string, min: number, max: number): number {
    if (typeof value !== "number" || !Number.isFinite(value)) {
        throw new HttpsError("invalid-argument", `Invalid ${name}: must be a number.`);
    }
    if (value < min || value > max) {
        throw new HttpsError("invalid-argument", `Invalid ${name}: out of range.`);
    }
    return value;
}

export function validateBoolean(value: unknown, name: string): boolean {
    if (typeof value !== "boolean") {
        throw new HttpsError("invalid-argument", `${name} must be a boolean.`);
    }
    return value;
}

export function validateMaxUses(value: unknown): number {
    if (value === undefined || value === null) return 0;
    if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
        throw new HttpsError("invalid-argument", "Invalid maxUses: must be a non-negative integer.");
    }
    return value;
}

export function validateDocId(value: unknown, name: string): string {
    if (typeof value !== "string" || value.length === 0 || value.length > 128) {
        throw new HttpsError("invalid-argument", `Invalid ${name}.`);
    }
    if (/[\/\0]/.test(value)) {
        throw new HttpsError("invalid-argument", `Invalid ${name}: illegal characters.`);
    }
    return value;
}

export function validateUrl(value: string, name: string): void {
    if (!value) return;
    try {
        const url = new URL(value);
        if (url.protocol !== "https:") {
            throw new HttpsError("invalid-argument", `${name} must use https://.`);
        }
    } catch (e) {
        if (e instanceof HttpsError) throw e;
        throw new HttpsError("invalid-argument", `${name} must be a valid URL.`);
    }
}

export function validateStorageImageUrl(value: string, name: string): void {
    if (!value) return;
    try {
        const url = new URL(value);
        const expectedPrefix = `/v0/b/${getStorage().bucket().name}/o/`;
        if (
            url.origin !== STORAGE_ORIGIN
            || !url.pathname.startsWith(expectedPrefix)
        ) {
            throw new HttpsError("invalid-argument", `${name} must be a Firebase Storage URL for this project.`);
        }
    } catch (e) {
        if (e instanceof HttpsError) throw e;
        throw new HttpsError("invalid-argument", `${name} must be a valid URL.`);
    }
}

export function validateStr(value: unknown, name: string, maxLen: number, required = false): string {
    if (value === undefined || value === null) value = "";
    if (typeof value !== "string") {
        throw new HttpsError("invalid-argument", `Invalid ${name}.`);
    }
    if (required && value.trim().length === 0) {
        throw new HttpsError("invalid-argument", `${name} is required.`);
    }
    if (value.length > maxLen) {
        throw new HttpsError("invalid-argument", `${name} exceeds maximum length.`);
    }
    return value;
}

export function validateStringArray(
    value: unknown,
    name: string,
    maxItems: number,
    maxLen: number,
): string[] {
    if (value === undefined || value === null) return [];
    if (!Array.isArray(value)) {
        throw new HttpsError("invalid-argument", `Invalid ${name}: must be an array.`);
    }
    if (value.length > maxItems) {
        throw new HttpsError("invalid-argument", `${name} has too many items.`);
    }
    const seen = new Set<string>();
    const out: string[] = [];
    for (const item of value) {
        if (typeof item !== "string") {
            throw new HttpsError("invalid-argument", `Invalid ${name}: items must be strings.`);
        }
        if (item.length > maxLen) {
            throw new HttpsError("invalid-argument", `${name} item exceeds maximum length.`);
        }
        if (item && !seen.has(item)) {
            seen.add(item);
            out.push(item);
        }
    }
    return out;
}

export function sanitizeDisplayText(value: string): string {
    return value.replace(/<[^>]*>/g, "").replace(/[\x00-\x1F\x7F]/g, " ").trim();
}
