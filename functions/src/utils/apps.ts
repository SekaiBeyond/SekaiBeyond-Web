import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import { HttpsError } from "firebase-functions/v2/https";
import { type App, initializeApp } from "firebase-admin/app";
import { type DecodedIdToken, getAuth } from "firebase-admin/auth";
import { Timestamp } from "firebase-admin/firestore";
import type { MailLanguage } from "./accountMail";
import { db } from "./firebase";

export const APP_ID_RE = /^[a-z0-9-]{1,32}$/;

export const newAppId = () => randomBytes(8).toString("hex");

export function validateAppId(raw: unknown): string {
    if (typeof raw !== "string" || !APP_ID_RE.test(raw)) {
        throw new HttpsError("invalid-argument", "appId must be 1–32 lowercase letters, digits and -.");
    }
    return raw;
}

export const FIREBASE_PROJECT_ID_RE = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/;

export const SERVICE_ACCOUNT_RE = /^[a-z0-9-]{1,63}@([a-z0-9-]{1,63}\.iam|appspot|developer)\.gserviceaccount\.com$/;

export const APP_REDIRECT_URIS_MAX = 10;

export const APP_MAINTAINERS_MAX = 5;

export function normalizeRedirectUri(raw: unknown): string | null {
    if (typeof raw !== "string" || raw.length > 500) return null;
    let url: URL;
    try {
        url = new URL(raw);
    } catch {
        return null;
    }
    if (url.hash || raw.includes("#") || url.username || url.password) return null;
    const local = url.protocol === "http:" && (url.hostname === "localhost" || url.hostname === "127.0.0.1");
    return url.protocol === "https:" || local ? url.href : null;
}

export const APP_PLATFORMS = ["wechat-mini-program"] as const;
export type AppPlatform = typeof APP_PLATFORMS[number] | "";

export const isAppPlatform = (raw: unknown): raw is AppPlatform =>
    raw === "" || (APP_PLATFORMS as readonly unknown[]).includes(raw);

export const APP_ICON_PREFIX = "apps/";

interface AppDoc {
    nameEn: string;
    nameCn: string;
    platform: AppPlatform;
    iconUrl: string;
    maintainerUids: string[];
    redirectUris: string[];
    firebaseProjectId: string;
    serviceAccount: string;
    accountLinking: boolean;
    createdBy: string;
    createdByName: string;
    createdAt: Timestamp;
    updatedAt: Timestamp;
}

export interface RegisteredApp extends AppDoc {
    id: string;
}

export const appNameIn = (app: Pick<RegisteredApp, "id" | "nameEn" | "nameCn">, language: MailLanguage): string =>
    (language === "en" ? app.nameEn || app.nameCn : app.nameCn || app.nameEn) || app.id;

export const appRecordName = (app: Pick<AppDoc, "nameEn" | "nameCn"> | null, appId: string): string =>
    app ? app.nameEn || app.nameCn : appId;

export function hasSignIn(app: Pick<AppDoc, "redirectUris" | "firebaseProjectId" | "serviceAccount">): boolean {
    return app.redirectUris.length > 0 && !!app.firebaseProjectId && !!app.serviceAccount;
}

export const appsCol = () => db.collection("apps");

export function readApp(snap: FirebaseFirestore.DocumentSnapshot): RegisteredApp | null {
    const data = snap.data() as Partial<AppDoc> | undefined;
    if (!data) return null;
    return {
        id: snap.id,
        nameEn: data.nameEn ?? "",
        nameCn: data.nameCn ?? "",
        platform: isAppPlatform(data.platform) ? data.platform : "",
        iconUrl: data.iconUrl ?? "",
        maintainerUids: data.maintainerUids ?? [],
        redirectUris: data.redirectUris ?? [],
        firebaseProjectId: data.firebaseProjectId ?? "",
        serviceAccount: data.serviceAccount ?? "",
        accountLinking: data.accountLinking === true,
        createdBy: data.createdBy ?? "",
        createdByName: data.createdByName ?? "",
        createdAt: data.createdAt!,
        updatedAt: data.updatedAt!,
    };
}

export function appOrigins(app: RegisteredApp): string[] {
    return [...new Set(app.redirectUris.map(uri => new URL(uri).origin))];
}

const APPS_MAX_AGE_MS = 10_000;

let listing: {at: number; apps: Promise<Map<string, RegisteredApp>>} | null = null;

export function registeredApps(): Promise<Map<string, RegisteredApp>> {
    if (listing && Date.now() - listing.at <= APPS_MAX_AGE_MS) return listing.apps;
    const next = {
        at: Date.now(),
        apps: appsCol().get().then(snap => new Map(snap.docs.map(doc => [doc.id, readApp(doc)!]))),
    };
    next.apps.catch(() => {
        if (listing === next) listing = null;
    });
    listing = next;
    return next.apps;
}

