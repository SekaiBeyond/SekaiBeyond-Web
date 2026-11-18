import * as crypto from "crypto";
import { type FunctionsErrorCode, HttpsError, onRequest } from "firebase-functions/v2/https";
import { FieldPath, FieldValue, Timestamp } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import type { DecodedIdToken } from "firebase-admin/auth";
import { checkApiKeyRateLimit, consumeRateLimit, normalizeGroup, type UserGroup } from "../utils/auth";
import { type ApiKeyDoc, apiKeysCol, type ApiScope, hashApiKey, isApiKeyShaped } from "../utils/apiKeys";
import {
    APP_ID_RE,
    appNameIn,
    appOrigins,
    appRecordName,
    appsCol,
    CODE_VERIFIER_RE,
    hasSignIn,
    mintAppToken,
    readApp,
    redeemSignInCode,
    type RegisteredApp,
    registeredApps,
    SIGN_IN_CODE_RE,
    verifyAppIdToken,
} from "../utils/apps";
import { signedInSinceSessionsEnded } from "../utils/sessions";
import { maskEmail } from "../utils/accountEmail";
import { appLinkChangedMail, readMailLanguage, sendNotice } from "../utils/accountMail";
import {
    APP_USER_ID_RE,
    type AppLinkDoc,
    appLinkRef,
    type AppLinkRequestDoc,
    appLinkRequestsCol,
    appLinksCol,
    appLinkUserName,
    assertCanLink,
    LINK_CODE_RE,
    LINK_REQUEST_ID_RE,
    LINK_REQUEST_TTL_MS,
    linkConfirmCodeHash,
    linkRefusal,
    linkRequestStatus,
    newLinkConfirmCode,
    unlinkInTxn,
} from "../utils/appLinks";
import { activeBan } from "../utils/bans";
import { PASSWORD_PEPPER } from "../utils/credentials";
import { deletionPending } from "../utils/deletion";
import { isMembershipActive } from "../utils/membership";
import { detectImageMime, isStorageUrl } from "../utils/storage";
import { RESEND_QUEUE_CAP } from "../utils/config";
import { contactEmailFor, type EmailTemplateDoc, savedTemplate } from "../utils/emailTemplate";
import { eventLocationText, getEventDoc, readConInfo, RESERVED_ID_RE, soonestFirst, } from "../utils/events";
import { db } from "../utils/firebase";
import { isoOrNull } from "../utils/helpers";
import { computeEmailQuotaInTxn, reserveQuotaInTxn, rollbackQuotaReservation } from "../utils/quota";
import { recordDoc, recordRef } from "../utils/records";
import { RESEND_API_KEY, ResendSendError, sendEmails } from "../utils/resendClient";
import { renderTicketEmail, ticketTemplateRef } from "../utils/ticketEmail";
import { walletPassesOnFor } from "../utils/walletPass";
import {
    apiOrderAttendeeId,
    buildFreshTickets,
    isApiOrder,
    type NewTicket,
    SELLABLE_TICKET_TYPES,
    ticketClaimUrl,
} from "../utils/tickets";
import { sanitizeDisplayText, validateOptionalEmail, validateStr } from "../utils/validation";
import { getScheduledMailQueueDepth } from "./scheduledMail";

const ORDER_TICKETS_MAX = 50;

const EVENT_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;
const ORDER_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

const LAST_USED_WRITE_INTERVAL_MS = 5 * 60 * 1000;

const KNOWN_KEYS_MAX_AGE_MS = 5_000;

class ApiError extends Error {
    constructor(readonly status: number, readonly code: string, message: string) {
        super(message);
    }
}

interface ApiKey {
    id: string;
    appId: string;
    name: string;
    scopes: ApiScope[];
    eventIds: string[];
}

interface ApiReply {
    status: number;
    body: unknown;
    file?: {contentType: string; data: Buffer};
}

interface KeyListing {
    at: number;
    ids: Promise<Set<string>>;
}

let knownKeys: KeyListing | null = null;

function listKeyIds(): KeyListing {
    const listing: KeyListing = {
        at: Date.now(),
        ids: apiKeysCol().select().get().then(snap => new Set(snap.docs.map(doc => doc.id))),
    };
    listing.ids.catch(() => {
        if (knownKeys === listing) knownKeys = null;
    });
    return listing;
}

async function isKnownKeyId(keyId: string): Promise<boolean> {
    const last = knownKeys;
    if (last && (await last.ids).has(keyId)) return true;
    if (last && Date.now() - last.at <= KNOWN_KEYS_MAX_AGE_MS) return false;
    if (!knownKeys || knownKeys === last) knownKeys = listKeyIds();
    return (await knownKeys.ids).has(keyId);
}

interface Person {
    uid: string;
    app: RegisteredApp;
    user: FirebaseFirestore.DocumentSnapshot;
}

type Caller = {kind: "key"; key: ApiKey} | {kind: "person"; person: Person};

const JWT_RE = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*$/;

async function authenticate(header: string | undefined): Promise<Caller> {
    const match = /^Bearer\s+(\S{1,4096})$/i.exec(header ?? "");
    if (!match) {
        throw new ApiError(401, "missing-api-key",
            "Send the key, or the ID token of a sign-in to a registered app, as \"Authorization: Bearer <it>\".");
    }
    return JWT_RE.test(match[1])
        ? {kind: "person", person: await authenticatePerson(match[1])}
        : {kind: "key", key: await authenticateKey(match[1])};
}

function peekClaims(jwt: string): Record<string, unknown> | null {
    try {
        const claims: unknown = JSON.parse(Buffer.from(jwt.split(".")[1], "base64url").toString("utf8"));
        return claims && typeof claims === "object" ? claims as Record<string, unknown> : null;
    } catch {
        return null;
    }
}

const PERSON_RATE_LIMIT_MAX = 60;

