import * as crypto from "crypto";
import { type FunctionsErrorCode, HttpsError, onRequest } from "firebase-functions/v2/https";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { checkApiKeyRateLimit } from "../utils/auth";
import { type ApiKeyDoc, apiKeysCol, type ApiScope, hashApiKey } from "../utils/apiKeys";
import { RESEND_QUEUE_CAP } from "../utils/config";
import { contactEmailFor, type EmailTemplateDoc, savedTemplate } from "../utils/emailTemplate";
import { db } from "../utils/firebase";
import { computeEmailQuotaInTxn, reserveQuotaInTxn, rollbackQuotaReservation } from "../utils/quota";
import { recordDoc, recordRef } from "../utils/records";
import { RESEND_API_KEY, ResendSendError, sendEmails } from "../utils/resendClient";
import { renderTicketEmail, ticketTemplateRef } from "../utils/ticketEmail";
import { apiOrderAttendeeId, buildFreshTickets, isApiOrder, type NewTicket, ticketClaimUrl } from "../utils/tickets";
import { sanitizeDisplayText, validateOptionalEmail, validateStr } from "../utils/validation";
import { getScheduledMailQueueDepth } from "./scheduledMail";

/**
 * The ticket API a seller's server calls with a key from the API Keys tool, so
 * tickets sold in another app (the Chinese app first) land on the same list,
 * and scan at the same door, as ours. Overview in docs/api.md, and a page per
 * endpoint and per object in docs/api/.
 *
 *   GET  /api/v1/events                            events:read
 *   GET  /api/v1/events/{eventId}                  events:read
 *   POST /api/v1/events/{eventId}/orders           tickets:write
 *   GET  /api/v1/events/{eventId}/orders/{orderId} tickets:read
 *
 * Events are both kinds the site has: unarchived (upcomingEvents) and archived
 * (pastEvents), told apart by `archived`, each with the fields the site reads
 * for it. Archiving keeps an event's ID and moves its attendees along, so an
 * event's URLs, and its orders', outlive the archive. Every event is listed,
 * free, unpublished and archived ones too: the seller filters.
 *
 * Server to server, so no App Check and no CORS: the key is the credential,
 * and it must never ship inside an app.
 */

/** The types a seller may sell. Comp, guest and vendor tickets are given out by staff, never bought. */
const SELLABLE_TICKET_TYPES = ["normal", "early-bird", "student", "early-bird-student", "vip"];

/** Tickets one order may hold, as one attendee may hold anywhere else. */
const ORDER_TICKETS_MAX = 50;

const EVENT_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;
/** It names the order's doc (see apiOrderAttendeeId), so nothing a path can't hold. */
const ORDER_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

/** lastUsedAt is for spotting a key nobody uses, so it's written at most this often. */
const LAST_USED_WRITE_INTERVAL_MS = 5 * 60 * 1000;

class ApiError extends Error {
    constructor(readonly status: number, readonly code: string, message: string) {
        super(message);
    }
}

interface ApiKey {
    id: string;
    name: string;
    scopes: ApiScope[];
    eventIds: string[];
}

interface ApiReply {
    status: number;
    body: unknown;
}

async function authenticate(header: string | undefined): Promise<ApiKey> {
    const match = /^Bearer\s+(\S{1,128})$/i.exec(header ?? "");
    if (!match) {
        throw new ApiError(401, "missing-api-key", "Send the key as \"Authorization: Bearer <key>\".");
    }
    const snap = await apiKeysCol().doc(hashApiKey(match[1])).get();
    const data = snap.data() as ApiKeyDoc | undefined;
    // Revoking deletes a key; one revoked before that is refused the same way.
    if (!data || data.revokedAt) throw new ApiError(401, "invalid-api-key", "API key not recognised.");
    if (data.expiresAt.toMillis() <= Date.now()) {
        throw new ApiError(401, "api-key-expired", "This API key has expired.");
    }

    await checkApiKeyRateLimit(snap.id);
    if (!data.lastUsedAt || Date.now() - data.lastUsedAt.toMillis() > LAST_USED_WRITE_INTERVAL_MS) {
        // Bookkeeping: a failed write mustn't fail the call.
        await snap.ref.update({lastUsedAt: Timestamp.now()})
            .catch(err => console.error(`[api] lastUsedAt update failed for ${data.name}`, err));
    }
    return {id: snap.id, name: data.name, scopes: data.scopes ?? [], eventIds: data.eventIds ?? []};
}

