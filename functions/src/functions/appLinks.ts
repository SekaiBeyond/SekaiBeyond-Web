import { type CallableOptions, HttpsError, onCall } from "firebase-functions/v2/https";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { appLinkChangedMail, limitNoticedChange, readMailLanguage, sendNotice, } from "../utils/accountMail";
import {
    accountLinkQuery,
    accountLinksQuery,
    type AppLinkDoc,
    appLinkRef,
    type AppLinkRequestDoc,
    appLinkRequestsCol,
    type AppLinkUndoDoc,
    appLinkUserName,
    disownLinkInTxn,
    freeLinkCode,
    isLinkUndoToken,
    LINK_QR_PREFIX,
    LINK_REQUEST_ID_RE,
    LINK_REQUEST_TTL_MS,
    LINK_UNDO_DAYS,
    linkHeldUntil,
    linkOnHold,
    linkRequestStatus,
    linkUndoRef,
    linkUndoUrl,
    newLinkRequestId,
    newLinkUndoToken,
    unlinkInTxn,
} from "../utils/appLinks";
import { appsCol, readApp, type RegisteredApp, validateAppId } from "../utils/apps";
import { consumeRateLimit, requireAuth, requireRegisteredSession } from "../utils/auth";
import { credentialsRef, PASSWORD_PEPPER } from "../utils/credentials";
import { deletionPending } from "../utils/deletion";
import { db } from "../utils/firebase";
import { isoOrNull } from "../utils/helpers";
import { checkNewPassword, hashPassword } from "../utils/passwords";
import { RESEND_API_KEY } from "../utils/resendClient";
import { recordDoc, recordRef } from "../utils/records";
import { callerAddressKey } from "../utils/scans";
import { endSessions } from "../utils/sessions";

/**
 * The account's side of linking it to an app's account (see utils/appLinks.ts):
 * Settings lists the apps it may link, starts a request, watches it for the
 * app's claim, and confirms it, or undoes a link. The app's side is the API's
 * (functions/api.ts).
 *
 * Starting, confirming and undoing need a device on the account's list
 * (requireRegisteredSession), as changing how it signs in does, and each tells
 * the account's address. The notice of a link carries a "This wasn't me" link
 * (undoAppLink), for an owner whose sign-in someone else used to link theirs.
 */

const LINK_CALL = {maxInstances: 10, secrets: [RESEND_API_KEY]};

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

const requestGone = () =>
    new HttpsError("not-found", "This request has run out. Start again.", {code: "link-request-gone"});

