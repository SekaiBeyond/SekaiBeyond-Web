import { type CallableOptions, type CallableRequest, HttpsError, onCall } from "firebase-functions/v2/https";
import { getAuth } from "firebase-admin/auth";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { setTimeout as sleep } from "node:timers/promises";
import {
    addressTakenMail,
    codeMail,
    emailChangedMail,
    emailChangeUndoneMail,
    emailSetByStaffMail,
    googleChangedMail,
    limitNoticedChange,
    type MailLanguage,
    passwordChangedMail,
    readMailLanguage,
    requireCodeMailRoom,
    sendAccountMail,
    sendNotice,
} from "../utils/accountMail";
import {
    creditScannedTickets,
    domainTakesMail,
    emailIndexRef,
    FORMER_EMAILS_MAX,
    nextEmailChangeAt,
    normalizeEmail,
} from "../utils/accountEmail";
import {
    consumeRateLimit,
    requireAdmin,
    requireAuth,
    requireCanManage,
    requireRegisteredSession,
    requireStaff,
} from "../utils/auth";
import {
    credentialsRef,
    type GoogleBinding,
    googleBindingOf,
    googleIndexRef,
    PASSWORD_PEPPER
} from "../utils/credentials";
import { type CodePurpose, consumeEmailCode, dropEmailCode, issueEmailCode } from "../utils/emailCodes";
import { EMAIL_UNDO_DAYS, emailUndoRef, emailUndoUrl, isEmailUndoToken, newEmailUndoToken } from "../utils/emailUndo";
import { db } from "../utils/firebase";
import { type GoogleIdentity, verifyGoogleToken } from "../utils/google";
import { checkNewPassword, hashPassword, readPasswordAttempt, verifyPassword } from "../utils/passwords";
import { recordDoc, recordRef } from "../utils/records";
import { RESEND_API_KEY, type ResendEnvelope } from "../utils/resendClient";
import { callerAddressKey } from "../utils/scans";
import { endSessions, sessionIdOf, signInToken } from "../utils/sessions";
import { STORAGE_HOST } from "../utils/storage";
import { sanitizeDisplayText, validateDocId, validateEmail } from "../utils/validation";

/**
 * Our own accounts. Signing in happens here: these check an email and password,
 * or a Google sign-in, against credentials/{uid}, and answer with a Firebase
 * custom token for the client to sign in with. That token is the only part of
 * Firebase Auth still used, since Firestore's rules and every callable read
 * who's asking from it.
 *
 * Anyone can call these signed out, so they're protected by App Check, the
 * limits below and answers that don't say whether an address has an account.
 */

const ACCOUNT_CALL: CallableOptions = {
    maxInstances: 20,
    memory: "512MiB",
    secrets: [RESEND_API_KEY, PASSWORD_PEPPER],
};

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;

// Per network, so loose enough for a venue's Wi-Fi all signing up at once.
const CODES_PER_HOUR_PER_NETWORK = 30;
const SIGN_INS_PER_MINUTE_PER_NETWORK = 60;
const UNDOS_PER_HOUR_PER_NETWORK = 30;

// Password tries on one address, by anyone and whether or not it has an account,
// so being stopped says nothing about it. Enough for someone working out which
// password they used, and far too few to guess one: the daily ceiling keeps a
// guesser who waits out each window to a few thousand tries a year. Forgot
// Password and Google still sign in while either is in force, so nobody can lock
// a person out by trying their address.
const SIGN_INS_PER_ADDRESS = 10;
const SIGN_INS_PER_ADDRESS_WINDOW_MS = 15 * MINUTE_MS;
const SIGN_INS_PER_ADDRESS_PER_DAY = 30;
const DAY_MS = 24 * HOUR_MS;

// What a code email takes to send, roughly, for when there's nothing to send.
const SEND_TIME_MS = 150;
const SEND_TIME_JITTER_MS = 300;

const limitNetwork = (request: CallableRequest, bucket: string, max: number, windowMs: number) =>
    consumeRateLimit(`${bucket}_${callerAddressKey(request.rawRequest)}`, max, windowMs);

const badCode = () => new HttpsError("permission-denied", "That code isn't right.", {code: "bad-code"});

const wrongCredentials = () =>
    new HttpsError("unauthenticated", "Wrong email or password.", {code: "wrong-credentials"});

