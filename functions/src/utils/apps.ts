import { randomBytes } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import { HttpsError } from "firebase-functions/v2/https";
import { type App, initializeApp } from "firebase-admin/app";
import { type DecodedIdToken, getAuth } from "firebase-admin/auth";
import { Timestamp } from "firebase-admin/firestore";
import { RESERVED_ID_RE, soonestFirst } from "./events";
import { db } from "./firebase";

/**
 * Registered apps: other projects, such as SKBY Manager or a ticket seller's
 * app, that connect to Sekai Beyond. Core staff register apps in the Apps tool
 * (functions/apps.ts). An app may:
 *
 * - sign people in with their accounts here (issueAppToken), and read what of
 *   the site's data that person may see here, as far as the scopes the app was
 *   given allow (the person routes of functions/api.ts);
 * - hold server-to-server API keys (utils/apiKeys.ts) for the ticket API, with
 *   the app's ID as the namespace its order numbers live in;
 * - or both.
 *
 * A sign-in is a Firebase custom token for the app's own Firebase project,
 * signed through IAM as a service account of that project, as this project's
 * own are signed as the account the functions run as (see signInToken). So the
 * app's owner grants that account Service Account Token Creator on theirs,
 * and, for signing out here to sign people out there too, Firebase
 * Authentication Admin on their project.
 */

/**
 * What an app may read for the person signed in to it, each within what that
 * person may see here. Each person route of the API names the one it needs.
 */
export const APP_SCOPES = ["events:read", "team:read", "event-staff:read"] as const;
export type AppScope = typeof APP_SCOPES[number];

