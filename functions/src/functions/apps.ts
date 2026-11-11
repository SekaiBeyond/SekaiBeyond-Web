import { HttpsError, onCall } from "firebase-functions/v2/https";
import { Timestamp } from "firebase-admin/firestore";
import { GoogleAuth } from "google-auth-library";
import { adminTransaction, normalizeGroup, requireAdmin, requireAuth } from "../utils/auth";
import {
    APP_ID_RE,
    APP_REDIRECT_URIS_MAX,
    APP_SCOPES,
    appsCol,
    FIREBASE_PROJECT_ID_RE,
    isAppScope,
    mintAppToken,
    normalizeRedirectUri,
    readApp,
    type RegisteredApp,
    SERVICE_ACCOUNT_RE,
} from "../utils/apps";
import { db } from "../utils/firebase";
import { recordDoc, recordRef } from "../utils/records";
import { sanitizeDisplayText, validateDocId, validateStr } from "../utils/validation";

/**
 * Registering apps people sign in to with their accounts here (see
 * utils/apps.ts), and signing them in. Registering is core staff's, as API
 * keys are: an app is the club's arrangement with its owner, and only decides
 * what the site tells the app and serves it. What the app does with that, and
 * who may do what in it, is its own business.
 */

const APP_NAME_MAX = 60;

const isoOrNull = (t: unknown) => t instanceof Timestamp ? t.toDate().toISOString() : null;

interface AppInput {
    name: string;
    ownerUid: string;
    redirectUris: string[];
    scopes: (typeof APP_SCOPES)[number][];
    firebaseProjectId: string;
    serviceAccount: string;
}

function parseAppInput(raw: unknown): AppInput {
    const input = (raw ?? {}) as Record<string, unknown>;
    const name = sanitizeDisplayText(validateStr(input.name, "name", APP_NAME_MAX, true));
    if (!name) throw new HttpsError("invalid-argument", "name is required.");

    const ownerUid = input.ownerUid === undefined || input.ownerUid === "" ? "" : validateDocId(input.ownerUid, "ownerUid");

    if (!Array.isArray(input.redirectUris) || input.redirectUris.length === 0
        || input.redirectUris.length > APP_REDIRECT_URIS_MAX) {
        throw new HttpsError("invalid-argument",
            `redirectUris must list 1–${APP_REDIRECT_URIS_MAX} places sign-in may hand back to.`);
    }
    const redirectUris = [...new Set(input.redirectUris.map(uri => {
        const normalized = normalizeRedirectUri(uri);
        if (!normalized) {
            throw new HttpsError("invalid-argument",
                "Each redirect URI must be an https URL, or http on localhost or 127.0.0.1, with no #fragment.");
        }
        return normalized;
    }))];

    if (!Array.isArray(input.scopes) || !input.scopes.every(isAppScope)) {
        throw new HttpsError("invalid-argument", `scopes may only name: ${APP_SCOPES.join(", ")}.`);
    }
    // In APP_SCOPES order and once each, however they came. None is fine: the
    // app then gets who someone is and nothing else.
    const scopes = APP_SCOPES.filter(s => (input.scopes as string[]).includes(s));

    if (typeof input.firebaseProjectId !== "string" || !FIREBASE_PROJECT_ID_RE.test(input.firebaseProjectId)) {
        throw new HttpsError("invalid-argument", "firebaseProjectId must be a Firebase project ID.");
    }
    if (typeof input.serviceAccount !== "string" || !SERVICE_ACCOUNT_RE.test(input.serviceAccount)) {
        throw new HttpsError("invalid-argument", "serviceAccount must be a service account's address.");
    }
    return {
        name,
        ownerUid,
        redirectUris,
        scopes,
        firebaseProjectId: input.firebaseProjectId,
        serviceAccount: input.serviceAccount,
    };
}

function validateAppId(raw: unknown): string {
    if (typeof raw !== "string" || !APP_ID_RE.test(raw)) {
        throw new HttpsError("invalid-argument", "appId must be 1–32 lowercase letters, digits and -.");
    }
    return raw;
}

let signer: Promise<string> | null = null;

/**
 * The service account this project's functions run as, which an app's owner
 * grants roles to, or "" where it can't be told, as in the emulator.
 */
function signerAccount(): Promise<string> {
    signer ??= new GoogleAuth().getCredentials()
        .then(credentials => credentials.client_email ?? "")
        .catch(() => "");
    return signer;
}

/** Every app, newest first, with its owner's name, and the account owners grant roles to. Core staff only. */
export const listApps = onCall({maxInstances: 10}, async (request) => {
    const uid = await requireAuth(request, "staff");
    await requireAdmin(uid);

    const apps = (await appsCol().orderBy("createdAt", "desc").get()).docs.map(doc => readApp(doc)!);
    const ownerUids = [...new Set(apps.map(app => app.ownerUid).filter(Boolean))];
    const owners = ownerUids.length > 0
        ? await db.getAll(...ownerUids.map(id => db.collection("users").doc(id)))
        : [];
    const ownerNames = new Map(owners.map(snap => [snap.id, snap.get("displayName") as string ?? ""]));

    return {
        apps: apps.map(app => ({
            id: app.id,
            name: app.name,
            ownerUid: app.ownerUid,
            ownerName: ownerNames.get(app.ownerUid) ?? "",
            redirectUris: app.redirectUris,
            scopes: app.scopes,
            firebaseProjectId: app.firebaseProjectId,
            serviceAccount: app.serviceAccount,
            createdByName: app.createdByName,
            createdAt: isoOrNull(app.createdAt),
            updatedAt: isoOrNull(app.updatedAt),
        })),
        signer: await signerAccount(),
    };
});