async function authenticatePerson(idToken: string): Promise<Person> {
    const signInAgain = new ApiError(401, "invalid-token", "This sign-in isn't recognised. Sign in to the app again.");
    const claims = peekClaims(idToken);
    const appId = claims?.app;
    if (typeof appId !== "string" || !APP_ID_RE.test(appId)) throw signInAgain;
    const app = (await registeredApps()).get(appId);
    if (!app || !hasSignIn(app) || claims!.aud !== app.firebaseProjectId) throw signInAgain;
    let token: DecodedIdToken;
    try {
        token = await verifyAppIdToken(app, idToken);
    } catch {
        throw signInAgain;
    }
    if (token.firebase?.sign_in_provider !== "custom" || token.app !== appId) throw signInAgain;

    await consumeRateLimit(`app_${appId}_${token.uid}`, PERSON_RATE_LIMIT_MAX);
    const user = await db.collection("users").doc(token.uid).get();
    if (!user.exists || !signedInSinceSessionsEnded(token, user.data())) {
        throw new ApiError(401, "session-ended", "This sign-in has been signed out. Sign in to the app again.");
    }
    return {uid: token.uid, app, user};
}

async function authenticateKey(credential: string): Promise<ApiKey> {
    const keyId = hashApiKey(credential);
    if (!isApiKeyShaped(credential) || !(await isKnownKeyId(keyId))) {
        throw new ApiError(401, "invalid-api-key", "API key not recognised.");
    }
    const snap = await apiKeysCol().doc(keyId).get();
    const data = snap.data() as ApiKeyDoc | undefined;
    if (!data) throw new ApiError(401, "invalid-api-key", "API key not recognised.");
    if (data.expiresAt.toMillis() <= Date.now()) {
        throw new ApiError(401, "api-key-expired", "This API key has expired.");
    }

    await checkApiKeyRateLimit(snap.id);
    if (!data.lastUsedAt || Date.now() - data.lastUsedAt.toMillis() > LAST_USED_WRITE_INTERVAL_MS) {
        await snap.ref.update({lastUsedAt: Timestamp.now()})
            .catch(err => console.error(`[api] lastUsedAt update failed for ${data.name}`, err));
    }
    return {
        id: snap.id,
        appId: data.appId,
        name: data.name,
        scopes: data.scopes ?? [],
        eventIds: data.eventIds ?? [],
    };
}

function requireScope(key: ApiKey, scope: ApiScope): void {
    if (!key.scopes.includes(scope)) {
        throw new ApiError(403, "missing-scope", `This API key lacks the ${scope} scope.`);
    }
}

function requireKey(caller: Caller): ApiKey {
    if (caller.kind !== "key") {
        throw new ApiError(403, "api-key-required",
            "This needs an API key: a person's sign-in only reaches /v1/me. Call it from the app's server with the app's key.");
    }
    return caller.key;
}

function requirePerson(caller: Caller): Person {
    if (caller.kind !== "person") {
        throw new ApiError(403, "sign-in-required",
            "This is about a person: call it with their sign-in to a registered app, not an API key.");
    }
    return caller.person;
}

function requireEventAccess(key: ApiKey, eventId: string): void {
    if (key.eventIds.length > 0 && !key.eventIds.includes(eventId)) {
        throw new ApiError(403, "event-not-allowed", "This API key isn't allowed to use this event.");
    }
}

const str = (v: unknown): string => typeof v === "string" ? v : "";

type FoundEvent = Awaited<ReturnType<typeof getEventDoc>>;

async function findEvent(eventId: string, txn?: FirebaseFirestore.Transaction): Promise<FoundEvent> {
    const notFound = new ApiError(404, "event-not-found", "Event not found.");
    if (RESERVED_ID_RE.test(eventId)) throw notFound;
    const event = await getEventDoc(eventId, txn);
    if (!event.snap.exists) throw notFound;
    return event;
}

function whyNotOnSale(event: FoundEvent): ApiError | null {
    const data = event.snap.data()!;
    if (event.archived) return new ApiError(422, "event-archived", "This event has been archived.");
    if (data.paid !== true) return new ApiError(422, "event-not-paid", "This event is free: it has no tickets.");
    if (!(data.endAt instanceof Timestamp) || data.endAt.toMillis() <= Date.now()) {
        return new ApiError(422, "event-ended", "This event has ended.");
    }
    if (data.deleteAt) return new ApiError(422, "event-pending-deletion", "This event is due to be deleted.");
    return null;
}

type Venues = Map<string, FirebaseFirestore.DocumentData>;

async function venuesOf(events: FirebaseFirestore.DocumentSnapshot[]): Promise<Venues> {
    const ids = [...new Set(events.map(snap => str(snap.data()?.venueId)).filter(Boolean))];
    if (ids.length === 0) return new Map();
    const snaps = await db.getAll(...ids.map(id => db.collection("venues").doc(id)));
    return new Map(snaps.filter(snap => snap.exists).map(snap => [snap.id, snap.data()!]));
}

function eventJson(event: FoundEvent, venues: Venues) {
    const {snap, archived} = event;
    const data = snap.data()!;
    const venue = venues.get(str(data.venueId));
    const shared = {
        id: snap.id,
        archived,
        onSale: whyNotOnSale(event) === null,
        title: str(data.title),
        titleCn: str(data.titleCn),
        description: str(data.description),
        descriptionCn: str(data.descriptionCn),
        location: eventLocationText(data, venue, true),
        locationCn: eventLocationText(data, venue, false),
        venueId: str(data.venueId),
        con: readConInfo(data.con),
    };
    if (archived) {
        return {
            ...shared,
            date: str(data.date),
            tagIds: Array.isArray(data.tagIds) ? data.tagIds.filter((t: unknown) => typeof t === "string") : [],
            icon: str(data.icon),
            recapLink: str(data.recapLink),
            recapLinkCn: str(data.recapLinkCn),
            published: data.published === true,
            paid: data.paid === true,
            deleteAt: isoOrNull(data.deleteAt),
        };
    }
    return {
        ...shared,
        startAt: isoOrNull(data.startAt),
        endAt: isoOrNull(data.endAt),
        poster: str(data.poster),
        posterCredit: str(data.posterCredit),
        emailHeaderBg: str(data.emailHeaderBg),
        buyTicket: str(data.buyTicket),
        learnMore: str(data.learnMore),
        customButtonText: str(data.customButtonText),
        customButtonTextCn: str(data.customButtonTextCn),
        customButtonLink: str(data.customButtonLink),
        published: data.published === true,
        paid: data.paid === true,
        deleteAt: isoOrNull(data.deleteAt),
    };
}