export function isAppScope(raw: unknown): raw is AppScope {
    return typeof raw === "string" && (APP_SCOPES as readonly string[]).includes(raw);
}

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
    /** The account that looks after it, "" for none. Shown on its sign-in page. */
    ownerUid: string;
    /**
     * Where sign-in may hand back to; empty when the app doesn't sign people
     * in. Their origins may call the API from a browser.
     */
    redirectUris: string[];
    /** What it may read for the person signed in; empty when sign-in is off. */
    scopes: AppScope[];
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
    const data = snap.data() as Partial<AppDoc> | undefined;
    if (!data) return null;
    return {
        id: snap.id,
        name: data.name ?? snap.id,
        ownerUid: data.ownerUid ?? "",
        redirectUris: data.redirectUris ?? [],
        scopes: (data.scopes ?? []).filter(isAppScope),
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
 * The most a sign-in's claims may take, as JSON. Firebase Auth refuses a
 * custom token whose claims are over 1,000 bytes, and they ride along on every
 * call the app makes to its Firestore, so `eventStaff` is cut to fit under.
 */
const APP_CLAIMS_MAX_BYTES = 900;

/** An event ID a user doc may hold that can be read: one a doc can have (see validateDocId). */
const isReadableEventId = (id: string) => id.length > 0 && id.length <= 128 && !/[/\0]/.test(id) && !RESERVED_ID_RE.test(id);

/**
 * The unarchived events among `eventIds`, in the order a sign-in names them:
 * those yet to end, soonest first, then any over but not yet archived, which
 * is done by hand. So when they don't all fit, the ones left off are over or
 * furthest off. An archived or deleted event isn't in upcomingEvents.
 */
async function unarchivedInClaimOrder(eventIds: string[]): Promise<string[]> {
    const ids = [...new Set(eventIds.filter(isReadableEventId))];
    if (ids.length === 0) return [];
    const events = soonestFirst(await db.getAll(...ids.map(id => db.collection("upcomingEvents").doc(id))));
    const now = Date.now();
    const over = (snap: FirebaseFirestore.DocumentSnapshot) => {
        const endAt: unknown = snap.get("endAt");
        return endAt instanceof Timestamp && endAt.toMillis() <= now;
    };
    return [...events.filter(snap => !over(snap)), ...events.filter(over)].map(snap => snap.id);
}

/** `claims` with `eventStaff`: as many of `eventIds`, in order, as fit in APP_CLAIMS_MAX_BYTES. */
function withEventStaff<T extends object>(claims: T, eventIds: string[]): T & {eventStaff: string[]} {
    const eventStaff: string[] = [];
    let bytes = Buffer.byteLength(JSON.stringify({...claims, eventStaff}));
    for (const id of eventIds) {
        const more = Buffer.byteLength(JSON.stringify(id)) + (eventStaff.length > 0 ? 1 : 0);
        if (bytes + more > APP_CLAIMS_MAX_BYTES) break;
        eventStaff.push(id);
        bytes += more;
    }
    return {...claims, eventStaff};
}

/**
 * A custom token to sign in to the app's Firebase project as `uid`, the
 * account's uid here. Its claims are on every ID token the sign-in renews to,
 * so an app's security rules can go by them:
 *
 * - `app`, which app it's for;
 * - `group`, the account's group here;
 * - `eventStaff`, only for an app with event-staff:read: the unarchived events
 *   the account is event staff for (see unarchivedInClaimOrder), as many as
 *   fit (APP_CLAIMS_MAX_BYTES). /v1/me lists every one;
 * - `mintedAt`, as on this project's own sign-ins, so signing out everywhere
 *   here reaches it (signedInSinceSessionsEnded).
 *
 * They're as of the sign-in, and a change to them signs the account out of
 * the apps whose sign-ins carry them (signOutOfApps, signOutOfEventStaffApps,
 * signEveryoneOutOf), so its next sign-in has them as they are now. /v1/me
 * has them as they are now. A custom token works for an hour, so one taken
 * before a change and used after carries the claims from before: apps check
 * that a sign-in was used soon after `mintedAt` (see the docs).
 */
export async function mintAppToken(
    app: RegisteredApp,
    uid: string,
    person: {group: string; eventStaffEvents: string[]},
): Promise<string> {
    const auth = getAuth(adminFor(app));
    const claims = {app: app.id, group: person.group, mintedAt: Date.now()};
    if (!app.scopes.includes("event-staff:read")) return auth.createCustomToken(uid, claims);
    return auth.createCustomToken(uid, withEventStaff(claims, await unarchivedInClaimOrder(person.eventStaffEvents)));
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
 * or of those `which` picks, once each. Logged, not thrown: it follows a
 * change already made here, which mustn't fail for it, and an app whose owner
 * hasn't granted Firebase Authentication Admin fails every time. The API
 * refuses such a sign-in from then on regardless.
 */
async function acrossApps(
    uid: string,
    action: "revoke" | "delete",
    which: (app: RegisteredApp) => boolean = () => true,
): Promise<void> {
    let apps: RegisteredApp[];
    try {
        // Fresh, so an app registered a moment ago isn't missed.
        apps = (await appsCol().get()).docs.map(doc => readApp(doc)!);
    } catch (err) {
        console.error(`[apps] couldn't list apps to ${action} ${uid} in`, err);
        return;
    }
    // Apps can share a project: it's picked if any of them is.
    const byProject = new Map(apps.filter(app => hasSignIn(app) && which(app)).map(app => [app.firebaseProjectId, app]));
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

const carriesEventStaff = (app: Pick<AppDoc, "scopes">) => app.scopes.includes("event-staff:read");

/**
 * Signs `uid` out of the apps whose sign-ins carry `eventStaff`, those with
 * event-staff:read, for a change to which unarchived events it staffs.
 */
export const signOutOfEventStaffApps = (uid: string) => acrossApps(uid, "revoke", carriesEventStaff);

/** Whether changing an app from `before` to `after` changes which claims its sign-ins carry. */
export const claimsChange = (before: Pick<AppDoc, "scopes">, after: Pick<AppDoc, "scopes">) =>
    carriesEventStaff(before) !== carriesEventStaff(after);

/**
 * Signs everyone signed in to `app` with an account here out of it: each user
 * of its project made by a sign-in from here, which has no provider of its
 * own, unlike one the app made itself. For a change to the claims its
 * sign-ins carry, so each person's next sign-in has them. Logged, not thrown,
 * as acrossApps. Says how many it signed out.
 */
export async function signEveryoneOutOf(app: RegisteredApp): Promise<number> {
    if (!hasSignIn(app)) return 0;
    const auth = getAuth(adminFor(app));
    let count = 0;
    try {
        let pageToken: string | undefined;
        do {
            const page = await withRetries(() => auth.listUsers(1000, pageToken));
            const ours = page.users.filter(user => user.providerData.length === 0);
            // A page at a time, as far under Auth's rate limit as a page of 1,000 is.
            for (let i = 0; i < ours.length; i += 50) {
                await Promise.all(ours.slice(i, i + 50).map(user => withRetries(() => auth.revokeRefreshTokens(user.uid))
                    .then(() => count++, err => {
                        if (!userNotFound(err)) console.error(`[apps] revoke in ${app.id} failed for ${user.uid}`, err);
                    })));
            }
            pageToken = page.pageToken;
        } while (pageToken);
    } catch (err) {
        console.error(`[apps] couldn't list ${app.id}'s users to sign them out`, err);
    }
    return count;
}

/** Deletes a deleted account's user from every app, which signs it out there too. */
export const deleteFromApps = (uid: string) => acrossApps(uid, "delete");
