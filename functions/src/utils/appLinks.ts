import { randomBytes, randomInt } from "node:crypto";
import { HttpsError } from "firebase-functions/v2/https";
import { Timestamp } from "firebase-admin/firestore";
import { db } from "./firebase";

/**
 * Account links: an account here paired with someone's account in a registered
 * app (see apps.ts) whose `accountLinking` is on, the Chinese mini program
 * first. Both sides keep their own accounts and sign-ins, and either works
 * without the other: a link only lets the app read, with its key, what this
 * account is here (functions/api.ts). Nothing here ever reads the app.
 *
 * A link is one to one within an app: an account links one of the app's
 * accounts, and that one links only it. It's made from here and confirmed on
 * both sides, each seeing who the other is:
 *
 * 1. The account starts a request in Settings (startAppLink), which shows a QR
 *    code (LINK_QR_PREFIX and the request's ID) and a six-digit code, for
 *    LINK_REQUEST_TTL_MS.
 * 2. The app's server, once its user has scanned or typed it, looks the request
 *    up (GET /v1/link-requests/…), shows them whose account it is, and, once
 *    they say yes, claims it for them (POST …/claim).
 * 3. The account sees the app's user's name, and confirms (confirmAppLink).
 *
 * The two confirmations stop both ways of tricking someone with a code: having
 * them scan yours, which would put their app account on your account here, and
 * scanning theirs, which would put yours on theirs.
 *
 * Nothing links on its own, not even two accounts on the same address: an
 * address here can change and pass to someone else, and the app's isn't proven.
 */

/** An account's ID in an app, as the app has it: its own user ID, a number in the mini program's case. */
export const APP_USER_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

/** How long the app has to claim a request, and then the account to confirm it. */
export const LINK_REQUEST_TTL_MS = 3 * 60 * 1000;

/** What the QR code a request shows says: this, then the request's ID. */
export const LINK_QR_PREFIX = "SKBYLINK:";

/** A request's ID: 16 random bytes, base64url. What the QR code carries. */
export const LINK_REQUEST_ID_RE = /^[A-Za-z0-9_-]{22}$/;

/** The six digits a request shows for typing in instead, unique among an app's live requests. */
export const LINK_CODE_RE = /^\d{6}$/;

/**
 * How long either side of an undone link waits before linking someone else.
 * Linking back to the same one is fine. Membership and staff roles reach the
 * app through a link, so without it one membership could be passed round a
 * group's accounts in the app.
 */
export const LINK_HOLD_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

export const appLinkUserName = (raw: unknown): string => typeof raw === "string" ? raw : "";

/**
 * An `appLinks` doc, named by appLinkRef. Server only (see firestore.rules):
 * the account reads its own through getAppLinks, the app through the API.
 */
export interface AppLinkDoc {
    appId: string;
    /** The app's ID for its user (APP_USER_ID_RE). */
    appUserId: string;
    uid: string;
    /** The app's user's name as the app gave it when claiming, for Settings to show. */
    appUserName: string;
    linkedAt: Timestamp;
}

export const appLinksCol = () => db.collection("appLinks");

/** An app's user's link, named for both, which an app's ID (APP_ID_RE) keeps apart: it has no "_". */
export const appLinkRef = (appId: string, appUserId: string) => appLinksCol().doc(`${appId}_${appUserId}`);

/** The query for an account's link in an app, of which there's at most one. */
export const accountLinkQuery = (appId: string, uid: string) =>
    appLinksCol().where("appId", "==", appId).where("uid", "==", uid).limit(1);

/** Every link an account has, in any app. */
export const accountLinksQuery = (uid: string) => appLinksCol().where("uid", "==", uid);

export type LinkSide = "account" | "app-user";

/**
 * An `appLinkHolds` doc: one side of an undone link waiting out LINK_HOLD_DAYS
 * before linking anyone but `partner`, the one it was linked to. Server only;
 * a TTL policy (firestore.indexes.json) deletes it once it's run out.
 */
interface AppLinkHoldDoc {
    appId: string;
    partner: string;
    expiresAt: Timestamp;
}

