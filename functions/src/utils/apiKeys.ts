import * as crypto from "crypto";
import type { Timestamp } from "firebase-admin/firestore";
import { db } from "./firebase";

/** What a key may do. Each API route names the one it needs (see functions/api.ts). */
export const API_SCOPES = ["events:read", "tickets:read", "tickets:write"] as const;
export type ApiScope = typeof API_SCOPES[number];

export function isApiScope(raw: unknown): raw is ApiScope {
    return typeof raw === "string" && (API_SCOPES as readonly string[]).includes(raw);
}

/** Marks a key as ours wherever it turns up, in a config file or a leaked paste. */
const API_KEY_PREFIX = "sbk_";

/** What generateApiKey makes: the prefix and 32 random bytes in base64url. */
const API_KEY_RE = /^sbk_[A-Za-z0-9_-]{43}$/;

/** Whether `key` could be one of ours, so anything else is turned away without a read. */
export function isApiKeyShaped(key: string): boolean {
    return API_KEY_RE.test(key);
}

/**
 * An `apiKeys` doc, stored under the key's SHA-256: the key itself is never
 * kept, so a lost one is revoked and replaced rather than looked up. Each key
 * belongs to a registered app (see apps.ts), whose ID namespaces the orders it
 * places (see apiOrderAttendeeId), so a replacement key under the same app
 * finds the orders the old one placed, and two apps' order numbers never meet.
 * Server only (see firestore.rules).
 */
export interface ApiKeyDoc {
    /** The registered app (see apps.ts) this key belongs to. */
    appId: string;
    name: string;
    /** The key's first and last few characters, for telling keys apart. */
    hint: string;
    scopes: ApiScope[];
    /** The only events the key may touch; empty for all of them. */
    eventIds: string[];
    createdBy: string;
    createdByName: string;
    createdAt: Timestamp;
    expiresAt: Timestamp;
    lastUsedAt: Timestamp | null;
}

export const apiKeysCol = () => db.collection("apiKeys");

export function hashApiKey(key: string): string {
    return crypto.createHash("sha256").update(key).digest("hex");
}

/**
 * A new key, with the ID it's stored under. 256 random bits, so an unsalted
 * hash is enough: there's no guessable input to precompute.
 */
export function generateApiKey(): {key: string; keyId: string; hint: string} {
    const key = API_KEY_PREFIX + crypto.randomBytes(32).toString("base64url");
    const hint = `${key.slice(0, API_KEY_PREFIX.length + 4)}…${key.slice(-4)}`;
    return {key, keyId: hashApiKey(key), hint};
}