function requireScope(key: ApiKey, scope: ApiScope): void {
    if (!key.scopes.includes(scope)) {
        throw new ApiError(403, "missing-scope", `This API key lacks the ${scope} scope.`);
    }
}

function requireEventAccess(key: ApiKey, eventId: string): void {
    if (key.eventIds.length > 0 && !key.eventIds.includes(eventId)) {
        throw new ApiError(403, "event-not-allowed", "This API key isn't allowed to use this event.");
    }
}

const iso = (t: unknown): string | null => t instanceof Timestamp ? t.toDate().toISOString() : null;
const str = (v: unknown): string => typeof v === "string" ? v : "";

/** An event's doc, from whichever collection holds it. */
interface FoundEvent {
    archived: boolean;
    snap: FirebaseFirestore.DocumentSnapshot;
}

const upcomingRef = (eventId: string) => db.collection("upcomingEvents").doc(eventId);
const pastRef = (eventId: string) => db.collection("pastEvents").doc(eventId);

/**
 * Unarchived first. Archiving refuses an ID a past event already has, so the
 * two never both hold one.
 */
function pickEvent(
    upcoming: FirebaseFirestore.DocumentSnapshot,
    past: FirebaseFirestore.DocumentSnapshot,
): FoundEvent {
    if (upcoming.exists) return {archived: false, snap: upcoming};
    if (past.exists) return {archived: true, snap: past};
    throw new ApiError(404, "event-not-found", "Event not found.");
}

async function findEvent(eventId: string): Promise<FoundEvent> {
    const [upcoming, past] = await Promise.all([upcomingRef(eventId).get(), pastRef(eventId).get()]);
    return pickEvent(upcoming, past);
}

/**
 * Why an order can't be placed for it now, if it can't: what `onSale` sums up.
 * Archived tickets are read-only, as everywhere else. Unpublished events sell
 * too, so a test event can take orders without showing on the site: the
 * seller filters on `published`, as it does for the listing.
 */
function whyNotOnSale(event: FoundEvent): ApiError | null {
    const data = event.snap.data()!;
    if (event.archived) return new ApiError(422, "event-archived", "This event has been archived.");
    if (data.paid !== true) return new ApiError(422, "event-not-paid", "This event is free: it has no tickets.");
    if (!(data.endAt instanceof Timestamp) || data.endAt.toMillis() <= Date.now()) {
        return new ApiError(422, "event-ended", "This event has ended.");
    }
    return null;
}

/**
 * An event as the site reads it: the fields of app/lib/upcomingEvents.ts for
 * an unarchived one, of app/lib/pastEvents.ts for an archived one, with the
 * same defaults.
 */
function eventJson(event: FoundEvent) {
    const {snap, archived} = event;
    const data = snap.data()!;
    const shared = {
        id: snap.id,
        archived,
        onSale: whyNotOnSale(event) === null,
        title: str(data.title),
        titleCn: str(data.titleCn),
        description: str(data.description),
        descriptionCn: str(data.descriptionCn),
        location: str(data.location),
        locationCn: str(data.locationCn),
        venueId: str(data.venueId),
    };
    if (archived) {
        return {
            ...shared,
            date: str(data.date),
            tagIds: Array.isArray(data.tagIds) ? data.tagIds.filter((t: unknown) => typeof t === "string") : [],
            icon: str(data.icon),
            recapLink: str(data.recapLink),
            recapLinkCn: str(data.recapLinkCn),
            // Past events from before the flag are published.
            published: data.published !== false,
            paid: data.paid === true,
            deleteAt: iso(data.deleteAt),
        };
    }
    return {
        ...shared,
        startAt: iso(data.startAt),
        endAt: iso(data.endAt),
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
        deleteAt: iso(data.deleteAt),
    };
}