const emailTaken = () =>
    new HttpsError("already-exists", "That email already has an account.", {code: "email-taken"});

const googleTaken = () =>
    new HttpsError("already-exists", "That Google account is bound to another account.", {code: "google-taken"});

const badUndoLink = () =>
    new HttpsError("not-found", "This link doesn't work.", {code: "bad-undo-link"});

/** Refuses an address whose domain can't receive mail, before a code is spent bouncing off it. */
async function requireMailDomain(email: string): Promise<void> {
    if (!await domainTakesMail(email)) {
        throw new HttpsError("invalid-argument", "That address can't receive email.", {code: "email-undeliverable"});
    }
}

/** When the account in `user` may next change its address, or null if it may now. */
function emailChangeLockedUntil(user: FirebaseFirestore.DocumentData | undefined): Date | null {
    const changedAt: Date | undefined = user?.emailChangedAt?.toDate?.();
    if (!changedAt) return null;
    const next = nextEmailChangeAt(changedAt);
    return next.getTime() > Date.now() ? next : null;
}

function requireEmailChangeAllowed(user: FirebaseFirestore.DocumentData | undefined): void {
    const lockedUntil = emailChangeLockedUntil(user);
    if (lockedUntil) {
        throw new HttpsError("failed-precondition", "Your email can only change once a month.", {
            code: "email-change-locked",
            allowedAt: lockedUntil.toISOString(),
        });
    }
}

function readCode(value: unknown): string {
    if (typeof value !== "string" || !/^\d{6}$/.test(value.trim())) throw badCode();
    return value.trim();
}

function readDisplayName(value: unknown): string {
    const name = sanitizeDisplayText(typeof value === "string" ? value : "").slice(0, 50);
    if (!name) throw new HttpsError("invalid-argument", "A name is required.", {code: "no-name"});
    return name;
}

/** Throws unless `code` is the live one. Goes last in a call, as it uses the code up. */
async function requireEmailCode(purpose: CodePurpose, email: string, code: string): Promise<void> {
    if (!await consumeEmailCode(purpose, email, code)) throw badCode();
}

/** Emails a code, or `instead` of one, unless `email` has had too many lately, which looks the same to the caller. */
async function mailCode(
    purpose: CodePurpose,
    email: string,
    language: MailLanguage,
    instead?: ResendEnvelope,
): Promise<void> {
    const code = await issueEmailCode(purpose, email);
    if (!code) return;
    try {
        await sendAccountMail(instead ?? codeMail(email, purpose, code, language), "code");
    } catch (err) {
        await dropEmailCode(purpose, email).catch(() => {
        });
        throw err;
    }
}

/**
 * Emails a code proving an address, ahead of the call it's for. The answer is
 * the same whether or not the address has an account: to sign up with one that
 * does, its owner gets told so instead of getting a code.
 */
export const sendEmailCode = onCall(ACCOUNT_CALL, async (request) => {
    const input = (request.data ?? {}) as {purpose?: unknown; email?: unknown; language?: unknown};
    const language = readMailLanguage(input.language);
    await limitNetwork(request, "code", CODES_PER_HOUR_PER_NETWORK, HOUR_MS);

    if (input.purpose === "signup") {
        const email = validateEmail(input.email, "email");
        await requireMailDomain(email);
        const taken = (await emailIndexRef(email).get()).exists;
        await mailCode("signup", email, language, taken ? addressTakenMail(email, language) : undefined);
    } else if (input.purpose === "password") {
        const email = validateEmail(input.email, "email");
        // Refused alike when no code could go out now, or a full mailbag would
        // tell an address with an account from one without.
        await requireCodeMailRoom();
        if ((await emailIndexRef(email).get()).exists) {
            await mailCode("password", email, language);
        } else {
            await sleep(SEND_TIME_MS + Math.random() * SEND_TIME_JITTER_MS);
        }
    } else if (input.purpose === "email-change") {
        const uid = await requireRegisteredSession(request, "account");
        const email = validateEmail(input.email, "email");
        const user = (await db.collection("users").doc(uid).get()).data();
        requireEmailChangeAllowed(user);
        if (email === user?.email) {
            throw new HttpsError("invalid-argument", "That's already your email.", {code: "same-email"});
        }
        await requireMailDomain(email);
        const taken = (await emailIndexRef(email).get()).exists;
        await mailCode("email-change", email, language, taken ? addressTakenMail(email, language) : undefined);
    } else {
        throw new HttpsError("invalid-argument", "Invalid purpose.");
    }
    return {sent: true};
});

