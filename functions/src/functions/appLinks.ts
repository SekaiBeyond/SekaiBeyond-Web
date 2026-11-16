import { type CallableOptions, HttpsError, onCall } from "firebase-functions/v2/https";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { appLinkChangedMail, limitNoticedChange, readMailLanguage, sendNotice } from "../utils/accountMail";
import {
    accountLinkInAppQuery,
    accountLinksQuery,
    type AppLinkDoc,
    appLinkRef,
    type AppLinkRequestDoc,
    appLinkRequestsCol,
    type AppLinkUndoDoc,
    appLinkUserName,
    assertCanLink,
    clearAccountHoldInTxn,
    disownLinkInTxn,
    freeLinkCode,
    isLinkUndoToken,
    LINK_CONFIRM_ATTEMPTS,
    LINK_CONFIRM_CODE_RE,
    LINK_QR_PREFIX,
    LINK_REQUEST_ID_RE,
    LINK_REQUEST_TTL_MS,
    LINK_UNDO_DAYS,
    linkConfirmCodeMatches,
    linkRequestStatus,
    linkUndoRef,
    linkUndoUrl,
    newLinkRequestId,
    newLinkUndoToken,
    readAccountHold,
    readLinkDisown,
    unlinkInTxn,
} from "../utils/appLinks";
import { appNameIn, appRecordName, appsCol, readApp, type RegisteredApp, validateAppId } from "../utils/apps";
import {
    adminTransaction,
    consumeRateLimit,
    requireAuth,
    requireCanManage,
    requireRegisteredSession,
    requireStaff,
} from "../utils/auth";
import {
    credentialsRef,
    googleBindingOf,
    googleIndexRef,
    PASSWORD_PEPPER,
    unlinkFirebaseGoogle,
} from "../utils/credentials";
import { deletionPending } from "../utils/deletion";
import { db } from "../utils/firebase";
import { isoOrNull } from "../utils/helpers";
import { checkNewPassword, hashPassword } from "../utils/passwords";
import { RESEND_API_KEY } from "../utils/resendClient";
import { recordDoc, recordRef } from "../utils/records";
import { callerAddressKey } from "../utils/scans";
import { endSessions } from "../utils/sessions";
import { isStorageUrl } from "../utils/storage";
import { validateDocId } from "../utils/validation";

/**
 * The account's side of linking it to an app's account (see utils/appLinks.ts):
 * Settings lists the apps it may link, starts a request, watches it for the
 * app's claim, and confirms it with the code the app shows, or removes a link.
 * The app's side is the API's (functions/api.ts). Staff see an account's links
 * and holds, and may lift a hold.
 *
 * Starting, confirming and removing need a device on the account's list
 * (requireRegisteredSession), as changing how it signs in does, and each tells
 * the account's address. The notice of a link carries a "This wasn't me" link
 * (undoAppLink), for an owner whose sign-in someone else used to link theirs.
 */

/** Confirming checks the app's code against its peppered hash. */
const LINK_CALL: CallableOptions = {maxInstances: 10, secrets: [RESEND_API_KEY, PASSWORD_PEPPER]};

/** Requests one account may start an hour: enough for a few codes that ran out before anyone scanned them. */
const LINK_REQUESTS_PER_HOUR = 10;
const HOUR_MS = 60 * 60 * 1000;

/** Hashing the new password takes the memory account calls have. */
const LINK_UNDO_CALL: CallableOptions = {maxInstances: 20, memory: "512MiB", secrets: [PASSWORD_PEPPER]};

/** "This wasn't me" links one network may follow an hour, as for an email change's. */
const LINK_UNDOS_PER_HOUR_PER_NETWORK = 30;

const badUndoLink = () => new HttpsError("not-found", "This link doesn't work.", {code: "bad-undo-link"});

const linkingOff = () =>
    new HttpsError("failed-precondition", "This app doesn't link accounts.", {code: "linking-off"});

/** Settings' word for a request that's gone; the API's, to the app, is link-request-not-found. */
const requestGone = () =>
    new HttpsError("not-found", "This request has run out. Start again.", {code: "link-request-gone"});

/**
 * An app that links accounts, read fresh, so turning it off counts at once.
 * The API's requireLinkingApp reads the same through registeredApps' cache.
 */
async function requireLinkingApp(raw: unknown, txn?: FirebaseFirestore.Transaction): Promise<RegisteredApp> {
    const ref = appsCol().doc(validateAppId(raw));
    const app = readApp(txn ? await txn.get(ref) : await ref.get());
    if (!app?.accountLinking) throw linkingOff();
    return app;
}

