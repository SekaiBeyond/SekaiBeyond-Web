import { type App, initializeApp } from "firebase-admin/app";
import { type DecodedIdToken, getAuth } from "firebase-admin/auth";

/**
 * SKBY Manager, the core team's project tool, is a Firebase project of its
 * own. Core staff sign in to it with their accounts here: issueManagerToken
 * (functions/manager.ts) makes them a sign-in for the manager's project, which
 * its rules read `group` and `accessUntil` from, and managerApi serves it the
 * team and event staff. Off unless all three settings are in functions/.env
 * (see .env.example).
 */

const PROJECT_ID = process.env.MANAGER_PROJECT_ID ?? "";
// The manager project's Admin SDK service account. Its sign-ins are signed as
// it, through IAM, as this project's own are signed as the account the
// functions run as (see signInToken).
const SERVICE_ACCOUNT = process.env.MANAGER_SERVICE_ACCOUNT ?? "";

/** Where the manager is served, as an origin (https://host, no path), or "" when MANAGER_ORIGIN isn't one. */
export const MANAGER_ORIGIN = (() => {
    const raw = process.env.MANAGER_ORIGIN ?? "";
    if (!raw) return "";
    try {
        if (new URL(raw).origin === raw) return raw;
    } catch {
        // Logged below, as for any other value that isn't an origin.
    }
    // Not thrown: a bad value mustn't stop every function loading.
    console.error(`[manager] MANAGER_ORIGIN must be an origin such as https://skby-manager.web.app, not ${raw}`);
    return "";
})();

export const managerConfigured = PROJECT_ID !== "" && SERVICE_ACCOUNT !== "" && MANAGER_ORIGIN !== "";

/**
 * How long a manager sign-in lasts, whatever happens here meanwhile. Losing
 * access here ends it sooner (revokeManagerAccess); this ends one whose revoke
 * failed. The manager then sends its holder back here for a new one.
 */
export const MANAGER_ACCESS_MS = 24 * 60 * 60 * 1000;

let app: App | null = null;

/** The Admin SDK for the manager's project, using this project's credentials. */
function managerApp(): App {
    app ??= initializeApp({projectId: PROJECT_ID, serviceAccountId: SERVICE_ACCOUNT}, "manager");
    return app;
}

/**
 * A custom token to sign in to the manager's project as `uid`, which is the
 * account's uid here. Its claims are on every ID token the sign-in renews to:
 * `group` and `accessUntil` (milliseconds) for the manager's rules, and
 * `mintedAt` as on this project's own sign-ins, so signing out everywhere here
 * reaches it (signedInSinceSessionsEnded).
 */
export function mintManagerToken(uid: string, group: string): Promise<string> {
    const mintedAt = Date.now();
    return getAuth(managerApp()).createCustomToken(uid, {
        group,
        mintedAt,
        accessUntil: mintedAt + MANAGER_ACCESS_MS,
    });
}

/** An ID token from the manager's project, checked as Firebase Auth issued it. Throws if it isn't one. */
export function verifyManagerIdToken(idToken: string): Promise<DecodedIdToken> {
    return getAuth(managerApp()).verifyIdToken(idToken);
}

const userNotFound = (err: unknown) => (err as {code?: string})?.code === "auth/user-not-found";

/**
 * Signs `uid` out of the manager. Its sign-ins there can't renew after this,
 * so the last one ends within the hour an ID token lasts. Logged, not thrown:
 * it follows a change already made here, which mustn't fail for it, and
 * `accessUntil` ends a sign-in it misses. Someone who has never signed in to
 * the manager has nothing to revoke.
 */
export async function revokeManagerAccess(uid: string): Promise<void> {
    if (!managerConfigured) return;
    try {
        await getAuth(managerApp()).revokeRefreshTokens(uid);
    } catch (err) {
        if (!userNotFound(err)) console.error(`[manager] revoking sign-ins failed for ${uid}`, err);
    }
}

/** Deletes a deleted account's user from the manager's project, which signs it out there too. Logged, as revokeManagerAccess. */
export async function deleteManagerUser(uid: string): Promise<void> {
    if (!managerConfigured) return;
    try {
        await getAuth(managerApp()).deleteUser(uid);
    } catch (err) {
        if (!userNotFound(err)) console.error(`[manager] deleting the user failed for ${uid}`, err);
    }
}
