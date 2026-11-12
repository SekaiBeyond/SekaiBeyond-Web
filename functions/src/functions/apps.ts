import { HttpsError, onCall } from "firebase-functions/v2/https";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { GoogleAuth } from "google-auth-library";
import { adminTransaction, requireAdmin, requireAuth } from "../utils/auth";
import { type ApiKeyDoc, apiKeysCol } from "../utils/apiKeys";
import {
    APP_ID_RE,
    APP_MAINTAINERS_MAX,
    APP_REDIRECT_URIS_MAX,
    appsCol,
    CODE_CHALLENGE_RE,
    FIREBASE_PROJECT_ID_RE,
    hasSignIn,
    issueSignInCode,
    newAppId,
    normalizeRedirectUri,
    readApp,
    type RegisteredApp,
    SERVICE_ACCOUNT_RE,
    validateAppId,
} from "../utils/apps";
import { db } from "../utils/firebase";
import { isoOrNull } from "../utils/helpers";
import { recordDoc, recordRef } from "../utils/records";
import { sanitizeDisplayText, validateDocId, validateStr } from "../utils/validation";

/**
 * Registering apps people sign in to with their accounts here (see
 * utils/apps.ts), and signing them in. Registering is core staff's, as API
 * keys are: an app is the club's arrangement with its maintainers. Signing in
 * tells the app who someone is here; what of the site it reads is its keys'
 * scopes. What the app does with that, and who may do what in it, is its own
 * business.
 */

const APP_NAME_MAX = 60;

interface AppInput {
    name: string;
    maintainerUids: string[];
    redirectUris: string[];
    firebaseProjectId: string;
    serviceAccount: string;
}

function parseAppInput(raw: unknown): AppInput {
    const input = (raw ?? {}) as Record<string, unknown>;
    const name = sanitizeDisplayText(validateStr(input.name, "name", APP_NAME_MAX, true));
    if (!name) throw new HttpsError("invalid-argument", "name is required.");

    const rawMaintainers = input.maintainerUids;
    if (!Array.isArray(rawMaintainers) || rawMaintainers.length > APP_MAINTAINERS_MAX) {
        throw new HttpsError("invalid-argument", `maintainerUids must list 0–${APP_MAINTAINERS_MAX} accounts.`);
    }
    const maintainerUids = [...new Set(rawMaintainers.map(uid => validateDocId(uid, "maintainerUids")))];

    const rawUris = input.redirectUris === undefined ? [] : input.redirectUris;
    const rawProject = input.firebaseProjectId === undefined ? "" : input.firebaseProjectId;
    const rawServiceAccount = input.serviceAccount === undefined ? "" : input.serviceAccount;

    if (!Array.isArray(rawUris) || rawUris.length > APP_REDIRECT_URIS_MAX) {
        throw new HttpsError("invalid-argument",
            `redirectUris must list 1–${APP_REDIRECT_URIS_MAX} places sign-in may hand back to.`);
    }
    const redirectUris = [...new Set(rawUris.map(uri => {
        const normalized = normalizeRedirectUri(uri);
        if (!normalized) {
            throw new HttpsError("invalid-argument",
                "Each redirect URI must be an https URL, or http on localhost or 127.0.0.1, with no #fragment.");
        }
        return normalized;
    }))];

    // An app that only holds API keys leaves sign-in blank; one that signs
    // people in needs where to hand them back to, its project and its service account.
    if (redirectUris.length === 0 && rawProject === "" && rawServiceAccount === "") {
        return {name, maintainerUids, redirectUris: [], firebaseProjectId: "", serviceAccount: ""};
    }
    if (redirectUris.length === 0) {
        throw new HttpsError("invalid-argument",
            `redirectUris must list 1–${APP_REDIRECT_URIS_MAX} places sign-in may hand back to.`);
    }
    if (typeof rawProject !== "string" || !FIREBASE_PROJECT_ID_RE.test(rawProject)) {
        throw new HttpsError("invalid-argument", "firebaseProjectId must be a Firebase project ID.");
    }
    if (typeof rawServiceAccount !== "string" || !SERVICE_ACCOUNT_RE.test(rawServiceAccount)) {
        throw new HttpsError("invalid-argument", "serviceAccount must be a service account's address.");
    }
    return {
        name,
        maintainerUids,
        redirectUris,
        firebaseProjectId: rawProject,
        serviceAccount: rawServiceAccount,
    };
}

let signer: Promise<string> | null = null;

/**
 * The service account this project's functions run as, which an app's
 * maintainers grant roles to, or "" where it can't be told, as in the emulator.
 */
