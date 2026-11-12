import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import { HttpsError } from "firebase-functions/v2/https";
import { type App, initializeApp } from "firebase-admin/app";
import { type DecodedIdToken, getAuth } from "firebase-admin/auth";
import { Timestamp } from "firebase-admin/firestore";
import { db } from "./firebase";

/**
 * Registered apps: other projects, such as SKBY Manager or a ticket seller's
 * app, that connect to Sekai Beyond. Core staff register apps in the Apps tool
 * (functions/apps.ts). An app may:
 *
 * - sign people in with their accounts here (issueAppCode, then POST /v1/token
 *   in functions/api.ts), which tells it who they are here and nothing more
 *   (/v1/me);
 * - hold server-to-server API keys (utils/apiKeys.ts), which read the site's
 *   data as far as their scopes go and sell tickets, with the app's ID as the
 *   namespace its order numbers live in. Who of the app's own sees what a key
 *   reads is the app's to decide;
 * - or both.
 *
 * A sign-in is a Firebase custom token for the app's own Firebase project,
 * signed through IAM as a service account of that project, as this project's
 * own are signed as the account the functions run as (see signInToken). So the
 * app's maintainers grant that account Service Account Token Creator on theirs,
 * and, for signing out here to sign people out there too, Firebase
 * Authentication Admin on their project.
 */

/** An app's ID: what it signs people in with (/authorize?app=…), and its doc's name. */
export const APP_ID_RE = /^[a-z0-9-]{1,32}$/;

/** A new app's ID: 16 random hex digits, made here rather than chosen, as it can never change and an app's name can. */
export const newAppId = () => randomBytes(8).toString("hex");

/** An app's ID from a request, refused unless it's one an app can have. */
export function validateAppId(raw: unknown): string {
    if (typeof raw !== "string" || !APP_ID_RE.test(raw)) {
        throw new HttpsError("invalid-argument", "appId must be 1–32 lowercase letters, digits and -.");
    }
    return raw;
}

/** A Google Cloud project ID, the emulator's demo- ones included. */
export const FIREBASE_PROJECT_ID_RE = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/;

/** A service account's address: a project's own, App Engine's or Compute's default. */
export const SERVICE_ACCOUNT_RE = /^[a-z0-9-]{1,63}@([a-z0-9-]{1,63}\.iam|appspot|developer)\.gserviceaccount\.com$/;

export const APP_REDIRECT_URIS_MAX = 10;

/** The most accounts that may look after an app. */
export const APP_MAINTAINERS_MAX = 5;

/**
 * `raw` as a place sign-in may hand back to, in the one spelling it's stored
 * and compared in, or null if it can't be one: https, or http on this machine
 * for testing, with no fragment, which is where the sign-in goes.
 */
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

/** An `apps` doc. Server only (see firestore.rules). */
interface AppDoc {
    name: string;
    /**
     * The accounts that look after it, up to APP_MAINTAINERS_MAX, in the order
     * they were added. Shown on its sign-in page. Who registered it is
     * `createdBy`, who needn't be one.
     */
    maintainerUids: string[];
    /**
     * Where sign-in may hand back to; empty when the app doesn't sign people
     * in. Their origins may call the API from a browser.
     */
    redirectUris: string[];
    /** The Firebase project its sign-ins are for, "" when sign-in is off. */
    firebaseProjectId: string;
    /** The service account of that project its sign-ins are signed as, "" when sign-in is off. */
    serviceAccount: string;
    createdBy: string;
    createdByName: string;
    createdAt: Timestamp;
    updatedAt: Timestamp;
}

export interface RegisteredApp extends AppDoc {
    id: string;
}

/** Whether people can sign in to `app` with their accounts here. */
export function hasSignIn(app: Pick<AppDoc, "redirectUris" | "firebaseProjectId" | "serviceAccount">): boolean {
    return app.redirectUris.length > 0 && !!app.firebaseProjectId && !!app.serviceAccount;
}

export const appsCol = () => db.collection("apps");