const toBinding = (google: GoogleIdentity): GoogleBinding => ({
    sub: google.sub,
    email: google.email,
    name: google.name,
    photoURL: google.photoURL,
    signUpName: google.name,
});

const hasUploadedAvatar = (user: FirebaseFirestore.DocumentSnapshot): boolean => {
    const url: unknown = user.get("photoURL");
    return typeof url === "string" && url.includes(STORAGE_HOST);
};

interface NewAccount {
    email: string;
    displayName: string;
    photoURL: string;
    passwordHash: string | null;
    google: GoogleIdentity | null;
}

/**
 * Makes an account, whose address has been proven by now. The new doc's ID is
 * its uid. An address another account has moved off comes off that account's
 * former list, so it only ever leads to one account.
 */
async function createAccount({email, displayName, photoURL, passwordHash, google}: NewAccount): Promise<string> {
    const userRef = db.collection("users").doc();
    const uid = userRef.id;

    await db.runTransaction(async (txn) => {
        const [held, formerHolders, googleHeld] = await Promise.all([
            txn.get(emailIndexRef(email)),
            txn.get(db.collection("users").where("formerEmails", "array-contains", email)),
            google ? txn.get(googleIndexRef(google.sub)) : null,
        ]);
        if (held.exists) throw emailTaken();
        if (googleHeld?.exists) throw googleTaken();

        txn.set(emailIndexRef(email), {uid});
        for (const holder of formerHolders.docs) {
            txn.update(holder.ref, {formerEmails: FieldValue.arrayRemove(email)});
        }
        txn.set(userRef, {
            displayName,
            email,
            photoURL: photoURL.slice(0, 500),
            joinedAt: FieldValue.serverTimestamp(),
            attendedEvents: [],
            badges: [],
            group: "user",
            eventStaffEvents: [],
        });
        txn.set(credentialsRef(uid), {passwordHash, google: google ? toBinding(google) : null});
        if (google) txn.set(googleIndexRef(google.sub), {uid});
    });

    try {
        await creditScannedTickets(userRef, email);
    } catch (err) {
        // The account exists either way; a missed credit must not fail sign-up.
        console.error(`createAccount: ticket credit failed for ${uid}`, err);
    }
    return uid;
}

export const signUpWithEmail = onCall(ACCOUNT_CALL, async (request) => {
    const input = (request.data ?? {}) as {email?: unknown; code?: unknown; displayName?: unknown; password?: unknown};
    const email = validateEmail(input.email, "email");
    const code = readCode(input.code);
    const displayName = readDisplayName(input.displayName);
    const password = await checkNewPassword(input.password);

    await requireEmailCode("signup", email, code);
    const passwordHash = await hashPassword(password);
    const uid = await createAccount({email, displayName, photoURL: "", passwordHash, google: null});
    return {token: await signInToken(uid)};
});

/** The account `password` opens at `email`, or a refusal that doesn't say which part was wrong. */
async function checkPassword(request: CallableRequest, email: string, password: string): Promise<string> {
    await limitNetwork(request, "signin", SIGN_INS_PER_MINUTE_PER_NETWORK, MINUTE_MS);
    const address = emailIndexRef(email).id;
    await consumeRateLimit(`signin_${address}`, SIGN_INS_PER_ADDRESS, SIGN_INS_PER_ADDRESS_WINDOW_MS);
    await consumeRateLimit(`signin_day_${address}`, SIGN_INS_PER_ADDRESS_PER_DAY, DAY_MS);

    const uid: string | undefined = (await emailIndexRef(email).get()).get("uid");
    const stored: string | null | undefined = uid ? (await credentialsRef(uid).get()).get("passwordHash") : null;
    if (!await verifyPassword(password, stored) || !uid) throw wrongCredentials();
    return uid;
}

export const signInWithPassword = onCall(ACCOUNT_CALL, async (request) => {
    const input = (request.data ?? {}) as {email?: unknown; password?: unknown};
    const email = validateEmail(input.email, "email");
    const uid = await checkPassword(request, email, readPasswordAttempt(input.password));
    return {token: await signInToken(uid)};
});

