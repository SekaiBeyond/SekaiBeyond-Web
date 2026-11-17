import { type CallableOptions, type CallableRequest, HttpsError, onCall } from "firebase-functions/v2/https";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { setTimeout as sleep } from "node:timers/promises";
import {
    addressHeldMail,
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
    requireNoticeMailRoom,
    sendAccountMail,
    sendNotice,
} from "../utils/accountMail";
import {
    creditScannedTickets,
    domainTakesMail,
    emailIndexRef,
    formerEmailsAfter,
    nextEmailChangeAt,
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
    PASSWORD_PEPPER,
} from "../utils/credentials";
import { requireNotBanned } from "../utils/bans";
import {
    accountLinksQuery,
    type AppLinkDoc,
    appLinkUserName,
    disownLinkInTxn,
    readLinkDisown,
} from "../utils/appLinks";
import { appRecordName, appsCol, readApp } from "../utils/apps";
import { CODE_MAIL_HOURLY_CAP } from "../utils/config";
import { deletionPending } from "../utils/deletion";
import {
    CODE_ATTEMPTS,
    CODE_LENGTH,
    type CodePurpose,
    consumeEmailCode,
    emailCodeKey,
    issueEmailCode,
    withdrawEmailCode,
} from "../utils/emailCodes";
import {
    addressHeldForUndo,
    EMAIL_UNDO_DAYS,
    emailUndoLive,
    emailUndoRef,
    emailUndoUrl,
    isEmailUndoToken,
    newEmailUndoToken,
} from "../utils/emailUndo";
import { db } from "../utils/firebase";
import { type GoogleIdentity, verifyGoogleToken } from "../utils/google";
import { checkNewPassword, hashPassword, readPasswordAttempt, verifyPassword } from "../utils/passwords";
import { recordDoc, recordRef } from "../utils/records";
import { RESEND_API_KEY, type ResendEnvelope } from "../utils/resendClient";
import { callerAddressKey } from "../utils/scans";
import { endSessions, sessionIdOf, signInToken } from "../utils/sessions";
import { isStorageUrl } from "../utils/storage";
import { sanitizeDisplayText, validateDocId, validateEmail } from "../utils/validation";

const ACCOUNT_CALL: CallableOptions = {
    maxInstances: 20,
    memory: "512MiB",
    secrets: [RESEND_API_KEY, PASSWORD_PEPPER],
};

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;

const CODES_PER_HOUR_PER_NETWORK = Math.max(1, Math.floor(CODE_MAIL_HOURLY_CAP / 4));
const SIGN_INS_PER_MINUTE_PER_NETWORK = 60;
const UNDOS_PER_HOUR_PER_NETWORK = 30;

const CODE_CHECKS_PER_HOUR_PER_NETWORK = 2 * CODES_PER_HOUR_PER_NETWORK;
const CODE_CHECKS_PER_CODE_PER_NETWORK = CODE_ATTEMPTS - 1;

const SIGN_INS_PER_ADDRESS = 10;
const SIGN_INS_PER_ADDRESS_WINDOW_MS = 15 * MINUTE_MS;
const SIGN_INS_PER_ADDRESS_PER_DAY = 30;
const DAY_MS = 24 * HOUR_MS;

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

const emailHeld = () =>
    new HttpsError("already-exists", "That email is held for an account that just moved off it.", {
        code: "email-held",
    });

async function requireMailDomain(email: string): Promise<void> {
    if (!await domainTakesMail(email)) {
        throw new HttpsError("invalid-argument", "That address can't receive email.", {code: "email-undeliverable"});
    }
}

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
    if (user && deletionPending(user)) {
        throw new HttpsError("failed-precondition", "This account is due to be deleted.", {
            code: "deletion-pending",
        });
    }
}

function readCode(value: unknown): string {
    const code = typeof value === "string" ? value.trim() : "";
    if (code.length !== CODE_LENGTH || !/^\d+$/.test(code)) throw badCode();
    return code;
}

