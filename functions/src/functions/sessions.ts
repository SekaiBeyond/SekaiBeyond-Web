import { type CallableRequest, HttpsError, onCall } from "firebase-functions/v2/https";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { claimAccountEmail, verifiedEmail } from "../utils/accountEmail";
import { requireAuth } from "../utils/auth";
import { db } from "../utils/firebase";
import { describeUserAgent, SESSION_ID_RE, sessionIdOf, sessionRef, sessionsRef } from "../utils/sessions";

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
 * session behind.
 *
 * Also brings the account's email up to date when its Google account's has
 * changed, taking the address off any other account (see
 * utils/accountEmail.ts).
 */
export const touchSession = onCall({maxInstances: 20}, async (request) => {
    const {uid, sessionId} = await requireSession(request);
    const device = describeUserAgent(request.rawRequest?.headers?.["user-agent"]);
    const ref = sessionRef(uid, sessionId);
    const email = verifiedEmail(request.auth!.token);

    const registered = await db.runTransaction(async (txn) => {
        const [userSnap, snap] = await Promise.all([
            txn.get(db.collection("users").doc(uid)),
            txn.get(ref),
        ]);
        if (!userSnap.exists) return false;
        // Signed out between requireAuth and here: endedAt must not be undone.
        if (snap.data()?.endedAt) {
            throw new HttpsError("unauthenticated", "This device has been signed out.", {code: "session-ended"});
        }
        if (email && userSnap.get("email") !== email) {
            const releaseOthers = await claimAccountEmail(txn, uid, email);
            releaseOthers(userSnap.get("displayName") ?? "");
            txn.update(userSnap.ref, {email});
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

/** Signs out every device on the caller's account but the one they call from. */
export const endOtherSessions = onCall({maxInstances: 10}, async (request) => {
    const {uid, sessionId: own} = await requireSession(request);

    const snap = await sessionsRef(uid).where("endedAt", "==", null).get();
    const others = snap.docs.filter(doc => doc.id !== own);
    // A person has a handful of devices, far under a batch's 500 writes.
    const batch = db.batch();
    for (const doc of others) batch.update(doc.ref, {endedAt: FieldValue.serverTimestamp()});
    if (others.length > 0) await batch.commit();

    return {ended: others.length};
});