/**
 * Sets a password, in place of any old one, and signs out the account's other
 * devices, since a changed password is often someone getting a stolen account
 * back. The device asking gets a new sign-in from its caller.
 */
async function setPassword(
    uid: string,
    email: string,
    password: string,
    keepSession: string | null,
    language: MailLanguage,
): Promise<void> {
    const passwordHash = await hashPassword(password);
    await credentialsRef(uid).set({passwordHash, passwordChangedAt: FieldValue.serverTimestamp()}, {merge: true});
    await endSessions(uid, keepSession);

    const displayName: string = (await db.collection("users").doc(uid).get()).get("displayName") ?? "";
    await recordRef().set(recordDoc("account-password-set", {
        performedBy: uid,
        performedByName: displayName,
        targetUid: uid,
        targetName: displayName,
    }));
    await sendNotice(await passwordChangedMail(email, language));
}

/**
 * Forgot Password, which also gives a password to an account that never had one:
 * every account made through Google before these existed. Signs in with it.
 */
export const resetPassword = onCall(ACCOUNT_CALL, async (request) => {
    const input = (request.data ?? {}) as {email?: unknown; code?: unknown; password?: unknown; language?: unknown};
    const email = validateEmail(input.email, "email");
    const code = readCode(input.code);
    const password = await checkNewPassword(input.password);

    await requireEmailCode("password", email, code);
    const uid: string | undefined = (await emailIndexRef(email).get()).get("uid");
    if (!uid) throw badCode();
    await limitNoticedChange(uid, "password");

    await setPassword(uid, email, password, null, readMailLanguage(input.language));
    return {token: await signInToken(uid)};
});

/**
 * An account of ours that Firebase Auth has this Google account on, but the
 * migration (functions/scripts/migrate-accounts.mts) missed, such as one made
 * while it ran. Without this its owner would be asked to make a second account.
 * An account with a credentials doc has moved over, so Google being off it
 * means it was unbound.
 */
async function adoptFromFirebase(google: GoogleIdentity): Promise<string | null> {
    let uid: string;
    try {
        uid = (await getAuth().getUserByProviderUid("google.com", google.sub)).uid;
    } catch (err) {
        if ((err as {code?: string})?.code === "auth/user-not-found") return null;
        throw err;
    }
    const userRef = db.collection("users").doc(uid);

    return db.runTransaction(async (txn) => {
        const [user, credentials] = await Promise.all([txn.get(userRef), txn.get(credentialsRef(uid))]);
        if (!user.exists || credentials.exists) return null;

        const storedEmail: string = user.get("email") ?? "";
        const email = normalizeEmail(storedEmail) || (google.emailVerified ? google.email : "");
        const held = email ? await txn.get(emailIndexRef(email)) : null;
        txn.set(credentialsRef(uid), {passwordHash: null, google: toBinding(google)});
        txn.set(googleIndexRef(google.sub), {uid});
        if (held && !held.exists) {
            txn.set(emailIndexRef(email), {uid});
            if (email !== storedEmail) txn.update(userRef, {email});
        }
        return uid;
    });
}

/** The account bound to a Google sign-in, if there is one, kept up to date with what Google says now. */
async function accountForGoogle(google: GoogleIdentity): Promise<string | null> {
    const uid: string | undefined = (await googleIndexRef(google.sub).get()).get("uid");
    if (!uid) return adoptFromFirebase(google);

    const credentials = await credentialsRef(uid).get();
    const bound = googleBindingOf(credentials);
    if (bound && (bound.email !== google.email || bound.name !== google.name || bound.photoURL !== google.photoURL)) {
        await credentials.ref.update({
            "google.email": google.email,
            "google.name": google.name,
            "google.photoURL": google.photoURL,
        });
        if (bound.photoURL !== google.photoURL) {
            const user = await db.collection("users").doc(uid).get();
            if (user.exists && !hasUploadedAvatar(user)) {
                await user.ref.update({photoURL: google.photoURL.slice(0, 500)});
            }
        }
    }
    return uid;
}

/**
 * Signs in with a Google account bound to an account. One that isn't gets its
 * details back instead, for the create-account prompt: no account or login
 * exists until that's finished, so walking away leaves nothing behind.
 */
