import { type CallableRequest, HttpsError } from "firebase-functions/v2/https";
import { FieldValue } from "firebase-admin/firestore";
import { db } from "./firebase";

export const RATE_LIMIT_WINDOW_MS = 60_000;
export const RATE_LIMIT_MAX = 10;

export async function checkRateLimit(uid: string): Promise<void> {
    const ref = db.collection("rateLimits").doc(uid);
    const now = Date.now();
    // expiresAt is used by Firestore TTL policy to auto-delete stale documents.
    // Configure TTL on the "expiresAt" field in the Firebase console.
    const expiresAt = new Date(now + RATE_LIMIT_WINDOW_MS * 2);

    await db.runTransaction(async (txn) => {
        const snap = await txn.get(ref);
        const data = snap.data() as {count: number; windowStart: number} | undefined;

        if (!data || now - data.windowStart > RATE_LIMIT_WINDOW_MS) {
            txn.set(ref, {count: 1, windowStart: now, expiresAt});
            return;
        }

        if (data.count >= RATE_LIMIT_MAX) {
            throw new HttpsError("resource-exhausted", "Too many requests. Please wait a moment.", {code: "rate-limited"});
        }

        txn.update(ref, {count: FieldValue.increment(1)});
    });
}

export const ADMIN_GROUPS = ["core-staff", "president"];

export async function requireAuth(request: CallableRequest<unknown>): Promise<string> {
    if (!request.auth) {
        throw new HttpsError("unauthenticated", "Must be signed in.");
    }
    const uid = request.auth.uid;
    await checkRateLimit(uid);
    return uid;
}

export async function requireAdmin(uid: string): Promise<FirebaseFirestore.DocumentSnapshot> {
    return db.runTransaction(async (txn) => {
        const snap = await txn.get(db.collection("users").doc(uid));
        if (!ADMIN_GROUPS.includes(snap.data()?.group)) {
            throw new HttpsError("permission-denied", "Insufficient permissions.");
        }
        return snap;
    });
}

export async function adminTransaction<T>(
    uid: string,
    fn: (txn: FirebaseFirestore.Transaction, callerSnap: FirebaseFirestore.DocumentSnapshot) => Promise<T>
): Promise<T> {
    return db.runTransaction(async (txn) => {
        const callerSnap = await txn.get(db.collection("users").doc(uid));
        if (!ADMIN_GROUPS.includes(callerSnap.data()?.group)) {
            throw new HttpsError("permission-denied", "Insufficient permissions.");
        }
        return fn(txn, callerSnap);
    });
}