const readRequestId = (raw: unknown): string => {
    if (typeof raw !== "string" || !LINK_REQUEST_ID_RE.test(raw)) throw requestGone();
    return raw;
};

/**
 * The apps the caller may link, and their links: every app that links
 * accounts, and any other they're still linked in, which they may only remove.
 * Oldest first, so an app keeps its place, whatever it's renamed, and a new
 * one joins at the end.
 */
export const getAppLinks = onCall({maxInstances: 20}, async (request) => {
    const uid = await requireAuth(request, "account");
    const [appsSnap, linksSnap] = await Promise.all([
        appsCol().orderBy("createdAt").get(),
        accountLinksQuery(uid).get(),
    ]);
    const links = new Map(linksSnap.docs.map(doc => {
        const link = doc.data() as AppLinkDoc;
        return [link.appId, link];
    }));
    const apps = appsSnap.docs.map(doc => readApp(doc)!)
        .filter(app => app.accountLinking || links.has(app.id));
    return {
        apps: apps.map(app => {
            const link = links.get(app.id);
            return {
                appId: app.id,
                nameEn: app.nameEn,
                nameCn: app.nameCn,
                platform: app.platform,
                iconUrl: app.iconUrl,
                accountLinking: app.accountLinking,
                link: link ? {
                    appUserName: appLinkUserName(link.appUserName),
                    linkedAt: isoOrNull(link.linkedAt),
                } : null,
            };
        }),
    };
});

/**
 * Starts a request to link the caller's account to their account in an app:
 * what Settings shows to scan, or type in, in the app. Any request of theirs
 * for the app still waiting is cancelled, so only the newest code works.
 * Answers with the server's time too, for Settings to count down by.
 */
export const startAppLink = onCall(LINK_CALL, async (request) => {
    const uid = await requireRegisteredSession(request, "account");
    const appId = validateAppId((request.data as {appId?: unknown} | null)?.appId);
    await consumeRateLimit(`appLinkStart_${uid}`, LINK_REQUESTS_PER_HOUR, HOUR_MS);

    const requestId = newLinkRequestId();
    const ref = appLinkRequestsCol().doc(requestId);
    const doc = await db.runTransaction(async (txn): Promise<AppLinkRequestDoc> => {
        const app = await requireLinkingApp(appId, txn);
        const [user, linked, earlier] = await Promise.all([
            txn.get(db.collection("users").doc(uid)),
            txn.get(accountLinkInAppQuery(app.id, uid)),
            txn.get(appLinkRequestsCol().where("appId", "==", app.id).where("uid", "==", uid)),
        ]);
        if (!linked.empty) {
            throw new HttpsError("already-exists", "This account is already linked in this app.", {
                code: "account-linked",
            });
        }
        if (user.exists && deletionPending(user.data()!)) {
            throw new HttpsError("failed-precondition", "This account is due to be deleted.", {
                code: "deletion-pending",
            });
        }
        const code = await freeLinkCode(txn, app.id);
        for (const old of earlier.docs) {
            const status = linkRequestStatus(old.data() as AppLinkRequestDoc);
            if (status === "waiting" || status === "claimed") txn.update(old.ref, {status: "cancelled"});
        }
        const now = Date.now();
        const fresh: AppLinkRequestDoc = {
            appId: app.id,
            uid,
            code,
            status: "waiting",
            createdAt: Timestamp.fromMillis(now),
            expiresAt: Timestamp.fromMillis(now + LINK_REQUEST_TTL_MS),
        };
        txn.create(ref, fresh);
        return fresh;
    });
    return {
        requestId,
        code: doc.code,
        qr: LINK_QR_PREFIX + requestId,
        expiresAt: doc.expiresAt.toDate().toISOString(),
        serverTime: new Date().toISOString(),
    };
});

/** The caller's claimed request, read in `txn`, or the refusal for one that isn't. */
async function claimedRequest(
    txn: FirebaseFirestore.Transaction,
    ref: FirebaseFirestore.DocumentReference,
    uid: string,
): Promise<AppLinkRequestDoc & {appUserId: string}> {
    const req = (await txn.get(ref)).data() as AppLinkRequestDoc | undefined;
    if (!req || req.uid !== uid) throw requestGone();
    const status = linkRequestStatus(req);
    if (status === "waiting") {
        throw new HttpsError("failed-precondition", "Nobody has scanned this code yet.", {code: "link-not-claimed"});
    }
    if (status !== "claimed" || !req.appUserId) throw requestGone();
    return req as AppLinkRequestDoc & {appUserId: string};
}