/**
 * Registers an app (`create`), or changes one. Its ID is for good: it's in
 * every sign-in the app has. A change applies to the next sign-in at once and
 * to the API within seconds (see registeredApps).
 */
export const saveApp = onCall({maxInstances: 10}, async (request) => {
    const uid = await requireAuth(request, "staff");
    const input = (request.data ?? {}) as {appId?: unknown; create?: unknown};
    const appId = validateAppId(input.appId);
    const create = input.create === true;
    const fields = parseAppInput(request.data);

    await adminTransaction(uid, async (txn, callerSnap) => {
        const ref = appsCol().doc(appId);
        const [snap, owner] = await Promise.all([
            txn.get(ref),
            fields.ownerUid ? txn.get(db.collection("users").doc(fields.ownerUid)) : null,
        ]);
        if (create && snap.exists) {
            throw new HttpsError("already-exists", "An app with this ID already exists.", {code: "app-exists"});
        }
        if (!create && !snap.exists) throw new HttpsError("not-found", "App not found.");
        if (owner && !owner.exists) throw new HttpsError("not-found", "Owner not found.", {code: "owner-not-found"});

        const callerName: string = callerSnap.data()?.displayName ?? "";
        const now = Timestamp.now();
        if (create) {
            txn.create(ref, {...fields, createdBy: uid, createdByName: callerName, createdAt: now, updatedAt: now});
        } else {
            txn.update(ref, {...fields, updatedAt: now});
        }
        txn.set(recordRef(), recordDoc(create ? "app-create" : "app-update", {
            performedBy: uid,
            performedByName: callerName,
            appId,
            appName: fields.name,
        }));
    });
    return {saved: true};
});

/**
 * Removes an app. The API refuses its sign-ins within seconds, and sign-in to
 * it stops at once. Its users and data in its own project are its owner's.
 */
export const deleteApp = onCall({maxInstances: 10}, async (request) => {
    const uid = await requireAuth(request, "staff");
    const appId = validateAppId((request.data as {appId?: unknown} | null)?.appId);

    await adminTransaction(uid, async (txn, callerSnap) => {
        const ref = appsCol().doc(appId);
        const app = readApp(await txn.get(ref));
        if (!app) throw new HttpsError("not-found", "App not found.");
        txn.delete(ref);
        txn.set(recordRef(), recordDoc("app-delete", {
            performedBy: uid,
            performedByName: callerSnap.data()?.displayName ?? "",
            appId,
            appName: app.name,
        }));
    });
    return {deleted: true};
});

/** The app a sign-in is for, read fresh, so a change made a moment ago counts. */
async function findApp(raw: unknown): Promise<RegisteredApp> {
    const notFound = new HttpsError("not-found", "No such app.", {code: "unknown-app"});
    if (typeof raw !== "string" || !APP_ID_RE.test(raw)) throw notFound;
    const app = readApp(await appsCol().doc(raw).get());
    if (!app) throw notFound;
    return app;
}

/** Where a sign-in for `app` goes: the place asked for, which must be one of its own, or its first. */
function redirectFor(app: RegisteredApp, raw: unknown): string {
    if (raw === undefined || raw === null || raw === "") return app.redirectUris[0];
    const asked = normalizeRedirectUri(raw);
    if (!asked || !app.redirectUris.includes(asked)) {
        throw new HttpsError("invalid-argument", "This app can't be signed in to from there.", {code: "bad-redirect"});
    }
    return asked;
}

/**
 * What the sign-in page shows of an app before anyone signs in: its name, its
 * owner, and what it will be able to see. Refuses an unknown app, or a place
 * to hand back to that isn't its own, before anyone is asked to sign in.
 */
export const getAppSignInInfo = onCall({maxInstances: 20}, async (request) => {
    const input = (request.data ?? {}) as {appId?: unknown; redirectUri?: unknown};
    const app = await findApp(input.appId);
    redirectFor(app, input.redirectUri);
    const owner = app.ownerUid ? await db.collection("users").doc(app.ownerUid).get() : null;
    return {name: app.name, ownerName: owner?.get("displayName") as string ?? "", scopes: app.scopes};
});

/**
 * Signs the caller in to an app: a custom token for its Firebase project (see
 * mintAppToken), and where the sign-in page hands it, with the app's `state`.
 * Any account may sign in to any app: the app decides what that account may do
 * there, and the API what of the site it may see here.
 */
export const issueAppToken = onCall({maxInstances: 10}, async (request) => {
    const uid = await requireAuth(request);
    const input = (request.data ?? {}) as {appId?: unknown; redirectUri?: unknown};
    const app = await findApp(input.appId);
    const redirectUri = redirectFor(app, input.redirectUri);
    const group = normalizeGroup((await db.collection("users").doc(uid).get()).get("group"));
    return {token: await mintAppToken(app, uid, group), redirectUri};
});