function signerAccount(): Promise<string> {
    signer ??= new GoogleAuth().getCredentials()
        .then(credentials => credentials.client_email ?? "")
        .catch(() => "");
    return signer;
}

/** The user docs of `uids`, by uid, read together. */
async function usersByUid(uids: string[]): Promise<Map<string, FirebaseFirestore.DocumentSnapshot>> {
    const unique = [...new Set(uids.filter(Boolean))];
    if (unique.length === 0) return new Map();
    const snaps = await db.getAll(...unique.map(id => db.collection("users").doc(id)));
    return new Map(snaps.map(snap => [snap.id, snap]));
}

/** An app's creator or maintainer as the Apps tool shows them. */
interface AppPerson {
    uid: string;
    name: string;
    photoURL: string;
    /** Their account no longer exists. */
    deleted: boolean;
}

/** `uid` as it is now among `users`, or, its account gone, by `nameIfDeleted`. */
function appPerson(uid: string, users: Map<string, FirebaseFirestore.DocumentSnapshot>, nameIfDeleted = ""): AppPerson {
    const snap = users.get(uid);
    if (!snap?.exists) return {uid, name: nameIfDeleted, photoURL: "", deleted: true};
    const text = (field: string) => {
        const value: unknown = snap.get(field);
        return typeof value === "string" ? value : "";
    };
    return {uid, name: text("displayName"), photoURL: text("photoURL"), deleted: false};
}

/**
 * Every app, newest first, with who registered it and who looks after it, by
 * their names and photos now, its API keys (expired ones too, newest first,
 * never the key itself), and the account maintainers grant roles to. Core
 * staff only.
 */
export const listApps = onCall({maxInstances: 10}, async (request) => {
    const uid = await requireAuth(request, "staff");
    await requireAdmin(uid);

    const [appsSnap, keysSnap] = await Promise.all([
        appsCol().orderBy("createdAt", "desc").get(),
        apiKeysCol().orderBy("createdAt", "desc").get(),
    ]);
    const apps = appsSnap.docs.map(doc => readApp(doc)!);
    const users = await usersByUid(apps.flatMap(app => [app.createdBy, ...app.maintainerUids]));

    const keysByApp = new Map<string, {
        id: string;
        appId: string;
        name: string;
        hint: string;
        scopes: string[];
        eventIds: string[];
        createdByName: string;
        createdAt: string | null;
        expiresAt: string | null;
        lastUsedAt: string | null;
    }[]>();
    for (const doc of keysSnap.docs) {
        const data = doc.data() as ApiKeyDoc;
        const list = keysByApp.get(data.appId) ?? [];
        list.push({
            id: doc.id,
            appId: data.appId,
            name: data.name ?? "",
            hint: data.hint ?? "",
            scopes: data.scopes ?? [],
            eventIds: data.eventIds ?? [],
            createdByName: data.createdByName ?? "",
            createdAt: isoOrNull(data.createdAt),
            expiresAt: isoOrNull(data.expiresAt),
            lastUsedAt: isoOrNull(data.lastUsedAt),
        });
        keysByApp.set(data.appId, list);
    }

    return {
        apps: apps.map(app => ({
            id: app.id,
            name: app.name,
            creator: app.createdBy ? appPerson(app.createdBy, users, app.createdByName) : null,
            maintainers: app.maintainerUids.map(id => appPerson(id, users)),
            redirectUris: app.redirectUris,
            firebaseProjectId: app.firebaseProjectId,
            serviceAccount: app.serviceAccount,
            keys: keysByApp.get(app.id) ?? [],
            createdAt: isoOrNull(app.createdAt),
            updatedAt: isoOrNull(app.updatedAt),
        })),
        signer: await signerAccount(),
        serverNow: new Date().toISOString(),
    };
});

/**
 * Registers an app (`create`) under an ID made for it (newAppId), or changes
 * the one `appId` names. Its ID is for good: it's in every sign-in the app
 * has. A change applies to the next sign-in at once and to the API within
 * seconds (see registeredApps). Says the app's ID.
 */
