import * as crypto from "crypto";
import sanitizeHtml from "sanitize-html";
import { HttpsError, onCall, onRequest } from "firebase-functions/v2/https";
import { FieldPath, FieldValue, Timestamp } from "firebase-admin/firestore";
import { ADMIN_GROUPS, adminTransaction, normalizeGroup, requireAdmin, requireAuth } from "../utils/auth";
import { IMPORT_MAX_ROWS, PUBLIC_ORIGIN, RESEND_QUEUE_CAP, SEND_CHUNK_SIZE } from "../utils/config";
import { db } from "../utils/firebase";
import { syncProviderUsage } from "../utils/emailProvider";
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
            timeZone: "America/Los_Angeles",
            year: "numeric", month: "long", day: "numeric",
            hour: "numeric", minute: "2-digit",
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
        // A wide gap between tickets so a reader framing one code doesn't
        // also catch its neighbour and scan the wrong ticket.
        return `<div style="margin:${i === 0 ? 16 : 72}px 0 16px;text-align:center;">` +
            `<div style="display:inline-block;background-color:${bgColor};color:${textColor};font-weight:bold;font-size:13px;padding:4px 12px;border-radius:16px;margin-bottom:12px;text-transform:uppercase;letter-spacing:1px;">${typeLabel}</div><br/>` +
            `<img src="${qrUrl}" alt="Ticket ${id}" width="300" height="300" style="width:300px;max-width:100%;height:auto;display:inline-block;"/>` +
            `<div style="font-family:monospace;font-size:12px;color:#555;word-break:break-all;">${id}</div>` +
            `</div>`;
    }).join("\n");
}

// Ticket ids are UUIDs and event ids are Firestore doc ids, so both fit this
// charset well under the length cap. This endpoint is public and uncached for
// novel inputs, so rejecting off-shape params early keeps an anonymous caller
// from forcing QR generation for arbitrary (cache-busting) query strings.
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

        // Twice the 300px the email shows it at, so it stays sharp on a
        // high-density screen. Error correction "M" scans reliably at this size.
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