export function readApp(snap: FirebaseFirestore.DocumentSnapshot): RegisteredApp | null {
    // `ownerUid`: the one maintainer an app had before it could have several,
    // until it's next saved (saveApp deletes it, and `scopes`, what it once
    // read for the person signed in, which nothing reads).
    const data = snap.data() as (Partial<AppDoc> & {ownerUid?: string}) | undefined;
    if (!data) return null;
    return {
        id: snap.id,
        name: data.name ?? snap.id,
        maintainerUids: data.maintainerUids ?? (data.ownerUid ? [data.ownerUid] : []),
        redirectUris: data.redirectUris ?? [],
        firebaseProjectId: data.firebaseProjectId ?? "",
        serviceAccount: data.serviceAccount ?? "",
        createdBy: data.createdBy ?? "",
        createdByName: data.createdByName ?? "",
        createdAt: data.createdAt!,
        updatedAt: data.updatedAt!,
    };
}

/** The origins an app's pages are served from: those of the places sign-in hands back to. */
export function appOrigins(app: RegisteredApp): string[] {
    return [...new Set(app.redirectUris.map(uri => new URL(uri).origin))];
}

/** How old the API's list of apps may be: how long a change to one takes to reach it. */
const APPS_MAX_AGE_MS = 10_000;

let listing: {at: number; apps: Promise<Map<string, RegisteredApp>>} | null = null;

/**
 * Every registered app by ID, as of at most APPS_MAX_AGE_MS ago, so the API
 * doesn't read the app behind every call. Sign-in reads its app fresh instead.
 */
export function registeredApps(): Promise<Map<string, RegisteredApp>> {
    if (listing && Date.now() - listing.at <= APPS_MAX_AGE_MS) return listing.apps;
    const next = {
        at: Date.now(),
        apps: appsCol().get().then(snap => new Map(snap.docs.map(doc => [doc.id, readApp(doc)!]))),
    };
    // Listed again on the next call rather than kept.
    next.apps.catch(() => {
        if (listing === next) listing = null;
    });
    listing = next;
    return next.apps;
}

const adminApps = new Map<string, App>();

/** The Admin SDK for an app's Firebase project, using this project's credentials, signing as its service account. */
function adminFor(app: Pick<AppDoc, "firebaseProjectId" | "serviceAccount">): App {
    const key = `${app.firebaseProjectId}/${app.serviceAccount}`;
    let admin = adminApps.get(key);
    if (!admin) {
        admin = initializeApp({projectId: app.firebaseProjectId, serviceAccountId: app.serviceAccount}, `app:${key}`);
        adminApps.set(key, admin);
    }
    return admin;
}

/**
 * A custom token to sign in to the app's Firebase project as `uid`, the
 * account's uid here. Its claims are on every ID token the sign-in renews to,
 * so an app's security rules can go by them:
 *
 * - `app`, which app it's for;
 * - `group`, the account's group here;
 * - `mintedAt`, as on this project's own sign-ins, so signing out everywhere
 *   here reaches it (signedInSinceSessionsEnded).
 *
 * They're as of the sign-in, and a change of group signs the account out of
 * every app (signOutOfApps), so its next sign-in has the group as it is now.
 * /v1/me has it as it is now. A custom token works for an hour, so one taken
 * before a change and used after carries the group from before: apps check
 * that a sign-in was used soon after `mintedAt` (see the docs).
 */
export function mintAppToken(app: RegisteredApp, uid: string, group: string): Promise<string> {
    return getAuth(adminFor(app)).createCustomToken(uid, {app: app.id, group, mintedAt: Date.now()});
}

/**
 * How long a sign-in code lasts. The app trades it as soon as its page loads,
 * so this only has to cover a slow connection.
 */
export const SIGN_IN_CODE_TTL_MS = 2 * 60 * 1000;

/** A code challenge: the base64url SHA-256 of a code verifier, the one method (S256) taken. */
export const CODE_CHALLENGE_RE = /^[A-Za-z0-9_-]{43}$/;

/** A code verifier: 43–128 of RFC 7636's unreserved characters. */
export const CODE_VERIFIER_RE = /^[A-Za-z0-9._~-]{43,128}$/;

/** A sign-in code: 32 random bytes, base64url. */
export const SIGN_IN_CODE_RE = /^[A-Za-z0-9_-]{43}$/;

