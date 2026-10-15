import * as crypto from "crypto";
import sanitizeHtml from "sanitize-html";
import { HttpsError, onCall, onRequest } from "firebase-functions/v2/https";
import { FieldPath, FieldValue, Timestamp } from "firebase-admin/firestore";
import { ADMIN_GROUPS, adminTransaction, normalizeGroup, requireAdmin, requireAuth } from "../utils/auth";
import { IMPORT_MAX_ROWS, PUBLIC_ORIGIN, RESEND_QUEUE_CAP, SEND_CHUNK_SIZE } from "../utils/config";
import { db } from "../utils/firebase";
import { syncProviderUsage } from "../utils/emailProvider";
import { isOnEventDay } from "../utils/eventDays";
import { SITE_TIME_ZONE } from "../utils/siteTime";
import { commitInChunks } from "../utils/helpers";
import {
    computeEmailQuota,
    computeEmailQuotaInTxn,
    reserveQuotaInTxn,
    rollbackQuotaReservation,
} from "../utils/quota";
import { RESEND_API_KEY, type ResendEnvelope, ResendSendError, sendEmails } from "../utils/resendClient";
import { getScheduledMailQueueDepth } from "./scheduledMail";
import { EMAIL_RE, sanitizeDisplayText, validateDocId, validateEmail, validateStr } from "../utils/validation";
import { recordDoc, recordRef } from "../utils/records";
import { isScannedTicket } from "../utils/tickets";

function validateTicketCount(value: unknown): number {
    if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 50) {
        throw new HttpsError("invalid-argument", "ticketCount must be an integer between 1 and 50.");
    }
    return value;
}

const VALID_TICKET_TYPES = [
    "normal",
    "early-bird",
    "student",
    "early-bird-student",
    "vip",
    "Comp Ticket",
    "guest",
    "vendor",
];

function validateTicketType(value: unknown): string {
    if (typeof value !== "string" || !VALID_TICKET_TYPES.includes(value)) {
        return "normal";
    }
    return value;
}

interface NewTicket {
    ticketId: string;
    type: string;
    createdAt: Timestamp;
    redeemed: boolean;
    redeemedAt: Timestamp | null;
    redeemedBy: string;
    redeemedByName: string;
    checkedIn: boolean;
    checkedInAt: Timestamp | null;
    voided: boolean;
}

function buildFreshTickets(count: number, type = "normal"): {tickets: NewTicket[]; ticketIds: string[]} {
    const tickets: NewTicket[] = [];
    const ticketIds: string[] = [];
    for (let i = 0; i < count; i++) {
        const ticketId = crypto.randomUUID();
        ticketIds.push(ticketId);
        tickets.push({
            ticketId,
            type,
            createdAt: Timestamp.now(),
            redeemed: false,
            redeemedAt: null,
            redeemedBy: "",
            redeemedByName: "",
            checkedIn: false,
            checkedInAt: null,
            voided: false,
        });
    }
    return {tickets, ticketIds};
}

function formatEventDateForEmail(startAt: Timestamp | undefined): string {
    if (!startAt) return "";
    try {
        return new Intl.DateTimeFormat("en-US", {
            timeZone: SITE_TIME_ZONE,
            year: "numeric", month: "long", day: "numeric",
            hour: "numeric", minute: "2-digit",
            // "PT", so an attendee reading it elsewhere doesn't take it for their own clock.
            timeZoneName: "shortGeneric",
        }).format(startAt.toDate());
    } catch {
        return "";
    }
}

interface EmailTemplateDoc {
    subject: string;
    bodyHtml: string;
}

const EMAIL_HTML_SANITIZE_OPTIONS: sanitizeHtml.IOptions = {
    allowedTags: [
        "p", "div", "span", "strong", "em", "b", "i", "u", "br", "hr",
        "h1", "h2", "h3", "h4", "h5", "h6",
        "ul", "ol", "li",
        "a", "img",
        "table", "thead", "tbody", "tr", "td", "th",
        "code", "blockquote",
    ],
    allowedAttributes: {
        "*": ["style", "class", "align", "width", "height"],
        "a": ["href", "title", "target", "rel"],
        "img": ["src", "alt", "title", "width", "height"],
        "td": ["colspan", "rowspan", "valign"],
        "th": ["colspan", "rowspan", "valign"],
    },
    allowedSchemes: ["https", "mailto"],
    allowedSchemesByTag: {
        img: ["https", "data", "cid"],
    },
    allowedSchemesAppliedToAttributes: ["href", "src"],
    allowProtocolRelative: false,
    disallowedTagsMode: "discard",
};

function renderTicketQrBlock(tickets: any[], eventId: string): string {
    // One <div> per ticket. Images reference the serverless QR generation endpoint.
    const origin = PUBLIC_ORIGIN;
    return tickets.map((ticket, i) => {
        const id = typeof ticket === "string" ? ticket : (ticket.ticketId ?? "");
        const typeRaw = typeof ticket === "string" ? "normal" : (ticket.type ?? "normal");

        let typeLabel = "General Admission";
        let bgColor = "#ff6b9d"; // brand pink
        let textColor = "#ffffff";

        if (typeRaw === "early-bird-student" || typeRaw === "earlybirdstudent") {
            typeLabel = "Early Bird Student";
            bgColor = "#8e44ad"; // deep purple
        } else if (typeRaw === "early-bird" || typeRaw === "earlybird") {
            typeLabel = "Early Bird";
            bgColor = "#1abc9c"; // teal
        } else if (typeRaw === "student" || typeRaw === "学生") {
            typeLabel = "Student";
            bgColor = "#9b59b6"; // purple
        } else if (typeRaw === "vip") {
            typeLabel = "VIP";
            bgColor = "#f39c12"; // gold
        } else if (typeRaw === "guest" || typeRaw === "嘉宾") {
            typeLabel = "Guest";
            bgColor = "#3498db"; // blue
        } else if (typeRaw === "Comp Ticket" || typeRaw === "comp" || typeRaw === "赠票") {
            typeLabel = "Comp Ticket";
            bgColor = "#95a5a6"; // gray
        } else if (typeRaw === "vendor" || typeRaw === "商摊") {
            typeLabel = "Vendor";
            bgColor = "#d35400"; // burnt orange
        }

        const qrUrl = `${origin}/api/ticket-qr?ticket=${encodeURIComponent(id)}&event=${encodeURIComponent(eventId)}`;
        // A wide gap so framing one code doesn't also catch its neighbour.
        return `<div style="margin:${i === 0 ? 16 : 72}px 0 16px;text-align:center;">` +
            `<div style="display:inline-block;background-color:${bgColor};color:${textColor};font-weight:bold;font-size:13px;padding:4px 12px;border-radius:16px;margin-bottom:12px;text-transform:uppercase;letter-spacing:1px;">${typeLabel}</div><br/>` +
            `<img src="${qrUrl}" alt="Ticket ${id}" width="300" height="300" style="width:300px;max-width:100%;height:auto;display:inline-block;"/>` +
            `<div style="font-family:monospace;font-size:12px;color:#555;word-break:break-all;">${id}</div>` +
            `</div>`;
    }).join("\n");
}

// Ticket ids are UUIDs and event ids are doc ids, so both fit. The endpoint is
// public, so off-shape params are refused before any QR is generated for them.
const QR_PARAM_RE = /^[A-Za-z0-9_-]{1,128}$/;