/** Sums up the flags below it: a ticket redeemed and then voided reads voided. */
function ticketStatus(ticket: Partial<NewTicket>): "valid" | "used" | "voided" {
    if (ticket.voided === true) return "voided";
    return ticket.redeemed === true ? "used" : "valid";
}

type EmailStatus = "not-requested" | "sent" | "queued" | "unsent";

/**
 * What became of the email an order asked us to send. Queued is past the daily
 * cap, until scheduledMailDrain ships it; unsent is not yet sent, which staff
 * can do from the admin panel.
 */
function emailStatus(data: FirebaseFirestore.DocumentData): EmailStatus {
    if (data.apiSendEmail !== true) return "not-requested";
    if (data.emailScheduled === true) return "queued";
    return data.emailSent === true ? "sent" : "unsent";
}

function orderJson(eventId: string, data: FirebaseFirestore.DocumentData) {
    const tickets = (Array.isArray(data.tickets) ? data.tickets : []) as Partial<NewTicket>[];
    return {
        orderId: str(data.apiOrderId),
        eventId,
        createdAt: iso(data.createdAt),
        updatedAt: iso(data.updatedAt),
        buyer: {name: str(data.name), email: str(data.email)},
        emailStatus: emailStatus(data),
        ticketCount: tickets.length,
        tickets: tickets.map(t => ({
            ticketId: t.ticketId ?? "",
            type: t.type ?? "normal",
            qr: ticketClaimUrl(t.ticketId ?? "", eventId),
            status: ticketStatus(t),
            createdAt: iso(t.createdAt),
            redeemed: t.redeemed === true,
            redeemedAt: iso(t.redeemedAt),
            voided: t.voided === true,
        })),
    };
}

/**
 * Every event, in the site's own order: unarchived soonest first, then
 * archived latest first. Like the site's lists, an event missing its sort
 * field isn't one.
 */
async function listEvents(key: ApiKey): Promise<ApiReply> {
    requireScope(key, "events:read");
    const [upcoming, past] = await Promise.all([
        db.collection("upcomingEvents").orderBy("startAt", "asc").get(),
        db.collection("pastEvents").orderBy("date", "desc").get(),
    ]);
    const allowed = (doc: FirebaseFirestore.QueryDocumentSnapshot) =>
        key.eventIds.length === 0 || key.eventIds.includes(doc.id);
    const events = [
        ...upcoming.docs.filter(allowed).map(snap => eventJson({archived: false, snap})),
        ...past.docs.filter(allowed).map(snap => eventJson({archived: true, snap})),
    ];
    return {status: 200, body: {events}};
}

async function getEvent(key: ApiKey, eventId: string): Promise<ApiReply> {
    requireScope(key, "events:read");
    requireEventAccess(key, eventId);
    return {status: 200, body: eventJson(await findEvent(eventId))};
}

interface OrderInput {
    orderId: string;
    name: string;
    email: string;
    /** Count per type, in SELLABLE_TICKET_TYPES order, each type once. */
    counts: [string, number][];
    total: number;
    /** Whether to email the buyer their tickets from here. */
    sendEmail: boolean;
}

/** Any malformed field is a 400; validateStr and validateEmail say which one. */
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
    // The door sees it, so it's required where a staff-added attendee's isn't.
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

/**
 * What a retry has to match to count as the same order. Over the normalised
 * order, so lines split or reordered differently still match. Not sendEmail:
 * the first request's choice stands, and a retry never sends again.
 */
function orderFingerprint(order: OrderInput): string {
    return crypto.createHash("sha256")
        .update(JSON.stringify({name: order.name, email: order.email, counts: order.counts}))
        .digest("hex");
}

/** A new order whose tickets are to be emailed, and what the email needs. */
interface PendingEmail {
    ref: FirebaseFirestore.DocumentReference;
    doc: FirebaseFirestore.DocumentData;
    eventData: FirebaseFirestore.DocumentData;
    template: EmailTemplateDoc;
    contactEmail: string;
}

/**
 * Issues an order's tickets, once. The doc is named for the order, so a retry
 * after a timeout gets the tickets it already has (200), and the same order
 * number with different contents is refused (409) rather than overwritten.
 *
 * Marked sent, as HomeTown's are, when the seller's app delivers the tickets.
 * With sendEmail they're emailed from here once the order is in, and the
 * event's template is checked first, so such an order never goes through
 * without one. With an email, they're in that account's My Tickets too.
 */