export const signInWithGoogle = onCall(ACCOUNT_CALL, async (request) => {
    await limitNetwork(request, "signin", SIGN_INS_PER_MINUTE_PER_NETWORK, MINUTE_MS);
    const google = await verifyGoogleToken((request.data as {idToken?: unknown} | null)?.idToken);

    const uid = await accountForGoogle(google);
    if (uid) return {status: "signed-in" as const, token: await signInToken(uid)};

    const emailTakenByAccount = google.emailVerified && !!google.email
        && (await emailIndexRef(google.email).get()).exists;
    return {
        status: "needs-account" as const,
        name: sanitizeDisplayText(google.name).slice(0, 50),
        email: google.email,
        emailVerified: google.emailVerified,
        emailTaken: emailTakenByAccount,
    };
});

/**
 * The create-account prompt. Google has proven its own address, so that needs no
 * code; any other address does, from sendEmailCode. The password is optional, as
 * Google signs them in; Forgot Password gives them one later if they want.
 */
export const createAccountWithGoogle = onCall(ACCOUNT_CALL, async (request) => {
    const input = (request.data ?? {}) as {
        idToken?: unknown;
        displayName?: unknown;
        email?: unknown;
        code?: unknown;
        password?: unknown;
    };
    const google = await verifyGoogleToken(input.idToken);
    const displayName = readDisplayName(input.displayName);
    const email = validateEmail(input.email, "email");
    const password = input.password ? await checkNewPassword(input.password) : null;

    if (email !== google.email || !google.emailVerified) {
        await requireEmailCode("signup", email, readCode(input.code));
    }
    const passwordHash = password ? await hashPassword(password) : null;
    const uid = await createAccount({email, displayName, photoURL: google.photoURL, passwordHash, google});
    return {token: await signInToken(uid)};
});

/**
 * Binds a Google account to `uid`, which may only have the one, and tells the
 * account's address: a binding outlives a password reset, so someone who got
 * into the account briefly could otherwise keep a way back in unnoticed.
 */
async function bindGoogleTo(uid: string, google: GoogleIdentity, language: MailLanguage): Promise<void> {
    const notifyEmail = await db.runTransaction(async (txn) => {
        const [held, credentials, user] = await Promise.all([
            txn.get(googleIndexRef(google.sub)),
            txn.get(credentialsRef(uid)),
            txn.get(db.collection("users").doc(uid)),
        ]);
        if (held.exists && held.get("uid") !== uid) throw googleTaken();
        const bound = googleBindingOf(credentials);
        if (bound && bound.sub !== google.sub) {
            throw new HttpsError("already-exists", "This account already has a Google account bound.", {
                code: "google-already-bound",
            });
        }

        txn.set(credentials.ref, {google: toBinding(google)}, {merge: true});
        txn.set(held.ref, {uid});
        if (!hasUploadedAvatar(user)) {
            txn.update(user.ref, {photoURL: google.photoURL.slice(0, 500)});
        }
        const displayName: string = user.get("displayName") ?? "";
        txn.set(recordRef(), recordDoc("account-google-bind", {
            performedBy: uid,
            performedByName: displayName,
            targetUid: uid,
            targetName: displayName,
        }));
        return bound ? "" : (user.get("email") as string | undefined) ?? "";
    });
    if (notifyEmail) await sendNotice(await googleChangedMail(notifyEmail, google.email, true, language));
}

/** The prompt's "I already have an account": signs in with a password and binds the Google account to it. */
export const bindGoogleWithPassword = onCall(ACCOUNT_CALL, async (request) => {
    const input = (request.data ?? {}) as {
        idToken?: unknown;
        email?: unknown;
        password?: unknown;
        language?: unknown;
    };
    const google = await verifyGoogleToken(input.idToken);
    const email = validateEmail(input.email, "email");
    const uid = await checkPassword(request, email, readPasswordAttempt(input.password));
    await limitNoticedChange(uid, "google");

    await bindGoogleTo(uid, google, readMailLanguage(input.language));
    return {token: await signInToken(uid)};
});