export const serveTicketQr = onRequest({maxInstances: 10, memory: "256MiB"}, async (req, res) => {
    const ticketId = req.query.ticket as string;
    const eventId = req.query.event as string;
    if (!ticketId || !eventId) {
        res.status(400).send("Missing ticket or event parameter");
        return;
    }
    if (typeof ticketId !== "string" || typeof eventId !== "string"
        || !QR_PARAM_RE.test(ticketId) || !QR_PARAM_RE.test(eventId)) {
        res.status(400).send("Invalid ticket or event parameter");
        return;
    }

    const origin = PUBLIC_ORIGIN;
    if (!origin) {
        res.status(500).send("PUBLIC_ORIGIN is not configured");
        return;
    }

    try {
        const url = `${origin}/claim?ticket=${encodeURIComponent(ticketId)}&event=${encodeURIComponent(eventId)}`;
        const QRCode = (await import("qrcode")).default;

        // Twice the 300px the email shows, for high-density screens.
        const buf = await QRCode.toBuffer(url, {errorCorrectionLevel: "M", width: 600, margin: 1});

        res.set("Content-Type", "image/png");
        // Cache aggressively since ticket UUIDs are immutable and unique
        res.set("Cache-Control", "public, max-age=31536000, s-maxage=31536000");
        res.send(buf);
    } catch (err) {
        console.error("[serveTicketQr] Error generating QR:", err);
        res.status(500).send("Failed to generate QR code");
    }
});
const escapeHtml = (s: string): string => s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

// Site Config's Contact Email. Escaped like every other value, so it also works
// in an href (mailto:{{ contactEmail }}).
const CONTACT_EMAIL_PLACEHOLDER = /{{\s*contactEmail\s*}}/g;

function renderTemplate(
    template: string,
    data: {
        attendeeEmail: string;
        attendeeName: string;
        eventTitle: string;
        eventTitleCn: string;
        eventDate: string;
        emailHeaderBg: string;
        ticketCount: number;
        ticketBlock: string;
        contactEmail: string;
    },
    // False for the subject line, where entities would show literally ("Jones
    // &amp; Co").
    htmlContext: boolean,
): string {
    const sub = htmlContext ? escapeHtml : (s: string) => s;
    // A real <img>, since email clients strip or ignore CSS backgrounds. The URL
    // was validated at save time, but against its parsed form, so the stored
    // string is escaped too.
    const headerImage = data.emailHeaderBg
        ? `<img src="${escapeHtml(data.emailHeaderBg)}" alt="${sub(data.eventTitle)}" width="600" style="display:block;width:100%;max-width:600px;height:auto;border:0;outline:none;text-decoration:none;"/>`
        : `<div style="background-color:#ff6b9d;height:120px;"></div>`;

    // Function replacements throughout: a replacement string would read $&, $'
    // and $$ in a name or title as patterns.
    return template
        .replace(/{{\s*attendeeEmail\s*}}/g, () => sub(data.attendeeEmail))
        .replace(/{{\s*attendeeName\s*}}/g, () => sub(data.attendeeName))
        .replace(/{{\s*eventTitle\s*}}/g, () => sub(data.eventTitle))
        .replace(/{{\s*eventTitleCn\s*}}/g, () => sub(data.eventTitleCn))
        .replace(/{{\s*eventDate\s*}}/g, () => sub(data.eventDate))
        .replace(/{{\s*eventHeader\s*}}/g, () => headerImage)
        .replace(/{{\s*ticketCount\s*}}/g, () => String(data.ticketCount))
        .replace(CONTACT_EMAIL_PLACEHOLDER, () => sub(data.contactEmail))
        // {{ ticketIds[] }}, with a wrapping <p>/<div> collapsed. ticketBlock is
        // server-built HTML, never escaped.
        .replace(/(<p>\s*|<div>\s*)?{{\s*ticketIds\[]\s*}}(\s*<\/p>|\s*<\/div>)?/g, () => data.ticketBlock);
}

export const importEventAttendees = onCall({maxInstances: 10}, async (request) => {
    const uid = await requireAuth(request);

    const input = request.data as {eventId?: string; attendees?: unknown; onDuplicate?: string};
    const eventId = validateDocId(input.eventId, "eventId");
    if (!Array.isArray(input.attendees) || input.attendees.length === 0) {
        throw new HttpsError("invalid-argument", "attendees must be a non-empty array.");
    }
    const importMax = IMPORT_MAX_ROWS;
    if (input.attendees.length > importMax) {
        throw new HttpsError("invalid-argument",
            `Too many attendees in a single import (max ${importMax}).`);
    }

    // Validate + normalize + dedupe (later row wins)
    const normalized = new Map<string, {
        email: string;
        name: string;
        ticketCount: number;
        type: string;
        timestamp?: Date
    }>();
    for (const row of input.attendees) {
        if (!row || typeof row !== "object") {
            throw new HttpsError("invalid-argument", "Each attendee row must be an object.");
        }
        const r = row as Record<string, unknown>;
        const email = validateEmail(r.email, "email");
        const name = sanitizeDisplayText(validateStr(r.name, "name", 100, true));
        if (!name) throw new HttpsError("invalid-argument", "name is required.");
        const ticketCount = validateTicketCount(r.ticketCount);
        const type = validateTicketType(r.type);

        let timestamp: Date | undefined;
        if (r.timestamp && typeof r.timestamp === "string") {
            const parsed = new Date(r.timestamp);
            if (!isNaN(parsed.getTime())) timestamp = parsed;
        }

        normalized.set(email, {email, name, ticketCount, type, timestamp});
    }

    // Only the admin and event checks are transactional; the import itself is
    // too big for the 500-op limit, so it runs as batched commits below.
    const eventTitle = await adminTransaction(uid, async (txn) => {
        const eventSnap = await txn.get(db.collection("upcomingEvents").doc(eventId));
        if (!eventSnap.exists) throw new HttpsError("not-found", "Event not found.");
        return (eventSnap.data()?.title ?? eventId) as string;
    });

    const attendeesCol = db.collection("upcomingEvents").doc(eventId).collection("attendees");

    // Chunked for the `in` operator's 30-value limit.
    const emails = Array.from(normalized.keys());
    const existingByEmail = new Map<string, FirebaseFirestore.QueryDocumentSnapshot>();
    for (let i = 0; i < emails.length; i += 30) {
        const chunk = emails.slice(i, i + 30);
        const snap = await attendeesCol.where("email", "in", chunk).get();
        for (const doc of snap.docs) {
            const email = doc.data().email;
            if (typeof email === "string") existingByEmail.set(email, doc);
        }
    }

    const callerSnap = await db.collection("users").doc(uid).get();
    const callerName = callerSnap.data()?.displayName ?? "";

    let addedCount = 0;
    let replacedCount = 0;
    let skippedCount = 0;
    const ops: ((b: FirebaseFirestore.WriteBatch) => void)[] = [];

    const onDuplicate = input.onDuplicate === "override" ? "override" : "skip";

    for (const row of normalized.values()) {
        const existing = existingByEmail.get(row.email);

        if (existing && onDuplicate === "skip") {
            skippedCount++;
            continue;
        }

        const {tickets, ticketIds} = buildFreshTickets(row.ticketCount, row.type);
        const now = FieldValue.serverTimestamp();
        const customDate = row.timestamp ? Timestamp.fromDate(row.timestamp) : undefined;

        // A row's own timestamp stands in for both dates. Without one, a new record
        // is stamped now and a replaced one keeps its createdAt.

        if (existing) {
            replacedCount++;
            const dataToUpdate: any = {
                email: row.email,
                name: row.name,
                ticketCount: row.ticketCount,
                tickets,
                ticketIds,
                emailSent: false,
                emailSentAt: null,
                updatedAt: customDate || now,
            };
            if (customDate) dataToUpdate.createdAt = customDate;
            ops.push(b => b.set(existing.ref, dataToUpdate, {merge: true}));
        } else {
            addedCount++;
            const newRef = attendeesCol.doc();
            ops.push(b => b.set(newRef, {
                email: row.email,
                name: row.name,
                ticketCount: row.ticketCount,
                tickets,
                ticketIds,
                emailSent: false,
                emailSentAt: null,
                createdAt: customDate || now,
                updatedAt: customDate || now,
            }));
        }
    }

    ops.push(b => b.set(recordRef(), recordDoc("ticket-import", {
        performedBy: uid,
        performedByName: callerName,
        eventId,
        eventTitle,
        addedCount,
        replacedCount,
    })));

    await commitInChunks(ops);

    return {added: addedCount, replaced: replacedCount, skipped: skippedCount, total: normalized.size};
});

