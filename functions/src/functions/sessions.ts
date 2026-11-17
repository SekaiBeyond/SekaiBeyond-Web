import { type CallableRequest, HttpsError, onCall } from "firebase-functions/v2/https";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { requireAuth, requireRegisteredSession } from "../utils/auth";
import { activeBan } from "../utils/bans";
import { db } from "../utils/firebase";
import {
    describeUserAgent,
    endSessions,
    SESSION_ID_RE,
    sessionIdOf,
    sessionRef,
    signedInSinceSessionsEnded,
} from "../utils/sessions";

async function requireSession(request: CallableRequest): Promise<{uid: string; sessionId: string}> {
    const uid = await requireAuth(request);
    const sessionId = sessionIdOf(request.auth!.token);
    if (!sessionId) throw new HttpsError("failed-precondition", "This sign-in has no session.");
    return {uid, sessionId};
}

export const touchSession = onCall({maxInstances: 20}, async (request) => {
    const {uid, sessionId} = await requireSession(request);
    const device = describeUserAgent(request.rawRequest?.headers?.["user-agent"]);
    const ref = sessionRef(uid, sessionId);

    const registered = await db.runTransaction(async (txn) => {
        const [userSnap, snap] = await Promise.all([
            txn.get(db.collection("users").doc(uid)),
            txn.get(ref),
        ]);
        if (!userSnap.exists) return false;
        if (snap.data()?.endedAt || activeBan(userSnap.data())
            || (!snap.exists && !signedInSinceSessionsEnded(request.auth!.token, userSnap.data()))) {
            throw new HttpsError("unauthenticated", "This device has been signed out.", {code: "session-ended"});
        }
        txn.set(ref, {
            ...device,
            lastActiveAt: FieldValue.serverTimestamp(),
            ...(snap.exists ? {} : {
                signedInAt: Timestamp.fromMillis(Number(sessionId) * 1000),
                endedAt: null,
            }),
        }, {merge: true});
        return true;
    });

    return {registered};
});

export const endSession = onCall({maxInstances: 10}, async (request) => {
    const {uid, sessionId: own} = await requireSession(request);
    const raw = (request.data as {sessionId?: unknown} | null)?.sessionId;
    if (raw !== undefined && (typeof raw !== "string" || !SESSION_ID_RE.test(raw))) {
        throw new HttpsError("invalid-argument", "Invalid sessionId.");
    }
    const target = raw ?? own;
    const ref = sessionRef(uid, target);

    if (target === own) {
        await ref.delete();
        return {ended: true};
    }

    await db.runTransaction(async (txn) => {
        const snap = await txn.get(ref);
        if (!snap.exists || snap.data()?.endedAt) return;
        txn.update(ref, {endedAt: FieldValue.serverTimestamp()});
    });
    return {ended: true};
});

export const endOtherSessions = onCall({maxInstances: 10}, async (request) => {
    const uid = await requireRegisteredSession(request);
    const own = sessionIdOf(request.auth!.token);
    return {ended: await endSessions(uid, own, {revoke: false})};
});

export const endAllSessions = onCall({maxInstances: 10}, async (request) => {
    const uid = await requireAuth(request);
    await endSessions(uid, null);
    return {ended: true};
});
