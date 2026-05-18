import * as crypto from "crypto";
import sanitizeHtml from "sanitize-html";
import { HttpsError, onCall, onRequest } from "firebase-functions/v2/https";
import { FieldPath, FieldValue, Timestamp } from "firebase-admin/firestore";
import { ADMIN_GROUPS, adminTransaction, requireAdmin, requireAuth } from "../utils/auth";
import {
    IMPORT_MAX_ROWS,
    PUBLIC_ORIGIN,
    recordExpiresAt,
    RESEND_DAILY_CAP,
    RESEND_SEND_INTERVAL_MS,
    SEND_CHUNK_SIZE
} from "../utils/config";
import { db } from "../utils/firebase";
import { commitInChunks } from "../utils/helpers";
import { sanitizeDisplayText, validateDocId, validateStr } from "../utils/validation";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validateEmail(value: unknown, name: string): string {
    if (typeof value !== "string") {
        throw new HttpsError("invalid-argument", `Invalid ${name}.`);
    }
    const normalized = value.trim().toLowerCase();
    if (normalized.length === 0 || normalized.length > 320 || !EMAIL_RE.test(normalized)) {
        throw new HttpsError("invalid-argument", `Invalid ${name}.`);
    }
    return normalized;
}

function validateTicketCount(value: unknown): number {
    if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 50) {
        throw new HttpsError("invalid-argument", "ticketCount must be an integer between 1 and 50.");
    }
    return value;
}

const VALID_TICKET_TYPES = ["normal", "early-bird", "vip", "Comp Ticket", "guest"];

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

