import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { HttpsError } from "firebase-functions/v2/https";
import { Timestamp } from "firebase-admin/firestore";
import { PUBLIC_ORIGIN } from "./config";
import { accountPepper } from "./credentials";
import { deletionPending } from "./deletion";
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
 *    they say yes, claims it for them (POST …/claim). The claim's answer has a
 *    four-digit code (LINK_CONFIRM_CODE_RE) for the app to show them.
 * 3. The account sees the app's user's name, types in the code the app shows,
 *    and confirms (confirmAppLink).
 *
 * The two confirmations stop both ways of tricking someone with a code: having
 * them scan yours, which would put their app account on your account here, and
 * scanning theirs, which would put yours on theirs. The name alone wouldn't
 * stop the second, as the app's user picks it: someone who saw your code could
 * claim it under your name. The code the app shows proves whoever confirms
 * here can see the claimer's screen.
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

/**
 * What a linked app reads of an account (linkJson in functions/api.ts), as the
 * emails put it. Settings and the Apps tool say the same from their copy in
 * app/lib/appLinks.ts: change all three together, and linkJson with them.
 */
export const LINK_SHARED_FIELDS = {
    en: "name, photo, masked email, group and team title, membership, event staff roles, any ban and when it ends, and any deletion date",
    zh: "名称、头像、打码的邮箱、组别与团队头衔、会员状态、活动工作人员身份、封禁状态及截止时间，以及预定删除时间",
} as const;

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

/**
 * An account's link in one app, of which there's at most one. Not every link
 * it has: that's accountLinksQuery, which deleting the account needs.
 */
export const accountLinkInAppQuery = (appId: string, uid: string) =>
    appLinksCol().where("appId", "==", appId).where("uid", "==", uid).limit(1);

/** Every link an account has, in every app. */
export const accountLinksQuery = (uid: string) => appLinksCol().where("uid", "==", uid);

export type LinkSide = "account" | "app-user";

/**
 * An `appLinkHolds` doc: one side of an undone link waiting out LINK_HOLD_DAYS
 * before linking anyone but `partner`, the one it was linked to, or anyone at
 * all when that's "": an app's account whose link the account disowned
 * (disownLinkInTxn). The collection also keeps when an account last disowned
 * a link (recentDisownRef). Server only; a TTL policy (firestore.indexes.json)
 * deletes each once it's run out.
 */
interface AppLinkHoldDoc {
    appId: string;
    partner: string;
    expiresAt: Timestamp;
}

const appLinkHoldsCol = () => db.collection("appLinkHolds");

const appLinkHoldRef = (appId: string, side: LinkSide, id: string) =>
    appLinkHoldsCol().doc(`${appId}_${side === "account" ? "a" : "u"}_${id}`);

/** The hold on an account's side in an app, as staff see it: who it may still link, and until when. */
export async function readAccountHold(
    appId: string,
    uid: string,
): Promise<{partner: string; until: Date} | null> {
    const hold = (await appLinkHoldRef(appId, "account", uid).get()).data() as AppLinkHoldDoc | undefined;
    if (!hold || hold.expiresAt.toMillis() <= Date.now()) return null;
    return {partner: hold.partner, until: hold.expiresAt.toDate()};
}

/**
 * When an account last disowned a link in an app, for LINK_HOLD_DAYS after:
 * disowning one skips the hold only once in that time (disownLinkInTxn).
 */
const recentDisownRef = (appId: string, uid: string) => appLinkHoldsCol().doc(`${appId}_d_${uid}`);

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

/**
 * Refuses linking `uid` and `appUserId` in `appId` unless both are free to: the
 * account is still here and not due to be deleted, neither side is linked to
 * anyone else in the app, and neither is waiting out a hold that keeps it from
 * the other. Read in the transaction that would link them, before it writes:
 * the app's claim (functions/api.ts) and the account's confirming
 * (confirmAppLink) both check it. Returns the account's user doc.
 *
 * Each refusal names its code in `details`, which Settings and the API both
 * answer with; the API sends the rest of `details` too. The conflicts are
 * `already-exists`, which the API answers with 409.
 */