const wrongCode = (attemptsLeft: number) => new HttpsError("permission-denied", attemptsLeft > 0
    ? "That isn't the code the app shows."
    : "That isn't the code the app shows, and too many were wrong. Start again.", {
    code: attemptsLeft > 0 ? "wrong-link-code" : "link-code-spent",
    attemptsLeft,
});

/**
 * Links the caller's account to the app's account that claimed their request,
 * once they've seen whose it is and typed in the code the app shows them. A
 * wrong code counts, and LINK_CONFIRM_ATTEMPTS of them cancel the request.
 * Either side may have been linked meanwhile, or be waiting out a hold, which
 * the claim checked too (assertCanLink).
 *
 * The code is checked, and a wrong one counted, before the notice is charged
 * for, so mistyping it doesn't use up the day's notices.
 */
export const confirmAppLink = onCall(LINK_CALL, async (request) => {
    const uid = await requireRegisteredSession(request, "account");
    const input = (request.data ?? {}) as {requestId?: unknown; code?: unknown; language?: unknown};
    const requestId = readRequestId(input.requestId);
    if (typeof input.code !== "string" || !LINK_CONFIRM_CODE_RE.test(input.code)) {
        throw new HttpsError("invalid-argument", "Enter the four digits the app shows.");
    }
    const code = input.code;
    const language = readMailLanguage(input.language);
    const ref = appLinkRequestsCol().doc(requestId);

    const attemptsLeft = await db.runTransaction(async (txn) => {
        const req = await claimedRequest(txn, ref, uid);
        if (linkConfirmCodeMatches(requestId, req, code)) return null;
        const attempts = (req.confirmAttempts ?? 0) + 1;
        txn.update(ref, attempts >= LINK_CONFIRM_ATTEMPTS
            ? {confirmAttempts: attempts, status: "cancelled"}
            : {confirmAttempts: attempts});
        return LINK_CONFIRM_ATTEMPTS - attempts;
    });
    if (attemptsLeft !== null) throw wrongCode(attemptsLeft);

    await limitNoticedChange(uid, "appLink");
    const undoToken = newLinkUndoToken();

    const linked = await db.runTransaction(async (txn) => {
        const req = await claimedRequest(txn, ref, uid);
        // Claimed again meanwhile, with a new code: not counted, as this one was right.
        if (!linkConfirmCodeMatches(requestId, req, code)) throw wrongCode(LINK_CONFIRM_ATTEMPTS);
        const app = await requireLinkingApp(req.appId, txn);
        const user = await assertCanLink(txn, app.id, uid, req.appUserId);

        const appUserName = appLinkUserName(req.appUserName);
        const link: AppLinkDoc = {appId: app.id, appUserId: req.appUserId, uid, appUserName, linkedAt: Timestamp.now()};
        txn.create(appLinkRef(app.id, req.appUserId), link);
        txn.update(ref, {status: "linked"});
        const displayName: string = user.get("displayName") ?? "";
        txn.set(recordRef(), recordDoc("account-app-link", {
            performedBy: uid,
            performedByName: displayName,
            targetUid: uid,
            targetName: displayName,
            appId: app.id,
            appName: appRecordName(app, app.id),
            appUserName,
        }));
        const email = (user.get("email") as string | undefined) ?? "";
        if (email) {
            const undo: AppLinkUndoDoc = {
                uid,
                appId: app.id,
                appUserId: req.appUserId,
                appUserName,
                email,
                expiresAt: Timestamp.fromMillis(Date.now() + LINK_UNDO_DAYS * 24 * HOUR_MS),
            };
            txn.set(linkUndoRef(undoToken), undo);
        }
        return {email, appName: appNameIn(app, language), appUserName};
    });

    if (linked.email) {
        await sendNotice(await appLinkChangedMail(
            linked.email, linked.appName, linked.appUserName, "linked", language, linkUndoUrl(undoToken)));
    }
    return {linked: true};
});

/** Cancels the caller's request, unless it's linked already. Nothing to cancel is fine. */
export const cancelAppLink = onCall({maxInstances: 10}, async (request) => {
    const uid = await requireAuth(request, "account");
    const ref = appLinkRequestsCol().doc(readRequestId((request.data as {requestId?: unknown} | null)?.requestId));
    await db.runTransaction(async (txn) => {
        const req = (await txn.get(ref)).data() as AppLinkRequestDoc | undefined;
        if (!req || req.uid !== uid) return;
        const status = linkRequestStatus(req);
        if (status === "waiting" || status === "claimed") txn.update(ref, {status: "cancelled"});
    });
    return {cancelled: true};
});

