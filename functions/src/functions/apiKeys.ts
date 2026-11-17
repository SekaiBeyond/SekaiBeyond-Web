import { HttpsError, onCall } from "firebase-functions/v2/https";
import { Timestamp } from "firebase-admin/firestore";
import { adminTransaction, requireAuth } from "../utils/auth";
import { appRecordName, appsCol, readApp, validateAppId } from "../utils/apps";
import { getEventDoc } from "../utils/events";
import { recordDoc, recordRef } from "../utils/records";
import { sanitizeDisplayText, validateDocId, validateStr, validateStringArray } from "../utils/validation";
import { API_SCOPES, type ApiKeyDoc, apiKeysCol, generateApiKey, isApiScope } from "../utils/apiKeys";

const API_KEY_NAME_MAX = 60;
const API_KEY_EVENTS_MAX = 20;
const API_KEY_EXPIRY_DAYS_DEFAULT = 365;
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

export const createApiKey = onCall({maxInstances: 10}, async (request) => {
    const uid = await requireAuth(request, "staff");

    const input = (request.data ?? {}) as {
        appId?: unknown;
        name?: unknown;
        scopes?: unknown;
        eventIds?: unknown;
        expiresInDays?: unknown;
    };
    const appId = validateAppId(input.appId);
    const name = sanitizeDisplayText(validateStr(input.name, "name", API_KEY_NAME_MAX, true));
    if (!name) throw new HttpsError("invalid-argument", "name is required.");
    if (!Array.isArray(input.scopes) || input.scopes.length === 0 || !input.scopes.every(isApiScope)) {
        throw new HttpsError("invalid-argument", `scopes must name at least one of: ${API_SCOPES.join(", ")}.`);
    }
    const requested = input.scopes as string[];
    const scopes = API_SCOPES.filter(s => requested.includes(s));
    const eventIds = validateStringArray(input.eventIds, "eventIds", API_KEY_EVENTS_MAX, 128)
        .map(id => validateDocId(id, "eventId"));
    const expiresInDays = validateExpiresInDays(input.expiresInDays);

    const {key, keyId, hint} = generateApiKey();
    const expiresAt = Timestamp.fromMillis(Date.now() + expiresInDays * DAY_MS);

    await adminTransaction(uid, async (txn, callerSnap) => {
        const [appSnap, ...found] = await Promise.all([
            txn.get(appsCol().doc(appId)),
            ...eventIds.map(id => getEventDoc(id, txn)),
        ]);
        const app = readApp(appSnap);
        if (!app) throw new HttpsError("not-found", "App not found.", {code: "unknown-app"});
        const missing = eventIds.find((_, i) => !found[i].snap.exists);
        if (missing) throw new HttpsError("not-found", `Event ${missing} not found.`, {code: "event-not-found"});

        const callerName: string = callerSnap.data()?.displayName ?? "";
        const doc: ApiKeyDoc = {
            appId,
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
            appId,
            appName: appRecordName(app, appId),
            apiKeyName: name,
            apiKeyHint: hint,
        }));
    });

    return {id: keyId, key, hint, expiresAt: expiresAt.toDate().toISOString()};
});

export const renameApiKey = onCall({maxInstances: 10}, async (request) => {
    const uid = await requireAuth(request, "staff");
    const input = (request.data ?? {}) as {keyId?: unknown; name?: unknown};
    const keyId = validateDocId(input.keyId, "keyId");
    const name = sanitizeDisplayText(validateStr(input.name, "name", API_KEY_NAME_MAX, true));
    if (!name) throw new HttpsError("invalid-argument", "name is required.");

    return adminTransaction(uid, async (txn, callerSnap) => {
        const ref = apiKeysCol().doc(keyId);
        const snap = await txn.get(ref);
        if (!snap.exists) throw new HttpsError("not-found", "API key not found.");
        const data = snap.data() as ApiKeyDoc;
        const oldName = data.name ?? "";
        if (oldName === name) return {name};

        const appSnap = data.appId ? await txn.get(appsCol().doc(data.appId)) : null;
        const callerName: string = callerSnap.data()?.displayName ?? "";
        txn.update(ref, {name});
        txn.set(recordRef(), recordDoc("api-key-rename", {
            performedBy: uid,
            performedByName: callerName,
            appId: data.appId,
            appName: appRecordName(appSnap && readApp(appSnap), data.appId),
            apiKeyName: name,
            apiKeyHint: data.hint ?? "",
            oldName,
            newName: name,
        }));
        return {name};
    });
});

export const revokeApiKey = onCall({maxInstances: 10}, async (request) => {
    const uid = await requireAuth(request, "staff");
    const input = (request.data ?? {}) as {keyId?: unknown};
    const keyId = validateDocId(input.keyId, "keyId");

    await adminTransaction(uid, async (txn, callerSnap) => {
        const ref = apiKeysCol().doc(keyId);
        const snap = await txn.get(ref);
        if (!snap.exists) throw new HttpsError("not-found", "API key not found.");
        const data = snap.data() as ApiKeyDoc;

        const appSnap = data.appId ? await txn.get(appsCol().doc(data.appId)) : null;
        const callerName: string = callerSnap.data()?.displayName ?? "";
        txn.delete(ref);
        txn.set(recordRef(), recordDoc("api-key-revoke", {
            performedBy: uid,
            performedByName: callerName,
            appId: data.appId,
            appName: appRecordName(appSnap && readApp(appSnap), data.appId),
            apiKeyName: data.name ?? "",
            apiKeyHint: data.hint ?? "",
        }));
    });
});
