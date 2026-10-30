import type { DecodedIdToken } from "firebase-admin/auth";
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
 * call it makes after. The doc stays for good, since its refresh token never
 * expires on its own.
 */

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
