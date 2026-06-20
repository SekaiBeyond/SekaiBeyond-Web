import { HttpsError } from "firebase-functions/v2/https";
import { getStorage } from "firebase-admin/storage";

export const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})?)?$/;

export function validateISODate(value: unknown, name: string): string | null {
    if (value === undefined || value === null || value === "") return null;
    if (typeof value !== "string" || !ISO_DATE_RE.test(value) || isNaN(Date.parse(value))) {
        throw new HttpsError("invalid-argument", `Invalid ${name}: must be an ISO 8601 date string.`);
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
            url.protocol !== "https:"
            || url.hostname !== "firebasestorage.googleapis.com"
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
