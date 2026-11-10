import { type DecodedIdToken, getAuth } from "firebase-admin/auth";
import { FieldValue } from "firebase-admin/firestore";
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
 * Signs out every device but `keepSession`, or every one with null, and
 * revokes the Firebase sessions behind them, which also reaches a sign-in the
 * list never caught. The kept device needs a new sign-in after, as its refresh
 * token goes too. An account that has never signed in has no Firebase record
 * to revoke.
 */
export async function endSessions(uid: string, keepSession: string | null): Promise<void> {
    const live = await sessionsRef(uid).where("endedAt", "==", null).get();
    const others = live.docs.filter(doc => doc.id !== keepSession);
    // A person has a handful of devices, far under a batch's 500 writes.
    const batch = db.batch();
    for (const doc of others) batch.update(doc.ref, {endedAt: FieldValue.serverTimestamp()});
    if (others.length > 0) await batch.commit();

    await getAuth().revokeRefreshTokens(uid).catch((err: unknown) => {
        if ((err as {code?: string})?.code !== "auth/user-not-found") throw err;
    });
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