function formatEventDateForEmail(startAt: Timestamp | undefined, locale: string): string {
    if (!startAt) return "";
    try {
        return new Intl.DateTimeFormat(locale, {
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
    bodyCnHtml: string;
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
    return tickets.map(ticket => {
        const id = typeof ticket === "string" ? ticket : (ticket.ticketId ?? "");
        const typeRaw = typeof ticket === "string" ? "normal" : (ticket.type ?? "normal");

        let typeLabel = "General Admission";
        let bgColor = "#ff6b9d"; // brand pink
        let textColor = "#ffffff";

        if (typeRaw === "early-bird" || typeRaw === "earlybird") {
            typeLabel = "Early Bird";
            bgColor = "#1abc9c"; // teal
        } else if (typeRaw === "vip") {
            typeLabel = "VIP";
            bgColor = "#f39c12"; // gold
        } else if (typeRaw === "guest" || typeRaw === "嘉宾") {
            typeLabel = "Guest";
            bgColor = "#3498db"; // blue
        } else if (typeRaw === "Comp Ticket" || typeRaw === "comp" || typeRaw === "赠票") {
            typeLabel = "Comp Ticket";
            bgColor = "#95a5a6"; // gray
        }

        const qrUrl = `${origin}/api/ticket-qr?ticket=${encodeURIComponent(id)}&event=${encodeURIComponent(eventId)}`;
        return `<div style="margin:16px 0;text-align:center;">` +
            `<div style="display:inline-block;background-color:${bgColor};color:${textColor};font-weight:bold;font-size:13px;padding:4px 12px;border-radius:16px;margin-bottom:12px;text-transform:uppercase;letter-spacing:1px;">${typeLabel}</div><br/>` +
            `<img src="${qrUrl}" alt="Ticket ${id}" style="width:200px;height:200px;display:inline-block;"/>` +
            `<div style="font-family:monospace;font-size:12px;color:#555;word-break:break-all;">${id}</div>` +
            `</div>`;
    }).join("\n");
}

export const serveTicketQr = onRequest({maxInstances: 10, memory: "256MiB"}, async (req, res) => {
    const ticketId = req.query.ticket as string;
    const eventId = req.query.event as string;
    if (!ticketId || !eventId) {
        res.status(400).send("Missing ticket or event parameter");
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

        // 256 px keeps each ticket's QR comfortably small. Error correction "M"
        // scans reliably at this size.
        const buf = await QRCode.toBuffer(url, {errorCorrectionLevel: "M", width: 256, margin: 1});

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
    },
    // True when rendering into HTML (body). False for plain-text contexts
    // (subject line) — entity-encoding subject text would surface literally
    // in inboxes (e.g. "Jones &amp; Co").
    htmlContext: boolean,
): string {
    const sub = htmlContext ? escapeHtml : (s: string) => s;
    // CSS background-image is unreliable in email clients (Outlook strips it
    // entirely; several others ignore it). Render a real <img> instead so the
    // header artwork shows everywhere. URL is validated as a Firebase Storage
    // URL at save time (validateStorageImageUrl) so it's safe to interpolate.
    const headerImage = data.emailHeaderBg
        ? `<img src="${data.emailHeaderBg}" alt="${sub(data.eventTitle)}" width="600" style="display:block;width:100%;max-width:600px;height:auto;border:0;outline:none;text-decoration:none;"/>`
        : `<div style="background-color:#ff6b9d;height:120px;"></div>`;

    return template
        .replace(/{{\s*attendeeEmail\s*}}/g, sub(data.attendeeEmail))
        .replace(/{{\s*attendeeName\s*}}/g, sub(data.attendeeName))
        .replace(/{{\s*eventTitle\s*}}/g, sub(data.eventTitle))
        .replace(/{{\s*eventTitleCn\s*}}/g, sub(data.eventTitleCn))
        .replace(/{{\s*eventDate\s*}}/g, sub(data.eventDate))
        .replace(/{{\s*eventHeader\s*}}/g, headerImage)
        // Back-compat: drop the old CSS-based placeholder so any saved template
        // that still references it doesn't ship the literal `{{...}}` string.
        .replace(/{{\s*eventHeaderBgStyle\s*}}/g, "")
        .replace(/{{\s*ticketCount\s*}}/g, String(data.ticketCount))
        // {{ ticketIds[] }} — with optional surrounding <p>/<div> tags collapsed.
        // ticketBlock is server-built HTML, never escaped.
        .replace(/(<p>\s*|<div>\s*)?{{\s*ticketIds\[]\s*}}(\s*<\/p>|\s*<\/div>)?/g, data.ticketBlock);
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
        return (eventSnap.data()?.title ?? eventSnap.data()?.name ?? eventId) as string;
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

        // For replaced records, we only update `updatedAt` unless a custom timestamp is provided, 
        // in which case it might make sense to update `createdAt` to that too if we want it to act as the original import date.
        // Let's just update `updatedAt` for replaced, and `createdAt`/`updatedAt` for new. 
        // Actually, if a custom timestamp is provided, let's set `createdAt` to it for both added and replaced, so the ticket acts like it was created then.

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

    ops.push(b => b.set(db.collection("records").doc(), {
        type: "ticket-import",
        performedBy: uid,
        performedByName: callerName,
        eventId,
        eventTitle,
        addedCount,
        replacedCount,
        timestamp: FieldValue.serverTimestamp(),
        expiresAt: recordExpiresAt(),
    }));

    await commitInChunks(ops);

    return {added: addedCount, replaced: replacedCount, skipped: skippedCount, total: normalized.size};
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
        const group = callerData.group ?? "visitor";
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
        const eventTitle: string = eventSnap.data()?.title ?? eventSnap.data()?.name ?? "";

        const now = Timestamp.now();
        const REDEEM_GRACE_PERIOD_MS = 15_000;

        if (ticket.redeemed) {
            const redeemedAtMs = ticket.redeemedAt?.toMillis?.() ?? 0;
            const isWithinGracePeriod = (now.toMillis() - redeemedAtMs) < REDEEM_GRACE_PERIOD_MS;
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

        const eventTitle: string = eventSnap.exists
            ? (eventSnap.data()?.title ?? eventSnap.data()?.name ?? eventId)
            : eventId;

        txn.update(attendeeRef, {tickets, updatedAt: FieldValue.serverTimestamp()});
        txn.set(db.collection("records").doc(), {
            type: "ticket-void",
            performedBy: uid,
            performedByName: callerSnap.data()?.displayName ?? "",
            eventId,
            eventTitle,
            targetEmail: data.email ?? "",
            targetName: data.name ?? "",
            code: ticketId,
            timestamp: FieldValue.serverTimestamp(),
            expiresAt: recordExpiresAt(),
        });

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

        const eventTitle: string = eventSnap.exists
            ? (eventSnap.data()?.title ?? eventSnap.data()?.name ?? eventId)
            : eventId;

        txn.update(attendeeRef, {tickets, updatedAt: FieldValue.serverTimestamp()});
        txn.set(db.collection("records").doc(), {
            type: "ticket-unvoid",
            performedBy: uid,
            performedByName: callerSnap.data()?.displayName ?? "",
            eventId,
            eventTitle,
            targetEmail: data.email ?? "",
            targetName: data.name ?? "",
            code: ticketId,
            timestamp: FieldValue.serverTimestamp(),
            expiresAt: recordExpiresAt(),
        });

        return {unvoided: true};
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
        if (!attendeeSnap.exists) {
            throw new HttpsError("not-found", "Attendee not found.");
        }
        const data = attendeeSnap.data()!;
        const prevTicketCount: number = data.ticketCount ?? 0;
        const prevTickets: NewTicket[] = (data.tickets ?? []) as NewTicket[];
        const prevType = prevTickets[0]?.type ?? "normal";

        const eventTitle: string = eventSnap.exists
            ? (eventSnap.data()?.title ?? eventSnap.data()?.name ?? eventId)
            : eventId;

        const countChanged = ticketCount !== prevTicketCount;
        const typeChanged = type !== prevType;

        if (!countChanged && !typeChanged) {
            if (name === data.name) {
                return {updated: false, regenerated: false};
            }
            txn.update(attendeeRef, {name, updatedAt: FieldValue.serverTimestamp()});
            txn.set(db.collection("records").doc(), {
                type: "ticket-attendee-edit",
                performedBy: uid,
                performedByName: callerSnap.data()?.displayName ?? "",
                eventId,
                eventTitle,
                targetEmail: data.email ?? "",
                oldName: data.name ?? "",
                newName: name,
                timestamp: FieldValue.serverTimestamp(),
                expiresAt: recordExpiresAt(),
            });
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
        txn.set(db.collection("records").doc(), {
            type: "ticket-regenerate",
            performedBy: uid,
            performedByName: callerSnap.data()?.displayName ?? "",
            eventId,
            eventTitle,
            targetEmail: data.email ?? "",
            targetName: name,
            timestamp: FieldValue.serverTimestamp(),
            expiresAt: recordExpiresAt(),
        });
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

        const eventTitle: string = eventSnap.exists
            ? (eventSnap.data()?.title ?? eventSnap.data()?.name ?? eventId)
            : eventId;

        txn.update(attendeeRef, {tickets, updatedAt: FieldValue.serverTimestamp()});
        txn.set(db.collection("records").doc(), {
            type: "ticket-type-edit",
            performedBy: uid,
            performedByName: callerSnap.data()?.displayName ?? "",
            eventId,
            eventTitle,
            targetEmail: data.email ?? "",
            targetName: data.name ?? "",
            code: ticketId,
            oldType,
            newType: type,
            timestamp: FieldValue.serverTimestamp(),
            expiresAt: recordExpiresAt(),
        });

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
        if (!attendeeSnap.exists) {
            throw new HttpsError("not-found", "Attendee not found.");
        }
        const data = attendeeSnap.data()!;
        const tickets: NewTicket[] = (data.tickets ?? []).map(
            (t: Record<string, unknown>) => t as unknown as NewTicket
        );
        const eventTitle: string = eventSnap.exists
            ? (eventSnap.data()?.title ?? eventSnap.data()?.name ?? eventId)
            : eventId;
        txn.delete(attendeeRef);
        txn.set(db.collection("records").doc(), {
            type: "ticket-attendee-delete",
            performedBy: uid,
            performedByName: callerSnap.data()?.displayName ?? "",
            eventId,
            eventTitle,
            targetEmail: data.email ?? "",
            targetName: data.name ?? "",
            timestamp: FieldValue.serverTimestamp(),
            expiresAt: recordExpiresAt(),
        });
        return {deleted: true, ticketCount: tickets.length};
    });
});

async function computeTicketEmailQuota(): Promise<{sentToday: number; dailyCap: number}> {
    // Start of today in America/Los_Angeles, expressed as a UTC Timestamp.
    // UTC-now minus LA's elapsed-since-midnight equals LA midnight (UTC).
    // hourCycle:'h23' pins the range to 0–23 (en-US hour12:false can return "24").
    const now = new Date();
    const laParts = new Intl.DateTimeFormat("en-GB", {
        timeZone: "America/Los_Angeles",
        hour: "2-digit", minute: "2-digit", second: "2-digit",
        hourCycle: "h23",
    }).formatToParts(now);
    const part = (t: string) => Number(laParts.find(p => p.type === t)?.value ?? "0");
    const laMidnightMs = now.getTime()
        - part("hour") * 3600_000
        - part("minute") * 60_000
        - part("second") * 1000
        - now.getMilliseconds();
    const startOfTodayLA = Timestamp.fromMillis(laMidnightMs);

    // Uses the existing (type, timestamp) composite index. `in` runs as two
    // equality queries under the hood, each served by that index — adding the
    // tool-driven custom-email-send type here keeps the daily cap a single
    // shared budget across all outbound mail.
    const snap = await db.collection("records")
        .where("type", "in", ["ticket-email-send", "custom-email-send"])
        .where("timestamp", ">=", startOfTodayLA)
        .get();
    let sentToday = 0;
    for (const d of snap.docs) {
        const c = d.data().sentCount;
        if (typeof c === "number" && Number.isFinite(c)) sentToday += c;
    }
    return {sentToday, dailyCap: RESEND_DAILY_CAP};
}

export const sendTicketEmails = onCall(
    {maxInstances: 5, timeoutSeconds: 300, memory: "512MiB"},
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
            bodyCnHtml: (templateData.bodyCnHtml as string) ?? "",
        };
        if (!template.subject.trim() || !template.bodyHtml.trim()) {
            throw new HttpsError("failed-precondition",
                "Email template is empty.", {code: "no-template"});
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

        const eventTitle: string = eventData.title ?? eventData.name ?? "";
        const eventTitleCn: string = eventData.titleCn ?? eventData.nameCn ?? "";
        const emailHeaderBg: string = eventData.emailHeaderBg ?? "";
        const eventDateEn = formatEventDateForEmail(eventData.startAt, "en-US");
        const eventDateCn = formatEventDateForEmail(eventData.startAt, "zh-CN");

        // Enforce the Resend daily cap server-side so a buggy/malicious client
        // (or parallel admins) can't blow past it. Caps the chunk at whatever
        // is still available today.
        const {sentToday, dailyCap} = await computeTicketEmailQuota();
        const remainingToday = Math.max(0, dailyCap - sentToday);
        if (remainingToday === 0) {
            throw new HttpsError("resource-exhausted",
                "Daily Resend cap reached.", {code: "quota-exceeded"});
        }

        // Ops here are only for things that don't trigger Resend (ticketless
        // attendee marks + the audit record). The actual mail-doc creates are
        // paced below to stay under Resend's 5 req/sec POST /emails limit.
        const ops: ((b: FirebaseFirestore.WriteBatch) => void)[] = [];
        let sentCount = 0;
        let lastProcessedId: string | null = null;

        // Walk targets to preserve the cap and cursor semantics, but
        // only collect work — actual QR generation runs in parallel below.
        // Defective attendees (no ticketIds) are marked sent without consuming
        // from remainingToday; matches the original sequential loop.
        const ticketlessTargets: FirebaseFirestore.QueryDocumentSnapshot[] = [];
        const sendableTargets: {
            target: FirebaseFirestore.QueryDocumentSnapshot;
            data: FirebaseFirestore.DocumentData;
            ticketIds: string[];
            tickets: any[];
        }[] = [];
        for (const target of targets) {
            lastProcessedId = target.id;
            if (sentCount >= remainingToday) break;
            const data = target.data();
            const rawTickets: any[] = data.tickets ?? [];
            const activeTickets = rawTickets.filter(t => !t.voided);

            if (activeTickets.length === 0) {
                ticketlessTargets.push(target);
                continue;
            }

            sendableTargets.push({
                target,
                data,
                ticketIds: activeTickets.map(t => t.ticketId),
                tickets: activeTickets
            });
            sentCount++;
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

        // Pace mail-doc creates so the email extension's onCreate triggers
        // don't blow past Resend's POST /emails limit (5 req/sec). Each mail
        // doc + its attendee mark are committed together so a mid-loop crash
        // can't leave an email queued without the attendee marked sent (which
        // would cause duplicates on the next 'unsent' drain).
        for (let i = 0; i < sendableTargets.length; i++) {
            const {target, data, tickets} = sendableTargets[i];
            const ticketBlock = renderTicketQrBlock(tickets, eventId);

            // Strip control chars (CR/LF in particular) from the rendered subject,
            // so a stray newline in eventTitle/attendeeName can't escape the
            // Subject: header and inject extra fields. nodemailer's own header
            // encoder already guards against this; this is defense-in-depth.
            const renderedSubject = renderTemplate(template.subject, {
                attendeeEmail: data.email ?? "",
                attendeeName: data.name ?? "",
                eventTitle, eventTitleCn,
                eventDate: eventDateEn,
                emailHeaderBg,
                ticketCount: tickets.length,
                ticketBlock: "",
            }, false).replace(/[\x00-\x1F\x7F]+/g, " ").trim();
            const renderedBodyEn = renderTemplate(template.bodyHtml, {
                attendeeEmail: data.email ?? "",
                attendeeName: data.name ?? "",
                eventTitle, eventTitleCn,
                eventDate: eventDateEn,
                emailHeaderBg,
                ticketCount: tickets.length,
                ticketBlock,
            }, true);
            const renderedBodyCn = renderTemplate(template.bodyCnHtml, {
                attendeeEmail: data.email ?? "",
                attendeeName: data.name ?? "",
                eventTitle, eventTitleCn,
                eventDate: eventDateCn,
                emailHeaderBg,
                ticketCount: tickets.length,
                ticketBlock,
            }, true);

            // Bilingual: EN first, CN below, separated by a thin hr.
            const html = renderedBodyCn
                ? `${renderedBodyEn}\n<hr style="border:none;border-top:1px solid #ddd;margin:24px 0;"/>\n${renderedBodyCn}`
                : renderedBodyEn;

            if (i > 0 && RESEND_SEND_INTERVAL_MS > 0) {
                await new Promise(r => setTimeout(r, RESEND_SEND_INTERVAL_MS));
            }

            const mailRef = db.collection("mail").doc();
            const batch = db.batch();
            batch.set(mailRef, {
                to: data.email,
                message: {subject: renderedSubject, html},
            });
            batch.update(target.ref, {
                emailSent: true,
                emailSentAt: FieldValue.serverTimestamp(),
                updatedAt: FieldValue.serverTimestamp(),
            });
            await batch.commit();
        }

        // Only write an audit record when we actually sent something.
        // Otherwise, chunked loops would fill `records` with zero-count noise.
        if (sentCount > 0) {
            const callerSnap = await db.collection("users").doc(uid).get();
            ops.push(b => b.set(db.collection("records").doc(), {
                type: "ticket-email-send",
                performedBy: uid,
                performedByName: callerSnap.data()?.displayName ?? "",
                eventId,
                eventTitle,
                sentCount,
                timestamp: FieldValue.serverTimestamp(),
                expiresAt: recordExpiresAt(),
            }));
        }

        if (ops.length > 0) await commitInChunks(ops);

        // hasMore: the query returned a full chunk (there may be more).
        // For attendeeIds, the client controls chunking — never set hasMore.
        const hasMore = !attendeeIds && queriedCount >= chunkSize;
        const nextCursor = mode === "all" && hasMore && lastProcessedId
            ? lastProcessedId
            : undefined;

        return {sentCount, hasMore, ...(nextCursor ? {nextCursor} : {})};
    });
export const getTicketEmailQuota = onCall({maxInstances: 5}, async (request) => {
    const uid = await requireAuth(request);
    await requireAdmin(uid);

    const {sentToday, dailyCap} = await computeTicketEmailQuota();
    return {sentToday, dailyCap, chunkSize: SEND_CHUNK_SIZE};
});
export const updateEventEmailTemplate = onCall({maxInstances: 10}, async (request) => {
    const uid = await requireAuth(request);

    const input = request.data as {
        eventId?: string;
        subject?: unknown;
        bodyHtml?: unknown;
        bodyCnHtml?: unknown;
    };
    const eventId = validateDocId(input.eventId, "eventId");
    const subject = validateStr(input.subject, "subject", 500, true);
    const rawBodyHtml = validateStr(input.bodyHtml, "bodyHtml", 20000);
    const rawBodyCnHtml = validateStr(input.bodyCnHtml, "bodyCnHtml", 20000);

    const bodyHtml = sanitizeHtml(rawBodyHtml, EMAIL_HTML_SANITIZE_OPTIONS);
    const bodyCnHtml = rawBodyCnHtml
        ? sanitizeHtml(rawBodyCnHtml, EMAIL_HTML_SANITIZE_OPTIONS)
        : "";

    return adminTransaction(uid, async (txn, callerSnap) => {
        const eventSnap = await txn.get(db.collection("upcomingEvents").doc(eventId));
        if (!eventSnap.exists) throw new HttpsError("not-found", "Event not found.");
        const templateRef = db.collection("upcomingEvents").doc(eventId)
            .collection("emailTemplate").doc("default");
        txn.set(templateRef, {
            subject, bodyHtml, bodyCnHtml,
            updatedAt: FieldValue.serverTimestamp(),
            updatedBy: uid,
        }, {merge: true});
        txn.set(db.collection("records").doc(), {
            type: "upcoming-event-email-template-update",
            performedBy: uid,
            performedByName: callerSnap.data()?.displayName ?? "",
            eventId,
            eventTitle: eventSnap.data()?.title ?? eventSnap.data()?.name ?? eventId,
            timestamp: FieldValue.serverTimestamp(),
            expiresAt: recordExpiresAt(),
        });
        return {saved: true};
    });
});

// Caps the per-call recipient fan-out (to + cc + bcc combined). Each mail doc
// becomes one Resend POST; one POST with many recipients still counts as one
// quota slot in computeTicketEmailQuota, so without this an admin could blast
// a hundred addresses on one slot. 25 covers the realistic "small group ping"
// case without inviting newsletter-style use.
const CUSTOM_EMAIL_MAX_RECIPIENTS = 25;

function validateEmailList(value: unknown, name: string, required: boolean): string[] {
    if (value === undefined || value === null) {
        if (required) throw new HttpsError("invalid-argument", `${name} is required.`);
        return [];
    }
    if (!Array.isArray(value)) {
        throw new HttpsError("invalid-argument", `${name} must be an array of emails.`);
    }
    if (required && value.length === 0) {
        throw new HttpsError("invalid-argument", `${name} is required.`);
    }
    const seen = new Set<string>();
    const out: string[] = [];
    for (const v of value) {
        const email = validateEmail(v, name);
        if (!seen.has(email)) {
            seen.add(email);
            out.push(email);
        }
    }
    return out;
}

export const sendCustomEmail = onCall({maxInstances: 5, memory: "256MiB"}, async (request) => {
    const uid = await requireAuth(request);
    await requireAdmin(uid);

    const input = request.data as {
        to?: unknown;
        cc?: unknown;
        bcc?: unknown;
        replyTo?: unknown;
        subject?: unknown;
        bodyHtml?: unknown;
    };

    const to = validateEmailList(input.to, "to", true);
    const cc = validateEmailList(input.cc, "cc", false);
    const bcc = validateEmailList(input.bcc, "bcc", false);
    const totalRecipients = to.length + cc.length + bcc.length;
    if (totalRecipients > CUSTOM_EMAIL_MAX_RECIPIENTS) {
        throw new HttpsError("invalid-argument",
            `Too many recipients (max ${CUSTOM_EMAIL_MAX_RECIPIENTS} across to/cc/bcc).`);
    }

    // Reply-To: client may override; otherwise fall back to the admin's auth
    // token email so replies don't dead-letter at the From mailbox.
    const replyToInput = input.replyTo;
    const replyTo = (replyToInput === undefined || replyToInput === null || replyToInput === "")
        ? (request.auth?.token.email ?? "")
        : validateEmail(replyToInput, "replyTo");

    // Strip control chars from subject — defense-in-depth against header
    // injection (nodemailer's encoder already guards, mirror tickets.ts).
    const subject = validateStr(input.subject, "subject", 500, true)
        .replace(/[\x00-\x1F\x7F]+/g, " ").trim();
    if (!subject) throw new HttpsError("invalid-argument", "subject is required.");

    const rawBodyHtml = validateStr(input.bodyHtml, "bodyHtml", 20000, true);
    const bodyHtml = sanitizeHtml(rawBodyHtml, EMAIL_HTML_SANITIZE_OPTIONS);
    if (!bodyHtml.trim()) {
        throw new HttpsError("invalid-argument", "bodyHtml is empty after sanitization.");
    }

    const {sentToday, dailyCap} = await computeTicketEmailQuota();
    if (sentToday >= dailyCap) {
        throw new HttpsError("resource-exhausted",
            "Daily Resend cap reached.", {code: "quota-exceeded"});
    }

    const callerSnap = await db.collection("users").doc(uid).get();
    const callerName = callerSnap.data()?.displayName ?? "";

    const mailDoc: Record<string, unknown> = {
        to,
        message: {subject, html: bodyHtml},
    };
    if (cc.length > 0) mailDoc.cc = cc;
    if (bcc.length > 0) mailDoc.bcc = bcc;
    if (replyTo) mailDoc.replyTo = replyTo;

    // Mail doc + audit record committed together so the quota record can't
    // drift from what actually got queued.
    const batch = db.batch();
    const mailRef = db.collection("mail").doc();
    const recordRef = db.collection("records").doc();
    batch.set(mailRef, mailDoc);
    batch.set(recordRef, {
        type: "custom-email-send",
        performedBy: uid,
        performedByName: callerName,
        targetEmail: to[0],
        sentCount: 1,
        recipientCount: totalRecipients,
        subject,
        replyTo,
        timestamp: FieldValue.serverTimestamp(),
        expiresAt: recordExpiresAt(),
    });
    await batch.commit();

    return {sent: true, recipientCount: totalRecipients};
});
