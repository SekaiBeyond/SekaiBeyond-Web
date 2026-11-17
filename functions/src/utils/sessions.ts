import { setTimeout as sleep } from "node:timers/promises";
import { type DecodedIdToken, getAuth } from "firebase-admin/auth";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { db } from "./firebase";
import { signOutOfApps } from "./apps";
import { requireNotBanned } from "./bans";

export const UNLISTED_GRACE_SECONDS = 10 * 60;

export function sessionIdOf(token: DecodedIdToken): string | null {
    const authTime = token.auth_time;
    return typeof authTime === "number" && Number.isFinite(authTime) ? String(Math.trunc(authTime)) : null;
}

export const SESSION_ID_RE = /^\d{1,12}$/;

export function sessionsRef(uid: string): FirebaseFirestore.CollectionReference {
    return db.collection("users").doc(uid).collection("sessions");
}

export function sessionRef(uid: string, sessionId: string): FirebaseFirestore.DocumentReference {
    return sessionsRef(uid).doc(sessionId);
}

export async function signInToken(uid: string): Promise<string> {
    await requireNotBanned(uid);
    return getAuth().createCustomToken(uid, {mintedAt: Date.now()});
}

export const isSiteSignIn = (token: DecodedIdToken): boolean =>
    token.firebase?.sign_in_provider === "custom" && token.app === undefined;

function signInBeganMillis(token: DecodedIdToken): number {
    return typeof token.mintedAt === "number" ? Math.min(token.mintedAt, token.auth_time * 1000) : 0;
}

export function signedInSinceSessionsEnded(
    token: DecodedIdToken,
    user: FirebaseFirestore.DocumentData | undefined,
): boolean {
    const endedAt: unknown = user?.sessionsEndedAt;
    return !(endedAt instanceof Timestamp) || signInBeganMillis(token) > endedAt.toMillis();
}

const SECOND_MARGIN_MS = 100;

async function markSessionsEnded(uid: string): Promise<Timestamp | null> {
    try {
        const result = await db.collection("users").doc(uid).update({sessionsEndedAt: FieldValue.serverTimestamp()});
        return result.writeTime;
    } catch (err) {
        if ((err as {code?: unknown})?.code === 5) return null;
        throw err;
    }
}

export async function endSessions(
    uid: string,
    keepSession: string | null,
    {revoke = true}: {revoke?: boolean} = {},
): Promise<number> {
    const markedAt = await markSessionsEnded(uid);

    const live = await sessionsRef(uid).where("endedAt", "==", null).get();
    const others = live.docs.filter(doc => doc.id !== keepSession);
    const batch = db.batch();
    for (const doc of others) batch.update(doc.ref, {endedAt: FieldValue.serverTimestamp()});
    if (others.length > 0) await batch.commit();

    if (revoke) {
        await getAuth().revokeRefreshTokens(uid).catch((err: unknown) => {
            if ((err as {code?: string})?.code !== "auth/user-not-found") throw err;
        });
    }
    await signOutOfApps(uid);

    if (markedAt) {
        const wait = (Math.floor(markedAt.toMillis() / 1000) + 1) * 1000 + SECOND_MARGIN_MS - Date.now();
        if (wait > 0) await sleep(wait);
    }
    return others.length;
}

interface DeviceInfo {
    browser: string;
    os: string;
    device: "mobile" | "tablet" | "desktop";
}

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
