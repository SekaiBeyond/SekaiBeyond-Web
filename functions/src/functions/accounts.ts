import { type CallableOptions, type CallableRequest, HttpsError, onCall } from "firebase-functions/v2/https";
import { getAuth } from "firebase-admin/auth";
import { FieldValue } from "firebase-admin/firestore";
import { setTimeout as sleep } from "node:timers/promises";
import { addressTakenMail, codeMail, type MailLanguage, passwordChangedMail, readMailLanguage, sendAccountMail, sendNotice } from "../utils/accountMail";
import { creditScannedTickets, emailIndexRef } from "../utils/accountEmail";
import { consumeRateLimit } from "../utils/auth";
import { credentialsRef, type GoogleBinding, googleBindingOf, googleIndexRef, PASSWORD_PEPPER } from "../utils/credentials";
import { type CodePurpose, consumeEmailCode, dropEmailCode, issueEmailCode } from "../utils/emailCodes";
import { db } from "../utils/firebase";
import { type GoogleIdentity, verifyGoogleToken } from "../utils/google";
import { hashPassword, readPasswordAttempt, validateNewPassword, verifyPassword } from "../utils/passwords";
import { recordDoc, recordRef } from "../utils/records";
import { RESEND_API_KEY, type ResendEnvelope } from "../utils/resendClient";
import { callerAddressKey } from "../utils/scans";
import { sessionsRef } from "../utils/sessions";
import { sanitizeDisplayText, validateEmail } from "../utils/validation";

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

// Password tries on one address, by anyone and whether or not it has an account,
// so being stopped says nothing about it. Enough for someone working out which
// password they used, and far too few to guess one. Forgot Password still works
// while this is in force, so nobody can lock a person out by trying their address.
const SIGN_INS_PER_ADDRESS = 10;
const SIGN_INS_PER_ADDRESS_WINDOW_MS = 15 * MINUTE_MS;

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
        await sendAccountMail(instead ?? codeMail(email, purpose, code, language));
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
        const taken = (await emailIndexRef(email).get()).exists;
        await mailCode("signup", email, language, taken ? addressTakenMail(email, language) : undefined);
    } else if (input.purpose === "password") {
        const email = validateEmail(input.email, "email");
        if ((await emailIndexRef(email).get()).exists) {
            await mailCode("password", email, language);
        } else {
            await sleep(SEND_TIME_MS + Math.random() * SEND_TIME_JITTER_MS);
        }
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
    const password = validateNewPassword(input.password);

    await requireEmailCode("signup", email, code);
    const passwordHash = await hashPassword(password);
    const uid = await createAccount({email, displayName, photoURL: "", passwordHash, google: null});
    return {token: await getAuth().createCustomToken(uid)};
});

/** The account `password` opens at `email`, or a refusal that doesn't say which part was wrong. */
async function checkPassword(request: CallableRequest, email: string, password: string): Promise<string> {
    await limitNetwork(request, "signin", SIGN_INS_PER_MINUTE_PER_NETWORK, MINUTE_MS);
    await consumeRateLimit(
        `signin_${emailIndexRef(email).id}`,
        SIGN_INS_PER_ADDRESS,
        SIGN_INS_PER_ADDRESS_WINDOW_MS,
    );

    const uid: string | undefined = (await emailIndexRef(email).get()).get("uid");
    const stored: string | null | undefined = uid ? (await credentialsRef(uid).get()).get("passwordHash") : null;
    if (!await verifyPassword(password, stored) || !uid) throw wrongCredentials();
    return uid;
}

export const signInWithPassword = onCall(ACCOUNT_CALL, async (request) => {
    const input = (request.data ?? {}) as {email?: unknown; password?: unknown};
    const email = validateEmail(input.email, "email");
    const uid = await checkPassword(request, email, readPasswordAttempt(input.password));
    return {token: await getAuth().createCustomToken(uid)};
});

/**
 * Signs out every device but `keepSession` (see utils/sessions.ts), and revokes
 * the Firebase sessions behind them. An account that has never signed in has no
 * Firebase record to revoke.
 */
async function endSessions(uid: string, keepSession: string | null): Promise<void> {
    const live = await sessionsRef(uid).where("endedAt", "==", null).get();
    const others = live.docs.filter(doc => doc.id !== keepSession);
    // A person has a handful of devices, far under a batch's 500 writes.
    const batch = db.batch();
    for (const doc of others) batch.update(doc.ref, {endedAt: FieldValue.serverTimestamp()});
    if (others.length > 0) await batch.commit();

    await getAuth().revokeRefreshTokens(uid).catch((err: unknown) => {
        if ((err as {code?: string})?.code !== "auth/user-not-found") throw err;
    });
}

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
    const password = validateNewPassword(input.password);

    await requireEmailCode("password", email, code);
    const uid: string | undefined = (await emailIndexRef(email).get()).get("uid");
    if (!uid) throw badCode();

    await setPassword(uid, email, password, null, readMailLanguage(input.language));
    return {token: await getAuth().createCustomToken(uid)};
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

        const email: string = user.get("email") ?? "";
        const held = email ? await txn.get(emailIndexRef(email)) : null;
        txn.set(credentialsRef(uid), {passwordHash: null, google: toBinding(google)});
        txn.set(googleIndexRef(google.sub), {uid});
        if (held && !held.exists) txn.set(emailIndexRef(email), {uid});
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
    if (uid) return {status: "signed-in" as const, token: await getAuth().createCustomToken(uid)};

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
    const password = input.password ? validateNewPassword(input.password) : null;

    if (email !== google.email || !google.emailVerified) {
        await requireEmailCode("signup", email, readCode(input.code));
    }
    const passwordHash = password ? await hashPassword(password) : null;
    const uid = await createAccount({email, displayName, photoURL: google.photoURL, passwordHash, google});
    return {token: await getAuth().createCustomToken(uid)};
});

/** Binds a Google account to `uid`, which may only have the one. */
async function bindGoogleTo(uid: string, google: GoogleIdentity): Promise<void> {
    await db.runTransaction(async (txn) => {
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
        const displayName: string = user.get("displayName") ?? "";
        txn.set(recordRef(), recordDoc("account-google-bind", {
            performedBy: uid,
            performedByName: displayName,
            targetUid: uid,
            targetName: displayName,
        }));
    });
}

/** The prompt's "I already have an account": signs in with a password and binds the Google account to it. */
export const bindGoogleWithPassword = onCall(ACCOUNT_CALL, async (request) => {
    const input = (request.data ?? {}) as {idToken?: unknown; email?: unknown; password?: unknown};
    const google = await verifyGoogleToken(input.idToken);
    const email = validateEmail(input.email, "email");
    const uid = await checkPassword(request, email, readPasswordAttempt(input.password));

    await bindGoogleTo(uid, google);
    return {token: await getAuth().createCustomToken(uid)};
});