export async function assertCanLink(
    txn: FirebaseFirestore.Transaction,
    appId: string,
    uid: string,
    appUserId: string,
): Promise<FirebaseFirestore.DocumentSnapshot> {
    const [user, accountLinked, appUserLinked, accountHeld, appUserHeld] = await Promise.all([
        txn.get(db.collection("users").doc(uid)),
        txn.get(accountLinkInAppQuery(appId, uid)),
        txn.get(appLinkRef(appId, appUserId)),
        linkHeldUntil(txn, appId, "account", uid, appUserId),
        linkHeldUntil(txn, appId, "app-user", appUserId, uid),
    ]);
    if (!user.exists || deletionPending(user.data()!)) {
        throw new HttpsError("failed-precondition", "The account here is due to be deleted.", {
            code: "deletion-pending",
        });
    }
    if (!accountLinked.empty) {
        throw new HttpsError("already-exists", "The account here is already linked to another account in this app.", {
            code: "account-linked",
        });
    }
    if (appUserLinked.exists) {
        throw new HttpsError("already-exists", "The app's account is already linked to another account here.", {
            code: "app-user-linked",
        });
    }
    if (accountHeld) throw linkOnHold("account", accountHeld);
    if (appUserHeld) throw linkOnHold("app-user", appUserHeld);
    return user;
}

/** The refusal for a side still waiting out a hold, saying until when. */
const linkOnHold = (side: LinkSide, until: Date) =>
    new HttpsError("already-exists", side === "account"
        ? "The account here was linked to someone else in this app recently, and can't link another yet."
        : "The app's account was linked to another account here recently, and can't link another yet.", {
        code: "link-on-hold",
        side,
        until: until.toISOString(),
    });

/**
 * Undoes a link in `txn`. With `hold`, each side then waits out LINK_HOLD_DAYS
 * before linking anyone else; without, as when the account is being deleted
 * or put back by its owner after a takeover, it's free at once.
 */
export function unlinkInTxn(txn: FirebaseFirestore.Transaction, link: AppLinkDoc, {hold}: {hold: boolean}): void {
    txn.delete(appLinkRef(link.appId, link.appUserId));
    if (!hold) return;
    const expiresAt = Timestamp.fromMillis(Date.now() + LINK_HOLD_DAYS * DAY_MS);
    const holdDoc = (partner: string): AppLinkHoldDoc => ({appId: link.appId, partner, expiresAt});
    txn.set(appLinkHoldRef(link.appId, "account", link.uid), holdDoc(link.appUserId));
    txn.set(appLinkHoldRef(link.appId, "app-user", link.appUserId), holdDoc(link.uid));
}

/** How long the "This wasn't me" link in a link's notice works (undoAppLink). */
export const LINK_UNDO_DAYS = 7;

const LINK_UNDO_TOKEN_RE = /^[0-9a-f]{64}$/;

/**
 * An `appLinkUndos` doc, named by a hash of its token, so a copy of the
 * database can't be used to follow one: the "This wasn't me" link in the
 * notice an account gets when it's linked (appLinkChangedMail). It's for an
 * owner whose sign-in someone else used to link their own account in an app,
 * which would go on reading this one. Unlinking in Settings would hold the
 * owner's account to that app's account for LINK_HOLD_DAYS, and this doesn't
 * (disownLinkInTxn).
 *
 * It's the mailbox that counts, so it works only while the account is still on
 * `email`, the address the notice went to. Server only; a TTL policy deletes
 * it once it's run out.
 */
export interface AppLinkUndoDoc {
    uid: string;
    appId: string;
    appUserId: string;
    /** The app's user's name, as on the link, for the record. */
    appUserName: string;
    email: string;
    expiresAt: Timestamp;
    /** Set once it has undone the link, while signing every device out is left. */
    usedAt?: Timestamp;
}

export const newLinkUndoToken = (): string => randomBytes(32).toString("hex");

export const isLinkUndoToken = (value: unknown): value is string =>
    typeof value === "string" && LINK_UNDO_TOKEN_RE.test(value);

export const linkUndoRef = (token: string) =>
    db.collection("appLinkUndos").doc(createHash("sha256").update(token).digest("hex"));

// After the #, so it never reaches a server's logs or anyone's Referer header.
export const linkUndoUrl = (token: string): string => `${PUBLIC_ORIGIN}/undo-app-link#token=${token}`;