export const saveApp = onCall({maxInstances: 10}, async (request) => {
    const uid = await requireAuth(request, "staff");
    const input = (request.data ?? {}) as {appId?: unknown; create?: unknown};
    const create = input.create === true;
    const appId = create ? newAppId() : validateAppId(input.appId);
    const fields = parseAppInput(request.data);

    await adminTransaction(uid, async (txn, callerSnap) => {
        const ref = appsCol().doc(appId);
        const maintainerRefs = fields.maintainerUids.map(id => db.collection("users").doc(id));
        const [snap, maintainers] = await Promise.all([
            txn.get(ref),
            maintainerRefs.length > 0 ? txn.getAll(...maintainerRefs) : [],
        ]);
        // One in 2^64 a new ID is taken: create then fails rather than overwrite it.
        if (!create && !snap.exists) throw new HttpsError("not-found", "App not found.");
        if (maintainers.some(m => !m.exists)) {
            throw new HttpsError("not-found", "A maintainer's account no longer exists.", {code: "maintainer-not-found"});
        }

        const callerName: string = callerSnap.data()?.displayName ?? "";
        const now = Timestamp.now();
        if (create) {
            txn.create(ref, {...fields, createdBy: uid, createdByName: callerName, createdAt: now, updatedAt: now});
        } else {
            // Left over from before (see readApp): ownerUid, the one maintainer
            // it had before it could have several, and scopes, what it once
            // read for the person signed in.
            txn.update(ref, {...fields, ownerUid: FieldValue.delete(), scopes: FieldValue.delete(), updatedAt: now});
        }
        txn.set(recordRef(), recordDoc(create ? "app-create" : "app-update", {
            performedBy: uid,
            performedByName: callerName,
            appId,
            appName: fields.name,
        }));
    });
    return {saved: true, appId};
});

/**
 * Removes an app and revokes its API keys. Its keys and sign-in to it stop at
 * once, and the API refuses its sign-ins within seconds. Its users and data in
 * its own project are its maintainers' to keep.
 */
export const deleteApp = onCall({maxInstances: 10}, async (request) => {
    const uid = await requireAuth(request, "staff");
    const appId = validateAppId((request.data as {appId?: unknown} | null)?.appId);

    await adminTransaction(uid, async (txn, callerSnap) => {
        const ref = appsCol().doc(appId);
        const [snap, keysSnap] = await Promise.all([
            txn.get(ref),
            txn.get(apiKeysCol().where("appId", "==", appId)),
        ]);
        const app = readApp(snap);
        if (!app) throw new HttpsError("not-found", "App not found.");
        txn.delete(ref);
        for (const keyDoc of keysSnap.docs) txn.delete(keyDoc.ref);
        txn.set(recordRef(), recordDoc("app-delete", {
            performedBy: uid,
            performedByName: callerSnap.data()?.displayName ?? "",
            appId,
            appName: app.name,
        }));
    });
    return {deleted: true};
});

/** The app a sign-in is for, read fresh, so a change made a moment ago counts. Refuses one without sign-in. */
async function findApp(raw: unknown): Promise<RegisteredApp> {
    const notFound = new HttpsError("not-found", "No such app.", {code: "unknown-app"});
    if (typeof raw !== "string" || !APP_ID_RE.test(raw)) throw notFound;
    const app = readApp(await appsCol().doc(raw).get());
    if (!app || !hasSignIn(app)) throw notFound;
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
 * What the sign-in page shows of an app before anyone signs in: its name and
 * the names of its maintainers. Refuses an
 * unknown app, or a place to hand back to that isn't its own, before anyone
 * is asked to sign in.
 */
export const getAppSignInInfo = onCall({maxInstances: 20}, async (request) => {
    const input = (request.data ?? {}) as {appId?: unknown; redirectUri?: unknown};
    const app = await findApp(input.appId);
    redirectFor(app, input.redirectUri);
    const users = await usersByUid(app.maintainerUids);
    const maintainerNames = app.maintainerUids.map(id => appPerson(id, users))
        .filter(person => !person.deleted && person.name)
        .map(person => person.name);
    return {name: app.name, maintainerNames};
});

/**
 * Signs the caller in to an app: a one-time code (see issueSignInCode), and
 * where the sign-in page hands it, with the app's `state`. The app trades it
 * for the sign-in at POST /v1/token. Any account may sign in to any app: the
 * app decides what that account may do there, and its keys' scopes what of the
 * site it reads.
 */
export const issueAppCode = onCall({maxInstances: 10}, async (request) => {
    const uid = await requireAuth(request);
    const input = (request.data ?? {}) as {appId?: unknown; redirectUri?: unknown; codeChallenge?: unknown};
    const app = await findApp(input.appId);
    const redirectUri = redirectFor(app, input.redirectUri);
    if (typeof input.codeChallenge !== "string" || !CODE_CHALLENGE_RE.test(input.codeChallenge)) {
        throw new HttpsError("invalid-argument",
            "codeChallenge must be the base64url SHA-256 of a code verifier.", {code: "bad-challenge"});
    }
    const code = await issueSignInCode(app, uid, redirectUri, input.codeChallenge);
    return {code, redirectUri};
});