/**
 * A sign-in code's doc, under the code's SHA-256, so the codes can't be read
 * back out of the database. Server only (see firestore.rules); a TTL policy
 * (firestore.indexes.json) deletes one nobody traded.
 */
export interface SignInCodeDoc {
    appId: string;
    uid: string;
    /** Where it was handed back to: from a browser, only that origin may trade it. */
    redirectUri: string;
    codeChallenge: string;
    createdAt: Timestamp;
    expiresAt: Timestamp;
}

const signInCodeRef = (code: string) =>
    db.collection("appSignInCodes").doc(createHash("sha256").update(code).digest("hex"));

/**
 * A one-time code for `uid` to sign in to `app` with, handed back at
 * `redirectUri`. Signing in hands an app this rather than a sign-in, so the
 * address bar, its history and whatever else reads them never hold anything
 * that signs anyone in: the app trades the code for one at POST /v1/token with
 * the code verifier that only it holds, whose SHA-256 is `codeChallenge`
 * (PKCE, RFC 7636).
 */
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

/**
 * What a sign-in code was issued for, if it's live and `codeVerifier` is the
 * verifier its challenge was made from, else null. A code works once: it's
 * deleted the first time it's offered, whatever comes of it, so one offered
 * with the wrong verifier, or by someone who saw it first, is gone.
 */
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

/** An ID token from the app's Firebase project, checked as Firebase Auth issued it. Throws if it isn't one. */
export function verifyAppIdToken(app: RegisteredApp, idToken: string): Promise<DecodedIdToken> {
    return getAuth(adminFor(app)).verifyIdToken(idToken);
}

const errorCode = (err: unknown) => (err as {code?: unknown})?.code;
const userNotFound = (err: unknown) => errorCode(err) === "auth/user-not-found";

/**
 * Whether a call to an app's Firebase Auth may work if tried again: the
 * network, a quota, or the server failing. Not a missing grant, which fails
 * every time and would only hold up the change behind it.
 */
function mayPassOnRetry(err: unknown): boolean {
    const code = errorCode(err);
    if (code === "app/network-error" || code === "app/network-timeout" || code === "auth/quota-exceeded") return true;
    if (code !== "auth/internal-error") return false;
    const status = (err as {httpResponse?: {status?: unknown}})?.httpResponse?.status;
    return typeof status !== "number" || status === 429 || status >= 500;
}

const RETRY_DELAYS_MS = [500, 2000];

/** `call`, tried again after each of RETRY_DELAYS_MS for as long as it fails in a way that may pass. */
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

/**
 * Does `action` to `uid` in the Firebase project of every app with sign-in,
 * once each. Logged, not thrown: it follows a change already made here, which
 * mustn't fail for it, and an app whose maintainers haven't granted Firebase
 * Authentication Admin fails every time. The API refuses such a sign-in from
 * then on regardless.
 */
async function acrossApps(uid: string, action: "revoke" | "delete"): Promise<void> {
    let apps: RegisteredApp[];
    try {
        // Fresh, so an app registered a moment ago isn't missed.
        apps = (await appsCol().get()).docs.map(doc => readApp(doc)!);
    } catch (err) {
        console.error(`[apps] couldn't list apps to ${action} ${uid} in`, err);
        return;
    }
    // Apps can share a project: each is reached once.
    const byProject = new Map(apps.filter(hasSignIn).map(app => [app.firebaseProjectId, app]));
    await Promise.all([...byProject.values()].map(async app => {
        const auth = getAuth(adminFor(app));
        try {
            await withRetries(() => action === "revoke" ? auth.revokeRefreshTokens(uid) : auth.deleteUser(uid));
        } catch (err) {
            // Someone who never signed in to it has nothing there.
            if (!userNotFound(err)) console.error(`[apps] ${action} in ${app.id} failed for ${uid}`, err);
        }
    }));
}

/**
 * Signs `uid` out of every app: its sign-ins can't renew, so each ends within
 * the hour an ID token lasts, and its next one has its claims as they are now
 * (mintAppToken). Call it once a change is made, not in its transaction.
 */
export const signOutOfApps = (uid: string) => acrossApps(uid, "revoke");

/** Deletes a deleted account's user from every app, which signs it out there too. */
export const deleteFromApps = (uid: string) => acrossApps(uid, "delete");