/** For a signed-in account, from Settings. */
export const bindGoogle = onCall(ACCOUNT_CALL, async (request) => {
    const uid = await requireRegisteredSession(request, "account");
    const input = (request.data ?? {}) as {idToken?: unknown; language?: unknown};
    const google = await verifyGoogleToken(input.idToken);
    await limitNoticedChange(uid, "google");
    await bindGoogleTo(uid, google, readMailLanguage(input.language));
    return {bound: true};
});

/**
 * Takes Google off the Firebase Auth record an older account has, since Firebase's
 * own Google sign-in would otherwise work until it's turned off.
 */
async function unlinkFirebaseGoogle(uid: string): Promise<void> {
    await getAuth().updateUser(uid, {providersToUnlink: ["google.com"]}).catch((err: unknown) => {
        if ((err as {code?: string})?.code !== "auth/user-not-found") throw err;
    });
}

/**
 * Takes the Google account off the caller's account, which needs a password to
 * still be signed in to.
 */
export const unbindGoogle = onCall(ACCOUNT_CALL, async (request) => {
    const uid = await requireRegisteredSession(request, "account");
    const language = readMailLanguage((request.data as {language?: unknown} | null)?.language);
    await limitNoticedChange(uid, "google");

    const unbound = await db.runTransaction(async (txn) => {
        const [credentials, user] = await Promise.all([
            txn.get(credentialsRef(uid)),
            txn.get(db.collection("users").doc(uid)),
        ]);
        const google = googleBindingOf(credentials);
        if (!google) return null;
        if (!credentials.get("passwordHash")) {
            throw new HttpsError("failed-precondition", "Set a password before unbinding Google.", {
                code: "needs-password",
            });
        }

        txn.update(credentials.ref, {google: null});
        txn.delete(googleIndexRef(google.sub));
        if (!hasUploadedAvatar(user) && user.get("photoURL")) {
            txn.update(user.ref, {photoURL: ""});
        }
        const displayName: string = user.get("displayName") ?? "";
        txn.set(recordRef(), recordDoc("account-google-unbind", {
            performedBy: uid,
            performedByName: displayName,
            targetUid: uid,
            targetName: displayName,
        }));
        return {email: (user.get("email") as string | undefined) ?? "", googleEmail: google.email};
    });

    await unlinkFirebaseGoogle(uid);
    if (unbound?.email) {
        await sendNotice(await googleChangedMail(unbound.email, unbound.googleEmail, false, language));
    }
    return {unbound: true};
});

/**
 * How an account signs in, without anything that signs it in: for its owner's
 * Settings tab, and for staff on the admin user page.
 */
export const getSignInMethods = onCall({maxInstances: 20}, async (request) => {
    const uid = await requireAuth(request, "account");
    const raw = (request.data as {uid?: unknown} | null)?.uid;
    const targetUid = raw === undefined ? uid : validateDocId(raw, "uid");
    if (targetUid !== uid) await requireStaff(uid);

    const [user, credentials] = await Promise.all([
        db.collection("users").doc(targetUid).get(),
        credentialsRef(targetUid).get(),
    ]);
    const google = googleBindingOf(credentials);
    return {
        hasPassword: !!credentials.get("passwordHash"),
        googleEmail: google ? google.email : null,
        emailChangeAllowedAt: emailChangeLockedUntil(user.data())?.toISOString() ?? null,
    };
});

/** Changes a password from Settings. The code stands in for the old password, which an account may not have. */
export const changePassword = onCall(ACCOUNT_CALL, async (request) => {
    const uid = await requireRegisteredSession(request, "account");
    const input = (request.data ?? {}) as {code?: unknown; password?: unknown; language?: unknown};
    const code = readCode(input.code);
    const password = await checkNewPassword(input.password);
    const email: string = (await db.collection("users").doc(uid).get()).get("email") ?? "";

    await requireEmailCode("password", email, code);
    await limitNoticedChange(uid, "password");
    await setPassword(uid, email, password, sessionIdOf(request.auth!.token), readMailLanguage(input.language));
    // This device's sign-in was revoked with the rest, so it gets a new one.
    return {token: await signInToken(uid)};
});

/**
 * Moves an account to `email`, whose owner has been proven or vouched for by now.
 * The old address joins the account's former list, and leaves the index for
 * anyone else to take. `by` is who's acting. An `ownChange` is held to the month
 * between changes, starts the next one, and can be undone from the old address
 * (undoEmailChange); staff stepping in does none of that.
 */