/** One ticket as its holder sees it: enough to show a QR and say where it stands. */
interface HeldTicket {
    ticketId: string;
    type: string;
    redeemed: boolean;
    redeemedAt: string | null;
    voided: boolean;
}

/**
 * Every ticket the caller holds for an event that hasn't ended yet.
 *
 * Attendee docs are keyed by purchase email and closed to everyone but staff, so
 * this is the only way holders reach their tickets. The email comes from the ID
 * token, and only once it is verified, so nobody can read someone else's tickets
 * through a profile field or an unowned sign-up address.
 *
 * The cut is the event's end, not the scan: a scanned ticket stays visible while
 * the event runs, and once `endAt` passes nothing comes back. Only paid,
 * published events are searched.
 *
 * A redeemed ticket also backfills attendance, for someone who signed up after
 * being scanned and whose sign-up credit (createUserProfile) failed.
 */
export const getMyTickets = onCall({maxInstances: 20}, async (request) => {
    const uid = await requireAuth(request);
    const email = (request.auth?.token.email ?? "").trim().toLowerCase();
    if (!email || request.auth?.token.email_verified !== true) return {events: []};

    // endAt alone stays on the automatic single-field index; there are only a
    // handful of live events to filter in memory.
    const liveSnap = await db.collection("upcomingEvents")
        .where("endAt", ">", Timestamp.now()).get();
    const liveEvents = liveSnap.docs.filter(doc => {
        const data = doc.data();
        return data.paid === true && data.published === true;
    });

    const found = await Promise.all(liveEvents.map(async (eventDoc) => {
        const attendeeSnap = await eventDoc.ref.collection("attendees")
            .where("email", "==", email).get();
        if (attendeeSnap.empty) return null;

        // Import dedupes by email, so this is one doc in practice; a hand-made
        // duplicate still shows its tickets.
        const tickets: HeldTicket[] = [];
        for (const doc of attendeeSnap.docs) {
            const rawTickets: unknown[] = Array.isArray(doc.data().tickets) ? doc.data().tickets : [];
            for (const raw of rawTickets) {
                const ticket = raw as Partial<NewTicket>;
                if (typeof ticket.ticketId !== "string" || !ticket.ticketId) continue;
                tickets.push({
                    ticketId: ticket.ticketId,
                    type: ticket.type || "normal",
                    redeemed: ticket.redeemed === true,
                    redeemedAt: ticket.redeemedAt?.toDate?.()?.toISOString() ?? null,
                    voided: ticket.voided === true,
                });
            }
        }
        if (tickets.length === 0) return null;

        const eventData = eventDoc.data();
        return {
            eventId: eventDoc.id,
            title: (eventData.title as string) ?? "",
            titleCn: (eventData.titleCn as string) ?? "",
            location: (eventData.location as string) ?? "",
            locationCn: (eventData.locationCn as string) ?? "",
            venueId: (eventData.venueId as string) ?? "",
            poster: (eventData.poster as string) ?? "",
            startAt: eventData.startAt?.toDate?.()?.toISOString() ?? new Date().toISOString(),
            tickets,
        };
    }));

    const events = found.filter((e): e is NonNullable<typeof e> => e !== null);
    // ISO strings sort as dates do: the next door to walk through comes first.
    events.sort((a, b) => a.startAt.localeCompare(b.startAt));

    const scannedInto = events
        .filter(e => e.tickets.some(isScannedTicket))
        .map(e => e.eventId);
    if (scannedInto.length > 0) {
        try {
            const userRef = db.collection("users").doc(uid);
            const attended: string[] = (await userRef.get()).data()?.attendedEvents ?? [];
            const missing = scannedInto.filter(id => !attended.includes(id));
            if (missing.length > 0) {
                await userRef.update({attendedEvents: FieldValue.arrayUnion(...missing)});
            }
        } catch (err) {
            // A failed credit mustn't hide the tickets; the scanner is the
            // primary writer anyway.
            console.error(`getMyTickets: attendance backfill failed for ${uid}`, err);
        }
    }

    return {events};
});
/**
 * Emails per lookup: 17 parallel `in` queries of 30, enough to answer a
 * 500-strong list in one call.
 */
const ACCOUNT_LOOKUP_MAX = 500;

/**
 * Which of these ticket emails belong to a registered account, for staff adding
 * an attendee or reading the list.
 *
 * It uses the scanner's exact query, a match on the lowercased address (see
 * redeemTicket), so staff see what check-in will actually find.
 *
 * Staff and above get who the account is; event staff only get whether there is
 * one.
 */
