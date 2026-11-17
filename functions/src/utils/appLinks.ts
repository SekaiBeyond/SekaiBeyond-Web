import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { HttpsError } from "firebase-functions/v2/https";
import { Timestamp } from "firebase-admin/firestore";
import { PUBLIC_ORIGIN } from "./config";
import { accountPepper } from "./credentials";
import { deletionPending } from "./deletion";
import { db } from "./firebase";

export const APP_USER_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

export const LINK_REQUEST_TTL_MS = 3 * 60 * 1000;

export const LINK_QR_PREFIX = "SKBYLINK:";

export const LINK_REQUEST_ID_RE = /^[A-Za-z0-9_-]{22}$/;

export const LINK_CODE_RE = /^\d{6}$/;

export const LINK_HOLD_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

export const LINK_SHARED_FIELDS = {
    en: "name, photo, masked email, group and team title, membership, event staff roles, any ban and when it ends, and any deletion date",
    zh: "名称、头像、打码的邮箱、组别与团队头衔、会员状态、活动工作人员身份、封禁状态及截止时间，以及预定删除时间",
} as const;

export const appLinkUserName = (raw: unknown): string => typeof raw === "string" ? raw : "";

export interface AppLinkDoc {
    appId: string;
    appUserId: string;
    uid: string;
    appUserName: string;
    linkedAt: Timestamp;
}

export const appLinksCol = () => db.collection("appLinks");

export const appLinkRef = (appId: string, appUserId: string) => appLinksCol().doc(`${appId}_${appUserId}`);

export const accountLinkInAppQuery = (appId: string, uid: string) =>
    appLinksCol().where("appId", "==", appId).where("uid", "==", uid).limit(1);

export const accountLinksQuery = (uid: string) => appLinksCol().where("uid", "==", uid);

type LinkSide = "account" | "app-user";

interface AppLinkHoldDoc {
    appId: string;
    partner: string;
    expiresAt: Timestamp;
}

const appLinkHoldsCol = () => db.collection("appLinkHolds");

const appLinkHoldRef = (appId: string, side: LinkSide, id: string) =>
    appLinkHoldsCol().doc(`${appId}_${side === "account" ? "a" : "u"}_${id}`);

export async function readAccountHold(
    appId: string,
    uid: string,
): Promise<{partner: string; until: Date} | null> {
    const hold = (await appLinkHoldRef(appId, "account", uid).get()).data() as AppLinkHoldDoc | undefined;
    if (!hold || hold.expiresAt.toMillis() <= Date.now()) return null;
    return {partner: hold.partner, until: hold.expiresAt.toDate()};
}

const recentDisownRef = (appId: string, uid: string) => appLinkHoldsCol().doc(`${appId}_d_${uid}`);

