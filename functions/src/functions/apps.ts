import { HttpsError, onCall } from "firebase-functions/v2/https";
import { Timestamp } from "firebase-admin/firestore";
import { GoogleAuth } from "google-auth-library";
import { adminTransaction, requireAdmin, requireAuth } from "../utils/auth";
import { type ApiKeyDoc, apiKeysCol } from "../utils/apiKeys";
import { type AppLinkDoc, appLinksCol, appLinkUserName } from "../utils/appLinks";
import {
    APP_ICON_PREFIX,
    APP_ID_RE,
    APP_MAINTAINERS_MAX,
    APP_PLATFORMS,
    APP_REDIRECT_URIS_MAX,
    type AppPlatform,
    appRecordName,
    appsCol,
    CODE_CHALLENGE_RE,
    FIREBASE_PROJECT_ID_RE,
    hasSignIn,
    isAppPlatform,
    issueSignInCode,
    newAppId,
    normalizeRedirectUri,
    readApp,
    type RegisteredApp,
    SERVICE_ACCOUNT_RE,
    validateAppId,
} from "../utils/apps";
import { BATCH_LIMIT } from "../utils/config";
import { db } from "../utils/firebase";
import { isoOrNull } from "../utils/helpers";
import { recordDoc, recordRef } from "../utils/records";
import { deleteStorageFile, logStorageCleanupError, requireNewlyLinkedFilesExist } from "../utils/storage";
import {
    sanitizeDisplayText,
    validateBoolean,
    validateDocId,
    validateStorageImageUrl,
    validateStr,
} from "../utils/validation";

const APP_NAME_MAX = 60;

interface AppInput {
    nameEn: string;
    nameCn: string;
    maintainerUids: string[];
    redirectUris: string[];
    firebaseProjectId: string;
    serviceAccount: string;
    accountLinking: boolean;
    platform: AppPlatform;
    iconUrl: string;
}

function parseAppInput(raw: unknown): AppInput {
    const input = (raw ?? {}) as Record<string, unknown>;
    const readName = (field: "nameEn" | "nameCn") =>
        sanitizeDisplayText(validateStr(input[field], field, APP_NAME_MAX));
    const names = {nameEn: readName("nameEn"), nameCn: readName("nameCn")};
    const accountLinking = validateBoolean(input.accountLinking ?? false, "accountLinking");
    const platform = input.platform ?? "";
    if (!isAppPlatform(platform)) {
        throw new HttpsError("invalid-argument", `platform must be "" or one of: ${APP_PLATFORMS.join(", ")}.`);
    }
    const iconUrl = validateStr(input.iconUrl, "iconUrl", 500);
    if (iconUrl) validateStorageImageUrl(iconUrl, "iconUrl");

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

    if (redirectUris.length === 0 && rawProject === "" && rawServiceAccount === "") {
        return {
            ...names,
            maintainerUids,
            redirectUris: [],
            firebaseProjectId: "",
            serviceAccount: "",
            accountLinking,
            platform,
            iconUrl,
        };
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
        ...names,
        maintainerUids,
        redirectUris,
        firebaseProjectId: rawProject,
        serviceAccount: rawServiceAccount,
        accountLinking,
        platform,
        iconUrl,
    };
}

let signer: Promise<string> | null = null;

function signerAccount(): Promise<string> {
    signer ??= new GoogleAuth().getCredentials()
        .then(credentials => credentials.client_email ?? "")
        .catch(() => "");
    return signer;
}

async function requireOtherProject(app: Pick<AppInput, "firebaseProjectId" | "serviceAccount">): Promise<void> {
    if (!app.serviceAccount) return;
    const project = process.env.GCLOUD_PROJECT ?? "";
    const ofThisProject = project !== "" && (app.firebaseProjectId === project
        || app.serviceAccount.endsWith(`@${project}.iam.gserviceaccount.com`)
        || app.serviceAccount === `${project}@appspot.gserviceaccount.com`);
    if (ofThisProject || app.serviceAccount === await signerAccount()) {
        throw new HttpsError("invalid-argument",
            "An app signs people in to its own Firebase project, as a service account of that project, not this site's.",
            {code: "own-project"});
    }
}