/**
 * Undoes, in `txn`, a link its account says it never made: the link, if it's
 * still there, and the hold undoing it put on the account, if it's been undone
 * since, so the account may link its own app account at once. The app's
 * account waits out LINK_HOLD_DAYS before linking anyone, this account too.
 *
 * Only once in LINK_HOLD_DAYS per app, though. Its owner could otherwise use
 * it to skip the hold on their own links, and pass a membership round a group
 * a link at a time. A second in that time still undoes the link, but holds
 * the account as unlinking in Settings would, and staff can lift that
 * (clearAppLinkHold) for someone who really was taken over twice.
 *
 * Reads before it writes, so call it before any other write in `txn`. Says
 * when the account's hold ends, or null when it isn't held.
 */
export async function disownLinkInTxn(
    txn: FirebaseFirestore.Transaction,
    appId: string,
    uid: string,
    appUserId: string,
): Promise<Date | null> {
    const linkRef = appLinkRef(appId, appUserId);
    const accountHoldRef = appLinkHoldRef(appId, "account", uid);
    const disownRef = recentDisownRef(appId, uid);
    const [link, accountHold, disowned] = await Promise.all([
        txn.get(linkRef),
        txn.get(accountHoldRef),
        txn.get(disownRef),
    ]);
    const now = Date.now();
    const holdUntil = Timestamp.fromMillis(now + LINK_HOLD_DAYS * DAY_MS);
    const lastDisownHolds = (disowned.get("expiresAt") as Timestamp | undefined)?.toMillis() ?? 0;
    const firstInAWhile = lastDisownHolds <= now;

    const linked = link.get("uid") === uid;
    if (linked) txn.delete(linkRef);
    txn.set(appLinkHoldRef(appId, "app-user", appUserId), {
        appId,
        partner: "",
        expiresAt: holdUntil
    } satisfies AppLinkHoldDoc);

    if (firstInAWhile) {
        if (accountHold.get("partner") === appUserId) txn.delete(accountHoldRef);
        txn.set(disownRef, {appId, partner: "", expiresAt: holdUntil} satisfies AppLinkHoldDoc);
        return null;
    }
    if (linked) {
        txn.set(accountHoldRef, {appId, partner: appUserId, expiresAt: holdUntil} satisfies AppLinkHoldDoc);
        return holdUntil.toDate();
    }
    const held = accountHold.data() as AppLinkHoldDoc | undefined;
    return held && held.expiresAt.toMillis() > now ? held.expiresAt.toDate() : null;
}

/**
 * Lifts the hold on an account's side in an app, for staff helping someone
 * who linked the wrong account of theirs. Says whether there was one.
 */
export async function clearAccountHoldInTxn(
    txn: FirebaseFirestore.Transaction,
    appId: string,
    uid: string,
): Promise<boolean> {
    const ref = appLinkHoldRef(appId, "account", uid);
    const hold = await txn.get(ref);
    if (!hold.exists) return false;
    txn.delete(ref);
    return (hold.get("expiresAt") as Timestamp).toMillis() > Date.now();
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
    /**
     * Set by the app's claim: the code the app shows its user, for the account
     * to type in (linkConfirmCodeHash). Peppered, as the account can read this
     * doc, and could otherwise work out a four-digit code from its hash.
     */
    confirmCodeHash?: string;
    /** Wrong codes typed in so far. LINK_CONFIRM_ATTEMPTS of them cancel it. */
    confirmAttempts?: number;
    createdAt: Timestamp;
    /** Pushed on by a claim, so the account has its own LINK_REQUEST_TTL_MS to confirm. */
    expiresAt: Timestamp;
}

/** The code a claim hands the app to show its user, for the account to type in here. */
export const LINK_CONFIRM_CODE_RE = /^\d{4}$/;

/** Wrong codes the account may type in before its request is cancelled. */
export const LINK_CONFIRM_ATTEMPTS = 5;

export const newLinkConfirmCode = (): string => String(randomInt(0, 10_000)).padStart(4, "0");

/** A request's confirming code as it's kept, keyed by the pepper, the request's ID mixed in. */
export const linkConfirmCodeHash = (requestId: string, code: string): string =>
    createHmac("sha256", accountPepper()).update(`link|${requestId}|${code}`).digest("hex");

/** Whether `code` is the one `req`'s claim handed the app. */
export function linkConfirmCodeMatches(requestId: string, req: AppLinkRequestDoc, code: string): boolean {
    if (!req.confirmCodeHash || !LINK_CONFIRM_CODE_RE.test(code)) return false;
    const expected = Buffer.from(req.confirmCodeHash, "hex");
    const given = Buffer.from(linkConfirmCodeHash(requestId, code), "hex");
    return expected.length === given.length && timingSafeEqual(expected, given);
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
