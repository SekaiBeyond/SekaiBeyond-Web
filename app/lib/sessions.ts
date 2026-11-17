import { useEffect, useState } from 'react';
import { onIdTokenChanged, type User } from 'firebase/auth';
import { collection, doc, onSnapshot, query, type QueryDocumentSnapshot, where } from 'firebase/firestore';
import { toDate } from '~/lib/collectionCache';
import {
    callTouchSession,
    functionsErrorCode,
    functionsErrorDetails,
    getFirebaseAuth,
    getFirebaseDb,
} from '~/lib/firebase';

export interface DeviceSession {
    id: string;
    browser: string;
    os: string;
    device: 'mobile' | 'tablet' | 'desktop';
    signedInAt: Date | null;
    lastActiveAt: Date | null;
}

const TOUCH_INTERVAL_MS = 15 * 60_000;

const TOUCH_RETRY_MS = 2_000;
const TOUCH_RETRY_MAX_MS = 60_000;

const REPLACED_SIGN_IN_WAIT_MS = 2_000;

export async function currentSessionId(user: User): Promise<string | null> {
    try {
        const authTime: unknown = (await user.getIdTokenResult()).claims.auth_time;
        return authTime ? String(authTime) : null;
    } catch {
        return null;
    }
}

export function signInMovedOn(endedId: string): Promise<boolean> {
    return new Promise(resolve => {
        let settled = false;
        let unsubscribe = () => {
        };
        const settle = (moved: boolean) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            unsubscribe();
            resolve(moved);
        };
        const timer = setTimeout(() => settle(false), REPLACED_SIGN_IN_WAIT_MS);
        const off = onIdTokenChanged(getFirebaseAuth(), user => {
            if (!user) {
                settle(false);
                return;
            }
            void currentSessionId(user).then(id => {
                if (id && id !== endedId) settle(true);
            });
        });
        unsubscribe = off;
        if (settled) off();
    });
}

export async function sessionEnded(): Promise<boolean> {
    try {
        await callTouchSession();
        return false;
    } catch (err) {
        return functionsErrorCode(err) === 'session-ended';
    }
}

export function watchOwnSession(uid: string, sessionId: string, onEnded: () => void): () => void {
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

export function deviceName(session: DeviceSession, isEnglish: boolean): string {
    const {browser, os} = session;
    if (browser && os) return isEnglish ? `${browser} on ${os}` : `${os} 上的 ${browser}`;
    return browser || os || (isEnglish ? 'Unknown device' : '未知设备');
}