export const getAttendeeAccounts = onCall({maxInstances: 10}, async (request) => {
    const uid = await requireAuth(request);

    const input = request.data as {eventId?: string; emails?: unknown};
    const eventId = validateDocId(input.eventId, "eventId");
    if (!Array.isArray(input.emails) || input.emails.length === 0) {
        throw new HttpsError("invalid-argument", "emails must be a non-empty array.");
    }
    if (input.emails.length > ACCOUNT_LOOKUP_MAX) {
        throw new HttpsError("invalid-argument",
            `Too many emails in a single lookup (max ${ACCOUNT_LOOKUP_MAX}).`);
    }

    // The same gate as reading the attendees: staff anywhere, event staff on
    // their own event.
    const callerSnap = await db.collection("users").doc(uid).get();
    const callerData = callerSnap.data() ?? {};
    const isStaffOrAbove = ["staff", ...ADMIN_GROUPS].includes(normalizeGroup(callerData.group));
    const callerEventStaff: string[] = callerData.eventStaffEvents ?? [];
    if (!isStaffOrAbove && !callerEventStaff.includes(eventId)) {
        throw new HttpsError("permission-denied", "Not authorized to read this event's attendees.");
    }

    // A malformed address is dropped rather than failing the whole lookup; it
    // matches no account anyway.
    const emails = Array.from(new Set(
        input.emails
            .map(raw => (typeof raw === "string" ? raw.trim().toLowerCase() : ""))
            .filter(email => email.length > 0 && email.length <= 320 && EMAIL_RE.test(email))
    ));
    if (emails.length === 0) return {accounts: []};

    const chunks: string[][] = [];
    for (let i = 0; i < emails.length; i += 30) {
        chunks.push(emails.slice(i, i + 30));
    }

    const snaps = await Promise.all(chunks.map(chunk =>
        db.collection("users").where("email", "in", chunk).get()
    ));

    const accounts: {email: string; uid?: string; displayName?: string}[] = [];
    for (const snap of snaps) {
        for (const doc of snap.docs) {
            const data = doc.data();
            if (typeof data.email !== "string") continue;
            const email = data.email.trim().toLowerCase();
            accounts.push(isStaffOrAbove
                ? {email, uid: doc.id, displayName: data.displayName ?? ""}
                : {email});
        }
    }

    return {accounts};
});
export const redeemTicket = onCall({maxInstances: 20}, async (request) => {
    const uid = await requireAuth(request);

    const input = request.data as {eventId?: string; ticketId?: string};
    const eventId = validateDocId(input.eventId, "eventId");
    const ticketId = validateStr(input.ticketId, "ticketId", 128, true);

    const attendeesCol = db.collection("upcomingEvents").doc(eventId).collection("attendees");

    return db.runTransaction(async (txn) => {
        const callerSnap = await txn.get(db.collection("users").doc(uid));
        const callerData = callerSnap.data() ?? {};
        const group = normalizeGroup(callerData.group);
        const callerEventStaff: string[] = callerData.eventStaffEvents ?? [];
        const isCoreStaffOrAbove = ADMIN_GROUPS.includes(group);
        const isStaffGroup = group === "staff";
        const isEventStaff = callerEventStaff.includes(eventId);
        if (!isCoreStaffOrAbove && !isStaffGroup && !isEventStaff) {
            throw new HttpsError("permission-denied", "Not authorized to scan tickets for this event.",
                {code: "not-authorized"});
        }

        // Require event exists so stale eventIds can't haunt redemption.
        const eventSnap = await txn.get(db.collection("upcomingEvents").doc(eventId));
        if (!eventSnap.exists) {
            throw new HttpsError("not-found", "Event not found.", {code: "event-missing"});
        }

        const now = Timestamp.now();
        // Core staff scan whenever. The staff group and the event's staff scan all
        // day on the event's days, so the door can open early, and are told so
        // before anything about the ticket.
        if (!isCoreStaffOrAbove
            && !isOnEventDay(eventSnap.data()?.startAt, eventSnap.data()?.endAt, now.toMillis())) {
            throw new HttpsError("failed-precondition", "Tickets can only be scanned on the day of the event.",
                {code: "not-event-day"});
        }

        const attendeeQuery = await txn.get(
            attendeesCol.where("ticketIds", "array-contains", ticketId).limit(1)
        );
        if (attendeeQuery.empty) {
            throw new HttpsError("not-found", "Ticket not found.", {code: "invalid"});
        }
        const attendeeDoc = attendeeQuery.docs[0];
        const attendeeData = attendeeDoc.data();
        const tickets: NewTicket[] = (attendeeData.tickets ?? []).map(
            (t: Record<string, unknown>) => t as unknown as NewTicket
        );
        const idx = tickets.findIndex(t => t.ticketId === ticketId);
        if (idx < 0) {
            throw new HttpsError("not-found", "Ticket not found.", {code: "invalid"});
        }
        const ticket = tickets[idx];

        if (ticket.voided) {
            throw new HttpsError("failed-precondition", "This ticket has been voided.",
                {code: "voided"});
        }

        const callerName: string = callerData.displayName ?? "";
        const attendeeEmail: string = attendeeData.email ?? "";
        const attendeeName: string = attendeeData.name ?? "";
        const eventTitle: string = eventSnap.data()?.title ?? "";

        // How long after admitting a ticket the same scanner reading it again is
        // told it succeeded, so a ticket still held to the camera doesn't flip to
        // "already redeemed". Timed from the admission.
        const REDEEM_GRACE_PERIOD_MS = 15_000;

        if (ticket.redeemed) {
            const sinceRedeemedMs = now.toMillis() - (ticket.redeemedAt?.toMillis?.() ?? 0);
            const isWithinGracePeriod = sinceRedeemedMs < REDEEM_GRACE_PERIOD_MS;
            const isSameScanner = ticket.redeemedBy === uid;

            if (!isWithinGracePeriod || !isSameScanner) {
                return {
                    alreadyRedeemed: true,
                    attendeeName,
                    attendeeEmail,
                    eventTitle,
                    ticketIndex: idx,
                    ticketType: ticket.type || "normal",
                    redeemedBy: ticket.redeemedByName,
                    redeemedAt: ticket.redeemedAt?.toDate?.()?.toISOString() ?? null,
                };
            }

            // The same scanner again moments later: report the earlier admission and
            // write nothing, since rewriting redeemedAt would restart the window on
            // every rescan.
            return {
                success: true,
                attendeeName,
                attendeeEmail,
                eventTitle,
                ticketIndex: idx,
                ticketType: ticket.type || "normal",
                userCheckedIn: ticket.checkedIn === true,
                graceRemainingMs: Math.min(REDEEM_GRACE_PERIOD_MS, REDEEM_GRACE_PERIOD_MS - sinceRedeemedMs),
            };
        }

        // Try to link to a registered user by email.
        const matchingUserSnap = await txn.get(
            db.collection("users").where("email", "==", attendeeEmail).limit(1)
        );
        let userCheckedIn = false;
        if (!matchingUserSnap.empty) {
            const userDoc = matchingUserSnap.docs[0];
            const attended: string[] = userDoc.data().attendedEvents ?? [];
            if (!attended.includes(eventId)) {
                txn.update(userDoc.ref, {attendedEvents: FieldValue.arrayUnion(eventId)});
            }
            userCheckedIn = true;
        }

        tickets[idx] = {
            ...ticket,
            redeemed: true,
            redeemedAt: now,
            redeemedBy: uid,
            redeemedByName: callerName,
            checkedIn: userCheckedIn,
            checkedInAt: userCheckedIn ? now : null,
        };

        txn.update(attendeeDoc.ref, {
            tickets,
            updatedAt: FieldValue.serverTimestamp(),
        });

        return {
            success: true,
            attendeeName,
            attendeeEmail,
            eventTitle,
            ticketIndex: idx,
            ticketType: ticket.type || "normal",
            userCheckedIn,
            graceRemainingMs: REDEEM_GRACE_PERIOD_MS,
        };
    });
});
export const voidTicket = onCall({maxInstances: 10}, async (request) => {
    const uid = await requireAuth(request);

    const input = request.data as {eventId?: string; attendeeId?: string; ticketId?: string};
    const eventId = validateDocId(input.eventId, "eventId");
    const attendeeId = validateDocId(input.attendeeId, "attendeeId");
    const ticketId = validateStr(input.ticketId, "ticketId", 128, true);

    return adminTransaction(uid, async (txn, callerSnap) => {
        const eventRef = db.collection("upcomingEvents").doc(eventId);
        const attendeeRef = eventRef.collection("attendees").doc(attendeeId);
        const [eventSnap, attendeeSnap] = await Promise.all([
            txn.get(eventRef),
            txn.get(attendeeRef),
        ]);
        // An archived event's tickets are read-only; see archiveUpcomingEvent.
        if (!eventSnap.exists) throw new HttpsError("not-found", "Event not found.");
        if (!attendeeSnap.exists) {
            throw new HttpsError("not-found", "Attendee not found.");
        }
        const data = attendeeSnap.data()!;
        const tickets: NewTicket[] = (data.tickets ?? []).map(
            (t: Record<string, unknown>) => t as unknown as NewTicket
        );
        const idx = tickets.findIndex(t => t.ticketId === ticketId);
        if (idx < 0) throw new HttpsError("not-found", "Ticket not found.");

        tickets[idx] = {...tickets[idx], voided: true};

        const eventTitle: string = eventSnap.data()?.title ?? eventId;

        txn.update(attendeeRef, {tickets, updatedAt: FieldValue.serverTimestamp()});
        txn.set(recordRef(), recordDoc("ticket-void", {
            performedBy: uid,
            performedByName: callerSnap.data()?.displayName ?? "",
            eventId,
            eventTitle,
            targetEmail: data.email ?? "",
            targetName: data.name ?? "",
        }));

        return {voided: true};
    });
});
export const unvoidTicket = onCall({maxInstances: 10}, async (request) => {
    const uid = await requireAuth(request);

    const input = request.data as {eventId?: string; attendeeId?: string; ticketId?: string};
    const eventId = validateDocId(input.eventId, "eventId");
    const attendeeId = validateDocId(input.attendeeId, "attendeeId");
    const ticketId = validateStr(input.ticketId, "ticketId", 128, true);

    return adminTransaction(uid, async (txn, callerSnap) => {
        const eventRef = db.collection("upcomingEvents").doc(eventId);
        const attendeeRef = eventRef.collection("attendees").doc(attendeeId);
        const [eventSnap, attendeeSnap] = await Promise.all([
            txn.get(eventRef),
            txn.get(attendeeRef),
        ]);
        // An archived event's tickets are read-only; see archiveUpcomingEvent.
        if (!eventSnap.exists) throw new HttpsError("not-found", "Event not found.");
        if (!attendeeSnap.exists) {
            throw new HttpsError("not-found", "Attendee not found.");
        }
        const data = attendeeSnap.data()!;
        const tickets: NewTicket[] = (data.tickets ?? []).map(
            (t: Record<string, unknown>) => t as unknown as NewTicket
        );
        const idx = tickets.findIndex(t => t.ticketId === ticketId);
        if (idx < 0) throw new HttpsError("not-found", "Ticket not found.");

        tickets[idx] = {...tickets[idx], voided: false};

        const eventTitle: string = eventSnap.data()?.title ?? eventId;

        txn.update(attendeeRef, {tickets, updatedAt: FieldValue.serverTimestamp()});
        txn.set(recordRef(), recordDoc("ticket-unvoid", {
            performedBy: uid,
            performedByName: callerSnap.data()?.displayName ?? "",
            eventId,
            eventTitle,
            targetEmail: data.email ?? "",
            targetName: data.name ?? "",
        }));

        return {unvoided: true};
    });
});
export const adminRedeemTicket = onCall({maxInstances: 10}, async (request) => {
    const uid = await requireAuth(request);

    const input = request.data as {eventId?: string; attendeeId?: string; ticketId?: string};
    const eventId = validateDocId(input.eventId, "eventId");
    const attendeeId = validateDocId(input.attendeeId, "attendeeId");
    const ticketId = validateStr(input.ticketId, "ticketId", 128, true);

    return adminTransaction(uid, async (txn, callerSnap) => {
        const eventRef = db.collection("upcomingEvents").doc(eventId);
        const attendeeRef = eventRef.collection("attendees").doc(attendeeId);
        const [eventSnap, attendeeSnap] = await Promise.all([
            txn.get(eventRef),
            txn.get(attendeeRef),
        ]);
        // An archived event's tickets are read-only; see archiveUpcomingEvent.
        if (!eventSnap.exists) throw new HttpsError("not-found", "Event not found.");
        if (!attendeeSnap.exists) {
            throw new HttpsError("not-found", "Attendee not found.");
        }
        const data = attendeeSnap.data()!;
        const tickets: NewTicket[] = (data.tickets ?? []).map(
            (t: Record<string, unknown>) => t as unknown as NewTicket
        );
        const idx = tickets.findIndex(t => t.ticketId === ticketId);
        if (idx < 0) throw new HttpsError("not-found", "Ticket not found.");
        if (tickets[idx].voided) {
            throw new HttpsError("failed-precondition", "This ticket has been voided.", {code: "voided"});
        }
        // Idempotent, so a double-click can't overwrite the original redeemer
        // and time.
        if (tickets[idx].redeemed) {
            return {redeemed: false, alreadyRedeemed: true};
        }

        // A check-in by hand credits the account exactly as the scanner does
        // (see redeemTicket).
        const attendeeEmail: string = data.email ?? "";
        let userCheckedIn = false;
        if (attendeeEmail) {
            const matchingUserSnap = await txn.get(
                db.collection("users").where("email", "==", attendeeEmail).limit(1)
            );
            if (!matchingUserSnap.empty) {
                const userDoc = matchingUserSnap.docs[0];
                const attended: string[] = userDoc.data().attendedEvents ?? [];
                if (!attended.includes(eventId)) {
                    txn.update(userDoc.ref, {attendedEvents: FieldValue.arrayUnion(eventId)});
                }
                userCheckedIn = true;
            }
        }

        const now = Timestamp.now();
        const callerName: string = callerSnap.data()?.displayName ?? "";
        tickets[idx] = {
            ...tickets[idx],
            redeemed: true,
            redeemedAt: now,
            redeemedBy: uid,
            redeemedByName: callerName,
            checkedIn: userCheckedIn,
            checkedInAt: userCheckedIn ? now : null,
        };

        const eventTitle: string = eventSnap.data()?.title ?? eventId;

        txn.update(attendeeRef, {tickets, updatedAt: FieldValue.serverTimestamp()});
        txn.set(recordRef(), recordDoc("ticket-redeem", {
            performedBy: uid,
            performedByName: callerName,
            eventId,
            eventTitle,
            targetEmail: data.email ?? "",
            targetName: data.name ?? "",
        }));

        return {redeemed: true};
    });
});
export const resetTicket = onCall({maxInstances: 10}, async (request) => {
    const uid = await requireAuth(request);

    const input = request.data as {eventId?: string; attendeeId?: string; ticketId?: string};
    const eventId = validateDocId(input.eventId, "eventId");
    const attendeeId = validateDocId(input.attendeeId, "attendeeId");
    const ticketId = validateStr(input.ticketId, "ticketId", 128, true);

    return adminTransaction(uid, async (txn, callerSnap) => {
        const eventRef = db.collection("upcomingEvents").doc(eventId);
        const attendeeRef = eventRef.collection("attendees").doc(attendeeId);
        const [eventSnap, attendeeSnap] = await Promise.all([
            txn.get(eventRef),
            txn.get(attendeeRef),
        ]);
        // An archived event's tickets are read-only; see archiveUpcomingEvent.
        if (!eventSnap.exists) throw new HttpsError("not-found", "Event not found.");
        if (!attendeeSnap.exists) {
            throw new HttpsError("not-found", "Attendee not found.");
        }
        const data = attendeeSnap.data()!;
        const tickets: NewTicket[] = (data.tickets ?? []).map(
            (t: Record<string, unknown>) => t as unknown as NewTicket
        );
        const idx = tickets.findIndex(t => t.ticketId === ticketId);
        if (idx < 0) throw new HttpsError("not-found", "Ticket not found.");

        // Only the redemption state. attendedEvents stays: the holder may have
        // attended on another ticket.
        tickets[idx] = {
            ...tickets[idx],
            redeemed: false,
            redeemedAt: null,
            redeemedBy: "",
            redeemedByName: "",
            checkedIn: false,
            checkedInAt: null,
        };

        const eventTitle: string = eventSnap.data()?.title ?? eventId;

        txn.update(attendeeRef, {tickets, updatedAt: FieldValue.serverTimestamp()});
        txn.set(recordRef(), recordDoc("ticket-reset", {
            performedBy: uid,
            performedByName: callerSnap.data()?.displayName ?? "",
            eventId,
            eventTitle,
            targetEmail: data.email ?? "",
            targetName: data.name ?? "",
        }));

        return {reset: true};
    });
});
export const updateEventAttendee = onCall({maxInstances: 10}, async (request) => {
    const uid = await requireAuth(request);

    const input = request.data as {
        eventId?: string;
        attendeeId?: string;
        name?: unknown;
        ticketCount?: unknown;
        type?: unknown;
    };
    const eventId = validateDocId(input.eventId, "eventId");
    const attendeeId = validateDocId(input.attendeeId, "attendeeId");
    const name = sanitizeDisplayText(validateStr(input.name, "name", 100, true));
    if (!name) throw new HttpsError("invalid-argument", "name is required.");
    const ticketCount = validateTicketCount(input.ticketCount);
    const type = validateTicketType(input.type);

    return adminTransaction(uid, async (txn, callerSnap) => {
        const eventRef = db.collection("upcomingEvents").doc(eventId);
        const attendeeRef = eventRef.collection("attendees").doc(attendeeId);
        const [eventSnap, attendeeSnap] = await Promise.all([
            txn.get(eventRef),
            txn.get(attendeeRef),
        ]);
        // An archived event's tickets are read-only; see archiveUpcomingEvent.
        if (!eventSnap.exists) throw new HttpsError("not-found", "Event not found.");
        if (!attendeeSnap.exists) {
            throw new HttpsError("not-found", "Attendee not found.");
        }
        const data = attendeeSnap.data()!;
        const prevTicketCount: number = data.ticketCount ?? 0;
        const prevTickets: NewTicket[] = (data.tickets ?? []) as NewTicket[];
        const prevType = prevTickets[0]?.type ?? "normal";

        const eventTitle: string = eventSnap.data()?.title ?? eventId;

        const countChanged = ticketCount !== prevTicketCount;
        const typeChanged = type !== prevType;

        if (!countChanged && !typeChanged) {
            if (name === data.name) {
                return {updated: false, regenerated: false};
            }
            txn.update(attendeeRef, {name, updatedAt: FieldValue.serverTimestamp()});
            txn.set(recordRef(), recordDoc("ticket-attendee-edit", {
                performedBy: uid,
                performedByName: callerSnap.data()?.displayName ?? "",
                eventId,
                eventTitle,
                targetEmail: data.email ?? "",
                oldName: data.name ?? "",
                newName: name,
            }));
            return {updated: true, regenerated: false};
        }

        const {tickets, ticketIds} = buildFreshTickets(ticketCount, type);
        txn.update(attendeeRef, {
            name,
            ticketCount,
            tickets,
            ticketIds,
            emailSent: false,
            emailSentAt: null,
            updatedAt: FieldValue.serverTimestamp(),
        });
        txn.set(recordRef(), recordDoc("ticket-regenerate", {
            performedBy: uid,
            performedByName: callerSnap.data()?.displayName ?? "",
            eventId,
            eventTitle,
            targetEmail: data.email ?? "",
            targetName: name,
        }));
        return {updated: true, regenerated: true};
    });
});
export const updateTicketType = onCall({maxInstances: 10}, async (request) => {
    const uid = await requireAuth(request);

    const input = request.data as {
        eventId?: string;
        attendeeId?: string;
        ticketId?: string;
        type?: unknown;
    };
    const eventId = validateDocId(input.eventId, "eventId");
    const attendeeId = validateDocId(input.attendeeId, "attendeeId");
    const ticketId = validateStr(input.ticketId, "ticketId", 128, true);
    const type = validateTicketType(input.type);

    return adminTransaction(uid, async (txn, callerSnap) => {
        const eventRef = db.collection("upcomingEvents").doc(eventId);
        const attendeeRef = eventRef.collection("attendees").doc(attendeeId);
        const [eventSnap, attendeeSnap] = await Promise.all([
            txn.get(eventRef),
            txn.get(attendeeRef),
        ]);
        // An archived event's tickets are read-only; see archiveUpcomingEvent.
        if (!eventSnap.exists) throw new HttpsError("not-found", "Event not found.");
        if (!attendeeSnap.exists) {
            throw new HttpsError("not-found", "Attendee not found.");
        }
        const data = attendeeSnap.data()!;
        const tickets: NewTicket[] = (data.tickets ?? []).map(
            (t: Record<string, unknown>) => t as unknown as NewTicket
        );
        const idx = tickets.findIndex(t => t.ticketId === ticketId);
        if (idx < 0) throw new HttpsError("not-found", "Ticket not found.");

        const oldType = tickets[idx].type || "normal";
        if (oldType === type) return {updated: false};

        tickets[idx] = {...tickets[idx], type};

        const eventTitle: string = eventSnap.data()?.title ?? eventId;

        txn.update(attendeeRef, {tickets, updatedAt: FieldValue.serverTimestamp()});
        txn.set(recordRef(), recordDoc("ticket-type-edit", {
            performedBy: uid,
            performedByName: callerSnap.data()?.displayName ?? "",
            eventId,
            eventTitle,
            targetEmail: data.email ?? "",
            targetName: data.name ?? "",
            oldType,
            newType: type,
        }));

        return {updated: true};
    });
});
export const deleteEventAttendee = onCall({maxInstances: 10}, async (request) => {
    const uid = await requireAuth(request);

    const input = request.data as {eventId?: string; attendeeId?: string};
    const eventId = validateDocId(input.eventId, "eventId");
    const attendeeId = validateDocId(input.attendeeId, "attendeeId");

    return adminTransaction(uid, async (txn, callerSnap) => {
        const eventRef = db.collection("upcomingEvents").doc(eventId);
        const attendeeRef = eventRef.collection("attendees").doc(attendeeId);
        const [eventSnap, attendeeSnap] = await Promise.all([
            txn.get(eventRef),
            txn.get(attendeeRef),
        ]);
        // An archived event's tickets are read-only; see archiveUpcomingEvent.
        if (!eventSnap.exists) throw new HttpsError("not-found", "Event not found.");
        if (!attendeeSnap.exists) {
            throw new HttpsError("not-found", "Attendee not found.");
        }
        const data = attendeeSnap.data()!;
        const tickets: NewTicket[] = (data.tickets ?? []).map(
            (t: Record<string, unknown>) => t as unknown as NewTicket
        );
        const eventTitle: string = eventSnap.data()?.title ?? eventId;
        txn.delete(attendeeRef);
        txn.set(recordRef(), recordDoc("ticket-attendee-delete", {
            performedBy: uid,
            performedByName: callerSnap.data()?.displayName ?? "",
            eventId,
            eventTitle,
            targetEmail: data.email ?? "",
            targetName: data.name ?? "",
        }));
        return {deleted: true, ticketCount: tickets.length};
    });
});