const appLinkHoldRef = (appId: string, side: LinkSide, id: string) =>
    db.collection("appLinkHolds").doc(`${appId}_${side === "account" ? "a" : "u"}_${id}`);

/**
 * When the hold on one side runs out, if it's holding it from linking `partner`;
 * null when it may. Read in the transaction that would link it.
 */
export async function linkHeldUntil(
    txn: FirebaseFirestore.Transaction,
    appId: string,
    side: LinkSide,
    id: string,
    partner: string,
): Promise<Date | null> {
    const hold = (await txn.get(appLinkHoldRef(appId, side, id))).data() as AppLinkHoldDoc | undefined;
    if (!hold || hold.partner === partner || hold.expiresAt.toMillis() <= Date.now()) return null;
    return hold.expiresAt.toDate();
}

/** The refusal for a side still waiting out a hold, saying until when. */
export const linkOnHold = (side: LinkSide, until: Date) =>
    new HttpsError("failed-precondition", side === "account"
        ? "This account was linked to someone else recently, and can't link another yet."
        : "This app account was linked to another account recently, and can't link another yet.", {
        code: "link-on-hold",
        side,
        until: until.toISOString(),
    });

/**
 * Undoes a link in `txn`. With `hold`, each side then waits out LINK_HOLD_DAYS
 * before linking anyone else; without, as when the account is being deleted
 * or put back by its owner after a takeover, it's free at once.
 */
export function unlinkInTxn(txn: FirebaseFirestore.Transaction, link: AppLinkDoc, hold: boolean): void {
    txn.delete(appLinkRef(link.appId, link.appUserId));
    if (!hold) return;
    const expiresAt = Timestamp.fromMillis(Date.now() + LINK_HOLD_DAYS * DAY_MS);
    const holdDoc = (partner: string): AppLinkHoldDoc => ({appId: link.appId, partner, expiresAt});
    txn.set(appLinkHoldRef(link.appId, "account", link.uid), holdDoc(link.appUserId));
    txn.set(appLinkHoldRef(link.appId, "app-user", link.appUserId), holdDoc(link.uid));
}

/** Where a request stands. `expired` is never stored: it's a live one past `expiresAt`. */
export type LinkRequestStatus = "waiting" | "claimed" | "linked" | "cancelled" | "expired";

/**
 * An `appLinkRequests` doc, named by its ID. The account it's for may read it
 * (see firestore.rules), so Settings can watch for the app's claim; the rest
 * is server only. A TTL policy deletes it a while after it runs out.
 */
export interface AppLinkRequestDoc {
    appId: string;
    uid: string;
    code: string;
    status: Exclude<LinkRequestStatus, "expired">;
    /** Set by the app's claim. */
    appUserId?: string;
    appUserName?: string;
    createdAt: Timestamp;
    /** Pushed on by a claim, so the account has its own LINK_REQUEST_TTL_MS to confirm. */
    expiresAt: Timestamp;
}

export const appLinkRequestsCol = () => db.collection("appLinkRequests");

/** `doc`'s status as of now. A linked or cancelled one stays so past its time. */
export function linkRequestStatus(doc: AppLinkRequestDoc): LinkRequestStatus {
    if (doc.status === "linked" || doc.status === "cancelled") return doc.status;
    return doc.expiresAt.toMillis() <= Date.now() ? "expired" : doc.status;
}

export const newLinkRequestId = () => randomBytes(16).toString("base64url");

/** Six digits not on any of `appId`'s live requests, read in `txn`. */
export async function freeLinkCode(txn: FirebaseFirestore.Transaction, appId: string): Promise<string> {
    for (let attempt = 0; attempt < 5; attempt++) {
        const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
        const taken = await txn.get(appLinkRequestsCol().where("appId", "==", appId).where("code", "==", code));
        if (taken.docs.every(doc => linkRequestStatus(doc.data() as AppLinkRequestDoc) !== "waiting")) return code;
    }
    throw new HttpsError("unavailable", "Couldn't make a code just now. Please try again.");
}