/** An app that links accounts, read fresh, so turning it off counts at once. */
async function linkingApp(raw: unknown, txn?: FirebaseFirestore.Transaction): Promise<RegisteredApp> {
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
 * accounts, and any other they're still linked in, which they may only undo.
 */
export const getAppLinks = onCall({maxInstances: 20}, async (request) => {
    const uid = await requireAuth(request, "account");
    const [appsSnap, linksSnap] = await Promise.all([appsCol().get(), accountLinksQuery(uid).get()]);
    const links = new Map(linksSnap.docs.map(doc => {
        const link = doc.data() as AppLinkDoc;
        return [link.appId, link];
    }));
    const apps = appsSnap.docs.map(doc => readApp(doc)!)
        .filter(app => app.accountLinking || links.has(app.id))
        .sort((a, b) => a.name.localeCompare(b.name));
    return {
        apps: apps.map(app => {
            const link = links.get(app.id);
            return {
                appId: app.id,
                name: app.name,
                accountLinking: app.accountLinking,
                link: link ? {
                    appUserName: appLinkUserName(link.appUserName),
                    linkedAt: isoOrNull(link.linkedAt)
                } : null,
            };
        }),
    };
});

/**
 * Starts a request to link the caller's account to their account in an app:
 * what Settings shows to scan, or type in, in the app. Any request of theirs
 * for the app still waiting is cancelled, so only the newest code works.
 */
export const startAppLink = onCall(LINK_CALL, async (request) => {
    const uid = await requireRegisteredSession(request, "account");
    const appId = validateAppId((request.data as {appId?: unknown} | null)?.appId);
    await consumeRateLimit(`appLinkStart_${uid}`, LINK_REQUESTS_PER_HOUR, HOUR_MS);

    const requestId = newLinkRequestId();
    const ref = appLinkRequestsCol().doc(requestId);
    const doc = await db.runTransaction(async (txn): Promise<AppLinkRequestDoc> => {
        const app = await linkingApp(appId, txn);
        const [user, linked, earlier] = await Promise.all([
            txn.get(db.collection("users").doc(uid)),
            txn.get(accountLinkQuery(app.id, uid)),
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
    };
});

/**
 * Links the caller's account to the app's account that claimed their request,
 * once they've seen whose it is. Either side may have been linked meanwhile,
 * or be waiting out a hold (LINK_HOLD_DAYS), which the claim checked too.
 */
export const confirmAppLink = onCall(LINK_CALL, async (request) => {
    const uid = await requireRegisteredSession(request, "account");
    const input = (request.data ?? {}) as {requestId?: unknown; language?: unknown};
    const ref = appLinkRequestsCol().doc(readRequestId(input.requestId));
    await limitNoticedChange(uid, "appLink");
    const undoToken = newLinkUndoToken();

    const linked = await db.runTransaction(async (txn) => {
        const snap = await txn.get(ref);
        const req = snap.data() as AppLinkRequestDoc | undefined;
        if (!req || req.uid !== uid) throw requestGone();
        const status = linkRequestStatus(req);
        if (status === "waiting") {
            throw new HttpsError("failed-precondition", "Nobody has scanned this code yet.", {code: "link-not-claimed"});
        }
        if (status !== "claimed" || !req.appUserId) throw requestGone();
        const app = await linkingApp(req.appId, txn);
        const linkRef = appLinkRef(app.id, req.appUserId);
        const [user, accountLinked, appUserLinked, accountHeld, appUserHeld] = await Promise.all([
            txn.get(db.collection("users").doc(uid)),
            txn.get(accountLinkQuery(app.id, uid)),
            txn.get(linkRef),
            linkHeldUntil(txn, app.id, "account", uid, req.appUserId),
            linkHeldUntil(txn, app.id, "app-user", req.appUserId, uid),
        ]);
        if (!accountLinked.empty) {
            throw new HttpsError("already-exists", "This account is already linked in this app.", {
                code: "account-linked",
            });
        }
        if (appUserLinked.exists) {
            throw new HttpsError("already-exists", "That app account is already linked to another account.", {
                code: "app-user-linked",
            });
        }
        if (accountHeld) throw linkOnHold("account", accountHeld);
        if (appUserHeld) throw linkOnHold("app-user", appUserHeld);

        const appUserName = appLinkUserName(req.appUserName);
        const link: AppLinkDoc = {appId: app.id, appUserId: req.appUserId, uid, appUserName, linkedAt: Timestamp.now()};
        txn.create(linkRef, link);
        txn.update(ref, {status: "linked"});
        const displayName: string = user.get("displayName") ?? "";
        txn.set(recordRef(), recordDoc("account-app-link", {
            performedBy: uid,
            performedByName: displayName,
            targetUid: uid,
            targetName: displayName,
            appId: app.id,
            appName: app.name,
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
        return {email, appName: app.name, appUserName};
    });

    if (linked.email) {
        await sendNotice(await appLinkChangedMail(
            linked.email, linked.appName, linked.appUserName, true, readMailLanguage(input.language),
            linkUndoUrl(undoToken)));
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
 * Undoes the caller's link in an app, which stops the app reading anything of
 * the account at once. Each side then waits out LINK_HOLD_DAYS before linking
 * anyone else. Works on an app that has since stopped linking accounts too.
 */
export const unlinkApp = onCall(LINK_CALL, async (request) => {
    const uid = await requireRegisteredSession(request, "account");
    const input = (request.data ?? {}) as {appId?: unknown; language?: unknown};
    const appId = validateAppId(input.appId);
    await limitNoticedChange(uid, "appLink");

    const unlinked = await db.runTransaction(async (txn) => {
        const [user, linked, appSnap] = await Promise.all([
            txn.get(db.collection("users").doc(uid)),
            txn.get(accountLinkQuery(appId, uid)),
            txn.get(appsCol().doc(appId)),
        ]);
        if (linked.empty) return null;
        const link = linked.docs[0].data() as AppLinkDoc;
        const appName = readApp(appSnap)?.name ?? appId;
        unlinkInTxn(txn, link, true);
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
        return {email: (user.get("email") as string | undefined) ?? "", appName, appUserName: link.appUserName};
    });

    if (unlinked?.email) {
        await sendNotice(await appLinkChangedMail(
            unlinked.email, unlinked.appName, appLinkUserName(unlinked.appUserName), false,
            readMailLanguage(input.language)));
    }
    return {unlinked: !!unlinked};
});

/**
 * The "This wasn't me" link in a link's notice (AppLinkUndoDoc), for an owner
 * whose sign-in someone else used to link their own account in an app. Undoes
 * the link without holding the account to that app's account, and lifts the
 * hold if it's been unlinked since, so the owner can link their own at once;
 * the app's account waits out the hold before linking anyone (disownLinkInTxn).
 *
 * Whoever linked it could sign in, so, as undoing an email change does, it
 * replaces the password and signs every device out, and the new password is
 * the way back in. The link is used up only once every device is signed out:
 * until then whoever linked it is still in, so following it again finishes.
 * Signs nobody in.
 */
export const undoAppLink = onCall(LINK_UNDO_CALL, async (request) => {
    const input = (request.data ?? {}) as {token?: unknown; password?: unknown};
    await consumeRateLimit(
        `linkUndo_${callerAddressKey(request.rawRequest)}`, LINK_UNDOS_PER_HOUR_PER_NETWORK, HOUR_MS);
    if (!isLinkUndoToken(input.token)) throw badUndoLink();
    const undoRef = linkUndoRef(input.token);
    const passwordHash = await hashPassword(await checkNewPassword(input.password));

    const {uid, appName} = await db.runTransaction(async (txn) => {
        const undo = (await txn.get(undoRef)).data() as AppLinkUndoDoc | undefined;
        if (!undo || undo.expiresAt.toMillis() <= Date.now()) throw badUndoLink();
        const [user, appSnap] = await Promise.all([
            txn.get(db.collection("users").doc(undo.uid)),
            txn.get(appsCol().doc(undo.appId)),
        ]);
        if (!user.exists || user.get("email") !== undo.email) throw badUndoLink();
        const appName = readApp(appSnap)?.name ?? undo.appId;

        await disownLinkInTxn(txn, undo.appId, undo.uid, undo.appUserId);
        txn.set(credentialsRef(undo.uid), {
            passwordHash,
            passwordChangedAt: FieldValue.serverTimestamp()
        }, {merge: true});
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
        return {uid: undo.uid, appName};
    });

    await endSessions(uid, null);
    await undoRef.delete();
    return {appName};
});
