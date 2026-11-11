import { type DecodedIdToken, getAuth } from "firebase-admin/auth";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { db } from "./firebase";

/**
 * Each device signed in to an account is a doc in users/{uid}/sessions, named
 * by its ID token's auth_time: the second the browser signed in, which every
 * token it refreshes to keeps. So the server can tell which sign-in a call
 * comes from without the client saying. Two browsers signing in to one
 * account in the same second share a row, and signing one out signs out both.
 *
 * Firebase Auth can only revoke every one of an account's sign-ins at once, so
 * signing one device out is done here: its doc is kept with `endedAt` set, the
 * device watches its doc and signs itself out, and requireAuth refuses any
 * call it makes after, as firestore.rules (liveSession) refuses its reads. The
 * doc stays for good, since its refresh token never expires on its own.
 *
 * A sign-in with no doc is refused the same way once UNLISTED_GRACE_SECONDS
 * have passed, or one that never listed itself, such as a stolen token, would
 * be out of reach of signing other devices out.
 *
 * Within those minutes it has no doc to end either, so signing devices out
 * also stamps the account's user doc with `sessionsEndedAt`, and a sign-in
 * with no doc that began before then is refused, and may not list itself
 * (signedInSinceSessionsEnded). firestore.rules (liveSession) does the same.
 */

/**
 * How long a new sign-in may go without a doc. A device lists itself once it
 * has loaded (touchSession), so a real one is listed within seconds. Written
 * into firestore.rules (liveSession) as well, so keep the two the same.
 */
export const UNLISTED_GRACE_SECONDS = 10 * 60;

/** The session a token belongs to, or null for a token without auth_time. */
export function sessionIdOf(token: DecodedIdToken): string | null {
    const authTime = token.auth_time;
    return typeof authTime === "number" && Number.isFinite(authTime) ? String(Math.trunc(authTime)) : null;
}

/** What a session ID looks like, for checking one a client names. */
export const SESSION_ID_RE = /^\d{1,12}$/;

export function sessionsRef(uid: string): FirebaseFirestore.CollectionReference {
    return db.collection("users").doc(uid).collection("sessions");
}

export function sessionRef(uid: string, sessionId: string): FirebaseFirestore.DocumentReference {
    return sessionsRef(uid).doc(sessionId);
}

/**
 * A token to sign in to `uid` with, which every sign-in the functions give out
 * goes through. It says when it was made (`mintedAt`, in milliseconds), as a
 * custom token works for an hour and its sign-in's auth_time is only when it's
 * used: one taken before the account's devices were signed out and used after
 * would otherwise count as a sign-in from after.
 */
export function signInToken(uid: string): Promise<string> {
    return getAuth().createCustomToken(uid, {mintedAt: Date.now()});
}

/**
 * When a sign-in began, in milliseconds: the earlier of when its token was
 * made (`mintedAt`) and its `auth_time`, or `auth_time` alone for Firebase
 * Auth's own providers. A custom-token sign-in that doesn't say when it was
 * made, which no token from signInToken is, counts as the oldest.
 */
function signInBeganMillis(token: DecodedIdToken): number {
    const authMillis = token.auth_time * 1000;
    if (typeof token.mintedAt === "number") return Math.min(token.mintedAt, authMillis);
    return token.firebase?.sign_in_provider === "custom" ? 0 : authMillis;
}

/**
 * Whether a sign-in began after the account's devices were last signed out
 * (`sessionsEndedAt` on its user doc `user`). Only asked of a sign-in with no
 * doc: one with a doc that was live then has been ended since. An auth_time is
 * in whole seconds, so one in the same second as the sign-out counts as before
 * (endSessions waits that second out). Written into firestore.rules
 * (liveSession) as well, so keep the two the same.
 */
export function signedInSinceSessionsEnded(
    token: DecodedIdToken,
    user: FirebaseFirestore.DocumentData | undefined,
): boolean {
    const endedAt: unknown = user?.sessionsEndedAt;
    return !(endedAt instanceof Timestamp) || signInBeganMillis(token) > endedAt.toMillis();
}

/** How far past the second endSessions waits, for the clocks of Auth and the functions to differ by. */
const SECOND_MARGIN_MS = 100;

/**
 * Stamps `sessionsEndedAt` on the account's user doc, and says when, or null
 * for an account with no user doc, which has nothing to sign in to.
 */