async function moveEmail(
    uid: string,
    email: string,
    by: {uid: string; name: string},
    ownChange: boolean,
): Promise<{oldEmail: string; undoToken: string | null}> {
    const userRef = db.collection("users").doc(uid);

    return db.runTransaction(async (txn) => {
        const [user, held, formerHolders] = await Promise.all([
            txn.get(userRef),
            txn.get(emailIndexRef(email)),
            txn.get(db.collection("users").where("formerEmails", "array-contains", email)),
        ]);
        if (!user.exists) throw new HttpsError("not-found", "User not found.");
        if (held.exists) throw emailTaken();
        if (ownChange) requireEmailChangeAllowed(user.data());

        const oldEmail: string = user.get("email") ?? "";
        const oldIndex = oldEmail ? await txn.get(emailIndexRef(oldEmail)) : null;

        if (oldIndex?.get("uid") === uid) txn.delete(oldIndex.ref);
        txn.set(emailIndexRef(email), {uid});
        for (const holder of formerHolders.docs) {
            if (holder.id !== uid) txn.update(holder.ref, {formerEmails: FieldValue.arrayRemove(email)});
        }

        const former: string[] = user.get("formerEmails") ?? [];
        txn.update(userRef, {
            email,
            formerEmails: [oldEmail, ...former].filter(a => a && a !== email).slice(0, FORMER_EMAILS_MAX),
            ...(ownChange ? {emailChangedAt: FieldValue.serverTimestamp()} : {}),
        });
        txn.set(recordRef(), recordDoc("account-email-change", {
            performedBy: by.uid,
            performedByName: by.name,
            targetUid: uid,
            targetName: user.get("displayName") ?? "",
            targetEmail: email,
            oldEmail,
        }));

        const undoToken = ownChange && oldEmail ? newEmailUndoToken() : null;
        if (undoToken) {
            txn.set(emailUndoRef(undoToken), {
                uid,
                oldEmail,
                newEmail: email,
                expiresAt: Timestamp.fromMillis(Date.now() + EMAIL_UNDO_DAYS * 24 * HOUR_MS),
            });
        }
        return {oldEmail, undoToken};
    });
}

/** The heads-up to the old address, and the attendance the new one was scanned into. */
async function afterEmailMoved(
    uid: string,
    oldEmail: string,
    email: string,
    language: MailLanguage,
    undoToken: string | null = null,
): Promise<void> {
    const undoUrl = undoToken ? emailUndoUrl(undoToken) : undefined;
    if (oldEmail) await sendNotice(await emailChangedMail(oldEmail, email, language, undoUrl));
    try {
        await creditScannedTickets(db.collection("users").doc(uid), email);
    } catch (err) {
        // The address has moved either way; getMyTickets backfills while the event runs.
        console.error(`afterEmailMoved: ticket credit failed for ${uid}`, err);
    }
}

export const changeEmail = onCall(ACCOUNT_CALL, async (request) => {
    const uid = await requireRegisteredSession(request, "account");
    const input = (request.data ?? {}) as {email?: unknown; code?: unknown; language?: unknown};
    const email = validateEmail(input.email, "email");
    const code = readCode(input.code);

    const user = await db.collection("users").doc(uid).get();
    requireEmailChangeAllowed(user.data());
    await requireEmailCode("email-change", email, code);

    const by = {uid, name: user.get("displayName") ?? ""};
    const {oldEmail, undoToken} = await moveEmail(uid, email, by, true);
    await afterEmailMoved(uid, oldEmail, email, readMailLanguage(input.language), undoToken);
    return {email};
});

/**
 * The "This wasn't me" link: puts an account back on the address it moved off,
 * and shuts every way in that the change could have opened. Someone who got in
 * could have set a password on their own address, bound their own Google account,
 * or asked for the account to be deleted, so all of that goes, and the new
 * password set here is the only way in left. The address it moved to comes off
 * the former list too, or tickets bought under it would stay on the account.
 *
 * The address must still be the one the link moved it to: once staff have stepped
 * in, or the owner has moved on, this link is out of date. Nothing signs in here:
 * every device is being signed out, and the one asking signs in fresh with the
 * new password. The address it moved to is told, in case this link was the wrong
 * person's: the old mailbox may be why the owner moved.
 */
