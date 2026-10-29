import { HttpsError, onCall } from "firebase-functions/v2/https";
import { Timestamp } from "firebase-admin/firestore";
import { adminTransaction, requireAdmin, requireAuth } from "../utils/auth";
import { getEventInTxn } from "../utils/events";
import { recordDoc, recordRef } from "../utils/records";
import { sanitizeDisplayText, validateDocId, validateStr, validateStringArray } from "../utils/validation";
import { API_SCOPES, type ApiKeyDoc, apiKeysCol, generateApiKey, isApiScope } from "../utils/apiKeys";

const API_KEY_NAME_MAX = 60;
/** Events one key may be held to; past this, it may as well have all of them. */
const API_KEY_EVENTS_MAX = 20;
const API_KEY_EXPIRY_DAYS_DEFAULT = 365;
/** No key lives forever, so a forgotten one lapses on its own. */
const API_KEY_EXPIRY_DAYS_MAX = 730;

const DAY_MS = 24 * 60 * 60 * 1000;

function validateExpiresInDays(value: unknown): number {
    if (value === undefined || value === null) return API_KEY_EXPIRY_DAYS_DEFAULT;
    if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > API_KEY_EXPIRY_DAYS_MAX) {
        throw new HttpsError("invalid-argument",
            `expiresInDays must be an integer between 1 and ${API_KEY_EXPIRY_DAYS_MAX}.`);
    }
    return value;
}

const isoOrNull = (t: unknown) => t instanceof Timestamp ? t.toDate().toISOString() : null;

/**
 * A key a seller's server calls the API with (see api.ts). Core-staff and above
 * only. The key is in the reply and nowhere else.
 *
 * Keys belong to the club, not to whoever made them, so one keeps working when
 * its maker steps down, and any core-staff can revoke it.
 */
export const createApiKey = onCall({maxInstances: 10}, async (request) => {
    const uid = await requireAuth(request, "staff");

    const input = request.data as {name?: unknown; scopes?: unknown; eventIds?: unknown; expiresInDays?: unknown};
    const name = sanitizeDisplayText(validateStr(input.name, "name", API_KEY_NAME_MAX, true));
    if (!name) throw new HttpsError("invalid-argument", "name is required.");
    if (!Array.isArray(input.scopes) || input.scopes.length === 0 || !input.scopes.every(isApiScope)) {
        throw new HttpsError("invalid-argument", `scopes must name at least one of: ${API_SCOPES.join(", ")}.`);
    }
    // In API_SCOPES order and once each, however they came.
    const requested = input.scopes as string[];
    const scopes = API_SCOPES.filter(s => requested.includes(s));
    const eventIds = validateStringArray(input.eventIds, "eventIds", API_KEY_EVENTS_MAX, 128)
        .map(id => validateDocId(id, "eventId"));
    const expiresInDays = validateExpiresInDays(input.expiresInDays);

    const {key, keyId, hint} = generateApiKey();
    const expiresAt = Timestamp.fromMillis(Date.now() + expiresInDays * DAY_MS);

    await adminTransaction(uid, async (txn, callerSnap) => {
        // A key held to an event that isn't there would be refused everywhere.
        // Archived or not: archiving keeps the ID, so the hold carries over.
        const found = await Promise.all(eventIds.map(id => getEventInTxn(txn, id)));
        const missing = eventIds.find((_, i) => !found[i].snap.exists);
        if (missing) throw new HttpsError("not-found", `Event ${missing} not found.`);

        const callerName: string = callerSnap.data()?.displayName ?? "";
        const doc: ApiKeyDoc = {
            name,
            hint,
            scopes,
            eventIds,
            createdBy: uid,
            createdByName: callerName,
            createdAt: Timestamp.now(),
            expiresAt,
            lastUsedAt: null,
        };
        txn.create(apiKeysCol().doc(keyId), doc);
        txn.set(recordRef(), recordDoc("api-key-create", {
            performedBy: uid,
            performedByName: callerName,
            apiKeyName: name,
            apiKeyHint: hint,
        }));
    });

    return {id: keyId, key, hint, expiresAt: expiresAt.toDate().toISOString()};
});

/** Every key, expired ones too, newest first. Never the key itself, which isn't kept. */
export const listApiKeys = onCall({maxInstances: 10}, async (request) => {
    const uid = await requireAuth(request, "staff");
    await requireAdmin(uid);

    const snap = await apiKeysCol().orderBy("createdAt", "desc").get();
    const keys = snap.docs.map(doc => {
        const data = doc.data() as ApiKeyDoc;
        return {
            id: doc.id,
            name: data.name ?? "",
            hint: data.hint ?? "",
            scopes: data.scopes ?? [],
            eventIds: data.eventIds ?? [],
            createdByName: data.createdByName ?? "",
            createdAt: isoOrNull(data.createdAt),
            expiresAt: isoOrNull(data.expiresAt),
            revokedAt: isoOrNull(data.revokedAt),
            revokedByName: data.revokedByName ?? "",
            lastUsedAt: isoOrNull(data.lastUsedAt),
        };
    });
    return {keys, serverNow: new Date().toISOString()};
});

/**
 * Stops a key working at once and deletes it, so it leaves the list. Records
 * keep its name and hint. Expired keys go the same way.
 */
export const revokeApiKey = onCall({maxInstances: 10}, async (request) => {
    const uid = await requireAuth(request, "staff");
    const input = request.data as {keyId?: unknown};
    const keyId = validateDocId(input.keyId, "keyId");

    return adminTransaction(uid, async (txn, callerSnap) => {
        const ref = apiKeysCol().doc(keyId);
        const snap = await txn.get(ref);
        if (!snap.exists) throw new HttpsError("not-found", "API key not found.");
        const data = snap.data() as ApiKeyDoc;

        const callerName: string = callerSnap.data()?.displayName ?? "";
        txn.delete(ref);
        txn.set(recordRef(), recordDoc("api-key-revoke", {
            performedBy: uid,
            performedByName: callerName,
            apiKeyName: data.name ?? "",
            apiKeyHint: data.hint ?? "",
        }));
        return {revoked: true};
    });
});