const adminApps = new Map<string, App>();

function adminFor(app: Pick<AppDoc, "firebaseProjectId" | "serviceAccount">): App {
    const key = `${app.firebaseProjectId}/${app.serviceAccount}`;
    let admin = adminApps.get(key);
    if (!admin) {
        admin = initializeApp({projectId: app.firebaseProjectId, serviceAccountId: app.serviceAccount}, `app:${key}`);
        adminApps.set(key, admin);
    }
    return admin;
}

export function mintAppToken(app: RegisteredApp, uid: string, group: string): Promise<string> {
    return getAuth(adminFor(app)).createCustomToken(uid, {app: app.id, group, mintedAt: Date.now()});
}

const SIGN_IN_CODE_TTL_MS = 2 * 60 * 1000;

export const CODE_CHALLENGE_RE = /^[A-Za-z0-9_-]{43}$/;

export const CODE_VERIFIER_RE = /^[A-Za-z0-9._~-]{43,128}$/;

export const SIGN_IN_CODE_RE = /^[A-Za-z0-9_-]{43}$/;

interface SignInCodeDoc {
    appId: string;
    uid: string;
    redirectUri: string;
    codeChallenge: string;
    createdAt: Timestamp;
    expiresAt: Timestamp;
}

const signInCodeRef = (code: string) =>
    db.collection("appSignInCodes").doc(createHash("sha256").update(code).digest("hex"));

export async function issueSignInCode(
    app: RegisteredApp,
    uid: string,
    redirectUri: string,
    codeChallenge: string,
): Promise<string> {
    const code = randomBytes(32).toString("base64url");
    const now = Date.now();
    const doc: SignInCodeDoc = {
        appId: app.id,
        uid,
        redirectUri,
        codeChallenge,
        createdAt: Timestamp.fromMillis(now),
        expiresAt: Timestamp.fromMillis(now + SIGN_IN_CODE_TTL_MS),
    };
    await signInCodeRef(code).create(doc);
    return code;
}

export async function redeemSignInCode(code: string, codeVerifier: string): Promise<SignInCodeDoc | null> {
    const ref = signInCodeRef(code);
    const signIn = await db.runTransaction(async txn => {
        const snap = await txn.get(ref);
        if (!snap.exists) return null;
        txn.delete(ref);
        return snap.data() as SignInCodeDoc;
    });
    if (!signIn || signIn.expiresAt.toMillis() <= Date.now()) return null;
    const challenge = Buffer.from(createHash("sha256").update(codeVerifier).digest("base64url"));
    const expected = Buffer.from(signIn.codeChallenge);
    return challenge.length === expected.length && timingSafeEqual(challenge, expected) ? signIn : null;
}

export function verifyAppIdToken(app: RegisteredApp, idToken: string): Promise<DecodedIdToken> {
    return getAuth(adminFor(app)).verifyIdToken(idToken);
}

const errorCode = (err: unknown) => (err as {code?: unknown})?.code;
const userNotFound = (err: unknown) => errorCode(err) === "auth/user-not-found";

function mayPassOnRetry(err: unknown): boolean {
    const code = errorCode(err);
    if (code === "app/network-error" || code === "app/network-timeout" || code === "auth/quota-exceeded") return true;
    if (code !== "auth/internal-error") return false;
    const status = (err as {httpResponse?: {status?: unknown}})?.httpResponse?.status;
    return typeof status !== "number" || status === 429 || status >= 500;
}

const RETRY_DELAYS_MS = [500, 2000];

async function withRetries<T>(call: () => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
        try {
            return await call();
        } catch (err) {
            if (attempt >= RETRY_DELAYS_MS.length || !mayPassOnRetry(err)) throw err;
            await sleep(RETRY_DELAYS_MS[attempt]);
        }
    }
}

async function acrossApps(uid: string, action: "revoke" | "delete"): Promise<void> {
    let apps: RegisteredApp[];
    try {
        apps = (await appsCol().get()).docs.map(doc => readApp(doc)!);
    } catch (err) {
        console.error(`[apps] couldn't list apps to ${action} ${uid} in`, err);
        return;
    }
    const byProject = new Map(apps.filter(hasSignIn).map(app => [app.firebaseProjectId, app]));
    await Promise.all([...byProject.values()].map(async app => {
        const auth = getAuth(adminFor(app));
        try {
            await withRetries(() => action === "revoke" ? auth.revokeRefreshTokens(uid) : auth.deleteUser(uid));
        } catch (err) {
            if (!userNotFound(err)) console.error(`[apps] ${action} in ${app.id} failed for ${uid}`, err);
        }
    }));
}

export const signOutOfApps = (uid: string) => acrossApps(uid, "revoke");

export const deleteFromApps = (uid: string) => acrossApps(uid, "delete");