function readDisplayName(value: unknown): string {
    const name = sanitizeDisplayText(typeof value === "string" ? value : "").slice(0, 50);
    if (!name) throw new HttpsError("invalid-argument", "A name is required.", {code: "no-name"});
    return name;
}

async function requireEmailCode(
    request: CallableRequest,
    purpose: CodePurpose,
    email: string,
    code: string,
): Promise<void> {
    const network = callerAddressKey(request.rawRequest);
    await consumeRateLimit(`codecheck_${network}`, CODE_CHECKS_PER_HOUR_PER_NETWORK, HOUR_MS);
    await consumeRateLimit(
        `codecheck_${emailCodeKey(purpose, email)}_${network}`,
        CODE_CHECKS_PER_CODE_PER_NETWORK,
        HOUR_MS,
    );
    if (!await consumeEmailCode(purpose, email, code)) throw badCode();
}

async function mailCode(
    purpose: CodePurpose,
    email: string,
    language: MailLanguage,
    instead?: ResendEnvelope,
): Promise<void> {
    const issued = await issueEmailCode(purpose, email);
    if (!issued) return;
    try {
        await sendAccountMail(instead ?? codeMail(email, purpose, issued.code, language), "code");
    } catch (err) {
        await withdrawEmailCode(purpose, email, issued).catch(() => {
        });
        throw err;
    }
}

async function insteadOfCode(
    email: string,
    language: MailLanguage,
    exceptUid?: string,
): Promise<ResendEnvelope | undefined> {
    if ((await emailIndexRef(email).get()).exists) return addressTakenMail(email, language);
    const held = await addressHeldForUndo(email, undefined, exceptUid);
    return held ? addressHeldMail(email, held.until.toDate(), language) : undefined;
}

export const sendEmailCode = onCall(ACCOUNT_CALL, async (request) => {
    const input = (request.data ?? {}) as {purpose?: unknown; email?: unknown; language?: unknown};
    const language = readMailLanguage(input.language);
    await limitNetwork(request, "code", CODES_PER_HOUR_PER_NETWORK, HOUR_MS);

    if (input.purpose === "signup") {
        const email = validateEmail(input.email, "email");
        await requireMailDomain(email);
        await mailCode("signup", email, language, await insteadOfCode(email, language));
    } else if (input.purpose === "password") {
        const email = validateEmail(input.email, "email");
        await requireCodeMailRoom();
        if ((await emailIndexRef(email).get()).exists) {
            await mailCode("password", email, language);
        } else {
            const held = await addressHeldForUndo(email);
            if (held) {
                await mailCode("password", email, language, addressHeldMail(email, held.until.toDate(), language));
            } else {
                await sleep(SEND_TIME_MS + Math.random() * SEND_TIME_JITTER_MS);
            }
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
        await mailCode("email-change", email, language, await insteadOfCode(email, language, uid));
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

const hasUploadedAvatar = (user: FirebaseFirestore.DocumentSnapshot): boolean => isStorageUrl(user.get("photoURL"));

interface NewAccount {
    email: string;
    displayName: string;
    photoURL: string;
    passwordHash: string | null;
    google: GoogleIdentity | null;
}

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
        if (await addressHeldForUndo(email, txn)) throw emailHeld();

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

    await requireEmailCode(request, "signup", email, code);
    const passwordHash = await hashPassword(password);
    const uid = await createAccount({email, displayName, photoURL: "", passwordHash, google: null});
    return {token: await signInToken(uid)};
});

const NO_ACCOUNT = "-";

async function checkPassword(request: CallableRequest, email: string, password: string): Promise<string> {
    await limitNetwork(request, "signin", SIGN_INS_PER_MINUTE_PER_NETWORK, MINUTE_MS);
    const address = emailIndexRef(email).id;
    await consumeRateLimit(`signin_${address}`, SIGN_INS_PER_ADDRESS, SIGN_INS_PER_ADDRESS_WINDOW_MS);
    await consumeRateLimit(`signin_day_${address}`, SIGN_INS_PER_ADDRESS_PER_DAY, DAY_MS);

    const uid: string | undefined = (await emailIndexRef(email).get()).get("uid");
    const stored: string | null | undefined = (await credentialsRef(uid || NO_ACCOUNT).get()).get("passwordHash");
    if (!await verifyPassword(password, stored) || !uid) throw wrongCredentials();
    await requireNotBanned(uid);
    return uid;
}

export const signInWithPassword = onCall(ACCOUNT_CALL, async (request) => {
    const input = (request.data ?? {}) as {email?: unknown; password?: unknown};
    const email = validateEmail(input.email, "email");
    const uid = await checkPassword(request, email, readPasswordAttempt(input.password));
    return {token: await signInToken(uid)};
});

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

export const resetPassword = onCall(ACCOUNT_CALL, async (request) => {
    const input = (request.data ?? {}) as {email?: unknown; code?: unknown; password?: unknown; language?: unknown};
    const email = validateEmail(input.email, "email");
    const code = readCode(input.code);
    const password = await checkNewPassword(input.password);

    await requireEmailCode(request, "password", email, code);
    const uid: string | undefined = (await emailIndexRef(email).get()).get("uid");
    if (!uid) throw badCode();
    await requireNotBanned(uid);
    await limitNoticedChange(uid, "password");

    await setPassword(uid, email, password, null, readMailLanguage(input.language));
    return {token: await signInToken(uid)};
});

async function accountForGoogle(google: GoogleIdentity): Promise<string | null> {
    const uid: string | undefined = (await googleIndexRef(google.sub).get()).get("uid");
    if (!uid) return null;

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
        await requireEmailCode(request, "signup", email, readCode(input.code));
    }
    const passwordHash = password ? await hashPassword(password) : null;
    const uid = await createAccount({email, displayName, photoURL: google.photoURL, passwordHash, google});
    return {token: await signInToken(uid)};
});

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