function ticketStatus(ticket: Partial<NewTicket>): "valid" | "used" | "voided" {
    if (ticket.voided === true) return "voided";
    return ticket.redeemed === true ? "used" : "valid";
}

type EmailStatus = "not-requested" | "sent" | "queued" | "unconfirmed" | "unsent";

function emailStatus(data: FirebaseFirestore.DocumentData): EmailStatus {
    if (data.apiSendEmail !== true) return "not-requested";
    if (data.emailSending === true) return "unconfirmed";
    if (data.emailScheduled === true) return "queued";
    return data.emailSent === true ? "sent" : "unsent";
}

function orderJson(eventId: string, data: FirebaseFirestore.DocumentData) {
    const tickets = (Array.isArray(data.tickets) ? data.tickets : []) as Partial<NewTicket>[];
    return {
        orderId: str(data.apiOrderId),
        eventId,
        createdAt: isoOrNull(data.createdAt),
        updatedAt: isoOrNull(data.updatedAt),
        buyer: {name: str(data.name), email: str(data.email)},
        emailStatus: emailStatus(data),
        ticketCount: tickets.length,
        tickets: tickets.map(t => ({
            ticketId: t.ticketId ?? "",
            type: t.type ?? "normal",
            qr: ticketClaimUrl(t.ticketId ?? "", eventId),
            status: ticketStatus(t),
            createdAt: isoOrNull(t.createdAt),
            redeemed: t.redeemed === true,
            redeemedAt: isoOrNull(t.redeemedAt),
            voided: t.voided === true,
        })),
    };
}

type Snapshot = FirebaseFirestore.DocumentSnapshot;

const byId = (a: Snapshot, b: Snapshot) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

async function heldEvents(eventIds: string[]): Promise<[Snapshot[], Snapshot[]]> {
    const [upcoming, past] = await Promise.all([
        db.getAll(...eventIds.map(id => db.collection("upcomingEvents").doc(id))),
        db.getAll(...eventIds.map(id => db.collection("pastEvents").doc(id))),
    ]);
    const date = (s: Snapshot) => s.get("date") as string;
    return [
        soonestFirst(upcoming),
        past.filter(s => typeof s.get("date") === "string")
            .sort((a, b) => (date(a) < date(b) ? 1 : date(a) > date(b) ? -1 : 0) || byId(b, a)),
    ];
}

async function listEvents(key: ApiKey): Promise<ApiReply> {
    requireScope(key, "events:read");
    const [upcoming, past] = key.eventIds.length > 0
        ? await heldEvents(key.eventIds)
        : await Promise.all([
            db.collection("upcomingEvents").orderBy("startAt", "asc").get().then(snap => snap.docs),
            db.collection("pastEvents").orderBy("date", "desc").get().then(snap => snap.docs),
        ]);
    const venues = await venuesOf([...upcoming, ...past]);
    const events = [
        ...upcoming.map(snap => eventJson({archived: false, snap}, venues)),
        ...past.map(snap => eventJson({archived: true, snap}, venues)),
    ];
    return {status: 200, body: {events}};
}

async function getEvent(key: ApiKey, eventId: string): Promise<ApiReply> {
    requireScope(key, "events:read");
    requireEventAccess(key, eventId);
    const event = await findEvent(eventId);
    return {status: 200, body: eventJson(event, await venuesOf([event.snap]))};
}

const TEAM_GROUPS: UserGroup[] = ["president", "core-staff", "staff"];

const PERSON_FIELDS = ["displayName", "photoURL", "group", "title", "titleCn"];

interface PersonJson {
    uid: string;
    displayName: string;
    photoURL: string;
    group: UserGroup;
    title: string;
    titleCn: string;
}

function personJson(snap: FirebaseFirestore.DocumentSnapshot): PersonJson {
    return {
        uid: snap.id,
        displayName: str(snap.get("displayName")),
        photoURL: str(snap.get("photoURL")),
        group: normalizeGroup(snap.get("group")),
        title: str(snap.get("title")),
        titleCn: str(snap.get("titleCn")),
    };
}

function byGroupThenName(a: PersonJson, b: PersonJson): number {
    const rank = (p: PersonJson) => {
        const i = TEAM_GROUPS.indexOf(p.group);
        return i === -1 ? TEAM_GROUPS.length : i;
    };
    return rank(a) - rank(b) || a.displayName.localeCompare(b.displayName) || (a.uid < b.uid ? -1 : 1);
}

async function exchangeSignInCode(body: unknown, origin: string | undefined): Promise<ApiReply> {
    const input = (body && typeof body === "object" ? body : {}) as {code?: unknown; codeVerifier?: unknown};
    if (typeof input.code !== "string" || !SIGN_IN_CODE_RE.test(input.code)
        || typeof input.codeVerifier !== "string" || !CODE_VERIFIER_RE.test(input.codeVerifier)) {
        throw new ApiError(400, "invalid-request", "Send {\"code\", \"codeVerifier\"} as JSON.");
    }
    const invalid = new ApiError(400, "invalid-code", "This sign-in code isn't valid. Sign in to the app again.");
    const signIn = await redeemSignInCode(input.code, input.codeVerifier);
    if (!signIn) throw invalid;
    if (origin !== undefined && origin !== new URL(signIn.redirectUri).origin) throw invalid;
    const app = readApp(await appsCol().doc(signIn.appId).get());
    if (!app || !hasSignIn(app) || !app.redirectUris.includes(signIn.redirectUri)) throw invalid;

    const user = await db.collection("users").doc(signIn.uid).get();
    const endedAt: unknown = user.get("sessionsEndedAt");
    if (!user.exists || (endedAt instanceof Timestamp && endedAt.toMillis() >= signIn.createdAt.toMillis())) {
        throw new ApiError(401, "session-ended", "This sign-in has been signed out. Sign in to the app again.");
    }
    let token: string;
    try {
        token = await mintAppToken(app, signIn.uid, normalizeGroup(user.get("group")));
    } catch (err) {
        console.error(`[api] couldn't sign ${signIn.uid} in to ${app.id}`, err);
        throw new ApiError(500, "sign-in-failed",
            "Couldn't sign you in to the app. Try again; if it keeps happening, tell the app's maintainers.");
    }
    return {status: 200, body: {token}};
}