// Site Config's Contact Email. Usable in an href too (mailto:{{ contactEmail }}),
// since the address is escaped like every other substituted value.
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
    // True when rendering into HTML (body). False for plain-text contexts
    // (subject line) — entity-encoding subject text would surface literally
    // in inboxes (e.g. "Jones &amp; Co").
    htmlContext: boolean,
): string {
    const sub = htmlContext ? escapeHtml : (s: string) => s;
    // CSS background-image is unreliable in email clients (Outlook strips it
    // entirely; several others ignore it). Render a real <img> instead so the
    // header artwork shows everywhere. The URL was checked as a Firebase Storage
    // URL at save time (validateStorageImageUrl), but that check reads the parsed
    // URL while the stored string is what lands here, so it is escaped too.
    const headerImage = data.emailHeaderBg
        ? `<img src="${escapeHtml(data.emailHeaderBg)}" alt="${sub(data.eventTitle)}" width="600" style="display:block;width:100%;max-width:600px;height:auto;border:0;outline:none;text-decoration:none;"/>`
        : `<div style="background-color:#ff6b9d;height:120px;"></div>`;

    // Function replacements throughout: a replacement string reads $&, $' and $$
    // as patterns, so a name or title containing one would come out mangled.
    return template
        .replace(/{{\s*attendeeEmail\s*}}/g, () => sub(data.attendeeEmail))
        .replace(/{{\s*attendeeName\s*}}/g, () => sub(data.attendeeName))
        .replace(/{{\s*eventTitle\s*}}/g, () => sub(data.eventTitle))
        .replace(/{{\s*eventTitleCn\s*}}/g, () => sub(data.eventTitleCn))
        .replace(/{{\s*eventDate\s*}}/g, () => sub(data.eventDate))
        .replace(/{{\s*eventHeader\s*}}/g, () => headerImage)
        .replace(/{{\s*ticketCount\s*}}/g, () => String(data.ticketCount))
        .replace(CONTACT_EMAIL_PLACEHOLDER, () => sub(data.contactEmail))
        // {{ ticketIds[] }} — with optional surrounding <p>/<div> tags collapsed.
        // ticketBlock is server-built HTML, never escaped.
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

    // Admin check + event existence check in a lightweight transaction.
    // We can't fit the whole import in one transaction (would violate the 500-op
    // limit on large imports), so the big writes run as batched commits below.
    const eventTitle = await adminTransaction(uid, async (txn) => {
        const eventSnap = await txn.get(db.collection("upcomingEvents").doc(eventId));
        if (!eventSnap.exists) throw new HttpsError("not-found", "Event not found.");
        return (eventSnap.data()?.title ?? eventId) as string;
    });

    const attendeesCol = db.collection("upcomingEvents").doc(eventId).collection("attendees");

    // Look up existing docs by email in parallel (queries in chunks to avoid
    // the `in` operator's 30-value limit).
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

        // A row's own timestamp, when the import has one, stands in for both dates,
        // so the ticket reads as bought then. Without one, a new record is stamped
        // now and a replaced one keeps its createdAt.

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
 * Attendee docs are keyed by the email the ticket was bought with, and the
 * `attendees` subcollection is closed to everyone but staff (see
 * firestore.rules), so this call is the only way a holder reaches their own
 * tickets. The email comes off the ID token rather than the users doc: the token
 * is what Auth actually verified, so nobody reads someone else's tickets by
 * having a profile field say so.
 *
 * The cut is the event's end, never the scan. A ticket already through the door
 * stays visible for the length of the event — people re-open their own ticket to
 * settle what they paid for or which of a batch was used — and once `endAt`
 * passes nothing comes back at all, scanned or not, so the card leaves the
 * profile on its own. The event's attendance then shows up under Events Attended
 * once it is archived.
 *
 * Only paid, published events are searched: a free event has no tickets, and an
 * unpublished event's title is withheld by those same rules.
 *
 * A redeemed ticket also backfills attendance. The scanner credits the holder's
 * account as it scans, but only if an account already carried the ticket's
 * email; someone who signed up afterwards would otherwise never be credited for
 * the event they were scanned into. createUserProfile does the same at sign-up,
 * for ended events too; this catches a sign-up whose credit failed.
 */
export const getMyTickets = onCall({maxInstances: 20}, async (request) => {
    const uid = await requireAuth(request);
    const email = (request.auth?.token.email ?? "").trim().toLowerCase();
    if (!email) return {events: []};

    // Filtering on endAt alone keeps this on the automatic single-field index —
    // there are only ever a handful of live events to sift in memory.
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

        // Import dedupes by email, so this is one doc in practice; taking every
        // match means a hand-edited duplicate still shows all of its tickets.
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
        .filter(e => e.tickets.some(t => t.redeemed && !t.voided))
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
            // A profile that couldn't be credited must not cost the caller the
            // sight of their tickets — the scanner is the primary writer anyway.
            console.error(`getMyTickets: attendance backfill failed for ${uid}`, err);
        }
    }

    return {events};
});
/**
 * How many emails one lookup may ask about. Firestore's `in` takes 30 at a time,
 * so this is 17 queries fired together — comfortably inside a call, and enough
 * that a 500-strong attendee list is answered in one round trip rather than
 * spending a caller's rate-limit budget on a dozen.
 */
const ACCOUNT_LOOKUP_MAX = 500;