export const sendTicketEmails = onCall(
    {maxInstances: 5, timeoutSeconds: 300, memory: "512MiB", secrets: [RESEND_API_KEY]},
    async (request) => {
        const uid = await requireAuth(request);
        await requireAdmin(uid);

        const input = request.data as {
            eventId?: string;
            mode?: string;
            attendeeIds?: unknown;
            cursor?: unknown;
        };
        const eventId = validateDocId(input.eventId, "eventId");
        const mode = input.mode === "all" ? "all" : "unsent";
        const chunkSize = SEND_CHUNK_SIZE;
        let attendeeIds: string[] | null = null;
        if (Array.isArray(input.attendeeIds)) {
            attendeeIds = input.attendeeIds.map(id => validateDocId(id, "attendeeId"));
            if (attendeeIds.length > chunkSize) {
                throw new HttpsError("invalid-argument",
                    `Too many attendee ids in a single send (max ${chunkSize}).`);
            }
        }
        const cursor = typeof input.cursor === "string" && input.cursor.length > 0
            ? validateDocId(input.cursor, "cursor")
            : null;

        const eventSnap = await db.collection("upcomingEvents").doc(eventId).get();
        if (!eventSnap.exists) throw new HttpsError("not-found", "Event not found.");
        const eventData = eventSnap.data()!;

        // Load template — hard-fail if not saved. No server-side default.
        const templateRef = db.collection("upcomingEvents").doc(eventId)
            .collection("emailTemplate").doc("default");
        const templateSnap = await templateRef.get();
        if (!templateSnap.exists) {
            throw new HttpsError("failed-precondition",
                "Email template not saved for this event.", {code: "no-template"});
        }
        const templateData = templateSnap.data() ?? {};
        const template: EmailTemplateDoc = {
            subject: (templateData.subject as string) ?? "",
            bodyHtml: (templateData.bodyHtml as string) ?? "",
        };
        if (!template.subject.trim() || !template.bodyHtml.trim()) {
            throw new HttpsError("failed-precondition",
                "Email template is empty.", {code: "no-template"});
        }

        // Refuse rather than send "contact us at " with an empty mailto. Read
        // per call, so a Site Config fix applies to the next send.
        const contactEmail = ((await db.collection("config").doc("main").get())
            .get("contactEmail") as string | undefined) ?? "";
        const usesContactEmail = [template.subject, template.bodyHtml]
            .some(t => t.search(CONTACT_EMAIL_PLACEHOLDER) !== -1);
        if (usesContactEmail && !contactEmail) {
            throw new HttpsError("failed-precondition",
                "The template uses {{ contactEmail }}, but Site Config has no Contact Email.",
                {code: "no-contact-email"});
        }

        // Target attendees — capped at chunkSize.
        const attendeesCol = db.collection("upcomingEvents").doc(eventId).collection("attendees");
        let targets: FirebaseFirestore.QueryDocumentSnapshot[];
        let queriedCount: number;
        if (attendeeIds && attendeeIds.length > 0) {
            const snaps = await Promise.all(attendeeIds.map(id => attendeesCol.doc(id).get()));
            let filtered = snaps.filter(s => s.exists) as FirebaseFirestore.QueryDocumentSnapshot[];
            if (mode === "unsent") {
                filtered = filtered.filter(s => s.data()?.emailSent !== true);
            }
            targets = filtered.slice(0, chunkSize);
            queriedCount = filtered.length;
        } else if (mode === "unsent") {
            // A drain: processed attendees leave the result set. createdAt order keeps
            // chunks FIFO on the (emailSent, createdAt) index.
            const snap = await attendeesCol
                .where("emailSent", "==", false)
                .orderBy("createdAt", "asc")
                .limit(chunkSize)
                .get();
            targets = snap.docs;
            queriedCount = snap.docs.length;
        } else {
            // Resend-all: cursor by doc id for stable chunked iteration.
            let q = attendeesCol.orderBy(FieldPath.documentId())
                .limit(chunkSize);
            if (cursor) q = q.startAfter(cursor);
            const snap = await q.get();
            targets = snap.docs;
            queriedCount = snap.docs.length;
        }

        const eventTitle: string = eventData.title ?? "";
        const eventTitleCn: string = eventData.titleCn ?? "";
        const emailHeaderBg: string = eventData.emailHeaderBg ?? "";
        const eventDateEn = formatEventDateForEmail(eventData.startAt);

        // The daily cap is enforced here, not trusted to the client; anything
        // past it goes to /scheduledMail for scheduledMailDrain. This pre-check
        // only skips a chunk when both the cap and the queue are full; the
        // authoritative read is in the transaction below. The queue cap is
        // loose on purpose.
        //
        // Re-anchoring against the provider first matters because the cache
        // otherwise only updates on sends, so it never sees the rolling window
        // reopen, and on a plan with no quota header it is never written at
        // all. A failed read leaves the cache as it was.
        await syncProviderUsage();
        const {sentToday, dailyCap} = await computeEmailQuota();
        const prelimRemainingToday = Math.max(0, dailyCap - sentToday);
        const initialQueueDepth = await getScheduledMailQueueDepth();
        const queueCapacity = Math.max(0, RESEND_QUEUE_CAP - initialQueueDepth);
        if (prelimRemainingToday === 0 && queueCapacity === 0) {
            throw new HttpsError("resource-exhausted",
                "Daily cap reached and overflow queue is full.", {code: "quota-exceeded"});
        }

        // Only the non-email writes (ticketless attendee marks); the send
        // itself is one call below.
        const ops: ((b: FirebaseFirestore.WriteBatch) => void)[] = [];

        // The send/queue split waits for the reservation transaction, so it
        // keys off a fresh sentToday rather than the pre-check's, which a
        // concurrent send may have consumed.
        const ticketlessTargets: FirebaseFirestore.QueryDocumentSnapshot[] = [];
        const candidates: {
            target: FirebaseFirestore.QueryDocumentSnapshot;
            data: FirebaseFirestore.DocumentData;
            tickets: any[];
        }[] = [];
        const prelimBudget = prelimRemainingToday + queueCapacity;
        // How many of `targets`, in order, this call handles; lowered if the
        // reservation trims candidates, so a resend-all resumes with the first one
        // left over.
        let handled = targets.length;
        for (const [i, target] of targets.entries()) {
            if (candidates.length >= prelimBudget) {
                handled = i;
                break;
            }
            const data = target.data();
            const rawTickets: any[] = data.tickets ?? [];
            const activeTickets = rawTickets.filter(t => !t.voided);

            if (activeTickets.length === 0) {
                ticketlessTargets.push(target);
                continue;
            }

            candidates.push({target, data, tickets: activeTickets});
        }

        // No tickets, or all voided: mark sent so the 'unsent' drain doesn't spin on it.
        for (const target of ticketlessTargets) {
            ops.push(b => b.update(target.ref, {
                emailSent: true,
                emailSentAt: FieldValue.serverTimestamp(),
                updatedAt: FieldValue.serverTimestamp(),
            }));
        }

        // Reserve daily-cap slots in a transaction that reads the quota cache
        // and writes the pre-charge together, so two concurrent sends can't
        // both spend the same slots: optimistic concurrency on
        // system/resendQuota retries the second. The reservation is released
        // once the send settles.
        const callerSnap = await db.collection("users").doc(uid).get();
        const performedByName = callerSnap.data()?.displayName ?? "";
        const {sendAuditRef, queueAuditRef, expectedSentCount, expectedQueuedCount} =
            await db.runTransaction(async (txn) => {
                const {sentToday: freshSent, dailyCap: freshCap, reserved: freshReserved} =
                    await computeEmailQuotaInTxn(txn);
                const remainingToday = Math.max(0, freshCap - freshSent);
                const sendCount = Math.min(candidates.length, remainingToday);
                const queueCount = Math.min(candidates.length - sendCount, queueCapacity);
                let sRef: FirebaseFirestore.DocumentReference | null = null;
                let qRef: FirebaseFirestore.DocumentReference | null = null;
                if (sendCount > 0) {
                    reserveQuotaInTxn(txn, sendCount, freshReserved);
                    sRef = recordRef();
                    txn.set(sRef, recordDoc("ticket-email-send", {
                        performedBy: uid,
                        performedByName,
                        eventId,
                        eventTitle,
                        sentCount: sendCount,
                    }));
                }
                if (queueCount > 0) {
                    qRef = recordRef();
                    txn.set(qRef, recordDoc("ticket-email-queue", {
                        performedBy: uid,
                        performedByName,
                        eventId,
                        eventTitle,
                        sentCount: queueCount,
                    }));
                }
                return {
                    sendAuditRef: sRef,
                    queueAuditRef: qRef,
                    expectedSentCount: sendCount,
                    expectedQueuedCount: queueCount,
                };
            });

        // Trim to what the transaction reserved: the first `expectedSentCount`
        // send now, the rest queue.
        const reservedCount = expectedSentCount + expectedQueuedCount;
        if (reservedCount < candidates.length) {
            handled = Math.min(handled, targets.indexOf(candidates[reservedCount].target));
        }
        const sendableTargets = candidates.slice(0, reservedCount).map((c, i) => ({
            ...c,
            queued: i >= expectedSentCount,
        }));

        // Envelopes for the send slice and payloads for the queue slice,
        // rendered in one pass.
        const sendEnvelopes: ResendEnvelope[] = [];
        const sendCommitTargets: typeof sendableTargets = [];
        const queueItems: {
            target: FirebaseFirestore.QueryDocumentSnapshot;
            envelope: ResendEnvelope;
        }[] = [];
        for (const item of sendableTargets) {
            const {target, data, tickets, queued} = item;
            const ticketBlock = renderTicketQrBlock(tickets, eventId);

            // Strip control characters so a newline in eventTitle or
            // attendeeName can't inject headers.
            const renderedSubject = renderTemplate(template.subject, {
                attendeeEmail: data.email ?? "",
                attendeeName: data.name ?? "",
                eventTitle, eventTitleCn,
                eventDate: eventDateEn,
                emailHeaderBg,
                ticketCount: tickets.length,
                ticketBlock: "",
                contactEmail,
            }, false).replace(/[\x00-\x1F\x7F]+/g, " ").trim();
            const html = renderTemplate(template.bodyHtml, {
                attendeeEmail: data.email ?? "",
                attendeeName: data.name ?? "",
                eventTitle, eventTitleCn,
                eventDate: eventDateEn,
                emailHeaderBg,
                ticketCount: tickets.length,
                ticketBlock,
                contactEmail,
            }, true);

            const envelope: ResendEnvelope = {
                to: data.email,
                subject: renderedSubject,
                html,
            };

            if (queued) {
                queueItems.push({target, envelope});
            } else {
                sendEnvelopes.push(envelope);
                sendCommitTargets.push(item);
            }
        }

        // One Resend call for the whole send slice (SEND_CHUNK_SIZE is capped
        // at the batch endpoint's 100). It is all or nothing: on failure, the
        // pre-charge is rolled back unless a quota header came back, which
        // resendClient has already recorded.
        let sentCount = 0;
        let sendError: unknown = null;
        if (sendEnvelopes.length > 0) {
            try {
                const result = await sendEmails(sendEnvelopes);
                sentCount = result.sentCount;
            } catch (err) {
                console.error("sendTicketEmails: send failed", err);
                sendError = err;
                const headerArrived = err instanceof ResendSendError
                    && err.dailyConsumed !== null;
                if (!headerArrived) {
                    await rollbackQuotaReservation(expectedSentCount);
                }
            }
        }

        // One commit per attendee, so one bad write (say, an attendee deleted
        // mid-call) doesn't strand the rest. The email has gone, so a failed
        // mark would be re-sent by the next 'unsent' drain; it is logged loudly
        // for an admin to flag. sentCount is Resend's id count, so the loop is
        // clamped to the targets held: overrunning would throw outside the
        // per-attendee catch.
        if (sentCount > sendCommitTargets.length) {
            console.error("sendTicketEmails: Resend returned more ids than envelopes sent",
                sentCount, sendCommitTargets.length);
        }
        const markCount = Math.min(sentCount, sendCommitTargets.length);
        for (let i = 0; i < markCount; i++) {
            const {target} = sendCommitTargets[i];
            try {
                await target.ref.update({
                    emailSent: true,
                    emailSentAt: FieldValue.serverTimestamp(),
                    updatedAt: FieldValue.serverTimestamp(),
                });
            } catch (err) {
                console.error("sendTicketEmails: SENT but failed to mark attendee",
                    target.id, err);
            }
        }

        // Queue the overflow. attendeePath lets the drain clear emailScheduled
        // once the mail ships, turning "Queued" into "Sent" in the admin UI.
        let queuedCount = 0;
        for (const {target, envelope} of queueItems) {
            const scheduledRef = db.collection("scheduledMail").doc();
            const batch = db.batch();
            batch.set(scheduledRef, {
                type: "ticket",
                envelope,
                eventId,
                queuedBy: uid,
                queuedAt: FieldValue.serverTimestamp(),
                recipientCount: 1,
                attendeePath: target.ref.path,
            });
            // emailSent keeps the 'unsent' drain off it; emailScheduled makes
            // the admin UI say "Queued" until the drain ships it.
            batch.update(target.ref, {
                emailSent: true,
                emailScheduled: true,
                updatedAt: FieldValue.serverTimestamp(),
            });
            try {
                await batch.commit();
                queuedCount++;
            } catch (err) {
                console.error("sendTicketEmails: failed to queue", target.id, err);
            }
        }

        if (ops.length > 0) await commitInChunks(ops);

        // If fewer shipped than were reserved, lower the audit's count, or
        // delete it when none did, so it doesn't block later sends.
        if (sendAuditRef) {
            if (sentCount === 0) await sendAuditRef.delete();
            else if (sentCount !== expectedSentCount) await sendAuditRef.update({sentCount});
        }
        if (queueAuditRef) {
            if (queuedCount === 0) await queueAuditRef.delete();
            else if (queuedCount !== expectedQueuedCount) await queueAuditRef.update({sentCount: queuedCount});
        }

        // Thrown after reconciling, so the writes that did succeed are kept.
        if (sendError && sentCount === 0 && expectedSentCount > 0) {
            throw new HttpsError("internal",
                "Email send failed; queued items (if any) will still drain.",
                {
                    code: "send-failed",
                    queuedCount,
                    cause: sendError instanceof Error ? sendError.message : String(sendError),
                });
        }

        // A full chunk came back, or this call stopped short of it. With
        // attendeeIds the client does the chunking.
        const hasMore = !attendeeIds && (queriedCount >= chunkSize || handled < targets.length);
        const resumeAfter = handled > 0 ? targets[handled - 1].id : cursor;
        const nextCursor = mode === "all" && hasMore && resumeAfter ? resumeAfter : undefined;

        return {sentCount, queuedCount, hasMore, ...(nextCursor ? {nextCursor} : {})};
    });
