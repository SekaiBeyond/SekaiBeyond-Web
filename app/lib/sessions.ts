import { useEffect, useState } from 'react';
import type { User } from 'firebase/auth';
import { collection, doc, onSnapshot, query, type QueryDocumentSnapshot, where } from 'firebase/firestore';
import { toDate } from '~/lib/collectionCache';
import { callTouchSession, functionsErrorCode, functionsErrorDetails, getFirebaseDb } from '~/lib/firebase';

/**
 * The devices signed in to an account, one doc each in users/{uid}/sessions,
 * named by the sign-in's auth_time (see functions/src/utils/sessions.ts).
 */

export interface DeviceSession {
    id: string;
    /** "" when its user agent didn't say. */
    browser: string;
    os: string;
    device: 'mobile' | 'tablet' | 'desktop';
    signedInAt: Date | null;
    lastActiveAt: Date | null;
}

/** How old this device's last-active time may get before it's brought up to date. */
const TOUCH_INTERVAL_MS = 15 * 60_000;

/** How long after a failed touch the next one waits, doubling each time up to the longest. */
const TOUCH_RETRY_MS = 2_000;
const TOUCH_RETRY_MAX_MS = 60_000;

/** This sign-in's session ID, or null when its token can't be read. */
export async function currentSessionId(user: User): Promise<string | null> {
    try {
        // A number on the wire, whatever the SDK's type says.
        const authTime: unknown = (await user.getIdTokenResult()).claims.auth_time;
        return authTime ? String(authTime) : null;
    } catch {
        return null;
    }
}

/**
 * Whether the server has refused this sign-in for good: signed out from another
 * device, or never listed in time. firestore.rules refuses its reads too, and
 * touchSession tells that apart from anything else going wrong, listing it
 * instead if it can be.
 */
export async function sessionEnded(): Promise<boolean> {
    try {
        await callTouchSession();
        return false;
    } catch (err) {
        return functionsErrorCode(err) === 'session-ended';
    }
}

/**
 * Keeps this device in its account's device list while it's signed in: adds
 * it, marks it active on load and when its tab comes back after a while, and
 * calls `onEnded` once it has been signed out from another device. Returns a
 * stop function, safe to call twice.
 *
 * A touch that fails is tried again, sooner at first. The server refuses a
 * sign-in that hasn't listed itself within its first minutes
 * (UNLISTED_GRACE_SECONDS in functions/src/utils/sessions.ts), and a first
 * touch can fail on nothing worse than the rate limit it shares with every
 * other call, or a dropped connection.
 */
export function watchOwnSession(uid: string, sessionId: string, onEnded: () => void): () => void {
    // When the doc says it was last active; null before it exists.
    let lastActive: number | null = null;
    let touching = false;
    let stopped = false;
    let retryDelay = TOUCH_RETRY_MS;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    const end = () => {
        if (stopped) return;
        stop();
        onEnded();
    };

    // `waitMs` is how long the server said to wait, when it was a rate limit.
    const retryLater = (waitMs = 0) => {
        if (stopped || retryTimer !== null) return;
        const delay = Math.min(Math.max(retryDelay, waitMs), TOUCH_RETRY_MAX_MS);
        retryDelay = Math.min(retryDelay * 2, TOUCH_RETRY_MAX_MS);
        retryTimer = setTimeout(() => {
            retryTimer = null;
            touchIfStale();
        }, delay);
    };

    const touchIfStale = () => {
        if (stopped || touching) return;
        if (lastActive !== null && Date.now() - lastActive < TOUCH_INTERVAL_MS) return;
        touching = true;
        callTouchSession()
            .then(() => {
                // Without waiting for the doc, so a doc that can't be read
                // isn't touched on every return to the tab.
                lastActive = Date.now();
                retryDelay = TOUCH_RETRY_MS;
            })
            .catch(err => {
                if (functionsErrorCode(err) === 'session-ended') {
                    end();
                    return;
                }
                retryLater(functionsErrorDetails<{retryAfterMs?: number}>(err)?.retryAfterMs);
            })
            .finally(() => {
                touching = false;
            });
    };

    const unsubscribe = onSnapshot(
        doc(getFirebaseDb(), 'users', uid, 'sessions', sessionId),
        snap => {
            const data = snap.data();
            if (data?.endedAt) {
                end();
                return;
            }
            lastActive = toDate(data?.lastActiveAt)?.getTime() ?? lastActive;
            touchIfStale();
        },
        // Still listed when the doc can't be watched; touchSession says if it ended.
        () => touchIfStale(),
    );

    const onVisible = () => {
        if (document.visibilityState === 'visible') touchIfStale();
    };
    document.addEventListener('visibilitychange', onVisible);

    function stop() {
        if (stopped) return;
        stopped = true;
        unsubscribe();
        document.removeEventListener('visibilitychange', onVisible);
        if (retryTimer !== null) clearTimeout(retryTimer);
    }

    return stop;
}

const DEVICE_TYPES = ['mobile', 'tablet', 'desktop'] as const;

function toDeviceSession(snap: QueryDocumentSnapshot): DeviceSession {
    const data = snap.data();
    return {
        id: snap.id,
        browser: typeof data.browser === 'string' ? data.browser : '',
        os: typeof data.os === 'string' ? data.os : '',
        device: DEVICE_TYPES.includes(data.device) ? data.device : 'desktop',
        signedInAt: toDate(data.signedInAt),
        lastActiveAt: toDate(data.lastActiveAt),
    };
}

/**
 * The devices signed in to `uid`'s account, most recently active first, kept
 * up to date as devices sign in and out. Null while loading.
 */
export function useDeviceSessions(uid: string | null): {sessions: DeviceSession[] | null; failed: boolean} {
    const [sessions, setSessions] = useState<DeviceSession[] | null>(null);
    const [failed, setFailed] = useState(false);

    useEffect(() => {
        setSessions(null);
        setFailed(false);
        if (!uid) return;
        return onSnapshot(
            query(collection(getFirebaseDb(), 'users', uid, 'sessions'), where('endedAt', '==', null)),
            snap => {
                setSessions(snap.docs.map(toDeviceSession).sort(
                    (a, b) => (b.lastActiveAt?.getTime() ?? 0) - (a.lastActiveAt?.getTime() ?? 0),
                ));
                setFailed(false);
            },
            () => setFailed(true),
        );
    }, [uid]);

    return {sessions, failed};
}

/** "Chrome on macOS", or whichever half is known. */
export function deviceName(session: DeviceSession, isEnglish: boolean): string {
    const {browser, os} = session;
    if (browser && os) return isEnglish ? `${browser} on ${os}` : `${os} 上的 ${browser}`;
    return browser || os || (isEnglish ? 'Unknown device' : '未知设备');
}
