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
import { credentialsRef, googleBindingOf, googleIndexRef, PASSWORD_PEPPER, } from "../utils/credentials";
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

const LINK_CALL: CallableOptions = {maxInstances: 10, secrets: [RESEND_API_KEY, PASSWORD_PEPPER]};

const LINK_REQUESTS_PER_HOUR = 10;
const HOUR_MS = 60 * 60 * 1000;

const LINK_UNDO_CALL: CallableOptions = {maxInstances: 20, memory: "512MiB", secrets: [PASSWORD_PEPPER]};

const LINK_UNDOS_PER_HOUR_PER_NETWORK = 30;

const badUndoLink = () => new HttpsError("not-found", "This link doesn't work.", {code: "bad-undo-link"});

const linkingOff = () =>
    new HttpsError("failed-precondition", "This app doesn't link accounts.", {code: "linking-off"});

const requestGone = () =>
    new HttpsError("not-found", "This request has run out. Start again.", {code: "link-request-gone"});

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

export const removeAppLink = onCall(LINK_CALL, async (request) => {
    const uid = await requireRegisteredSession(request, "account");
    const input = (request.data ?? {}) as {appId?: unknown; language?: unknown};
    const appId = validateAppId(input.appId);
    const language = readMailLanguage(input.language);
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
    await undoRef.delete();
    return {appId, nameEn, nameCn, heldUntil: heldUntil?.toISOString() ?? null};
});

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
