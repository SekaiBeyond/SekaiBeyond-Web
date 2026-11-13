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

/** The caller and the session their call comes from. requireAuth has already refused an ended one. */
async function requireSession(request: CallableRequest): Promise<{uid: string; sessionId: string}> {
    const uid = await requireAuth(request);
    const sessionId = sessionIdOf(request.auth!.token);
    if (!sessionId) throw new HttpsError("failed-precondition", "This sign-in has no session.");
    return {uid, sessionId};
}

/**
 * Registers the caller's device in their device list, or marks it active
 * again, with what its user agent says it is. The device calls this once it
 * has loaded and every so often while open. Nothing is written for an account
 * whose user doc is gone, so a deleted account's last token can't leave a
 * session behind, nor for a sign-in from before the account's devices were
 * last signed out, which would otherwise outlive it (see utils/sessions.ts).
 */
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
        // Signed out between requireAuth and here: endedAt must not be undone,
        // nor a sign-in the sign-out missed be listed after it. Reading the
        // user doc here is what keeps endSessions from missing it. Nor is one
        // listed for an account under a ban.
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

/**
 * Signs one of the caller's devices out. Their own, or none named, is removed
 * from the list, as signing out does; another is kept with `endedAt` set, which
 * signs that device out and refuses its calls (see utils/sessions.ts). One
 * already signed out or not in the list answers the same, as there is nothing
 * left to do.
 */
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

/**
 * Signs out every device on the caller's account but the one they call from,
 * which has to be on the list, as the button for this is: a sign-in the list
 * never caught goes too, and an unlisted caller would be one of those. Nothing
 * is revoked with Firebase Auth, which would sign the caller out as well.
 */
export const endOtherSessions = onCall({maxInstances: 10}, async (request) => {
    const uid = await requireRegisteredSession(request);
    const own = sessionIdOf(request.auth!.token);
    return {ended: await endSessions(uid, own, {revoke: false})};
});

/**
 * Signs out every device on the caller's account, theirs too, and revokes
 * every Firebase sign-in, so one the list never caught goes as well. The
 * caller's own row is ended rather than removed, so its watcher signs it out
 * even if the caller doesn't. Needs no session, as nothing is kept.
 */
export const endAllSessions = onCall({maxInstances: 10}, async (request) => {
    const uid = await requireAuth(request);
    await endSessions(uid, null);
    return {ended: true};
});