export const bindGoogle = onCall(ACCOUNT_CALL, async (request) => {
    const uid = await requireRegisteredSession(request, "account");
    const input = (request.data ?? {}) as {idToken?: unknown; language?: unknown};
    const google = await verifyGoogleToken(input.idToken);
    await limitNoticedChange(uid, "google");
    await bindGoogleTo(uid, google, readMailLanguage(input.language));
    return {bound: true};
});

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

    if (unbound?.email) {
        await sendNotice(await googleChangedMail(unbound.email, unbound.googleEmail, false, language));
    }
    return {unbound: true};
});

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

export const changePassword = onCall(ACCOUNT_CALL, async (request) => {
    const uid = await requireRegisteredSession(request, "account");
    const input = (request.data ?? {}) as {code?: unknown; password?: unknown; language?: unknown};
    const code = readCode(input.code);
    const password = await checkNewPassword(input.password);
    const email: string = (await db.collection("users").doc(uid).get()).get("email") ?? "";

    await requireEmailCode(request, "password", email, code);
    await limitNoticedChange(uid, "password");
    await setPassword(uid, email, password, sessionIdOf(request.auth!.token), readMailLanguage(input.language));
    return {token: await signInToken(uid)};
});

interface OwnMove {
    oldEmail: string;
    undoToken: string | null;
}

