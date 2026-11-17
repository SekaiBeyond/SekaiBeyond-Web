import * as crypto from "crypto";
import type { Timestamp } from "firebase-admin/firestore";
import { db } from "./firebase";

export const API_SCOPES = [
    "events:read", "team:read", "event-staff:read", "tickets:read", "tickets:write", "account-links",
] as const;
export type ApiScope = typeof API_SCOPES[number];

export function isApiScope(raw: unknown): raw is ApiScope {
    return typeof raw === "string" && (API_SCOPES as readonly string[]).includes(raw);
}

const API_KEY_PREFIX = "sbk_";

const API_KEY_RE = /^sbk_[A-Za-z0-9_-]{43}$/;

export function isApiKeyShaped(key: string): boolean {
    return API_KEY_RE.test(key);
}

export interface ApiKeyDoc {
    appId: string;
    name: string;
    hint: string;
    scopes: ApiScope[];
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

export function generateApiKey(): {key: string; keyId: string; hint: string} {
    const key = API_KEY_PREFIX + crypto.randomBytes(32).toString("base64url");
    const hint = `${key.slice(0, API_KEY_PREFIX.length + 4)}…${key.slice(-4)}`;
    return {key, keyId: hashApiKey(key), hint};
}