async function usersByUid(uids: string[]): Promise<Map<string, FirebaseFirestore.DocumentSnapshot>> {
    const unique = [...new Set(uids.filter(Boolean))];
    if (unique.length === 0) return new Map();
    const snaps = await db.getAll(...unique.map(id => db.collection("users").doc(id)));
    return new Map(snaps.map(snap => [snap.id, snap]));
}

interface AppPerson {
    uid: string;
    name: string;
    photoURL: string;
    deleted: boolean;
}

function appPerson(uid: string, users: Map<string, FirebaseFirestore.DocumentSnapshot>, nameIfDeleted = ""): AppPerson {
    const snap = users.get(uid);
    if (!snap?.exists) return {uid, name: nameIfDeleted, photoURL: "", deleted: true};
    const text = (field: string) => {
        const value: unknown = snap.get(field);
        return typeof value === "string" ? value : "";
    };
    return {uid, name: text("displayName"), photoURL: text("photoURL"), deleted: false};
}

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
            nameEn: app.nameEn,
            nameCn: app.nameCn,
            creator: app.createdBy ? appPerson(app.createdBy, users, app.createdByName) : null,
            maintainers: app.maintainerUids.map(id => appPerson(id, users)),
            redirectUris: app.redirectUris,
            firebaseProjectId: app.firebaseProjectId,
            serviceAccount: app.serviceAccount,
            accountLinking: app.accountLinking,
            platform: app.platform,
            iconUrl: app.iconUrl,
            keys: keysByApp.get(app.id) ?? [],
            createdAt: isoOrNull(app.createdAt),
            updatedAt: isoOrNull(app.updatedAt),
        })),
        signer: await signerAccount(),
        serverNow: new Date().toISOString(),
    };
});

export const saveApp = onCall({maxInstances: 10}, async (request) => {
    const uid = await requireAuth(request, "staff");
    const input = (request.data ?? {}) as {appId?: unknown; create?: unknown};
    const create = input.create === true;
    const appId = create ? newAppId() : validateAppId(input.appId);
    const fields = parseAppInput(request.data);
    await requireOtherProject(fields);

    const oldIconUrl = await adminTransaction(uid, async (txn, callerSnap) => {
        const ref = appsCol().doc(appId);
        const maintainerRefs = fields.maintainerUids.map(id => db.collection("users").doc(id));
        const [snap, maintainers] = await Promise.all([
            txn.get(ref),
            maintainerRefs.length > 0 ? txn.getAll(...maintainerRefs) : [],
        ]);
        if (!create && !snap.exists) throw new HttpsError("not-found", "App not found.");
        if (maintainers.some(m => !m.exists)) {
            throw new HttpsError("not-found", "A maintainer's account no longer exists.", {code: "maintainer-not-found"});
        }
        const prevIconUrl = readApp(snap)?.iconUrl ?? "";
        if (fields.iconUrl) await requireNewlyLinkedFilesExist([fields.iconUrl], [prevIconUrl]);

        const callerName: string = callerSnap.data()?.displayName ?? "";
        const now = Timestamp.now();
        if (create) {
            txn.create(ref, {
                ...fields,
                createdBy: uid,
                createdByName: callerName,
                createdAt: now,
                updatedAt: now,
            });
        } else {
            txn.update(ref, {...fields, updatedAt: now});
        }
        txn.set(recordRef(), recordDoc(create ? "app-create" : "app-update", {
            performedBy: uid,
            performedByName: callerName,
            appId,
            appName: appRecordName(fields, appId),
        }));
        return prevIconUrl;
    });

    if (oldIconUrl && oldIconUrl !== fields.iconUrl) {
        await deleteStorageFile(oldIconUrl, [APP_ICON_PREFIX])
            .catch(logStorageCleanupError(`saveApp ${appId}`));
    }
    return {saved: true, appId};
});