/**
 * Removes the caller's link in an app, which stops the app reading anything of
 * the account at once. Each side then waits out LINK_HOLD_DAYS before linking
 * anyone else. Works on an app that has since stopped linking accounts too.
 */
export const removeAppLink = onCall(LINK_CALL, async (request) => {
    const uid = await requireRegisteredSession(request, "account");
    const input = (request.data ?? {}) as {appId?: unknown; language?: unknown};
    const appId = validateAppId(input.appId);
    const language = readMailLanguage(input.language);
    // Nothing to remove costs none of the day's notices. Checked again below.
    if ((await accountLinkInAppQuery(appId, uid).get()).empty) return {unlinked: false};
    await limitNoticedChange(uid, "appLink");

    const unlinked = await db.runTransaction(async (txn) => {
        const [user, linked, appSnap] = await Promise.all([
            txn.get(db.collection("users").doc(uid)),
            txn.get(accountLinkInAppQuery(appId, uid)),
            txn.get(appsCol().doc(appId)),
        ]);
        if (linked.empty) return null;
        const link = linked.docs[0].data() as AppLinkDoc;
        const app = readApp(appSnap);
        const appName = appRecordName(app, appId);
        unlinkInTxn(txn, link);
        const displayName: string = user.get("displayName") ?? "";
        txn.set(recordRef(), recordDoc("account-app-unlink", {
            performedBy: uid,
            performedByName: displayName,
            targetUid: uid,
            targetName: displayName,
            appId,
            appName,
            appUserName: appLinkUserName(link.appUserName),
        }));
        return {
            email: (user.get("email") as string | undefined) ?? "",
            appName: app ? appNameIn(app, language) : appId,
            appUserName: link.appUserName,
        };
    });

    if (unlinked?.email) {
        await sendNotice(await appLinkChangedMail(
            unlinked.email, unlinked.appName, appLinkUserName(unlinked.appUserName), "unlinked", language));
    }
    return {unlinked: !!unlinked};
});

/**
 * The "This wasn't me" link in a link's notice (AppLinkUndoDoc), for an owner
 * whose sign-in someone else used to link their own account in an app. Undoes
 * the link without holding the account to that app's account, and lifts the
 * hold if it's been unlinked since, so the owner can link their own at once;
 * the app's account waits out the hold before linking anyone. Only once in
 * LINK_HOLD_DAYS per app: after that, the account is held as unlinking in
 * Settings would hold it (disownLinkInTxn), which `heldUntil` says.
 *
 * Whoever linked it could sign in, and anyone signed in can bind a Google
 * account of their own from Settings, so, as undoing an email change does, it
 * replaces the password, takes off any Google account bound and signs every
 * device out, and the new password is the only way back in. The link is used
 * up only once every device is signed out: until then whoever linked it is
 * still in, so following it again finishes. Signs nobody in.
 */
export const undoAppLink = onCall(LINK_UNDO_CALL, async (request) => {
    const input = (request.data ?? {}) as {token?: unknown; password?: unknown};
    await consumeRateLimit(
        `linkUndo_${callerAddressKey(request.rawRequest)}`, LINK_UNDOS_PER_HOUR_PER_NETWORK, HOUR_MS);
    if (!isLinkUndoToken(input.token)) throw badUndoLink();
    const undoRef = linkUndoRef(input.token);
    const passwordHash = await hashPassword(await checkNewPassword(input.password));

    const {uid, appId, nameEn, nameCn, heldUntil} = await db.runTransaction(async (txn) => {
        const undo = (await txn.get(undoRef)).data() as AppLinkUndoDoc | undefined;
        if (!undo || undo.expiresAt.toMillis() <= Date.now()) throw badUndoLink();
        const [user, credentials, appSnap, disown] = await Promise.all([
            txn.get(db.collection("users").doc(undo.uid)),
            txn.get(credentialsRef(undo.uid)),
            txn.get(appsCol().doc(undo.appId)),
            readLinkDisown(txn, undo.appId, undo.uid, undo.appUserId),
        ]);
        if (!user.exists || user.get("email") !== undo.email) throw badUndoLink();
        const app = readApp(appSnap);
        const appName = appRecordName(app, undo.appId);

        const heldUntil = disownLinkInTxn(txn, disown);
        const google = googleBindingOf(credentials);
        if (google) txn.delete(googleIndexRef(google.sub));
        txn.set(credentials.ref, {
            passwordHash,
            passwordChangedAt: FieldValue.serverTimestamp(),
            google: null,
        }, {merge: true});
        // A photo that isn't an upload is the Google account's, and goes with it, as unbinding does.
        const photoURL: unknown = user.get("photoURL");
        if (photoURL && !isStorageUrl(photoURL)) txn.update(user.ref, {photoURL: ""});
        if (!undo.usedAt) {
            txn.update(undoRef, {usedAt: FieldValue.serverTimestamp()});
            const displayName: string = user.get("displayName") ?? "";
            txn.set(recordRef(), recordDoc("account-app-link-undo", {
                performedBy: undo.uid,
                performedByName: displayName,
                targetUid: undo.uid,
                targetName: displayName,
                appId: undo.appId,
                appName,
                appUserName: appLinkUserName(undo.appUserName),
            }));
        }
        return {uid: undo.uid, appId: undo.appId, nameEn: app?.nameEn ?? "", nameCn: app?.nameCn ?? "", heldUntil};
    });

    await endSessions(uid, null);
    await unlinkFirebaseGoogle(uid);
    await undoRef.delete();
    return {appId, nameEn, nameCn, heldUntil: heldUntil?.toISOString() ?? null};
});

