import { HttpsError } from "firebase-functions/v2/https";
import { getAuth } from "firebase-admin/auth";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { db } from "./firebase";

interface Ban {
    until: Date | null;
}

const usersCol = () => db.collection("users");

export const BAN_NOTES_CLEARED = {
    banReason: FieldValue.delete(),
    bannedBy: FieldValue.delete(),
    bannedByName: FieldValue.delete(),
};

export const BAN_CLEARED = {
    bannedAt: FieldValue.delete(),
    bannedUntil: FieldValue.delete(),
    ...BAN_NOTES_CLEARED,
};

export const hasBan = (user: FirebaseFirestore.DocumentData | undefined): boolean =>
    user?.bannedAt instanceof Timestamp;

export function activeBan(user: FirebaseFirestore.DocumentData | undefined): Ban | null {
    if (!hasBan(user)) return null;
    const until: unknown = user!.bannedUntil;
    if (!(until instanceof Timestamp)) return {until: null};
    return until.toMillis() > Date.now() ? {until: until.toDate()} : null;
}

const accountBanned = (ban: Ban) =>
    new HttpsError("permission-denied", "This account has been banned.", {
        code: "account-banned",
        until: ban.until?.toISOString() ?? null,
    });

export async function setAuthDisabled(uid: string, disabled: boolean): Promise<void> {
    await getAuth().updateUser(uid, {disabled}).catch((err: unknown) => {
        if ((err as {code?: string})?.code !== "auth/user-not-found") throw err;
    });
}

export async function enableSignIn(uid: string): Promise<void> {
    await setAuthDisabled(uid, false);
    if (activeBan((await usersCol().doc(uid).get()).data())) await setAuthDisabled(uid, true);
}

export async function requireNotBanned(uid: string): Promise<void> {
    const ref = usersCol().doc(uid);
    const user = (await ref.get()).data();
    const ban = activeBan(user);
    if (ban) throw accountBanned(ban);
    if (!hasBan(user)) return;

    const cleared = await db.runTransaction(async (txn) => {
        const fresh = (await txn.get(ref)).data();
        const again = activeBan(fresh);
        if (again) throw accountBanned(again);
        if (!hasBan(fresh)) return false;
        txn.update(ref, BAN_CLEARED);
        return true;
    });
    if (cleared) await enableSignIn(uid);
}