async function moveEmail(
    uid: string,
    email: string,
    by: {uid: string; name: string},
    own: OwnMove | null,
): Promise<{oldEmail: string}> {
    const userRef = db.collection("users").doc(uid);

    return db.runTransaction(async (txn) => {
        const [user, held, formerHolders] = await Promise.all([
            txn.get(userRef),
            txn.get(emailIndexRef(email)),
            txn.get(db.collection("users").where("formerEmails", "array-contains", email)),
        ]);
        if (!user.exists) throw new HttpsError("not-found", "User not found.");
        if (held.exists) throw emailTaken();
        if (own) requireEmailChangeAllowed(user.data());
        if (await addressHeldForUndo(email, txn, uid)) throw emailHeld();

        const oldEmail: string = user.get("email") ?? "";
        if (own && oldEmail !== own.oldEmail) {
            throw new HttpsError("aborted", "The account changed meanwhile. Please try again.");
        }
        const oldIndex = oldEmail ? await txn.get(emailIndexRef(oldEmail)) : null;

        if (oldIndex?.get("uid") === uid) txn.delete(oldIndex.ref);
        txn.set(emailIndexRef(email), {uid});
        for (const holder of formerHolders.docs) {
            if (holder.id !== uid) txn.update(holder.ref, {formerEmails: FieldValue.arrayRemove(email)});
        }

        txn.update(userRef, {
            email,
            ...formerEmailsAfter(user.data(), {left: oldEmail, gone: [email]}),
            ...(own ? {emailChangedAt: FieldValue.serverTimestamp()} : {}),
        });
        txn.set(recordRef(), recordDoc("account-email-change", {
            performedBy: by.uid,
            performedByName: by.name,
            targetUid: uid,
            targetName: user.get("displayName") ?? "",
            targetEmail: email,
            oldEmail,
        }));

        if (own?.undoToken) {
            const now = Date.now();
            txn.set(emailUndoRef(own.undoToken), {
                uid,
                oldEmail,
                newEmail: email,
                changedAt: Timestamp.fromMillis(now),
                expiresAt: Timestamp.fromMillis(now + EMAIL_UNDO_DAYS * 24 * HOUR_MS),
            });
        }
        return {oldEmail};
    });
}

async function creditMovedEmail(uid: string, email: string): Promise<void> {
    try {
        await creditScannedTickets(db.collection("users").doc(uid), email);
    } catch (err) {
        console.error(`creditMovedEmail: ticket credit failed for ${uid}`, err);
    }
}

export const changeEmail = onCall(ACCOUNT_CALL, async (request) => {
    const uid = await requireRegisteredSession(request, "account");
    const input = (request.data ?? {}) as {email?: unknown; code?: unknown; language?: unknown};
    const email = validateEmail(input.email, "email");
    const code = readCode(input.code);
    const language = readMailLanguage(input.language);

    const user = await db.collection("users").doc(uid).get();
    requireEmailChangeAllowed(user.data());
    const oldEmail: string = user.get("email") ?? "";
    if (oldEmail) await requireNoticeMailRoom();
    await requireEmailCode(request, "email-change", email, code);
    if ((await emailIndexRef(email).get()).exists) throw emailTaken();
    if (await addressHeldForUndo(email, undefined, uid)) throw emailHeld();

    const undoToken = oldEmail ? newEmailUndoToken() : null;
    if (undoToken) {
        await sendAccountMail(await emailChangedMail(oldEmail, email, language, emailUndoUrl(undoToken)), "notice");
    }
    const by = {uid, name: user.get("displayName") ?? ""};
    await moveEmail(uid, email, by, {oldEmail, undoToken});
    await creditMovedEmail(uid, email);
    return {email};
});