/**
 * An account's links and holds, app by app, for staff looking at it in the
 * Users tab: who it's linked to in each app, and which it's held to and until
 * when. Listed are the apps it has one or the other in, and those it could
 * link in, as its own Settings lists them, and in the same order: oldest first.
 */
export const getUserAppLinks = onCall({maxInstances: 10}, async (request) => {
    const uid = await requireAuth(request, "staff");
    await requireStaff(uid);
    const targetUid = validateDocId((request.data as {uid?: unknown} | null)?.uid, "uid");

    const [appsSnap, linksSnap] = await Promise.all([
        appsCol().orderBy("createdAt").get(),
        accountLinksQuery(targetUid).get(),
    ]);
    const links = new Map(linksSnap.docs.map(doc => {
        const link = doc.data() as AppLinkDoc;
        return [link.appId, link];
    }));
    const apps = appsSnap.docs.map(doc => readApp(doc)!);
    const holds = await Promise.all(apps.map(app => readAccountHold(app.id, targetUid)));
    return {
        apps: apps.flatMap((app, i) => {
            const link = links.get(app.id);
            const hold = holds[i];
            if (!link && !hold && !app.accountLinking) return [];
            return [{
                appId: app.id,
                nameEn: app.nameEn,
                nameCn: app.nameCn,
                platform: app.platform,
                iconUrl: app.iconUrl,
                accountLinking: app.accountLinking,
                link: link ? {
                    appUserId: link.appUserId,
                    appUserName: appLinkUserName(link.appUserName),
                    linkedAt: isoOrNull(link.linkedAt),
                } : null,
                hold: hold ? {appUserId: hold.partner, until: hold.until.toISOString()} : null,
            }];
        }),
    };
});

/**
 * Lifts the hold on an account in an app, so it can link another of its own
 * accounts there before LINK_HOLD_DAYS are up: for someone who linked the
 * wrong one, or was linked by someone else twice in that time. Core-staff and
 * above, for accounts below them, never their own. On the Records tab.
 */
export const clearAppLinkHold = onCall({maxInstances: 10}, async (request) => {
    const uid = await requireAuth(request, "staff");
    const input = (request.data ?? {}) as {targetUid?: unknown; appId?: unknown};
    const targetUid = validateDocId(input.targetUid, "targetUid");
    const appId = validateAppId(input.appId);
    if (targetUid === uid) throw new HttpsError("permission-denied", "Cannot lift your own hold.");

    const cleared = await adminTransaction(uid, async (txn, callerSnap) => {
        const [target, appSnap] = await Promise.all([
            txn.get(db.collection("users").doc(targetUid)),
            txn.get(appsCol().doc(appId)),
        ]);
        if (!target.exists) throw new HttpsError("not-found", "Target user not found.");
        requireCanManage(callerSnap.data()!.group, target.get("group"));
        if (!await clearAccountHoldInTxn(txn, appId, targetUid)) return false;
        txn.set(recordRef(), recordDoc("account-app-hold-clear", {
            performedBy: uid,
            performedByName: callerSnap.get("displayName") ?? "",
            targetUid,
            targetName: target.get("displayName") ?? "",
            appId,
            appName: appRecordName(readApp(appSnap), appId),
        }));
        return true;
    });
    return {cleared};
});