function getMe(caller: Caller): ApiReply {
    return {status: 200, body: personJson(requirePerson(caller).user)};
}

async function listTeam(key: ApiKey): Promise<ApiReply> {
    requireScope(key, "team:read");
    const snap = await db.collection("users").where("group", "in", TEAM_GROUPS).select(...PERSON_FIELDS).get();
    return {status: 200, body: {people: snap.docs.map(personJson).sort(byGroupThenName)}};
}

async function listEventStaff(key: ApiKey, eventId: string): Promise<ApiReply> {
    requireScope(key, "event-staff:read");
    requireEventAccess(key, eventId);
    await findEvent(eventId);
    const snap = await db.collection("users")
        .where("eventStaffEvents", "array-contains", eventId)
        .select(...PERSON_FIELDS)
        .get();
    return {status: 200, body: {eventId, staff: snap.docs.map(personJson).sort(byGroupThenName)}};
}

interface OrderInput {
    orderId: string;
    name: string;
    email: string;
    counts: [string, number][];
    total: number;
    sendEmail: boolean;
}

function parseOrder(body: unknown): OrderInput {
    if (!body || typeof body !== "object" || Array.isArray(body)) {
        throw new ApiError(400, "invalid-request", "Send a JSON object with Content-Type: application/json.");
    }
    const input = body as {orderId?: unknown; buyer?: unknown; tickets?: unknown; sendEmail?: unknown};

    if (typeof input.orderId !== "string" || !ORDER_ID_RE.test(input.orderId)) {
        throw new ApiError(400, "invalid-request",
            "orderId must be 1–64 characters of letters, digits, - and _.");
    }
    if (!input.buyer || typeof input.buyer !== "object" || Array.isArray(input.buyer)) {
        throw new ApiError(400, "invalid-request", "buyer must be an object.");
    }
    const buyer = input.buyer as {name?: unknown; email?: unknown};
    const name = sanitizeDisplayText(validateStr(buyer.name, "buyer.name", 100, true));
    if (!name) throw new ApiError(400, "invalid-request", "buyer.name is required.");
    const email = validateOptionalEmail(buyer.email, "buyer.email");

    if (!Array.isArray(input.tickets) || input.tickets.length === 0) {
        throw new ApiError(400, "invalid-request", "tickets must be a non-empty array.");
    }
    const byType = new Map<string, number>();
    for (const raw of input.tickets) {
        const line = (raw ?? {}) as {type?: unknown; count?: unknown};
        if (typeof line.type !== "string" || !SELLABLE_TICKET_TYPES.includes(line.type)) {
            throw new ApiError(422, "unknown-ticket-type",
                `Ticket type must be one of: ${SELLABLE_TICKET_TYPES.join(", ")}.`);
        }
        if (typeof line.count !== "number" || !Number.isInteger(line.count) || line.count < 1) {
            throw new ApiError(400, "invalid-request", "Each ticket count must be a positive integer.");
        }
        byType.set(line.type, (byType.get(line.type) ?? 0) + line.count);
    }
    const counts = SELLABLE_TICKET_TYPES
        .filter(type => byType.has(type))
        .map((type): [string, number] => [type, byType.get(type)!]);
    const total = counts.reduce((sum, [, count]) => sum + count, 0);
    if (total > ORDER_TICKETS_MAX) {
        throw new ApiError(400, "invalid-request", `An order holds at most ${ORDER_TICKETS_MAX} tickets.`);
    }

    if (input.sendEmail != null && typeof input.sendEmail !== "boolean") {
        throw new ApiError(400, "invalid-request", "sendEmail must be true or false.");
    }
    const sendEmail = input.sendEmail === true;
    if (sendEmail && !email) throw new ApiError(400, "invalid-request", "sendEmail needs buyer.email.");
    return {orderId: input.orderId, name, email, counts, total, sendEmail};
}

function orderFingerprint(order: OrderInput): string {
    return crypto.createHash("sha256")
        .update(JSON.stringify({name: order.name, email: order.email, counts: order.counts}))
        .digest("hex");
}

interface PendingEmail {
    ref: FirebaseFirestore.DocumentReference;
    doc: FirebaseFirestore.DocumentData;
    eventData: FirebaseFirestore.DocumentData;
    template: EmailTemplateDoc;
    contactEmail: string;
}