async function markSessionsEnded(uid: string): Promise<Timestamp | null> {
    try {
        const result = await db.collection("users").doc(uid).update({sessionsEndedAt: FieldValue.serverTimestamp()});
        return result.writeTime;
    } catch (err) {
        // 5 is NOT_FOUND: no user doc.
        if ((err as {code?: unknown})?.code === 5) return null;
        throw err;
    }
}

/**
 * Signs out every device but `keepSession`, or every one with null, and with
 * `revoke` (the default) revokes the Firebase sessions behind them. The kept
 * device needs a new sign-in after a revoke, as its refresh token goes too.
 * An account that has never signed in has no Firebase record to revoke.
 *
 * A sign-in the list never caught is reached by `sessionsEndedAt`, stamped
 * before the list is read: a device listing itself (touchSession) reads the
 * user doc in its transaction, so it either listed itself in time to be ended
 * here or sees the stamp and is refused. Returns once the second of the stamp
 * is over, so a sign-in after, such as the kept device's new one, has a later
 * auth_time. Says how many devices it signed out.
 */
export async function endSessions(
    uid: string,
    keepSession: string | null,
    {revoke = true}: {revoke?: boolean} = {},
): Promise<number> {
    const markedAt = await markSessionsEnded(uid);

    const live = await sessionsRef(uid).where("endedAt", "==", null).get();
    const others = live.docs.filter(doc => doc.id !== keepSession);
    // A person has a handful of devices, far under a batch's 500 writes.
    const batch = db.batch();
    for (const doc of others) batch.update(doc.ref, {endedAt: FieldValue.serverTimestamp()});
    if (others.length > 0) await batch.commit();

    if (revoke) {
        await getAuth().revokeRefreshTokens(uid).catch((err: unknown) => {
            if ((err as {code?: string})?.code !== "auth/user-not-found") throw err;
        });
    }

    if (markedAt) {
        const wait = (Math.floor(markedAt.toMillis() / 1000) + 1) * 1000 + SECOND_MARGIN_MS - Date.now();
        if (wait > 0) await new Promise(resolve => setTimeout(resolve, wait));
    }
    return others.length;
}

export interface DeviceInfo {
    /** "" when the user agent doesn't say. */
    browser: string;
    os: string;
    device: "mobile" | "tablet" | "desktop";
}

// In order: Edge, Opera, Samsung Internet and the in-app browsers all say
// Chrome and Safari too, and Chrome says Safari.
const BROWSERS: Array<[RegExp, string]> = [
    [/MicroMessenger\//, "WeChat"],
    [/\bQQ\//, "QQ"],
    [/(?:MQQBrowser|QQBrowser)\//, "QQ Browser"],
    [/\bLine\//, "LINE"],
    [/Instagram/, "Instagram"],
    [/FBAN|FBAV/, "Facebook"],
    [/Edg(?:e|A|iOS)?\//, "Edge"],
    [/OPR\/|Opera/, "Opera"],
    [/SamsungBrowser\//, "Samsung Internet"],
    [/Firefox\/|FxiOS\//, "Firefox"],
    [/CriOS\/|Chrome\//, "Chrome"],
    [/Version\/[\d.]+.*Safari\//, "Safari"],
];

/**
 * A browser, system and kind of device read from a user agent, for the device
 * list. Only these are kept, not the user agent itself. An iPad asking for the
 * desktop site says it's a Mac, so it shows as one.
 */
export function describeUserAgent(raw: string | string[] | undefined): DeviceInfo {
    const ua = (Array.isArray(raw) ? raw.join(" ") : raw ?? "").slice(0, 1000);
    const browser = BROWSERS.find(([re]) => re.test(ua))?.[1] ?? "";

    if (/iPad/.test(ua)) return {browser, os: "iPadOS", device: "tablet"};
    if (/iPhone|iPod/.test(ua)) return {browser, os: "iOS", device: "mobile"};
    if (/Android/.test(ua)) return {browser, os: "Android", device: /Mobile/.test(ua) ? "mobile" : "tablet"};

    const os = /CrOS/.test(ua) ? "ChromeOS"
        : /Windows/.test(ua) ? "Windows"
            : /Mac OS X|Macintosh/.test(ua) ? "macOS"
                : /Linux/.test(ua) ? "Linux"
                    : "";
    return {browser, os, device: "desktop"};
}