export const getTicketEmailQuota = onCall({
    maxInstances: 5,
    // For syncProviderUsage; without it the read has no key and falls back to
    // the cached counter.
    secrets: [RESEND_API_KEY],
}, async (request) => {
    const uid = await requireAuth(request);
    await requireAdmin(uid);

    // The send path's re-anchor, so the headroom shown matches what
    // sendTicketEmails gates on.
    await syncProviderUsage();
    const [{sentToday, dailyCap}, queuedCount] = await Promise.all([
        computeEmailQuota(),
        getScheduledMailQueueDepth(),
    ]);
    return {
        sentToday,
        dailyCap,
        chunkSize: SEND_CHUNK_SIZE,
        queuedCount,
        queueCap: RESEND_QUEUE_CAP,
    };
});
export const updateEventEmailTemplate = onCall({maxInstances: 10}, async (request) => {
    const uid = await requireAuth(request);

    const input = request.data as {
        eventId?: string;
        subject?: unknown;
        bodyHtml?: unknown;
    };
    const eventId = validateDocId(input.eventId, "eventId");
    const subject = validateStr(input.subject, "subject", 500, true);
    const rawBodyHtml = validateStr(input.bodyHtml, "bodyHtml", 20000);

    const bodyHtml = sanitizeHtml(rawBodyHtml, EMAIL_HTML_SANITIZE_OPTIONS);

    return adminTransaction(uid, async (txn, callerSnap) => {
        const eventSnap = await txn.get(db.collection("upcomingEvents").doc(eventId));
        if (!eventSnap.exists) throw new HttpsError("not-found", "Event not found.");
        const templateRef = db.collection("upcomingEvents").doc(eventId)
            .collection("emailTemplate").doc("default");
        txn.set(templateRef, {
            subject, bodyHtml,
            updatedAt: FieldValue.serverTimestamp(),
            updatedBy: uid,
        }, {merge: true});
        txn.set(recordRef(), recordDoc("upcoming-event-email-template-update", {
            performedBy: uid,
            performedByName: callerSnap.data()?.displayName ?? "",
            eventId,
            eventTitle: eventSnap.data()?.title ?? eventId,
        }));
        return {saved: true};
    });
});