async function createOrder(key: ApiKey, eventId: string, body: unknown): Promise<ApiReply> {
    requireScope(key, "tickets:write");
    requireEventAccess(key, eventId);
    const order = parseOrder(body);
    const fingerprint = orderFingerprint(order);

    const placed = await db.runTransaction(async (txn): Promise<{reply: ApiReply; email?: PendingEmail}> => {
        const event = await findEvent(eventId, txn);
        const orderRef = event.snap.ref.collection("attendees")
            .doc(apiOrderAttendeeId(key.appId, order.orderId));
        const orderSnap = await txn.get(orderRef);

        if (orderSnap.exists) {
            const data = orderSnap.data()!;
            if (data.apiOrderFingerprint !== fingerprint) {
                throw new ApiError(409, "order-conflict",
                    "An order with this orderId already exists with different contents.");
            }
            return {reply: {status: 200, body: orderJson(eventId, data)}};
        }
        const refusal = whyNotOnSale(event);
        if (refusal) throw refusal;
        const eventData = event.snap.data()!;
        let email: Omit<PendingEmail, "ref" | "doc" | "eventData"> | null = null;
        if (order.sendEmail) {
            const template = savedTemplate((await txn.get(ticketTemplateRef(event.snap.ref))).data());
            email = {template, contactEmail: await contactEmailFor(template)};
        }

        const tickets: NewTicket[] = [];
        const ticketIds: string[] = [];
        for (const [type, count] of order.counts) {
            const built = buildFreshTickets(count, type);
            tickets.push(...built.tickets);
            ticketIds.push(...built.ticketIds);
        }
        const now = Timestamp.now();
        const doc = {
            email: order.email,
            name: order.name,
            ticketCount: order.total,
            tickets,
            ticketIds,
            source: "api",
            apiOrderId: order.orderId,
            apiOrderFingerprint: fingerprint,
            apiKeyId: key.id,
            apiKeyName: key.name,
            apiSendEmail: order.sendEmail,
            emailSent: true,
            ...(order.sendEmail ? {emailSending: true} : {}),
            emailSentAt: null,
            createdAt: now,
            updatedAt: now,
        };
        txn.create(orderRef, doc);
        txn.set(recordRef(), recordDoc("ticket-api-order", {
            eventId,
            eventTitle: str(eventData.title) || eventId,
            targetEmail: order.email,
            targetName: order.name,
            ticketCount: order.total,
            apiKeyName: key.name,
            apiOrderId: order.orderId,
        }));
        return {
            reply: {status: 201, body: orderJson(eventId, doc)},
            ...(email ? {email: {...email, ref: orderRef, doc, eventData}} : {}),
        };
    });

    if (!placed.email) return placed.reply;
    const changes = await emailOrder(key, eventId, placed.email);
    return {status: 201, body: orderJson(eventId, {...placed.email.doc, ...changes})};
}

const ORDER_EMAIL_TIMEOUT_MS = 10_000;

async function emailOrder(key: ApiKey, eventId: string, pending: PendingEmail) {
    const {ref, doc, eventData, template, contactEmail} = pending;
    const walletPass = await walletPassesOnFor(ref.parent.parent!);
    const envelope = renderTicketEmail(template, contactEmail, {id: eventId, data: eventData},
        {name: doc.name, email: doc.email}, doc.tickets, walletPass);
    const recordFields = {
        eventId,
        eventTitle: str(eventData.title) || eventId,
        sentCount: 1,
        apiKeyName: key.name,
        apiOrderId: doc.apiOrderId,
    };
    const now = Timestamp.now();

    const settle = async (fields: Record<string, unknown>, what: string) => {
        try {
            await ref.update(fields);
            return fields;
        } catch (err) {
            console.error(`[api] order ${doc.apiOrderId}: ${what}, but failed to mark it so`, err);
            return {};
        }
    };
    const release = () => settle({emailSent: false, emailSending: false, updatedAt: now}, "unsent");

    const queue = async () => {
        try {
            if (await getScheduledMailQueueDepth() >= RESEND_QUEUE_CAP) return release();
            const queued = {emailScheduled: true, emailSending: false, updatedAt: now};
            const batch = db.batch();
            batch.set(db.collection("scheduledMail").doc(), {
                type: "ticket",
                envelope,
                eventId,
                queuedAt: FieldValue.serverTimestamp(),
                recipientCount: 1,
                targetPath: ref.path,
            });
            batch.update(ref, queued);
            batch.set(recordRef(), recordDoc("ticket-email-queue", recordFields));
            await batch.commit();
            return queued;
        } catch (err) {
            console.error(`[api] order ${doc.apiOrderId}: email neither sent nor queued`, err);
            return release();
        }
    };

    let quotaReserved: boolean;
    try {
        quotaReserved = await db.runTransaction(async (txn) => {
            const {sentToday, dailyCap, reserved} = await computeEmailQuotaInTxn(txn);
            if (sentToday >= dailyCap) return false;
            reserveQuotaInTxn(txn, 1, reserved);
            return true;
        });
    } catch (err) {
        console.error(`[api] order ${doc.apiOrderId}: email neither sent nor queued`, err);
        return release();
    }
    if (!quotaReserved) return queue();

    try {
        await sendEmails([envelope], ORDER_EMAIL_TIMEOUT_MS);
    } catch (err) {
        console.error(`[api] order ${doc.apiOrderId}: email send failed`, err);
        if (!(err instanceof ResendSendError && err.dailyConsumed !== null)) await rollbackQuotaReservation(1);
        if (err instanceof ResendSendError && err.status === null) return {};
        return err instanceof ResendSendError && err.status === 429 ? queue() : release();
    }
    return settle({emailSending: false, emailSentAt: now, updatedAt: now}, "sent");
}

async function getOrder(key: ApiKey, eventId: string, orderId: string): Promise<ApiReply> {
    requireScope(key, "tickets:read");
    requireEventAccess(key, eventId);
    const event = await findEvent(eventId);
    const snap = await event.snap.ref.collection("attendees").doc(apiOrderAttendeeId(key.appId, orderId)).get();
    if (!snap.exists || !isApiOrder(snap.data())) {
        throw new ApiError(404, "order-not-found", "Order not found.");
    }
    return {status: 200, body: orderJson(eventId, snap.data()!)};
}

async function requireLinkingApp(key: ApiKey): Promise<RegisteredApp> {
    requireScope(key, "account-links");
    const app = (await registeredApps()).get(key.appId);
    if (!app?.accountLinking) {
        throw new ApiError(403, "linking-off",
            "This app doesn't link accounts. Core staff can turn it on in the Apps tool.");
    }
    return app;
}

function readAppUserId(raw: unknown): string {
    if (typeof raw !== "string" || !APP_USER_ID_RE.test(raw)) {
        throw new ApiError(400, "invalid-request", "appUserId must be 1–64 characters of letters, digits, - and _.");
    }
    return raw;
}