async function linkHeldUntil(
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

const linkOnHold = (side: LinkSide, until: Date) =>
    new HttpsError("already-exists", side === "account"
        ? "The account here was linked to someone else in this app recently, and can't link another yet."
        : "The app's account was linked to another account here recently, and can't link another yet.", {
        code: "link-on-hold",
        side,
        until: until.toISOString(),
    });

export function unlinkInTxn(txn: FirebaseFirestore.Transaction, link: AppLinkDoc): void {
    txn.delete(appLinkRef(link.appId, link.appUserId));
    const expiresAt = Timestamp.fromMillis(Date.now() + LINK_HOLD_DAYS * DAY_MS);
    const holdDoc = (partner: string): AppLinkHoldDoc => ({appId: link.appId, partner, expiresAt});
    txn.set(appLinkHoldRef(link.appId, "account", link.uid), holdDoc(link.appUserId));
    txn.set(appLinkHoldRef(link.appId, "app-user", link.appUserId), holdDoc(link.uid));
}

export const LINK_UNDO_DAYS = 7;

const LINK_UNDO_TOKEN_RE = /^[0-9a-f]{64}$/;

export interface AppLinkUndoDoc {
    uid: string;
    appId: string;
    appUserId: string;
    appUserName: string;
    email: string;
    expiresAt: Timestamp;
    usedAt?: Timestamp;
}

export const newLinkUndoToken = (): string => randomBytes(32).toString("hex");

export const isLinkUndoToken = (value: unknown): value is string =>
    typeof value === "string" && LINK_UNDO_TOKEN_RE.test(value);

export const linkUndoRef = (token: string) =>
    db.collection("appLinkUndos").doc(createHash("sha256").update(token).digest("hex"));

export const linkUndoUrl = (token: string): string => `${PUBLIC_ORIGIN}/undo-app-link#token=${token}`;

interface LinkDisown {
    appId: string;
    uid: string;
    appUserId: string;
    linked: boolean;
    accountHold: {partner: string; expiresAt: Timestamp} | null;
    firstInAWhile: boolean;
}

export async function readLinkDisown(
    txn: FirebaseFirestore.Transaction,
    appId: string,
    uid: string,
    appUserId: string,
): Promise<LinkDisown> {
    const [link, accountHold, disowned] = await Promise.all([
        txn.get(appLinkRef(appId, appUserId)),
        txn.get(appLinkHoldRef(appId, "account", uid)),
        txn.get(recentDisownRef(appId, uid)),
    ]);
    const lastDisownHolds = (disowned.get("expiresAt") as Timestamp | undefined)?.toMillis() ?? 0;
    return {
        appId,
        uid,
        appUserId,
        linked: link.get("uid") === uid,
        accountHold: (accountHold.data() as AppLinkHoldDoc | undefined) ?? null,
        firstInAWhile: lastDisownHolds <= Date.now(),
    };
}

export function disownLinkInTxn(
    txn: FirebaseFirestore.Transaction,
    {appId, uid, appUserId, linked, accountHold, firstInAWhile}: LinkDisown,
): Date | null {
    const accountHoldRef = appLinkHoldRef(appId, "account", uid);
    const now = Date.now();
    const holdUntil = Timestamp.fromMillis(now + LINK_HOLD_DAYS * DAY_MS);

    if (linked) txn.delete(appLinkRef(appId, appUserId));
    txn.set(appLinkHoldRef(appId, "app-user", appUserId), {
        appId,
        partner: "",
        expiresAt: holdUntil
    } satisfies AppLinkHoldDoc);

    if (firstInAWhile) {
        if (accountHold?.partner === appUserId) txn.delete(accountHoldRef);
        txn.set(recentDisownRef(appId, uid), {appId, partner: "", expiresAt: holdUntil} satisfies AppLinkHoldDoc);
        return null;
    }
    if (linked) {
        txn.set(accountHoldRef, {appId, partner: appUserId, expiresAt: holdUntil} satisfies AppLinkHoldDoc);
        return holdUntil.toDate();
    }
    return accountHold && accountHold.expiresAt.toMillis() > now ? accountHold.expiresAt.toDate() : null;
}

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

type LinkRequestStatus = "waiting" | "claimed" | "linked" | "cancelled" | "expired";

export interface AppLinkRequestDoc {
    appId: string;
    uid: string;
    code: string;
    status: Exclude<LinkRequestStatus, "expired">;
    appUserId?: string;
    appUserName?: string;
    confirmCodeHash?: string;
    confirmAttempts?: number;
    refusal?: LinkRefusal;
    createdAt: Timestamp;
    expiresAt: Timestamp;
}

interface LinkRefusal {
    code: string;
    side?: string;
    until?: string;
    at: Timestamp;
}

export function linkRefusal(err: HttpsError): LinkRefusal {
    const details = (err.details ?? {}) as {code?: unknown; side?: unknown; until?: unknown};
    return {
        code: typeof details.code === "string" ? details.code : "link-refused",
        ...(typeof details.side === "string" ? {side: details.side} : {}),
        ...(typeof details.until === "string" ? {until: details.until} : {}),
        at: Timestamp.now(),
    };
}

export const LINK_CONFIRM_CODE_RE = /^\d{4}$/;

export const LINK_CONFIRM_ATTEMPTS = 5;

export const newLinkConfirmCode = (): string => String(randomInt(0, 10_000)).padStart(4, "0");

export const linkConfirmCodeHash = (requestId: string, code: string): string =>
    createHmac("sha256", accountPepper()).update(`link|${requestId}|${code}`).digest("hex");

export function linkConfirmCodeMatches(requestId: string, req: AppLinkRequestDoc, code: string): boolean {
    if (!req.confirmCodeHash || !LINK_CONFIRM_CODE_RE.test(code)) return false;
    const expected = Buffer.from(req.confirmCodeHash, "hex");
    const given = Buffer.from(linkConfirmCodeHash(requestId, code), "hex");
    return expected.length === given.length && timingSafeEqual(expected, given);
}

export const appLinkRequestsCol = () => db.collection("appLinkRequests");

export function linkRequestStatus(doc: AppLinkRequestDoc): LinkRequestStatus {
    if (doc.status === "linked" || doc.status === "cancelled") return doc.status;
    return doc.expiresAt.toMillis() <= Date.now() ? "expired" : doc.status;
}

export const newLinkRequestId = () => randomBytes(16).toString("base64url");

export async function freeLinkCode(txn: FirebaseFirestore.Transaction, appId: string): Promise<string> {
    for (let attempt = 0; attempt < 5; attempt++) {
        const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
        const taken = await txn.get(appLinkRequestsCol().where("appId", "==", appId).where("code", "==", code));
        if (taken.docs.every(doc => linkRequestStatus(doc.data() as AppLinkRequestDoc) !== "waiting")) return code;
    }
    throw new HttpsError("unavailable", "Couldn't make a code just now. Please try again.");
}