export const undoEmailChange = onCall(ACCOUNT_CALL, async (request) => {
    const input = (request.data ?? {}) as {token?: unknown; password?: unknown; language?: unknown};
    await limitNetwork(request, "undo", UNDOS_PER_HOUR_PER_NETWORK, HOUR_MS);
    if (!isEmailUndoToken(input.token)) throw badUndoLink();
    const undoRef = emailUndoRef(input.token);
    const password = await checkNewPassword(input.password);
    const passwordHash = await hashPassword(password);

    const {uid, oldEmail, newEmail} = await db.runTransaction(async (txn) => {
        const undo = await txn.get(undoRef);
        const uid: unknown = undo.get("uid");
        if (typeof uid !== "string") throw badUndoLink();
        const oldEmail: string = undo.get("oldEmail");
        const newEmail: string = undo.get("newEmail");
        const finishing = !!undo.get("restoredAt");

        const [user, credentials, oldHeld, newHeld, formerHolders, appLinks] = await Promise.all([
            txn.get(db.collection("users").doc(uid)),
            txn.get(credentialsRef(uid)),
            txn.get(emailIndexRef(oldEmail)),
            txn.get(emailIndexRef(newEmail)),
            txn.get(db.collection("users").where("formerEmails", "array-contains", oldEmail)),
            txn.get(accountLinksQuery(uid)),
        ]);
        if (!emailUndoLive(undo, user.data())) throw badUndoLink();

        const changedAt = (undo.get("changedAt") as Timestamp | undefined)?.toMillis()
            ?? (undo.get("expiresAt") as Timestamp).toMillis() - EMAIL_UNDO_DAYS * 24 * HOUR_MS;
        const linksSince = appLinks.docs
            .map(doc => doc.data() as AppLinkDoc)
            .filter(link => link.linkedAt.toMillis() >= changedAt);
        const [linkApps, disowns] = await Promise.all([
            Promise.all(linksSince.map(link => txn.get(appsCol().doc(link.appId)))),
            Promise.all(linksSince.map(link => readLinkDisown(txn, link.appId, uid, link.appUserId))),
        ]);

        if (finishing) {
            if (oldHeld.get("uid") !== uid) throw badUndoLink();
        } else {
            if (oldHeld.exists) throw emailTaken();
            txn.update(undoRef, {restoredAt: FieldValue.serverTimestamp()});
            if (newHeld.get("uid") === uid) txn.delete(newHeld.ref);
            txn.set(oldHeld.ref, {uid});
            for (const holder of formerHolders.docs) {
                if (holder.id !== uid) txn.update(holder.ref, {formerEmails: FieldValue.arrayRemove(oldEmail)});
            }
        }

        txn.update(user.ref, {
            ...(finishing ? {} : {
                email: oldEmail,
                ...formerEmailsAfter(user.data(), {gone: [oldEmail, newEmail]}),
            }),
            ...(hasUploadedAvatar(user) ? {} : {photoURL: ""}),
            ...(user.get("deletionRequestedBy") === uid ? {
                deleteAt: FieldValue.delete(),
                deletionRequestedBy: FieldValue.delete(),
            } : {}),
        });

        const google = googleBindingOf(credentials);
        if (google) txn.delete(googleIndexRef(google.sub));
        const displayName: string = user.get("displayName") ?? "";
        linksSince.forEach((link, i) => {
            disownLinkInTxn(txn, disowns[i]);
            txn.set(recordRef(), recordDoc("account-app-unlink", {
                performedBy: uid,
                performedByName: displayName,
                targetUid: uid,
                targetName: displayName,
                appId: link.appId,
                appName: appRecordName(readApp(linkApps[i]), link.appId),
                appUserName: appLinkUserName(link.appUserName),
                linkEndedBy: "email-undo",
            }));
        });
        txn.set(credentials.ref, {
            passwordHash,
            passwordChangedAt: FieldValue.serverTimestamp(),
            google: null,
        }, {merge: true});

        if (!finishing) {
            txn.set(recordRef(), recordDoc("account-email-undo", {
                performedBy: uid,
                performedByName: displayName,
                targetUid: uid,
                targetName: displayName,
                targetEmail: oldEmail,
                oldEmail: newEmail,
            }));
        }
        return {uid, oldEmail, newEmail};
    });

    await endSessions(uid, null);

    const userRef = db.collection("users").doc(uid);
    await db.runTransaction(async (txn) => {
        const user = await txn.get(userRef);
        txn.delete(undoRef);
        if (user.exists && user.get("email") === oldEmail) txn.update(userRef, {emailChangedAt: FieldValue.delete()});
    });
    await sendNotice(await emailChangeUndoneMail(newEmail, readMailLanguage(input.language)));
    return {email: oldEmail};
});

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

    const {oldEmail} = await moveEmail(targetUid, email, {uid, name: caller.get("displayName") ?? ""}, null);
    await sendNotice(await emailSetByStaffMail(email, language));
    if (oldEmail) await sendNotice(await emailChangedMail(oldEmail, email, language));
    await creditMovedEmail(targetUid, email);
    return {email};
});