const linkRequestNotFound = () =>
    new ApiError(404, "link-request-not-found", "No such link request. It may have run out: ask them to start again.");

const notLinked = () => new ApiError(404, "not-linked", "This app account isn't linked to an account here.");

const usersCol = () => db.collection("users");

function accountPreviewJson(user: Snapshot) {
    return {
        displayName: str(user.get("displayName")),
        photoURL: str(user.get("photoURL")),
        email: maskEmail(str(user.get("email"))),
    };
}

function linkRequestJson(requestId: string, req: AppLinkRequestDoc, user: Snapshot | null) {
    const status = linkRequestStatus(req);
    const open = status === "waiting" || status === "claimed";
    return {
        requestId,
        status,
        expiresAt: isoOrNull(req.expiresAt),
        account: open && user?.exists ? accountPreviewJson(user) : null,
        appUserId: req.appUserId ?? null,
        uid: status === "linked" ? req.uid : null,
    };
}

async function findLinkRequest(appId: string, idOrCode: string): Promise<FirebaseFirestore.DocumentSnapshot> {
    if (LINK_REQUEST_ID_RE.test(idOrCode)) {
        const snap = await appLinkRequestsCol().doc(idOrCode).get();
        if (!snap.exists || snap.get("appId") !== appId) throw linkRequestNotFound();
        return snap;
    }
    if (!LINK_CODE_RE.test(idOrCode)) throw linkRequestNotFound();
    const found = await appLinkRequestsCol().where("appId", "==", appId).where("code", "==", idOrCode).get();
    const waiting = found.docs.find(doc => linkRequestStatus(doc.data() as AppLinkRequestDoc) === "waiting");
    if (!waiting) throw linkRequestNotFound();
    return waiting;
}

async function getLinkRequest(key: ApiKey, idOrCode: string): Promise<ApiReply> {
    const app = await requireLinkingApp(key);
    const snap = await findLinkRequest(app.id, idOrCode);
    const req = snap.data() as AppLinkRequestDoc;
    const user = await usersCol().doc(req.uid).get();
    return {status: 200, body: linkRequestJson(snap.id, req, user)};
}

async function claimLinkRequest(key: ApiKey, requestId: string, body: unknown): Promise<ApiReply> {
    const app = await requireLinkingApp(key);
    if (!LINK_REQUEST_ID_RE.test(requestId)) throw linkRequestNotFound();
    const input = (body && typeof body === "object" ? body : {}) as {appUserId?: unknown; appUserName?: unknown};
    const appUserId = readAppUserId(input.appUserId);
    const appUserName = sanitizeDisplayText(validateStr(input.appUserName, "appUserName", 50));
    const ref = appLinkRequestsCol().doc(requestId);
    const confirmCode = newLinkConfirmCode();
    const confirmCodeHash = linkConfirmCodeHash(requestId, confirmCode);

    const outcome = await db.runTransaction(async (txn): Promise<ApiReply | {refused: HttpsError}> => {
        const snap = await txn.get(ref);
        const req = snap.data() as AppLinkRequestDoc | undefined;
        if (!req || req.appId !== app.id) throw linkRequestNotFound();
        const status = linkRequestStatus(req);
        if (status === "claimed" && req.appUserId === appUserId) {
            const user = await txn.get(usersCol().doc(req.uid));
            txn.update(ref, {confirmCodeHash});
            return {status: 200, body: {...linkRequestJson(requestId, req, user), confirmCode}};
        }
        if (status !== "waiting") {
            throw new HttpsError("already-exists", status === "claimed"
                ? "Someone else has claimed this request."
                : `This request is ${status}: ask them to start again.`, {code: "link-request-closed", status});
        }

        let user: Snapshot;
        try {
            user = await assertCanLink(txn, app.id, req.uid, appUserId);
        } catch (err) {
            if (!(err instanceof HttpsError)) throw err;
            txn.update(ref, {refusal: linkRefusal(err)});
            return {refused: err};
        }
        const claimed: AppLinkRequestDoc = {
            ...req,
            status: "claimed",
            appUserId,
            appUserName,
            confirmCodeHash,
            confirmAttempts: 0,
            expiresAt: Timestamp.fromMillis(Date.now() + LINK_REQUEST_TTL_MS),
        };
        txn.update(ref, {
            status: claimed.status,
            appUserId,
            appUserName,
            confirmCodeHash,
            confirmAttempts: 0,
            expiresAt: claimed.expiresAt,
            refusal: FieldValue.delete(),
        });
        return {status: 200, body: {...linkRequestJson(requestId, claimed, user), confirmCode}};
    });
    if ("refused" in outcome) throw outcome.refused;
    return outcome;
}

function linkJson(link: AppLinkDoc, user: Snapshot) {
    const data = user.data()!;
    const ban = activeBan(data);
    const staffEvents: unknown = data.eventStaffEvents;
    return {
        appUserId: link.appUserId,
        uid: link.uid,
        linkedAt: isoOrNull(link.linkedAt),
        account: {
            ...personJson(user),
            email: maskEmail(str(data.email)),
            membership: {
                active: isMembershipActive(data),
                expiresAt: isoOrNull(data.membershipExpiresAt),
            },
            eventStaffEvents: Array.isArray(staffEvents) ? staffEvents.filter(id => typeof id === "string") : [],
            ban: ban ? {until: ban.until?.toISOString() ?? null} : null,
            deleteAt: deletionPending(data) ? isoOrNull(data.deleteAt) : null,
        },
    };
}

async function readLink(appId: string, appUserId: string): Promise<{link: AppLinkDoc; user: Snapshot}> {
    const link = (await appLinkRef(appId, appUserId).get()).data() as AppLinkDoc | undefined;
    if (!link) throw notLinked();
    const user = await usersCol().doc(link.uid).get();
    if (!user.exists) throw notLinked();
    return {link, user};
}