/**
 * Which of these ticket emails belong to a registered account.
 *
 * Staff need this in two places: adding an attendee, where it says whether the
 * address they just typed will reach somebody's profile, and reading the list
 * afterwards, where it says which tickets will credit an account when scanned.
 *
 * It answers with the same query the scanner uses — an exact match on the
 * lowercased address (see redeemTicket) — so what staff are shown is a preview
 * of what check-in will actually find, rather than a friendlier lookup that
 * would promise a link the scanner then misses.
 *
 * Who the account belongs to is for staff and above, who can read every
 * profile anyway. Event staff get the fact of a link and nothing else: they can
 * read this event's attendees, which is not the same as being able to put a name
 * to every address in the club.
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

    // The same gate as reading the attendees themselves: staff anywhere, event
    // staff on their own event.
    const callerSnap = await db.collection("users").doc(uid).get();
    const callerData = callerSnap.data() ?? {};
    const isStaffOrAbove = ["staff", ...ADMIN_GROUPS].includes(normalizeGroup(callerData.group));
    const callerEventStaff: string[] = callerData.eventStaffEvents ?? [];
    if (!isStaffOrAbove && !callerEventStaff.includes(eventId)) {
        throw new HttpsError("permission-denied", "Not authorized to read this event's attendees.");
    }

    // A malformed address is dropped rather than rejected. This is a read on
    // behalf of a preview that may well be showing a row someone typed wrong,
    // and no address matches an account anyway — losing the whole lookup over
    // one bad row would be the worse answer.
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
        const isEventStaff = callerEventStaff.includes(eventId);
        if (!isCoreStaffOrAbove && !isEventStaff) {
            throw new HttpsError("permission-denied", "Not authorized to scan tickets for this event.",
                {code: "not-authorized"});
        }

        // Require event exists so stale eventIds can't haunt redemption.
        const eventSnap = await txn.get(db.collection("upcomingEvents").doc(eventId));
        if (!eventSnap.exists) {
            throw new HttpsError("not-found", "Event not found.", {code: "event-missing"});
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

        const now = Timestamp.now();
        // How long after admitting a ticket the same scanner can read it again and
        // be told it succeeded, so a ticket still held up to the camera doesn't flip
        // to "already redeemed" a moment after it got in. Timed from the admission;
        // the scanner's cache is told what is left of it.
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

            // The same scanner reading it again moments later: report the admission
            // it already made, and write nothing. Writing redeemedAt again would
            // restart the window on every rescan, and a ticket held up to the camera
            // every few seconds would never stop reading as a fresh admission.
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
        // Idempotent: a ticket already redeemed stays as-is so a double-click
        // can't overwrite the original redeemer/time.
        if (tickets[idx].redeemed) {
            return {redeemed: false, alreadyRedeemed: true};
        }

        // A check-in by hand is still a check-in, so it credits the holder's
        // account exactly as the scanner does (see redeemTicket) — otherwise
        // whether the event reaches their profile would come down to which
        // button the door staff pressed.
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

        // Clear only the redemption state. The attendee's user-level
        // attendedEvents (set by the scanner) is intentionally left untouched —
        // a user may have attended via another ticket, so we don't un-check-in
        // the person just because one ticket was reset.
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

        // Refuse rather than send "contact us at  and we'll sort it out" with
        // a mailto: to no one. Read per call, so a fix in Site Config applies
        // to the next send.
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
            // Drain pattern: processed attendees leave the result set on the next call.
            // orderBy createdAt gives FIFO fairness across chunks — uses the
            // existing (emailSent, createdAt) composite index.
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

        // Enforce the Resend daily cap server-side so a buggy/malicious client
        // (or parallel admins) can't blow past it. Anything past the daily cap
        // goes into /scheduledMail and is drained by scheduledMailDrain as
        // quota frees up.
        // Bail out only when BOTH the daily cap and the queue are full —
        // otherwise the chunk falls through to the walk below. The
        // authoritative cap re-read happens inside the txn (see below); this
        // pre-check is just to short-circuit a no-op chunk before doing real
        // work. Queue capacity stays loose by design — a few overflow items
        // past RESEND_QUEUE_CAP are acceptable.
        //
        // Re-anchor `confirmed` against the provider before reading it. The
        // cache is otherwise only written as a side effect of sending, so it
        // never observes the rolling window reopening between sends — and on a
        // plan that gets no quota header it is never written at all, which
        // would leave the cap unenforced. A failed read leaves the cache as-is
        // and we gate on it, same as before.
        await syncProviderUsage();
        const {sentToday, dailyCap} = await computeEmailQuota();
        const prelimRemainingToday = Math.max(0, dailyCap - sentToday);
        const initialQueueDepth = await getScheduledMailQueueDepth();
        const queueCapacity = Math.max(0, RESEND_QUEUE_CAP - initialQueueDepth);
        if (prelimRemainingToday === 0 && queueCapacity === 0) {
            throw new HttpsError("resource-exhausted",
                "Daily cap reached and overflow queue is full.", {code: "quota-exceeded"});
        }

        // Ops here are only for non-email side effects (ticketless attendee
        // marks). The actual Resend send happens in one batch call below.
        const ops: ((b: FirebaseFirestore.WriteBatch) => void)[] = [];

        // Walk targets into a candidates list. The send-vs-queue split is
        // deferred until inside the reservation transaction below, so the
        // split keys off a fresh sentToday read rather than the stale one
        // from the pre-check (which a concurrent admin send could have
        // consumed in the meantime).
        const ticketlessTargets: FirebaseFirestore.QueryDocumentSnapshot[] = [];
        const candidates: {
            target: FirebaseFirestore.QueryDocumentSnapshot;
            data: FirebaseFirestore.DocumentData;
            tickets: any[];
        }[] = [];
        const prelimBudget = prelimRemainingToday + queueCapacity;
        // How many of `targets`, in order, this call deals with — lowered below if
        // the reservation trims candidates. A resend-all pass resumes after the
        // last of them, so a target left over is picked up next call, not skipped.
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

        // Defective attendees (no tickets or all voided): mark sent so the mode='unsent'
        // drain doesn't spin on the same doc forever.
        for (const target of ticketlessTargets) {
            ops.push(b => b.update(target.ref, {
                emailSent: true,
                emailSentAt: FieldValue.serverTimestamp(),
                updatedAt: FieldValue.serverTimestamp(),
            }));
        }

        // Reserve daily-cap slots atomically. Reading the quota cache inside
        // the txn and writing the pre-charge (reserved counter + audit
        // record) in the same txn closes the race where two concurrent
        // admin sends both observe pre-reservation state and double-spend:
        // Firestore's optimistic concurrency on system/resendQuota means
        // whichever txn lands second retries against the new total. Once
        // the send settles, this send's own reservation is released, and
        // Resend's authoritative count recorded if a quota header came back.
        // Queue audit shares the txn for symmetry — doesn't consume the
        // daily cap, cheap to include.
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

        // Trim candidates to what the txn actually reserved (a concurrent
        // admin send may have consumed slots between the pre-check and the
        // txn read). First `expectedSentCount` ship now; the rest queue.
        const reservedCount = expectedSentCount + expectedQueuedCount;
        if (reservedCount < candidates.length) {
            handled = Math.min(handled, targets.indexOf(candidates[reservedCount].target));
        }
        const sendableTargets = candidates.slice(0, reservedCount).map((c, i) => ({
            ...c,
            queued: i >= expectedSentCount,
        }));

        // Build envelopes for the send slice and queue payloads for the
        // queue slice. One pass — both share the same rendering.
        const sendEnvelopes: ResendEnvelope[] = [];
        const sendCommitTargets: typeof sendableTargets = [];
        const queueItems: {
            target: FirebaseFirestore.QueryDocumentSnapshot;
            envelope: ResendEnvelope;
        }[] = [];
        for (const item of sendableTargets) {
            const {target, data, tickets, queued} = item;
            const ticketBlock = renderTicketQrBlock(tickets, eventId);

            // Strip control chars (CR/LF in particular) from the rendered
            // subject so a stray newline in eventTitle/attendeeName can't
            // escape the Subject: header and inject extra fields.
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

        // One call to Resend for the whole send slice — sendEmails picks
        // the single endpoint when there's exactly one envelope and the
        // batch endpoint (up to 100) otherwise. SEND_CHUNK_SIZE is capped
        // at 100 so a single call always covers the chunk.
        // Failure mode: all-or-nothing — a 4xx/5xx fails every envelope. If
        // Resend responded with the quota header, resendClient already
        // wrote the authoritative count to the cache; if no header came
        // back, we roll back the pre-charge so a retry doesn't see a false
        // ceiling.
        let sentCount = 0;
        let sendError: unknown = null;
        if (sendEnvelopes.length > 0) {
            try {
                const result = await sendEmails(sendEnvelopes);
                sentCount = result.sentCount;
            } catch (err) {
                console.error("sendTicketEmails: send failed", err);
                sendError = err;
                // Roll back the pre-charge unless a quota header came back;
                // resendClient has already folded that into the cache.
                const headerArrived = err instanceof ResendSendError
                    && err.dailyConsumed !== null;
                if (!headerArrived) {
                    await rollbackQuotaReservation(expectedSentCount);
                }
            }
        }

        // Mark attendees as sent — one batch.commit() per attendee so a
        // single bad write (e.g., attendee deleted mid-call) doesn't
        // strand the whole group. The Resend send already happened, so
        // a failed mark means the email will look "unsent" in the admin
        // UI and would be re-sent on the next 'unsent' drain.
        // Mitigation: log loudly so an admin can manually flag.
        // sentCount is the id count Resend returned, not a local length, so
        // clamp the loop to the targets we actually hold. Overrunning would
        // throw outside the per-attendee catch below and strand every
        // remaining mark, re-sending the whole batch on the next drain.
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

        // Queue the overflow. attendeePath lets the drain clear
        // emailScheduled once the queued mail actually ships, flipping
        // the admin UI from "Queued" to "Sent".
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
            // emailSent=true keeps the mode='unsent' drain from
            // re-picking this attendee on the next chunk call.
            // emailScheduled is the disambiguator the admin UI keys on to
            // show "Queued" instead of "Sent" until the drain ships the mail.
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

        // Reconcile the eager audit reservations: if a mid-loop error or
        // skipped target meant we shipped fewer than reserved, lower the
        // recorded count (or delete the audit entirely if nothing got
        // through). Keeps computeEmailQuota accurate without leaving a
        // counterfactual over-count blocking later sends.
        if (sendAuditRef) {
            if (sentCount === 0) await sendAuditRef.delete();
            else if (sentCount !== expectedSentCount) await sendAuditRef.update({sentCount});
        }
        if (queueAuditRef) {
            if (queuedCount === 0) await queueAuditRef.delete();
            else if (queuedCount !== expectedQueuedCount) await queueAuditRef.update({sentCount: queuedCount});
        }

        // Surface send failures to the caller after reconciliation so any
        // audit/queue writes that did succeed are durable. Queued items
        // get drained later; the admin should retry the failed send.
        if (sendError && sentCount === 0 && expectedSentCount > 0) {
            throw new HttpsError("internal",
                "Email send failed; queued items (if any) will still drain.",
                {
                    code: "send-failed",
                    queuedCount,
                    cause: sendError instanceof Error ? sendError.message : String(sendError),
                });
        }

        // hasMore: the query returned a full chunk (there may be more), or this
        // call stopped short of the chunk it read. For attendeeIds, the client
        // controls chunking — never set hasMore.
        const hasMore = !attendeeIds && (queriedCount >= chunkSize || handled < targets.length);
        const resumeAfter = handled > 0 ? targets[handled - 1].id : cursor;
        const nextCursor = mode === "all" && hasMore && resumeAfter ? resumeAfter : undefined;

        return {sentCount, queuedCount, hasMore, ...(nextCursor ? {nextCursor} : {})};
    });
export const getTicketEmailQuota = onCall({
    maxInstances: 5,
    // Needed by syncProviderUsage below; without the binding it reads no key
    // and silently falls back to the cached counter.
    secrets: [RESEND_API_KEY],
}, async (request) => {
    const uid = await requireAuth(request);
    await requireAdmin(uid);

    // Same re-anchor as the send path, so the headroom quoted in the send UI
    // matches what sendTicketEmails will actually gate on a moment later.
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
