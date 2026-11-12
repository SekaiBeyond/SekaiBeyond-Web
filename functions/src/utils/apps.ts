import { type App, initializeApp } from "firebase-admin/app";
import { type DecodedIdToken, getAuth } from "firebase-admin/auth";
import { Timestamp } from "firebase-admin/firestore";
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
export interface AppDoc {
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

/** Firestore keeps IDs like __x__ for itself and can't read one, so no event has one. */
const READABLE_ID_RE = /^(?!__.*__$)[^/\0]{1,128}$/;

/**
 * The unarchived events among `eventIds`, soonest first, as the site lists
 * them: an archived or deleted event isn't in upcomingEvents, and one missing
 * its start isn't one.
 */
async function unarchivedSoonestFirst(eventIds: string[]): Promise<string[]> {
    const ids = [...new Set(eventIds.filter(id => READABLE_ID_RE.test(id)))];
    if (ids.length === 0) return [];
    const snaps = await db.getAll(...ids.map(id => db.collection("upcomingEvents").doc(id)));
    const startMs = (snap: FirebaseFirestore.DocumentSnapshot) => (snap.get("startAt") as Timestamp).toMillis();
    return snaps
        .filter(snap => snap.get("startAt") instanceof Timestamp)
        .sort((a, b) => startMs(a) - startMs(b) || (a.id < b.id ? -1 : 1))
        .map(snap => snap.id);
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
 *   the account is event staff for, soonest first, with the furthest left off
 *   past what fits (APP_CLAIMS_MAX_BYTES). /v1/me lists every one;
 * - `mintedAt`, as on this project's own sign-ins, so signing out everywhere
 *   here reaches it (signedInSinceSessionsEnded).
 *
 * They're as of the sign-in, and changing the account's group or which
 * unarchived events it staffs signs it out of every app (signOutOfApps), so
 * its next sign-in has them as they are now. /v1/me has them as they are now.
 */
export async function mintAppToken(
    app: RegisteredApp,
    uid: string,
    person: {group: string; eventStaffEvents: string[]},
): Promise<string> {
    const auth = getAuth(adminFor(app));
    const claims = {app: app.id, group: person.group, mintedAt: Date.now()};
    if (!app.scopes.includes("event-staff:read")) return auth.createCustomToken(uid, claims);
    return auth.createCustomToken(uid, withEventStaff(claims, await unarchivedSoonestFirst(person.eventStaffEvents)));
}

/** An ID token from the app's Firebase project, checked as Firebase Auth issued it. Throws if it isn't one. */
export function verifyAppIdToken(app: RegisteredApp, idToken: string): Promise<DecodedIdToken> {
    return getAuth(adminFor(app)).verifyIdToken(idToken);
}

const userNotFound = (err: unknown) => (err as {code?: string})?.code === "auth/user-not-found";

/**
 * Does `action` to `uid` in every app's Firebase project, once each. Logged,
 * not thrown: it follows a change already made here, which mustn't fail for
 * it, and an app whose owner hasn't granted Firebase Authentication Admin
 * fails every time. The API refuses such a sign-in from then on regardless.
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
    const byProject = new Map(apps.filter(hasSignIn).map(app => [app.firebaseProjectId, app]));
    await Promise.all([...byProject.values()].map(async app => {
        const auth = getAuth(adminFor(app));
        try {
            if (action === "revoke") await auth.revokeRefreshTokens(uid);
            else await auth.deleteUser(uid);
        } catch (err) {
            // Someone who never signed in to it has nothing there.
            if (!userNotFound(err)) console.warn(`[apps] ${action} in ${app.id} failed for ${uid}`, err);
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