async function createOrder(key: ApiKey, eventId: string, body: unknown): Promise<ApiReply> {
    requireScope(key, "tickets:write");
    requireEventAccess(key, eventId);
    const order = parseOrder(body);
    const fingerprint = orderFingerprint(order);

    const placed = await db.runTransaction(async (txn): Promise<{reply: ApiReply; email?: PendingEmail}> => {
        const [upcomingSnap, pastSnap] = await Promise.all([
            txn.get(upcomingRef(eventId)),
            txn.get(pastRef(eventId)),
        ]);
        const event = pickEvent(upcomingSnap, pastSnap);
        const orderRef = event.snap.ref.collection("attendees").doc(apiOrderAttendeeId(order.orderId));
        const orderSnap = await txn.get(orderRef);

        // Before the on-sale checks, so a retry still gets its tickets once the
        // event has ended, or been archived along with them.
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
        // Each refuses with a 422 of its own: no-template, no-contact-email.
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
            // Unsent until emailOrder sends or queues it, so Send Unsent picks
            // it up if that never happens.
            emailSent: !order.sendEmail,
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

/**
 * How long an order waits on Resend before leaving its email unsent, well
 * inside the relay's 30 seconds, so the seller gets the reply rather than a
 * 504 and the order isn't cut off mid-send.
 */
const ORDER_EMAIL_TIMEOUT_MS = 10_000;

/**
 * Emails a new order's tickets as sendTicketEmails would one attendee's: now
 * while the daily cap has room, else onto /scheduledMail for
 * scheduledMailDrain, else not at all. The order stands either way, since the
 * buyer has paid; one left unsent is Send Unsent's to pick up. Returns the
 * fields it changed on the order.
 *
 * Without the provider re-sync sendTicketEmails starts with, which would add a
 * round trip to every order: the drain re-syncs every half hour, and a send
 * Resend turns away for being over its cap is queued for it.
 */
async function emailOrder(key: ApiKey, eventId: string, pending: PendingEmail) {
    const {ref, doc, eventData, template, contactEmail} = pending;
    const envelope = renderTicketEmail(template, contactEmail, {id: eventId, data: eventData},
        {name: doc.name, email: doc.email}, doc.tickets);
    const recordFields = {
        eventId,
        eventTitle: str(eventData.title) || eventId,
        sentCount: 1,
        apiKeyName: key.name,
        apiOrderId: doc.apiOrderId,
    };
    const now = Timestamp.now();

    // Unless the queue is full too, which leaves it unsent.
    const queue = async () => {
        try {
            if (await getScheduledMailQueueDepth() >= RESEND_QUEUE_CAP) return {};
            // emailSent keeps Send Unsent off it; emailScheduled makes it read
            // queued until the drain ships it.
            const queued = {emailSent: true, emailScheduled: true, updatedAt: now};
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
            return {};
        }
    };

    let sendRecord: FirebaseFirestore.DocumentReference | null;
    try {
        sendRecord = await db.runTransaction(async (txn) => {
            const {sentToday, dailyCap, reserved} = await computeEmailQuotaInTxn(txn);
            if (sentToday >= dailyCap) return null;
            reserveQuotaInTxn(txn, 1, reserved);
            const record = recordRef();
            txn.set(record, recordDoc("ticket-email-send", recordFields));
            return record;
        });
    } catch (err) {
        console.error(`[api] order ${doc.apiOrderId}: email neither sent nor queued`, err);
        return {};
    }
    if (sendRecord === null) return queue();

    try {
        await sendEmails([envelope], ORDER_EMAIL_TIMEOUT_MS);
    } catch (err) {
        console.error(`[api] order ${doc.apiOrderId}: email send failed`, err);
        // Unless a quota header came back, which resendClient has already recorded.
        if (!(err instanceof ResendSendError && err.dailyConsumed !== null)) await rollbackQuotaReservation(1);
        await sendRecord.delete()
            .catch(e => console.error(`[api] order ${doc.apiOrderId}: failed to drop send record`, e));
        // Over Resend's cap or rate limit, so nothing went and the drain can
        // try again. Any other failure, a timeout included, may have sent it.
        return err instanceof ResendSendError && err.status === 429 ? queue() : {};
    }
    // The email has gone, so a failed mark would see Send Unsent send it again.
    const sent = {emailSent: true, emailSentAt: now, updatedAt: now};
    await ref.update(sent)
        .catch(err => console.error(`[api] order ${doc.apiOrderId}: SENT but failed to mark`, err));
    return sent;
}

/** From whichever collection holds the event, so an order is still there once it's archived. */
async function getOrder(key: ApiKey, eventId: string, orderId: string): Promise<ApiReply> {
    requireScope(key, "tickets:read");
    requireEventAccess(key, eventId);
    const event = await findEvent(eventId);
    const snap = await event.snap.ref.collection("attendees").doc(apiOrderAttendeeId(orderId)).get();
    if (!snap.exists || !isApiOrder(snap.data())) {
        throw new ApiError(404, "order-not-found", "Order not found.");
    }
    return {status: 200, body: orderJson(eventId, snap.data()!)};
}

type Route =
    | {kind: "events"}
    | {kind: "event"; eventId: string}
    | {kind: "orders"; eventId: string}
    | {kind: "order"; eventId: string; orderId: string};

const ROUTE_METHODS: Record<Route["kind"], string> = {
    events: "GET",
    event: "GET",
    orders: "POST",
    order: "GET",
};

/**
 * Served at /api/v1/* through the Hosting rewrite and at /v1/* on the
 * function's own URL (and so on a relay in front of it), so either prefix.
 */
function matchRoute(path: string): Route | null {
    const segments = path.replace(/^\/api(?=\/)/, "").split("/").filter(Boolean);
    if (segments[0] !== "v1" || segments[1] !== "events") return null;
    const [, , eventId, sub, orderId] = segments;
    if (eventId === undefined) return segments.length === 2 ? {kind: "events"} : null;
    if (!EVENT_ID_RE.test(eventId)) return null;
    if (sub === undefined) return {kind: "event", eventId};
    if (sub !== "orders" || segments.length > 5) return null;
    if (orderId === undefined) return {kind: "orders", eventId};
    return ORDER_ID_RE.test(orderId) ? {kind: "order", eventId, orderId} : null;
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

export const api = onRequest({maxInstances: 20, memory: "256MiB", secrets: [RESEND_API_KEY]}, async (req, res) => {
    res.set("Cache-Control", "no-store");
    const fail = (status: number, code: string, message: string) =>
        res.status(status).json({error: {code, message}});

    const route = matchRoute(req.path);
    if (!route) {
        fail(404, "not-found", "No such endpoint.");
        return;
    }
    if (req.method !== ROUTE_METHODS[route.kind]) {
        res.set("Allow", ROUTE_METHODS[route.kind]);
        fail(405, "method-not-allowed", `Use ${ROUTE_METHODS[route.kind]} here.`);
        return;
    }

    try {
        const key = await authenticate(req.get("Authorization"));
        const reply = route.kind === "events" ? await listEvents(key)
            : route.kind === "event" ? await getEvent(key, route.eventId)
                : route.kind === "orders" ? await createOrder(key, route.eventId, req.body)
                    : await getOrder(key, route.eventId, route.orderId);
        res.status(reply.status).json(reply.body);
    } catch (err) {
        if (err instanceof ApiError) {
            fail(err.status, err.code, err.message);
            return;
        }
        // The shared validators and the rate limit throw these.
        if (err instanceof HttpsError && HTTPS_ERROR_STATUS[err.code]) {
            const details = err.details as {code?: string; retryAfterMs?: number} | undefined;
            if (details?.retryAfterMs) res.set("Retry-After", String(Math.ceil(details.retryAfterMs / 1000)));
            const code = details?.code ?? (err.code === "invalid-argument" ? "invalid-request" : err.code);
            fail(HTTPS_ERROR_STATUS[err.code]!, code, err.message);
            return;
        }
        console.error(`[api] ${req.method} ${req.path} failed`, err);
        fail(500, "internal", "Something went wrong. Try again.");
    }
});
