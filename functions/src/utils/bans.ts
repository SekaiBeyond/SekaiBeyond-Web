import { HttpsError } from "firebase-functions/v2/https";
import { getAuth } from "firebase-admin/auth";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { db } from "./firebase";

/**
 * A ban keeps an account from signing in, to the site or to any app, until it
 * runs out or staff lift it (banUser, unbanUser). It lives on the user doc:
 *
 * - `bannedAt`, when it was made;
 * - `bannedUntil`, when it runs out, absent for a ban until lifted;
 * - `banReason`, staff's note, which the account isn't shown;
 * - `bannedBy` and `bannedByName`, who made it.
 *
 * Banning signs every device out (endSessions) and disables the account's
 * Firebase Auth record, which also shuts Firebase's own Google sign-in that
 * older accounts still have. Every sign-in the functions give out checks it
 * first (signInToken). There's no scheduled job: a ban that has run out is
 * cleared the next time the account signs in (requireNotBanned).
 */

export interface Ban {
    /** Null for a ban until lifted. */
    until: Date | null;
}

const usersCol = () => db.collection("users");

/** What clears a ban off a user doc. */
export const BAN_CLEARED = {
    bannedAt: FieldValue.delete(),
    bannedUntil: FieldValue.delete(),
    banReason: FieldValue.delete(),
    bannedBy: FieldValue.delete(),
    bannedByName: FieldValue.delete(),
};

/** Whether the user doc `user` has a ban on it, in force or run out. */
export const hasBan = (user: FirebaseFirestore.DocumentData | undefined): boolean =>
    user?.bannedAt instanceof Timestamp;

/** The ban in force on the account in `user`, or null for none or one that has run out. */
export function activeBan(user: FirebaseFirestore.DocumentData | undefined): Ban | null {
    if (!hasBan(user)) return null;
    const until: unknown = user!.bannedUntil;
    if (!(until instanceof Timestamp)) return {until: null};
    return until.toMillis() > Date.now() ? {until: until.toDate()} : null;
}

/** The refusal a banned account gets, saying until when for the sign-in page to show. */
export const accountBanned = (ban: Ban) =>
    new HttpsError("permission-denied", "This account has been banned.", {
        code: "account-banned",
        until: ban.until?.toISOString() ?? null,
    });

/** Sets whether Firebase Auth refuses the account. One that has never signed in has no record there, and needs none. */
export async function setAuthDisabled(uid: string, disabled: boolean): Promise<void> {
    await getAuth().updateUser(uid, {disabled}).catch((err: unknown) => {
        if ((err as {code?: string})?.code !== "auth/user-not-found") throw err;
    });
}

/**
 * Lets Firebase Auth sign the account in again, after its ban is cleared. A
 * ban made meanwhile has disabled it before this enabled it, which the read
 * after catches, or disables it after.
 */
export async function enableSignIn(uid: string): Promise<void> {
    await setAuthDisabled(uid, false);
    if (activeBan((await usersCol().doc(uid).get()).data())) await setAuthDisabled(uid, true);
}

/**
 * Refuses an account under a ban, before anything signs it in. One whose ban
 * has run out has it cleared here, unless staff have banned it again since.
 */
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