export const deleteApp = onCall({maxInstances: 10}, async (request) => {
    const uid = await requireAuth(request, "staff");
    const appId = validateAppId((request.data as {appId?: unknown} | null)?.appId);

    const removed = await adminTransaction(uid, async (txn, callerSnap) => {
        const ref = appsCol().doc(appId);
        const [snap, keysSnap] = await Promise.all([
            txn.get(ref),
            txn.get(apiKeysCol().where("appId", "==", appId)),
        ]);
        const app = readApp(snap);
        if (!app) throw new HttpsError("not-found", "App not found.");
        const callerName: string = callerSnap.data()?.displayName ?? "";
        txn.delete(ref);
        for (const keyDoc of keysSnap.docs) txn.delete(keyDoc.ref);
        txn.set(recordRef(), recordDoc("app-delete", {
            performedBy: uid,
            performedByName: callerName,
            appId,
            appName: appRecordName(app, appId),
        }));
        return {appName: appRecordName(app, appId), callerName, iconUrl: app.iconUrl};
    });

    if (removed.iconUrl) {
        await deleteStorageFile(removed.iconUrl, [APP_ICON_PREFIX])
            .catch(logStorageCleanupError(`deleteApp ${appId}`));
    }

    try {
        const links = await appLinksCol().where("appId", "==", appId).get();
        const perBatch = Math.floor(BATCH_LIMIT / 2);
        for (let i = 0; i < links.docs.length; i += perBatch) {
            const chunk = links.docs.slice(i, i + perBatch);
            const users = await db.getAll(...chunk.map(doc => db.collection("users").doc((doc.data() as AppLinkDoc).uid)));
            const batch = db.batch();
            chunk.forEach((doc, j) => {
                const link = doc.data() as AppLinkDoc;
                batch.delete(doc.ref);
                batch.set(recordRef(`app-removed-unlink-${appId}-${link.uid}`), recordDoc("account-app-unlink", {
                    performedBy: uid,
                    performedByName: removed.callerName,
                    targetUid: link.uid,
                    targetName: users[j].get("displayName") ?? "",
                    appId,
                    appName: removed.appName,
                    appUserName: appLinkUserName(link.appUserName),
                    linkEndedBy: "app-removed",
                }));
            });
            await batch.commit();
        }
    } catch (err) {
        console.error(`[apps] couldn't delete ${appId}'s account links`, err);
    }
    return {deleted: true};
});

async function findApp(raw: unknown): Promise<RegisteredApp> {
    const notFound = new HttpsError("not-found", "No such app.", {code: "unknown-app"});
    if (typeof raw !== "string" || !APP_ID_RE.test(raw)) throw notFound;
    const app = readApp(await appsCol().doc(raw).get());
    if (!app || !hasSignIn(app)) throw notFound;
    return app;
}

function redirectFor(app: RegisteredApp, raw: unknown): string {
    if (raw === undefined || raw === null || raw === "") return app.redirectUris[0];
    const asked = normalizeRedirectUri(raw);
    if (!asked || !app.redirectUris.includes(asked)) {
        throw new HttpsError("invalid-argument", "This app can't be signed in to from there.", {code: "bad-redirect"});
    }
    return asked;
}

export const getAppSignInInfo = onCall({maxInstances: 20}, async (request) => {
    const input = (request.data ?? {}) as {appId?: unknown; redirectUri?: unknown};
    const app = await findApp(input.appId);
    redirectFor(app, input.redirectUri);
    const users = await usersByUid(app.maintainerUids);
    const maintainerNames = app.maintainerUids.map(id => appPerson(id, users))
        .filter(person => !person.deleted && person.name)
        .map(person => person.name);
    return {nameEn: app.nameEn, nameCn: app.nameCn, iconUrl: app.iconUrl, maintainerNames};
});

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