async function getLink(key: ApiKey, appUserId: string): Promise<ApiReply> {
    const app = await requireLinkingApp(key);
    const {link, user} = await readLink(app.id, readAppUserId(appUserId));
    return {status: 200, body: linkJson(link, user)};
}

const LINKS_PAGE_MAX = 500;

async function listLinks(key: ApiKey, query: Record<string, unknown>): Promise<ApiReply> {
    const app = await requireLinkingApp(key);
    const after = query.after === undefined ? null : readAppUserId(query.after);
    const limit = query.limit === undefined ? LINKS_PAGE_MAX : Number(query.limit);
    if (!Number.isInteger(limit) || limit < 1 || limit > LINKS_PAGE_MAX) {
        throw new ApiError(400, "invalid-request", `limit must be an integer from 1 to ${LINKS_PAGE_MAX}.`);
    }
    let page = appLinksCol().where("appId", "==", app.id).orderBy(FieldPath.documentId()).limit(limit + 1);
    if (after !== null) page = page.startAfter(appLinkRef(app.id, after).id);
    const docs = (await page.get()).docs;
    const links = docs.slice(0, limit).map(doc => {
        const link = doc.data() as AppLinkDoc;
        return {appUserId: link.appUserId, uid: link.uid, linkedAt: isoOrNull(link.linkedAt)};
    });
    return {status: 200, body: {links, next: docs.length > limit ? links[links.length - 1].appUserId : null}};
}

async function deleteLink(key: ApiKey, appUserId: string, query: Record<string, unknown>): Promise<ApiReply> {
    const app = await requireLinkingApp(key);
    const language = readMailLanguage(query.language);
    const ref = appLinkRef(app.id, readAppUserId(appUserId));
    const unlinked = await db.runTransaction(async (txn) => {
        const link = (await txn.get(ref)).data() as AppLinkDoc | undefined;
        if (!link) return null;
        const user = await txn.get(usersCol().doc(link.uid));
        unlinkInTxn(txn, link);
        const displayName = str(user.get("displayName"));
        txn.set(recordRef(), recordDoc("account-app-unlink", {
            performedByName: displayName,
            targetUid: link.uid,
            targetName: displayName,
            appId: app.id,
            appName: appRecordName(app, app.id),
            appUserName: appLinkUserName(link.appUserName),
            apiKeyName: key.name,
        }));
        return {email: str(user.get("email")), appUserName: appLinkUserName(link.appUserName)};
    });
    if (unlinked?.email) {
        await sendNotice(await appLinkChangedMail(
            unlinked.email, appNameIn(app, language), unlinked.appUserName, "unlinked", language));
    }
    return {status: 200, body: {unlinked: !!unlinked}};
}

const PHOTO_MAX_BYTES = 5 * 1024 * 1024;
const PHOTO_FETCH_TIMEOUT_MS = 5_000;

async function fetchGooglePhoto(photoURL: string): Promise<Buffer | null> {
    let url: URL;
    try {
        url = new URL(photoURL);
    } catch {
        return null;
    }
    if (url.protocol !== "https:" || !url.hostname.endsWith(".googleusercontent.com")) return null;
    const res = await fetch(url, {redirect: "error", signal: AbortSignal.timeout(PHOTO_FETCH_TIMEOUT_MS)});
    if (!res.ok) return null;
    const data = Buffer.from(await res.arrayBuffer());
    return data.length <= PHOTO_MAX_BYTES ? data : null;
}

async function getLinkPhoto(key: ApiKey, appUserId: string): Promise<ApiReply> {
    const app = await requireLinkingApp(key);
    const {link, user} = await readLink(app.id, readAppUserId(appUserId));
    const photoURL = str(user.get("photoURL"));
    const noPhoto = new ApiError(404, "no-photo", "This account has no photo.");
    if (!photoURL) throw noPhoto;

    let data: Buffer | null = null;
    if (isStorageUrl(photoURL)) {
        const file = getStorage().bucket().file(`avatars/${link.uid}`);
        const [exists] = await file.exists();
        if (exists) [data] = await file.download();
    } else {
        data = await fetchGooglePhoto(photoURL).catch((err: unknown) => {
            console.error(`[api] couldn't fetch ${link.uid}'s Google photo`, err);
            return null;
        });
    }
    const contentType = data && data.length <= PHOTO_MAX_BYTES ? detectImageMime(data) : null;
    if (!data || !contentType) throw noPhoto;
    return {status: 200, body: null, file: {contentType, data}};
}

type Route =
    | {kind: "token"}
    | {kind: "me"}
    | {kind: "team"}
    | {kind: "events"}
    | {kind: "event"; eventId: string}
    | {kind: "event-staff"; eventId: string}
    | {kind: "orders"; eventId: string}
    | {kind: "order"; eventId: string; orderId: string}
    | {kind: "link-request"; idOrCode: string}
    | {kind: "link-request-claim"; requestId: string}
    | {kind: "links"}
    | {kind: "link"; appUserId: string}
    | {kind: "unlink"; appUserId: string}
    | {kind: "link-photo"; appUserId: string};

const ROUTE_METHODS: Record<Route["kind"], string> = {
    token: "POST",
    me: "GET",
    team: "GET",
    events: "GET",
    event: "GET",
    "event-staff": "GET",
    orders: "POST",
    order: "GET",
    "link-request": "GET",
    "link-request-claim": "POST",
    links: "GET",
    link: "GET",
    unlink: "DELETE",
    "link-photo": "GET",
};

const SEGMENT_RE = /^[A-Za-z0-9_-]{1,64}$/;