export const undoEmailChange = onCall(ACCOUNT_CALL, async (request) => {
    const input = (request.data ?? {}) as {token?: unknown; password?: unknown; language?: unknown};
    await limitNetwork(request, "undo", UNDOS_PER_HOUR_PER_NETWORK, HOUR_MS);
    if (!isEmailUndoToken(input.token)) throw badUndoLink();
    const undoRef = emailUndoRef(input.token);
    const password = await checkNewPassword(input.password);
    const passwordHash = await hashPassword(password);

    const {uid, oldEmail, newEmail} = await db.runTransaction(async (txn) => {
        const undo = await txn.get(undoRef);
        const expiresAt: Timestamp | undefined = undo.get("expiresAt");
        if (!expiresAt || expiresAt.toMillis() <= Date.now()) throw badUndoLink();
        const uid: string = undo.get("uid");
        const oldEmail: string = undo.get("oldEmail");
        const newEmail: string = undo.get("newEmail");

        const [user, credentials, oldHeld, newHeld, formerHolders] = await Promise.all([
            txn.get(db.collection("users").doc(uid)),
            txn.get(credentialsRef(uid)),
            txn.get(emailIndexRef(oldEmail)),
            txn.get(emailIndexRef(newEmail)),
            txn.get(db.collection("users").where("formerEmails", "array-contains", oldEmail)),
        ]);
        if (!user.exists || user.get("email") !== newEmail) throw badUndoLink();
        if (oldHeld.exists) throw emailTaken();

        txn.delete(undoRef);
        if (newHeld.get("uid") === uid) txn.delete(newHeld.ref);
        txn.set(oldHeld.ref, {uid});
        for (const holder of formerHolders.docs) {
            if (holder.id !== uid) txn.update(holder.ref, {formerEmails: FieldValue.arrayRemove(oldEmail)});
        }

        const former: string[] = user.get("formerEmails") ?? [];
        txn.update(user.ref, {
            email: oldEmail,
            formerEmails: former.filter(a => a !== oldEmail && a !== newEmail),
            ...(hasUploadedAvatar(user) ? {} : {photoURL: ""}),
            emailChangedAt: FieldValue.delete(),
            deleteAt: FieldValue.delete(),
            deletionRequestedBy: FieldValue.delete(),
        });

        const google = googleBindingOf(credentials);
        if (google) txn.delete(googleIndexRef(google.sub));
        txn.set(credentials.ref, {
            passwordHash,
            passwordChangedAt: FieldValue.serverTimestamp(),
            google: null,
        }, {merge: true});

        const displayName: string = user.get("displayName") ?? "";
        txn.set(recordRef(), recordDoc("account-email-undo", {
            performedBy: uid,
            performedByName: displayName,
            targetUid: uid,
            targetName: displayName,
            targetEmail: oldEmail,
            oldEmail: newEmail,
        }));
        return {uid, oldEmail, newEmail};
    });

    await endSessions(uid, null);
    await unlinkFirebaseGoogle(uid);
    await sendNotice(await emailChangeUndoneMail(newEmail, readMailLanguage(input.language)));
    return {email: oldEmail};
});

/**
 * Staff moving an account to a new address, for someone who has lost their
 * mailbox and so can't get a code. Core staff can do this to anyone they can
 * manage, so it's on the Records tab and both addresses are told.
 */
export const adminChangeEmail = onCall(ACCOUNT_CALL, async (request) => {
    const uid = await requireAuth(request, "staff");
    const input = (request.data ?? {}) as {targetUid?: unknown; email?: unknown; language?: unknown};
    const targetUid = validateDocId(input.targetUid, "targetUid");
    const email = validateEmail(input.email, "email");
    const language = readMailLanguage(input.language);

    const caller = await requireAdmin(uid);
    const target = await db.collection("users").doc(targetUid).get();
    if (!target.exists) throw new HttpsError("not-found", "User not found.");
    requireCanManage(caller.get("group"), target.get("group"));

    const {oldEmail} = await moveEmail(targetUid, email, {uid, name: caller.get("displayName") ?? ""}, false);
    await sendNotice(await emailSetByStaffMail(email, language));
    await afterEmailMoved(targetUid, oldEmail, email, language);
    return {email};
});