function matchRoute(path: string, method: string): Route | null {
    const segments = path.replace(/^\/api(?=\/)/, "").split("/").filter(Boolean);
    if (segments[0] !== "v1") return null;
    if (segments.length === 2 && segments[1] === "token") return {kind: "token"};
    if (segments.length === 2 && segments[1] === "me") return {kind: "me"};
    if (segments.length === 2 && segments[1] === "team") return {kind: "team"};
    if (segments[1] === "link-requests") {
        const [, , idOrCode, sub] = segments;
        if (idOrCode === undefined || !SEGMENT_RE.test(idOrCode) || segments.length > 4) return null;
        if (sub === undefined) return {kind: "link-request", idOrCode};
        return sub === "claim" ? {kind: "link-request-claim", requestId: idOrCode} : null;
    }
    if (segments[1] === "links") {
        const [, , appUserId, sub] = segments;
        if (appUserId === undefined) return segments.length === 2 ? {kind: "links"} : null;
        if (!SEGMENT_RE.test(appUserId) || segments.length > 4) return null;
        if (sub === undefined) return method === "DELETE" ? {kind: "unlink", appUserId} : {kind: "link", appUserId};
        return sub === "photo" ? {kind: "link-photo", appUserId} : null;
    }
    if (segments[1] !== "events") return null;
    const [, , eventId, sub, orderId] = segments;
    if (eventId === undefined) return segments.length === 2 ? {kind: "events"} : null;
    if (!EVENT_ID_RE.test(eventId)) return null;
    if (sub === undefined) return {kind: "event", eventId};
    if (sub === "staff") return segments.length === 4 ? {kind: "event-staff", eventId} : null;
    if (sub !== "orders" || segments.length > 5) return null;
    if (orderId === undefined) return {kind: "orders", eventId};
    return ORDER_ID_RE.test(orderId) ? {kind: "order", eventId, orderId} : null;
}

async function answer(
    route: Exclude<Route, {kind: "token"}>,
    caller: Caller,
    req: {body: unknown; query: Record<string, unknown>},
): Promise<ApiReply> {
    if (route.kind === "me") return getMe(caller);
    const key = requireKey(caller);
    switch (route.kind) {
        case "team":
            return listTeam(key);
        case "events":
            return listEvents(key);
        case "event":
            return getEvent(key, route.eventId);
        case "event-staff":
            return listEventStaff(key, route.eventId);
        case "orders":
            return createOrder(key, route.eventId, req.body);
        case "order":
            return getOrder(key, route.eventId, route.orderId);
        case "link-request":
            return getLinkRequest(key, route.idOrCode);
        case "link-request-claim":
            return claimLinkRequest(key, route.requestId, req.body);
        case "links":
            return listLinks(key, req.query);
        case "link":
            return getLink(key, route.appUserId);
        case "unlink":
            return deleteLink(key, route.appUserId, req.query);
        case "link-photo":
            return getLinkPhoto(key, route.appUserId);
    }
}

async function registeredOrigin(origin: string | undefined): Promise<string | null> {
    if (!origin) return null;
    try {
        for (const app of (await registeredApps()).values()) {
            if (appOrigins(app).includes(origin)) return origin;
        }
    } catch (err) {
        console.error("[api] couldn't list apps to check an origin", err);
    }
    return null;
}

const HTTPS_ERROR_STATUS: Partial<Record<FunctionsErrorCode, number>> = {
    "invalid-argument": 400,
    "unauthenticated": 401,
    "permission-denied": 403,
    "not-found": 404,
    "already-exists": 409,
    "aborted": 409,
    "failed-precondition": 422,
    "resource-exhausted": 429,
};

export const api = onRequest({
    maxInstances: 20,
    memory: "256MiB",
    secrets: [RESEND_API_KEY, PASSWORD_PEPPER],
    cors: false
}, async (req, res) => {
    res.set("Cache-Control", "no-store");
    res.set("Vary", "Origin");
    const corsOrigin = await registeredOrigin(req.get("Origin"));
    let caller: Caller | null = null;
    const send = (status: number, body: unknown) => {
        if (corsOrigin && caller?.kind !== "key") res.set("Access-Control-Allow-Origin", corsOrigin);
        res.status(status).json(body);
    };
    const fail = (status: number, code: string, message: string, extra?: Record<string, unknown>) =>
        send(status, {error: {...extra, code, message}});

    const route = matchRoute(req.path, req.method);
    if (req.method === "OPTIONS" && corsOrigin) {
        const token = route?.kind === "token";
        res.set("Access-Control-Allow-Origin", corsOrigin);
        res.set("Access-Control-Allow-Methods", token ? "POST" : "GET");
        res.set("Access-Control-Allow-Headers", token ? "Content-Type" : "Authorization");
        res.set("Access-Control-Max-Age", "3600");
        res.status(204).end();
        return;
    }

    if (!route) {
        fail(404, "not-found", "No such endpoint.");
        return;
    }
    if (req.method !== ROUTE_METHODS[route.kind]) {
        const allowed = route.kind === "link" ? "GET, DELETE" : ROUTE_METHODS[route.kind];
        res.set("Allow", allowed);
        fail(405, "method-not-allowed", `Use ${allowed} here.`);
        return;
    }

    try {
        if (route.kind === "token") {
            const reply = await exchangeSignInCode(req.body, req.get("Origin"));
            send(reply.status, reply.body);
            return;
        }
        caller = await authenticate(req.get("Authorization"));
        const reply = await answer(route, caller, req);
        if (reply.file) {
            res.status(reply.status).type(reply.file.contentType).send(reply.file.data);
            return;
        }
        send(reply.status, reply.body);
    } catch (err) {
        if (err instanceof ApiError) {
            fail(err.status, err.code, err.message);
            return;
        }
        if (err instanceof HttpsError && HTTPS_ERROR_STATUS[err.code]) {
            const {code: detailCode, retryAfterMs, ...rest} =
                (err.details ?? {}) as {code?: string; retryAfterMs?: number} & Record<string, unknown>;
            if (retryAfterMs) res.set("Retry-After", String(Math.ceil(retryAfterMs / 1000)));
            const code = detailCode ?? (err.code === "invalid-argument" ? "invalid-request" : err.code);
            fail(HTTPS_ERROR_STATUS[err.code]!, code, err.message, rest);
            return;
        }
        console.error(`[api] ${req.method} ${req.path} failed`, err);
        fail(500, "internal", "Something went wrong. Try again.");
    }
});
