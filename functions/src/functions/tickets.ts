import sanitizeHtml from "sanitize-html";
import { HttpsError, onCall, onRequest } from "firebase-functions/v2/https";
import { FieldPath, FieldValue, Timestamp } from "firebase-admin/firestore";
import {
    ADMIN_GROUPS,
    adminTransaction,
    isStaffOrAbove,
    normalizeGroup,
    requireAdmin,
    requireAuth
} from "../utils/auth";
import { IMPORT_MAX_ROWS, PUBLIC_ORIGIN, RESEND_QUEUE_CAP, SEND_CHUNK_SIZE } from "../utils/config";
import { db } from "../utils/firebase";
import { syncProviderUsage } from "../utils/emailProvider";
import { isOnEventDay } from "../utils/eventDays";
import { commitInChunks } from "../utils/helpers";
import {
    computeEmailQuota,
    computeEmailQuotaInTxn,
    reserveQuotaInTxn,
    rollbackQuotaReservation,
} from "../utils/quota";
import { RESEND_API_KEY, type ResendEnvelope, ResendSendError, sendEmails } from "../utils/resendClient";
import { getScheduledMailQueueDepth } from "./scheduledMail";
import {
    EMAIL_RE,
    sanitizeDisplayText,
    validateBoolean,
    validateDocId,
    validateEmail,
    validateOptionalEmail,
    validateStr,
} from "../utils/validation";
import { accountByEmail, verifiedEmail } from "../utils/accountEmail";
import { contactEmailFor, EMAIL_HTML_SANITIZE_OPTIONS, readSavedTemplate } from "../utils/emailTemplate";
import { renderTicketEmail, ticketTemplateRef } from "../utils/ticketEmail";
import {
    countWalletPasses,
    revokeWalletPasses,
    WALLET_COLORS,
    WALLET_PASS_MAX_NOTES,
    walletPassesOnFor,
    walletPassFor,
    type WalletPassRefusal,
    walletPassSettingsRef,
    WALLETWALLET_API_KEY,
} from "../utils/walletPass";
import { recordDoc, type RecordFields, recordRef, type RecordType } from "../utils/records";
import {
    buildFreshTickets,
    creditedEmail,
    freshTicket,
    hometownAttendeeId,
    isApiOrder,
    isCheckedInWalkIn,
    isHometownTicketId,
    isScannedTicket,
    type NewTicket,
    ticketClaimUrl,
} from "../utils/tickets";

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

const TICKET_NOTES_MAX = 500;

/** A staff note on a ticket. Optional: empty for none. */
function validateTicketNotes(value: unknown): string {
    return sanitizeDisplayText(validateStr(value, "notes", TICKET_NOTES_MAX));
}

/** Staff anywhere, or the event's own staff: who may work its door and read its list. */
function worksEvent(caller: FirebaseFirestore.DocumentData, eventId: string): boolean {
    const eventStaff: string[] = caller.eventStaffEvents ?? [];
    return isStaffOrAbove(caller.group) || eventStaff.includes(eventId);
}

/**
 * Credits the one account registered to `email`, if any, with attending
 * `eventId`, as a scan does. Reads before it writes, so it goes before the
 * caller's own writes. Whether there was an account.
 */
async function creditAccountAttendance(
    txn: FirebaseFirestore.Transaction,
    email: string,
    eventId: string,
): Promise<boolean> {
    const account = await accountByEmail(email, txn);
    if (!account) return false;
    const attended: string[] = account.data().attendedEvents ?? [];
    if (!attended.includes(eventId)) {
        txn.update(account.ref, {attendedEvents: FieldValue.arrayUnion(eventId)});
    }
    return true;
}

/** A ticket let in at the door at `now` by `by`, and checked in to an account or not. */
function admitted(ticket: NewTicket, by: {uid: string; name: string}, now: Timestamp, checkedIn: boolean): NewTicket {
    return {
        ...ticket,
        redeemed: true,
        redeemedAt: now,
        redeemedBy: by.uid,
        redeemedByName: by.name,
        checkedIn,
        checkedInAt: checkedIn ? now : null,
    };
}

/**
 * The title of the upcoming event an import is for, once the caller is
 * confirmed as core staff or above, and the caller's name for its record.
 */
async function importTarget(uid: string, eventId: string): Promise<{eventTitle: string; callerName: string}> {
    return adminTransaction(uid, async (txn, callerSnap) => {
        const eventSnap = await txn.get(db.collection("upcomingEvents").doc(eventId));
        if (!eventSnap.exists) throw new HttpsError("not-found", "Event not found.");
        return {eventTitle: eventSnap.data()?.title ?? eventId, callerName: callerSnap.data()?.displayName ?? ""};
    });
}

// Ticket ids are UUIDs and event ids are doc ids, so both fit. The endpoint is
// public, so off-shape params are refused before any QR is generated for them.
const QR_PARAM_RE = /^[A-Za-z0-9_-]{1,128}$/;

export const serveTicketQr = onRequest({maxInstances: 10, memory: "256MiB"}, async (req, res) => {
    const {ticket: ticketId, event: eventId} = req.query;
    if (!ticketId || !eventId) {
        res.status(400).send("Missing ticket or event parameter");
        return;
    }
    if (typeof ticketId !== "string" || typeof eventId !== "string"
        || !QR_PARAM_RE.test(ticketId) || !QR_PARAM_RE.test(eventId)) {
        res.status(400).send("Invalid ticket or event parameter");
        return;
    }

    if (!PUBLIC_ORIGIN) {
        res.status(500).send("PUBLIC_ORIGIN is not configured");
        return;
    }

    try {
        const url = ticketClaimUrl(ticketId, eventId);
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

// What a ticket email's Add to Wallet opens when there's no pass to go to, by
// status, in both languages. The QR code in the email works either way.
const WALLET_PASS_REFUSALS: Record<WalletPassRefusal, {status: number; en: string; cn: string}> = {
    "off": {
        status: 503,
        en: "Wallet passes aren't available right now.",
        cn: "电子钱包票券暂不可用。"
    },
    "not-found": {
        status: 404,
        en: "We couldn't find this ticket.",
        cn: "找不到这张门票。"
    },
    "voided": {
        status: 410,
        en: "This ticket has been voided.",
        cn: "这张门票已作废。"
    },
    "ended": {
        status: 410,
        en: "This event has ended.",
        cn: "活动已结束。"
    },
    "ticket-limit": {
        status: 429,
        en: "This ticket has made as many wallet passes as it can today. Try again tomorrow.",
        cn: "这张门票今天生成钱包票券的次数已达上限，请明天再试。"
    },
    "month-limit": {
        status: 429,
        en: "Wallet passes are unavailable for the rest of this month.",
        cn: "本月电子钱包票券已不可用。"
    },
    "failed": {
        status: 502,
        en: "We couldn't make your wallet pass just now. Please try again in a moment.",
        cn: "暂时无法生成钱包票券，请稍后再试。"
    },
};

function walletPassRefusalPage(refusal: WalletPassRefusal): {status: number; html: string} {
    const {status, en, cn} = WALLET_PASS_REFUSALS[refusal];
    const fallback = ["voided", "ended", "not-found"].includes(refusal) ? ""
        : "<p>Your ticket's QR code in the email still works at the door.<br/>邮件中的门票二维码仍可正常入场。</p>";
    return {
        status,
        html: "<!doctype html><html><head><meta charset=\"utf-8\"/>" +
            "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\"/>" +
            "<meta name=\"robots\" content=\"noindex\"/><title>Add to Wallet</title></head>" +
            "<body style=\"font-family:system-ui,sans-serif;max-width:480px;margin:64px auto;padding:0 16px;" +
            "line-height:1.5;color:#222;background:#fff;text-align:center;\">" +
            `<p><strong>${en}</strong><br/>${cn}</p>${fallback}</body></html>`,
    };
}

/**
 * A ticket email's Add to Wallet: off to the ticket's pass, made the first time
 * (see walletPassFor), or a page saying why there's none.
 */
export const serveWalletPass = onRequest({
    maxInstances: 10,
    memory: "256MiB",
    secrets: [WALLETWALLET_API_KEY],
}, async (req, res) => {
    res.set("Cache-Control", "no-store");
    const {ticket: ticketId, event: eventId} = req.query;
    const result = typeof ticketId === "string" && typeof eventId === "string"
    && QR_PARAM_RE.test(ticketId) && QR_PARAM_RE.test(eventId)
        ? await walletPassFor(eventId, ticketId)
        : {refusal: "not-found" as const};
    if ("shareUrl" in result) {
        res.redirect(302, result.shareUrl);
        return;
    }
    const {status, html} = walletPassRefusalPage(result.refusal);
    res.status(status).type("html").send(html);
});

export const importEventAttendees = onCall({maxInstances: 10}, async (request) => {
    const uid = await requireAuth(request, "staff");

    const input = request.data as {eventId?: string; attendees?: unknown; onDuplicate?: string};
    const eventId = validateDocId(input.eventId, "eventId");
    if (!Array.isArray(input.attendees) || input.attendees.length === 0) {
        throw new HttpsError("invalid-argument", "attendees must be a non-empty array.");
    }
    if (input.attendees.length > IMPORT_MAX_ROWS) {
        throw new HttpsError("invalid-argument",
            `Too many attendees in a single import (max ${IMPORT_MAX_ROWS}).`);
    }

    // Validate + normalize + dedupe (later row wins)
    const normalized = new Map<string, {
        email: string;
        name: string;
        ticketCount: number;
        type: string;
        notes: string;
        timestamp?: Date
    }>();
    for (const row of input.attendees) {
        if (!row || typeof row !== "object") {
            throw new HttpsError("invalid-argument", "Each attendee row must be an object.");
        }
        const r = row as Record<string, unknown>;
        const email = validateEmail(r.email, "email");
        // Optional: a ticket only needs an email to reach someone.
        const name = sanitizeDisplayText(validateStr(r.name, "name", 100));
        const ticketCount = validateTicketCount(r.ticketCount);
        const type = validateTicketType(r.type);
        // Set by Add Attendee, which is one row; a file has no notes column.
        const notes = validateTicketNotes(r.notes);

        let timestamp: Date | undefined;
        if (r.timestamp && typeof r.timestamp === "string") {
            const parsed = new Date(r.timestamp);
            if (!isNaN(parsed.getTime())) timestamp = parsed;
        }

        normalized.set(email, {email, name, ticketCount, type, notes, timestamp});
    }

    // Only the admin and event checks are transactional; the import itself is
    // too big for the 500-op limit, so it runs as batched commits below.
    const {eventTitle, callerName} = await importTarget(uid, eventId);

    const attendeesCol = db.collection("upcomingEvents").doc(eventId).collection("attendees");

    // Chunked for the `in` operator's 30-value limit.
    const emails = Array.from(normalized.keys());
    const existingByEmail = new Map<string, FirebaseFirestore.QueryDocumentSnapshot>();
    for (let i = 0; i < emails.length; i += 30) {
        const chunk = emails.slice(i, i + 30);
        const snap = await attendeesCol.where("email", "in", chunk).get();
        for (const doc of snap.docs) {
            // A HomeTown ticket is kept by its number and an API order by its
            // order, neither re-issued by email.
            if (doc.data().source === "hometown" || isApiOrder(doc.data())) continue;
            const email = doc.data().email;
            if (typeof email === "string") existingByEmail.set(email, doc);
        }
    }

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

        const {tickets, ticketIds} = buildFreshTickets(row.ticketCount, row.type, row.notes);
        const now = FieldValue.serverTimestamp();
        const customDate = row.timestamp ? Timestamp.fromDate(row.timestamp) : undefined;

        // A row's own timestamp stands in for both dates. Without one, a new record
        // is stamped now and a replaced one keeps its createdAt.

        if (existing) {
            replacedCount++;
            const dataToUpdate: any = {
                email: row.email,
                ticketCount: row.ticketCount,
                tickets,
                ticketIds,
                emailSent: false,
                emailSentAt: null,
                updatedAt: customDate || now,
            };
            // A blank name keeps the one on file.
            if (row.name) dataToUpdate.name = row.name;
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

/**
 * Someone added at the door, on the event's days only, by anyone who may scan
 * there: core staff, the staff group, or the event's own staff. The email is
 * optional here and nowhere else, since without one nobody can be sent their
 * tickets; with `checkIn` the tickets are redeemed on the spot, crediting the
 * account as a scan would. An email already on the list is refused rather than re-issued,
 * which would void the tickets they were sent.
 */
export const addWalkInAttendee = onCall({maxInstances: 10}, async (request) => {
    const uid = await requireAuth(request, "staff");

    const input = request.data as {
        eventId?: string;
        email?: unknown;
        name?: unknown;
        ticketCount?: unknown;
        type?: unknown;
        notes?: unknown;
        checkIn?: unknown;
    };
    const eventId = validateDocId(input.eventId, "eventId");
    const email = validateOptionalEmail(input.email, "email");
    const name = sanitizeDisplayText(validateStr(input.name, "name", 100));
    const ticketCount = validateTicketCount(input.ticketCount);
    const type = validateTicketType(input.type);
    const notes = validateTicketNotes(input.notes);
    const checkIn = input.checkIn === true;

    return db.runTransaction(async (txn) => {
        // Whoever works the door, as redeemTicket lets scan: core staff, the
        // staff group and the event's own staff, all on the event's days only.
        const callerData = (await txn.get(db.collection("users").doc(uid))).data() ?? {};
        if (!worksEvent(callerData, eventId)) {
            throw new HttpsError("permission-denied", "Not authorized to add walk-ins for this event.",
                {code: "not-authorized"});
        }

        const eventRef = db.collection("upcomingEvents").doc(eventId);
        const attendeesCol = eventRef.collection("attendees");
        const eventSnap = await txn.get(eventRef);
        // An archived event's tickets are read-only; see archiveUpcomingEvent.
        if (!eventSnap.exists) throw new HttpsError("not-found", "Event not found.");

        const now = Timestamp.now();
        if (!isOnEventDay(eventSnap.data()?.startAt, eventSnap.data()?.endAt, now.toMillis())) {
            throw new HttpsError("failed-precondition", "Walk-ins can only be added on the day of the event.",
                {code: "not-event-day"});
        }

        // Every read before the first write.
        if (email) {
            const existing = await txn.get(attendeesCol.where("email", "==", email).limit(1));
            if (!existing.empty) {
                throw new HttpsError("already-exists", "An attendee with this email already exists.",
                    {code: "attendee-exists"});
            }
        }
        const userCheckedIn = checkIn && await creditAccountAttendance(txn, email, eventId);

        const callerName: string = callerData.displayName ?? "";
        const {tickets, ticketIds} = buildFreshTickets(ticketCount, type, notes);
        const issued = checkIn
            ? tickets.map(t => admitted(t, {uid, name: callerName}, now, userCheckedIn))
            : tickets;

        const attendeeRef = attendeesCol.doc();
        txn.set(attendeeRef, {
            email,
            name,
            ticketCount,
            tickets: issued,
            ticketIds,
            walkIn: true,
            // Without an address there's nothing to send, which also keeps it out
            // of the unsent drain.
            emailSent: !email,
            emailSentAt: null,
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
        });
        txn.set(recordRef(), recordDoc("ticket-walk-in", {
            performedBy: uid,
            performedByName: callerName,
            eventId,
            eventTitle: eventSnap.data()?.title ?? eventId,
            targetEmail: email,
            targetName: name,
            ticketCount,
            checkedIn: checkIn,
        }));

        return {attendeeId: attendeeRef.id, checkedIn: checkIn, userCheckedIn};
    });
});

interface HometownRow {
    ticketId: string;
    email: string;
    name: string;
    type: string;
    orderId: string;
}

/** Rows a HomeTown import works through at once, each its own transaction. */
const HOMETOWN_IMPORT_CONCURRENCY = 20;

/** Ticket numbers one import may name as the whole file, for flagging what's missing. */
const HOMETOWN_COMPLETE_MAX = 20_000;

/** Whether a ticket on file differs from its row in HomeTown's export. */
function hometownDetailsDiffer(row: HometownRow, data: FirebaseFirestore.DocumentData): boolean {
    return row.name !== (data.name ?? "")
        || row.email !== (data.email ?? "")
        || row.orderId !== (data.hometownOrderId ?? "")
        || row.type !== ((data.tickets?.[0]?.type as string | undefined) ?? "normal");
}

type HometownOutcome = "added" | "confirmed" | "updated" | "skipped";

/**
 * Tickets sold through the school's HomeTown box office, from its guest list
 * export: one attendee doc per ticket, named for its number (see
 * hometownAttendeeId), so the number is what every import matches on. A newer
 * export imports over an older one at any time, during the event too. One
 * admitted at the door while missing from the list (see redeemTicket) gets its
 * buyer filled in and keeps its admission.
 *
 * Otherwise a ticket already here is only marked seen, unless `updateExisting`
 * takes the export as the truth for it: changed buyer details and type are
 * copied over, never its check-in or void. With that, `completeTicketIds` (the
 * whole file's numbers, sent with its last chunk) flags a listed ticket missing
 * from the file as missingFromHometown, refunded or transferred most likely, for
 * an admin to review; flagged rather than voided, since a partial export would
 * otherwise void real tickets. A flagged ticket back in any later export is
 * unflagged.
 *
 * Every chunk of one file passes the same `importId`, so the file leaves one
 * record however many chunks it takes.
 *
 * They're marked sent: HomeTown emailed the ticket, and ours would be a second,
 * different QR.
 */
export const importHometownTickets = onCall({maxInstances: 10, timeoutSeconds: 300}, async (request) => {
    const uid = await requireAuth(request, "hometown-import");

    const input = request.data as {
        eventId?: string;
        tickets?: unknown;
        updateExisting?: unknown;
        completeTicketIds?: unknown;
        importId?: unknown;
    };
    const eventId = validateDocId(input.eventId, "eventId");
    const importId = input.importId == null ? null : validateDocId(input.importId, "importId");
    if (!Array.isArray(input.tickets) || input.tickets.length === 0) {
        throw new HttpsError("invalid-argument", "tickets must be a non-empty array.");
    }
    if (input.tickets.length > IMPORT_MAX_ROWS) {
        throw new HttpsError("invalid-argument",
            `Too many tickets in a single import (max ${IMPORT_MAX_ROWS}).`);
    }

    // Later row wins, as in importEventAttendees.
    const rows = new Map<string, HometownRow>();
    for (const row of input.tickets) {
        if (!row || typeof row !== "object") {
            throw new HttpsError("invalid-argument", "Each ticket row must be an object.");
        }
        const r = row as Record<string, unknown>;
        const ticketId = validateStr(r.ticketId, "ticketId", 12, true);
        if (!isHometownTicketId(ticketId)) {
            throw new HttpsError("invalid-argument", `Not a HomeTown ticket number: ${ticketId}`);
        }
        // A box office sale may have no email; the ticket still gets in.
        const email = validateOptionalEmail(r.email, "email");
        const name = sanitizeDisplayText(validateStr(r.name, "name", 100));
        const type = validateTicketType(r.type);
        const orderId = sanitizeDisplayText(validateStr(r.orderId, "orderId", 32));
        rows.set(ticketId, {ticketId, email, name, type, orderId});
    }

    const updateExisting = input.updateExisting === true;
    let complete: Set<string> | null = null;
    if (updateExisting && input.completeTicketIds != null) {
        if (!Array.isArray(input.completeTicketIds) || input.completeTicketIds.length > HOMETOWN_COMPLETE_MAX) {
            throw new HttpsError("invalid-argument",
                `completeTicketIds must be an array of at most ${HOMETOWN_COMPLETE_MAX} ticket numbers.`);
        }
        complete = new Set(rows.keys());
        for (const id of input.completeTicketIds) {
            if (typeof id !== "string" || !isHometownTicketId(id)) {
                throw new HttpsError("invalid-argument", `Not a HomeTown ticket number: ${String(id)}`);
            }
            complete.add(id);
        }
    }

    const {eventTitle, callerName} = await importTarget(uid, eventId);

    const eventRef = db.collection("upcomingEvents").doc(eventId);
    const attendeesCol = eventRef.collection("attendees");
    // When each ticket last appeared in an export, for tracing a flag.
    const seenAt = Timestamp.now();

    // Most of a re-import is already here, so one read pass sorts the rows: new
    // and unlisted ones go through importRow, and when updating, changed ones
    // through updateRow. The rest are only marked seen, which also unflags one
    // an earlier export left out.
    const all = Array.from(rows.values());
    const pending: HometownRow[] = [];
    const changed: HometownRow[] = [];
    const seenOnly: FirebaseFirestore.DocumentReference[] = [];
    let restoredCount = 0;
    for (let i = 0; i < all.length; i += 100) {
        const chunk = all.slice(i, i + 100);
        const snaps = await db.getAll(...chunk.map(r => attendeesCol.doc(hometownAttendeeId(r.ticketId))));
        snaps.forEach((snap, j) => {
            const data = snap.data();
            if (!data || data.unlisted === true) {
                pending.push(chunk[j]);
                return;
            }
            if (data.missingFromHometown === true) restoredCount++;
            if (updateExisting && hometownDetailsDiffer(chunk[j], data)) changed.push(chunk[j]);
            else seenOnly.push(snap.ref);
        });
    }

    // Credits the buyer when an export supplies or changes the email on a
    // ticket that was already scanned.
    const creditScannedBuyer = async (
        txn: FirebaseFirestore.Transaction,
        email: string,
        prevEmail: string,
        tickets: NewTicket[],
    ): Promise<boolean> => {
        if (email === prevEmail || !tickets.some(isScannedTicket)) return false;
        return creditAccountAttendance(txn, email, eventId);
    };

    // Copies a row's buyer and type onto a ticket on file, along with `fields`.
    const applyRow = async (
        txn: FirebaseFirestore.Transaction,
        ref: FirebaseFirestore.DocumentReference,
        row: HometownRow,
        data: FirebaseFirestore.DocumentData,
        fields: Record<string, FieldValue>,
    ): Promise<void> => {
        const tickets = (data.tickets ?? []) as NewTicket[];
        const credited = await creditScannedBuyer(txn, row.email, data.email ?? "", tickets);
        txn.update(ref, {
            email: row.email,
            name: row.name,
            hometownOrderId: row.orderId,
            tickets: tickets.map(t => ({
                ...t,
                type: row.type,
                ...(credited && isScannedTicket(t) ? {checkedIn: true, checkedInAt: t.redeemedAt} : {}),
            })),
            hometownSeenAt: seenAt,
            updatedAt: FieldValue.serverTimestamp(),
            ...fields,
        });
    };

    // Re-read in every row's transaction, so once an archive deletes the event
    // the rest of the import refuses rather than creating tickets under it.
    const readTicket = async (txn: FirebaseFirestore.Transaction, ref: FirebaseFirestore.DocumentReference) => {
        const [eventSnap, snap] = await Promise.all([txn.get(eventRef), txn.get(ref)]);
        if (!eventSnap.exists) throw new HttpsError("not-found", "Event not found.");
        return snap;
    };

    // Each its own transaction, since a door may be admitting the same ticket
    // right now and a blind write would undo that admission.
    const importRow = (row: HometownRow) => db.runTransaction(async (txn): Promise<HometownOutcome> => {
        const ref = attendeesCol.doc(hometownAttendeeId(row.ticketId));
        const snap = await readTicket(txn, ref);
        if (!snap.exists) {
            txn.create(ref, {
                email: row.email,
                name: row.name,
                ticketCount: 1,
                tickets: [freshTicket(row.ticketId, row.type)],
                ticketIds: [row.ticketId],
                source: "hometown",
                hometownOrderId: row.orderId,
                hometownSeenAt: seenAt,
                emailSent: true,
                emailSentAt: null,
                createdAt: FieldValue.serverTimestamp(),
                updatedAt: FieldValue.serverTimestamp(),
            });
            return "added";
        }
        const data = snap.data()!;
        if (data.unlisted !== true) return "skipped";
        await applyRow(txn, ref, row, data, {unlisted: FieldValue.delete()});
        return "confirmed";
    });

    // A transaction too: the type sits in the tickets array a scan rewrites.
    const updateRow = (row: HometownRow) => db.runTransaction(async (txn): Promise<HometownOutcome> => {
        const ref = attendeesCol.doc(hometownAttendeeId(row.ticketId));
        const data = (await readTicket(txn, ref)).data();
        // Removed since the read pass: leave it gone.
        if (!data) return "skipped";
        await applyRow(txn, ref, row, data, {missingFromHometown: FieldValue.delete()});
        return "updated";
    });

    const work = [...pending.map(row => () => importRow(row)), ...changed.map(row => () => updateRow(row))];
    const outcomes: HometownOutcome[] = [];
    for (let i = 0; i < work.length; i += HOMETOWN_IMPORT_CONCURRENCY) {
        outcomes.push(...await Promise.all(work.slice(i, i + HOMETOWN_IMPORT_CONCURRENCY).map(run => run())));
    }
    const count = (outcome: HometownOutcome) => outcomes.filter(o => o === outcome).length;

    // Field writes alone, which can't undo a scan. Updates, unlike the
    // transactions' creates, can't leave a ticket behind under an archived event.
    if (seenOnly.length > 0) {
        await commitInChunks(seenOnly.map(ref => (b: FirebaseFirestore.WriteBatch) =>
            b.update(ref, {hometownSeenAt: seenAt, missingFromHometown: FieldValue.delete()})));
    }

    let missingCount = 0;
    if (complete) {
        const onFile = await attendeesCol.where("source", "==", "hometown").get();
        const toFlag: FirebaseFirestore.DocumentReference[] = [];
        for (const doc of onFile.docs) {
            const data = doc.data();
            // An unlisted one was never on HomeTown's list, so its absence says nothing.
            if (data.unlisted === true || complete.has(data.ticketIds?.[0] ?? "")) continue;
            missingCount++;
            if (data.missingFromHometown !== true) toFlag.push(doc.ref);
        }
        if (toFlag.length > 0) {
            await commitInChunks(toFlag.map(ref => (b: FirebaseFirestore.WriteBatch) =>
                b.update(ref, {missingFromHometown: true})));
        }
    }

    // Each chunk adds its counts to the file's record, and the one carrying the
    // whole file's numbers sets how many it left out.
    await recordRef(importId ? `hometown-import-${importId}` : undefined).set({
        ...recordDoc("hometown-import", {
            performedBy: uid,
            performedByName: callerName,
            eventId,
            eventTitle,
        }),
        addedCount: FieldValue.increment(count("added")),
        confirmedCount: FieldValue.increment(count("confirmed")),
        ...(updateExisting ? {updatedCount: FieldValue.increment(count("updated"))} : {}),
        ...(complete ? {missingCount} : {}),
    }, {merge: true});

    return {
        added: count("added"),
        confirmed: count("confirmed"),
        updated: count("updated"),
        skipped: rows.size - count("added") - count("confirmed") - count("updated"),
        missing: missingCount,
        restored: restoredCount,
    };
});

/** The earliest purchase time an order list may give, to catch a misread date. */
const HOMETOWN_ORDER_TIME_MIN = Date.UTC(2020, 0, 1);

/** How far ahead of the server's clock a purchase time may be, for clock skew. */
const HOMETOWN_ORDER_TIME_SKEW_MS = 24 * 60 * 60 * 1000;

/**
 * When each HomeTown ticket was bought, from HomeTown's order list export (one
 * row per order, which the guest list lacks): every ticket on file whose
 * hometownOrderId is a listed order takes that order's time as its createdAt,
 * and each of its tickets' too, so the sales timeline, the attendee list's
 * order and the CSV export follow purchases rather than imports. Tickets of
 * orders the list leaves out keep their times.
 *
 * Every chunk of one file passes the same `syncId`, so the file leaves one
 * record however many chunks it takes.
 */
export const syncHometownOrderTimes = onCall({maxInstances: 10, timeoutSeconds: 300}, async (request) => {
    const uid = await requireAuth(request, "hometown-import");

    const input = request.data as {eventId?: string; orders?: unknown; syncId?: unknown};
    const eventId = validateDocId(input.eventId, "eventId");
    const syncId = input.syncId == null ? null : validateDocId(input.syncId, "syncId");
    if (!Array.isArray(input.orders) || input.orders.length === 0) {
        throw new HttpsError("invalid-argument", "orders must be a non-empty array.");
    }
    if (input.orders.length > IMPORT_MAX_ROWS) {
        throw new HttpsError("invalid-argument", `Too many orders in a single sync (max ${IMPORT_MAX_ROWS}).`);
    }

    const latest = Date.now() + HOMETOWN_ORDER_TIME_SKEW_MS;
    const times = new Map<string, Timestamp>();
    for (const row of input.orders) {
        if (!row || typeof row !== "object") {
            throw new HttpsError("invalid-argument", "Each order row must be an object.");
        }
        const r = row as Record<string, unknown>;
        // Cleaned as importHometownTickets cleans it, so the two match.
        const orderId = sanitizeDisplayText(validateStr(r.orderId, "orderId", 32, true));
        const ms = typeof r.orderedAt === "string" ? Date.parse(r.orderedAt) : NaN;
        if (!(ms >= HOMETOWN_ORDER_TIME_MIN && ms <= latest)) {
            throw new HttpsError("invalid-argument", `Order ${orderId} has an invalid purchase time.`);
        }
        times.set(orderId, Timestamp.fromMillis(ms));
    }

    const {eventTitle, callerName} = await importTarget(uid, eventId);

    const eventRef = db.collection("upcomingEvents").doc(eventId);
    const attendeesCol = eventRef.collection("attendees");

    const timeDiffers = (data: FirebaseFirestore.DocumentData, time: Timestamp) =>
        !(data.createdAt instanceof Timestamp && data.createdAt.isEqual(time))
        || ((data.tickets ?? []) as NewTicket[]).some(t => !(t.createdAt instanceof Timestamp && t.createdAt.isEqual(time)));

    const onFile = await attendeesCol.where("source", "==", "hometown").get();
    const matched = new Set<string>();
    const pending: FirebaseFirestore.DocumentReference[] = [];
    let matchedTickets = 0;
    for (const doc of onFile.docs) {
        const data = doc.data();
        const time = times.get(data.hometownOrderId ?? "");
        if (!time) continue;
        matched.add(data.hometownOrderId);
        matchedTickets++;
        if (timeDiffers(data, time)) pending.push(doc.ref);
    }

    // A transaction each, since a door may be admitting the ticket right now and
    // the times sit in the tickets array a scan rewrites.
    const syncRow = (ref: FirebaseFirestore.DocumentReference) => db.runTransaction(async (txn) => {
        const [eventSnap, snap] = await Promise.all([txn.get(eventRef), txn.get(ref)]);
        if (!eventSnap.exists) throw new HttpsError("not-found", "Event not found.");
        const data = snap.data();
        const time = times.get(data?.hometownOrderId ?? "");
        // Removed or moved to another order since the read pass: leave it.
        if (!data || !time || !timeDiffers(data, time)) return false;
        txn.update(ref, {
            createdAt: time,
            tickets: ((data.tickets ?? []) as NewTicket[]).map(t => ({...t, createdAt: time})),
            updatedAt: FieldValue.serverTimestamp(),
        });
        return true;
    });

    let synced = 0;
    for (let i = 0; i < pending.length; i += HOMETOWN_IMPORT_CONCURRENCY) {
        const results = await Promise.all(pending.slice(i, i + HOMETOWN_IMPORT_CONCURRENCY).map(syncRow));
        synced += results.filter(Boolean).length;
    }

    await recordRef(syncId ? `hometown-order-times-${syncId}` : undefined).set({
        ...recordDoc("hometown-order-times", {
            performedBy: uid,
            performedByName: callerName,
            eventId,
            eventTitle,
        }),
        syncedCount: FieldValue.increment(synced),
        unmatchedCount: FieldValue.increment(times.size - matched.size),
    }, {merge: true});

    return {
        synced,
        unchanged: matchedTickets - synced,
        unmatched: times.size - matched.size,
    };
});

/**
 * Whether a HomeTown ticket missing from the imported list is let in, with a
 * warning to the scanner, and recorded so a second scan of it is refused. Off
 * unless an admin turns it on, since a fake ticket gets in the same way.
 *
 * Kept in the event's settings subcollection, which only staff read: the event
 * doc is public once published, and this says which doors a fake would pass.
 */
export const setHometownAdmitUnlisted = onCall({maxInstances: 10}, async (request) => {
    const uid = await requireAuth(request, "staff");

    const input = request.data as {eventId?: string; enabled?: unknown};
    const eventId = validateDocId(input.eventId, "eventId");
    const enabled = validateBoolean(input.enabled, "enabled");

    return adminTransaction(uid, async (txn, callerSnap) => {
        const eventRef = db.collection("upcomingEvents").doc(eventId);
        const eventSnap = await txn.get(eventRef);
        // An archived event's tickets are read-only; see archiveUpcomingEvent.
        if (!eventSnap.exists) throw new HttpsError("not-found", "Event not found.");

        txn.set(eventRef.collection("settings").doc("hometown"), {
            admitUnlisted: enabled,
            updatedAt: FieldValue.serverTimestamp(),
            updatedBy: uid,
        }, {merge: true});
        txn.set(recordRef(), recordDoc("hometown-admit-unlisted", {
            performedBy: uid,
            performedByName: callerSnap.data()?.displayName ?? "",
            eventId,
            eventTitle: eventSnap.data()?.title ?? eventId,
            enabled,
        }));
        return {enabled};
    });
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
 * Every ticket the caller holds for an event that hasn't ended yet. Not an
 * order bought in a seller's app, which its buyer holds there whatever email
 * it went to (see creditedEmail).
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
    const email = verifiedEmail(request.auth!.token);
    if (!email) return {events: []};

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

        // One doc per HomeTown ticket, or per imported email.
        const tickets: HeldTicket[] = [];
        for (const doc of attendeeSnap.docs) {
            if (isApiOrder(doc.data())) continue;
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
 * It matches as the scanner does, on the lowercased address, and leaves out an
 * address more than one account holds, which check-in credits to neither (see
 * utils/accountEmail.ts), so staff see what check-in will actually find.
 *
 * Staff and above get who the account is; event staff only get whether there is
 * one.
 */
export const getAttendeeAccounts = onCall({maxInstances: 10}, async (request) => {
    const uid = await requireAuth(request, "staff");

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
    const callerData = (await db.collection("users").doc(uid).get()).data() ?? {};
    if (!worksEvent(callerData, eventId)) {
        throw new HttpsError("permission-denied", "Not authorized to read this event's attendees.");
    }
    const namesAccounts = isStaffOrAbove(callerData.group);

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

    const holders = new Map<string, FirebaseFirestore.QueryDocumentSnapshot[]>();
    for (const doc of snaps.flatMap(snap => snap.docs)) {
        const email = doc.get("email");
        if (typeof email !== "string") continue;
        holders.set(email, [...holders.get(email) ?? [], doc]);
    }

    const accounts: {email: string; uid?: string; displayName?: string}[] = [];
    for (const [email, docs] of holders) {
        if (docs.length !== 1) continue;
        accounts.push(namesAccounts
            ? {email, uid: docs[0].id, displayName: docs[0].get("displayName") ?? ""}
            : {email});
    }

    return {accounts};
});
/**
 * How long after admitting a ticket the same scanner reading it again is told it
 * succeeded, so a ticket still held to the camera doesn't flip to "already
 * redeemed". Timed from the admission.
 */
const REDEEM_GRACE_PERIOD_MS = 15_000;

export const redeemTicket = onCall({maxInstances: 20}, async (request) => {
    const uid = await requireAuth(request, "scan");

    const input = request.data as {eventId?: string; ticketId?: string};
    const eventId = validateDocId(input.eventId, "eventId");
    const ticketId = validateStr(input.ticketId, "ticketId", 128, true);

    const attendeesCol = db.collection("upcomingEvents").doc(eventId).collection("attendees");

    return db.runTransaction(async (txn) => {
        const callerData = (await txn.get(db.collection("users").doc(uid))).data() ?? {};
        const isCoreStaffOrAbove = ADMIN_GROUPS.includes(normalizeGroup(callerData.group));
        if (!worksEvent(callerData, eventId)) {
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

        const callerName: string = callerData.displayName ?? "";
        const eventTitle: string = eventSnap.data()?.title ?? "";

        // A HomeTown ticket is read by its doc, which also locks the number for
        // the unlisted admission below.
        const hometown = isHometownTicketId(ticketId);
        let attendeeDoc: FirebaseFirestore.DocumentSnapshot | null;
        if (hometown) {
            const snap = await txn.get(attendeesCol.doc(hometownAttendeeId(ticketId)));
            attendeeDoc = snap.exists ? snap : null;
        } else {
            const attendeeQuery = await txn.get(
                attendeesCol.where("ticketIds", "array-contains", ticketId).limit(1)
            );
            attendeeDoc = attendeeQuery.empty ? null : attendeeQuery.docs[0];
        }

        const refuseUnlisted = async () => {
            const settingsSnap = await txn.get(eventSnap.ref.collection("settings").doc("hometown"));
            if (settingsSnap.data()?.admitUnlisted !== true) {
                throw new HttpsError("not-found", "HomeTown ticket is not on the imported list.",
                    {code: "hometown-unlisted"});
            }
        };

        if (!attendeeDoc && hometown) {
            // The QR names no event, so a number this event doesn't know may be a
            // real ticket for another show. One on another event's list is
            // refused, whatever the setting.
            const elsewhere = await txn.get(db.collectionGroup("attendees")
                .where("ticketIds", "array-contains", ticketId).limit(5));
            const listedElsewhere = elsewhere.docs.find(d =>
                d.ref.parent.path !== attendeesCol.path && d.data().unlisted !== true);
            if (listedElsewhere) {
                const otherEventSnap = await txn.get(listedElsewhere.ref.parent.parent!);
                throw new HttpsError("failed-precondition", "This HomeTown ticket is for another event.",
                    {code: "hometown-other-event", eventTitle: otherEventSnap.data()?.title ?? ""});
            }
            await refuseUnlisted();

            // Bought after the last import, or fake: let in with a warning, and
            // recorded so the same number is refused next time. An import that
            // later lists it fills in the buyer.
            txn.create(attendeesCol.doc(hometownAttendeeId(ticketId)), {
                email: "",
                name: "",
                ticketCount: 1,
                tickets: [admitted(freshTicket(ticketId, "normal"), {uid, name: callerName}, now, false)],
                ticketIds: [ticketId],
                source: "hometown",
                hometownOrderId: "",
                unlisted: true,
                emailSent: true,
                emailSentAt: null,
                createdAt: FieldValue.serverTimestamp(),
                updatedAt: FieldValue.serverTimestamp(),
            });
            return {
                success: true,
                hometown: true,
                unlisted: true,
                missingFromHometown: false,
                attendeeName: "",
                attendeeEmail: "",
                eventTitle,
                ticketIndex: 0,
                ticketType: "normal",
                notes: "",
                userCheckedIn: false,
                graceRemainingMs: REDEEM_GRACE_PERIOD_MS,
            };
        }
        if (!attendeeDoc) {
            throw new HttpsError("not-found", "Ticket not found.", {code: "invalid"});
        }
        const attendeeData = attendeeDoc.data() ?? {};
        const tickets = [...(attendeeData.tickets ?? [])] as NewTicket[];
        const idx = tickets.findIndex(t => t.ticketId === ticketId);
        if (idx < 0) {
            throw new HttpsError("not-found", "Ticket not found.", {code: "invalid"});
        }
        const ticket = tickets[idx];

        if (ticket.voided) {
            throw new HttpsError("failed-precondition", "This ticket has been voided.",
                {code: "voided"});
        }

        const attendeeEmail: string = attendeeData.email ?? "";
        const attendeeName: string = attendeeData.name ?? "";
        // So the scanner can say a HomeTown ticket was only ever let in unlisted,
        // or has dropped out of HomeTown's latest export.
        const source = {
            hometown,
            unlisted: attendeeData.unlisted === true,
            missingFromHometown: attendeeData.missingFromHometown === true,
        };

        if (ticket.redeemed) {
            const sinceRedeemedMs = now.toMillis() - (ticket.redeemedAt?.toMillis?.() ?? 0);
            const isWithinGracePeriod = sinceRedeemedMs < REDEEM_GRACE_PERIOD_MS;
            const isSameScanner = ticket.redeemedBy === uid;

            if (!isWithinGracePeriod || !isSameScanner) {
                return {
                    alreadyRedeemed: true,
                    ...source,
                    attendeeName,
                    attendeeEmail,
                    eventTitle,
                    ticketIndex: idx,
                    ticketType: ticket.type || "normal",
                    notes: ticket.notes ?? "",
                    redeemedBy: ticket.redeemedByName,
                    redeemedAt: ticket.redeemedAt?.toDate?.()?.toISOString() ?? null,
                };
            }

            // The same scanner again moments later: report the earlier admission and
            // write nothing, since rewriting redeemedAt would restart the window on
            // every rescan.
            return {
                success: true,
                ...source,
                attendeeName,
                attendeeEmail,
                eventTitle,
                ticketIndex: idx,
                ticketType: ticket.type || "normal",
                notes: ticket.notes ?? "",
                userCheckedIn: ticket.checkedIn === true,
                graceRemainingMs: Math.min(REDEEM_GRACE_PERIOD_MS, REDEEM_GRACE_PERIOD_MS - sinceRedeemedMs),
            };
        }

        // Only let in unlisted while the switch is on, even once on file: a
        // ticket reset or unvoided after it went off has still never been listed.
        if (source.unlisted) await refuseUnlisted();

        // Try to link to a registered user by email; a walk-in may have none,
        // and an app order never does (see creditedEmail).
        const userCheckedIn = await creditAccountAttendance(txn, creditedEmail(attendeeData), eventId);
        tickets[idx] = admitted(ticket, {uid, name: callerName}, now, userCheckedIn);

        txn.update(attendeeDoc.ref, {
            tickets,
            updatedAt: FieldValue.serverTimestamp(),
        });

        return {
            success: true,
            ...source,
            attendeeName,
            attendeeEmail,
            eventTitle,
            ticketIndex: idx,
            ticketType: ticket.type || "normal",
            notes: ticket.notes ?? "",
            userCheckedIn,
            graceRemainingMs: REDEEM_GRACE_PERIOD_MS,
        };
    });
});

/** How a record names an attendee: by its HomeTown number when it has no name or email. */
function attendeeRecordName(data: FirebaseFirestore.DocumentData): string {
    if (data.name) return data.name as string;
    if (!data.email && data.source === "hometown") return `HomeTown #${data.ticketIds?.[0] ?? ""}`;
    return "";
}

/** An attendee under an upcoming event, read in `txn`, with the event's title for records. */
async function readAttendee(txn: FirebaseFirestore.Transaction, eventId: string, attendeeId: string) {
    const eventRef = db.collection("upcomingEvents").doc(eventId);
    const ref = eventRef.collection("attendees").doc(attendeeId);
    const [eventSnap, snap] = await Promise.all([txn.get(eventRef), txn.get(ref)]);
    // An archived event's tickets are read-only; see archiveUpcomingEvent.
    if (!eventSnap.exists) throw new HttpsError("not-found", "Event not found.");
    if (!snap.exists) throw new HttpsError("not-found", "Attendee not found.");
    return {ref, data: snap.data()!, eventTitle: (eventSnap.data()?.title ?? eventId) as string};
}

/** Which ticket an edit from the admin panel is for. */
interface TicketTarget {
    eventId: string;
    attendeeId: string;
    ticketId: string;
}

function ticketTarget(raw: unknown): TicketTarget {
    const input = raw as {eventId?: string; attendeeId?: string; ticketId?: string};
    return {
        eventId: validateDocId(input.eventId, "eventId"),
        attendeeId: validateDocId(input.attendeeId, "attendeeId"),
        ticketId: validateStr(input.ticketId, "ticketId", 128, true),
    };
}

/**
 * What an edit makes of one ticket: the ticket as it now stands and anything
 * its record adds, or just a reply when nothing changes.
 */
interface TicketEdit<R> {
    reply: R;
    ticket?: NewTicket;
    record?: RecordFields;
}

/**
 * Changes one ticket from the admin panel, as core staff and above: reads the
 * attendee holding it, applies `edit`, and records the change as
 * `recordType`. An edit that gives back no ticket writes nothing.
 */
async function editTicket<R>(
    uid: string,
    {eventId, attendeeId, ticketId}: TicketTarget,
    recordType: RecordType,
    edit: (ticket: NewTicket, attendee: {
        txn: FirebaseFirestore.Transaction;
        data: FirebaseFirestore.DocumentData;
        callerName: string;
    }) => TicketEdit<R> | Promise<TicketEdit<R>>,
): Promise<R> {
    return adminTransaction(uid, async (txn, callerSnap) => {
        const {ref, data, eventTitle} = await readAttendee(txn, eventId, attendeeId);
        const tickets = [...(data.tickets ?? [])] as NewTicket[];
        const idx = tickets.findIndex(t => t.ticketId === ticketId);
        if (idx < 0) throw new HttpsError("not-found", "Ticket not found.");

        const callerName: string = callerSnap.data()?.displayName ?? "";
        const {reply, ticket, record} = await edit(tickets[idx], {txn, data, callerName});
        if (!ticket) return reply;

        tickets[idx] = ticket;
        txn.update(ref, {tickets, updatedAt: FieldValue.serverTimestamp()});
        txn.set(recordRef(), recordDoc(recordType, {
            performedBy: uid,
            performedByName: callerName,
            eventId,
            eventTitle,
            targetEmail: data.email ?? "",
            targetName: attendeeRecordName(data),
            ...record,
        }));
        return reply;
    });
}

export const voidTicket = onCall({maxInstances: 10, secrets: [WALLETWALLET_API_KEY]}, async (request) => {
    const uid = await requireAuth(request, "staff");
    const target = ticketTarget(request.data);
    let walletPasses: unknown;
    const reply = await editTicket(uid, target, "ticket-void", (ticket, {data}) => {
        walletPasses = data.walletPasses;
        return {ticket: {...ticket, voided: true}, reply: {voided: true}};
    });
    // Its wallet pass too, once the void is in. Forgotten only once revoked,
    // since a revoked pass can't be restored: unvoided, the ticket gets a new
    // one on its next send. One that failed to revoke is kept, and works again
    // if the ticket is unvoided.
    const [revoked] = await revokeWalletPasses(walletPasses, [target.ticketId]);
    if (revoked) {
        const eventRef = db.collection("upcomingEvents").doc(target.eventId);
        await Promise.all([
            eventRef.collection("attendees").doc(target.attendeeId)
                .update(new FieldPath("walletPasses", revoked), FieldValue.delete())
                .catch(err => console.error("voidTicket: revoked its wallet pass, but failed to drop it", err)),
            countWalletPasses(eventRef, -1),
        ]);
    }
    return reply;
});
export const unvoidTicket = onCall({maxInstances: 10}, async (request) => {
    const uid = await requireAuth(request, "staff");
    return editTicket(uid, ticketTarget(request.data), "ticket-unvoid",
        ticket => ({ticket: {...ticket, voided: false}, reply: {unvoided: true}}));
});
export const adminRedeemTicket = onCall({maxInstances: 10}, async (request) => {
    const uid = await requireAuth(request, "staff");
    const target = ticketTarget(request.data);
    return editTicket<{redeemed: boolean; alreadyRedeemed?: boolean}>(uid, target, "ticket-redeem",
        async (ticket, {txn, data, callerName}) => {
            if (ticket.voided) {
                throw new HttpsError("failed-precondition", "This ticket has been voided.", {code: "voided"});
            }
            // Idempotent, so a double-click can't overwrite the original redeemer
            // and time.
            if (ticket.redeemed) return {reply: {redeemed: false, alreadyRedeemed: true}};

            // A check-in by hand credits the account exactly as the scanner does
            // (see redeemTicket).
            const userCheckedIn = await creditAccountAttendance(txn, creditedEmail(data), target.eventId);
            return {
                ticket: admitted(ticket, {uid, name: callerName}, Timestamp.now(), userCheckedIn),
                reply: {redeemed: true},
            };
        });
});
export const resetTicket = onCall({maxInstances: 10}, async (request) => {
    const uid = await requireAuth(request, "staff");
    // Only the redemption state. attendedEvents stays: the holder may have
    // attended on another ticket.
    return editTicket(uid, ticketTarget(request.data), "ticket-reset", ticket => ({
        ticket: {
            ...ticket,
            redeemed: false,
            redeemedAt: null,
            redeemedBy: "",
            redeemedByName: "",
            checkedIn: false,
            checkedInAt: null,
        },
        reply: {reset: true},
    }));
});
export const updateEventAttendee = onCall({maxInstances: 10}, async (request) => {
    const uid = await requireAuth(request, "staff");

    const input = request.data as {
        eventId?: string;
        attendeeId?: string;
        name?: unknown;
        ticketCount?: unknown;
        type?: unknown;
        notes?: unknown;
    };
    const eventId = validateDocId(input.eventId, "eventId");
    const attendeeId = validateDocId(input.attendeeId, "attendeeId");
    const name = sanitizeDisplayText(validateStr(input.name, "name", 100));
    const ticketCount = validateTicketCount(input.ticketCount);
    const type = validateTicketType(input.type);
    // Left out, each ticket keeps its own note; given, every ticket gets it.
    const notes = input.notes === undefined ? undefined : validateTicketNotes(input.notes);

    return adminTransaction(uid, async (txn, callerSnap) => {
        const {ref: attendeeRef, data, eventTitle} = await readAttendee(txn, eventId, attendeeId);
        const prevTicketCount: number = data.ticketCount ?? 0;
        const prevTickets: NewTicket[] = (data.tickets ?? []) as NewTicket[];
        const prevType = prevTickets[0]?.type ?? "normal";

        const callerName: string = callerSnap.data()?.displayName ?? "";

        const countChanged = ticketCount !== prevTicketCount;
        const typeChanged = type !== prevType;
        const notesChanged = notes !== undefined && prevTickets.some(t => (t.notes ?? "") !== notes);

        // A HomeTown ticket is its number; re-issuing would swap it for one of ours.
        if (data.source === "hometown" && (countChanged || typeChanged)) {
            throw new HttpsError("failed-precondition", "HomeTown tickets can't be re-issued.",
                {code: "hometown-ticket"});
        }
        // Nor an API order: its buyer holds these IDs in the seller's app.
        if (isApiOrder(data) && (countChanged || typeChanged)) {
            throw new HttpsError("failed-precondition", "Tickets sold through the API can't be re-issued.",
                {code: "api-order"});
        }

        if (notesChanged) {
            txn.set(recordRef(), recordDoc("ticket-notes-edit", {
                performedBy: uid,
                performedByName: callerName,
                eventId,
                eventTitle,
                targetEmail: data.email ?? "",
                targetName: attendeeRecordName({...data, name}),
            }));
        }

        if (!countChanged && !typeChanged) {
            const nameChanged = name !== data.name;
            if (!nameChanged && !notesChanged) {
                return {updated: false, regenerated: false};
            }
            const update: Record<string, unknown> = {updatedAt: FieldValue.serverTimestamp()};
            if (nameChanged) update.name = name;
            if (notesChanged) update.tickets = prevTickets.map(t => ({...t, notes}));
            txn.update(attendeeRef, update);
            if (nameChanged) {
                txn.set(recordRef(), recordDoc("ticket-attendee-edit", {
                    performedBy: uid,
                    performedByName: callerName,
                    eventId,
                    eventTitle,
                    targetEmail: data.email ?? "",
                    oldName: attendeeRecordName(data),
                    newName: name,
                }));
            }
            // Left out rather than undefined, which a callable sends as null.
            return {updated: true, regenerated: false, ...(notes !== undefined && {notes})};
        }

        const {tickets: freshTickets, ticketIds} = buildFreshTickets(ticketCount, type, notes);
        // Without a new note, each keeps its own by position, so a re-issue doesn't lose them.
        const tickets = notes !== undefined
            ? freshTickets
            : freshTickets.map((t, i) => prevTickets[i]?.notes ? {...t, notes: prevTickets[i].notes} : t);
        txn.update(attendeeRef, {
            name,
            ticketCount,
            tickets,
            ticketIds,
            emailSent: !data.email,
            emailSentAt: null,
            updatedAt: FieldValue.serverTimestamp(),
        });
        txn.set(recordRef(), recordDoc("ticket-regenerate", {
            performedBy: uid,
            performedByName: callerName,
            eventId,
            eventTitle,
            targetEmail: data.email ?? "",
            targetName: name,
        }));
        return {updated: true, regenerated: true};
    });
});
export const updateTicketType = onCall({maxInstances: 10}, async (request) => {
    const uid = await requireAuth(request, "staff");
    const target = ticketTarget(request.data);
    const type = validateTicketType((request.data as {type?: unknown}).type);

    return editTicket(uid, target, "ticket-type-edit", ticket => {
        const oldType = ticket.type || "normal";
        if (oldType === type) return {reply: {updated: false}};
        return {ticket: {...ticket, type}, record: {oldType, newType: type}, reply: {updated: true}};
    });
});
export const updateTicketNotes = onCall({maxInstances: 10}, async (request) => {
    const uid = await requireAuth(request, "staff");
    const target = ticketTarget(request.data);
    // An empty note clears it.
    const notes = validateTicketNotes((request.data as {notes?: unknown}).notes);

    return editTicket(uid, target, "ticket-notes-edit", ticket => {
        if ((ticket.notes ?? "") === notes) return {reply: {updated: false, notes}};
        return {ticket: {...ticket, notes}, reply: {updated: true, notes}};
    });
});
export const deleteEventAttendee = onCall({maxInstances: 10, secrets: [WALLETWALLET_API_KEY]}, async (request) => {
    const uid = await requireAuth(request, "staff");

    const input = request.data as {eventId?: string; attendeeId?: string};
    const eventId = validateDocId(input.eventId, "eventId");
    const attendeeId = validateDocId(input.attendeeId, "attendeeId");

    let walletPasses: unknown;
    const reply = await adminTransaction(uid, async (txn, callerSnap) => {
        const {ref: attendeeRef, data, eventTitle} = await readAttendee(txn, eventId, attendeeId);
        // Its doc is what keeps the number from getting in again, unlisted or
        // by the next import, so it's voided instead.
        if (data.source === "hometown") {
            throw new HttpsError("failed-precondition", "HomeTown tickets can't be removed; void them instead.",
                {code: "hometown-ticket"});
        }
        // Its doc is what makes a retried order find the tickets it already
        // issued; without it, a retry would issue new ones.
        if (isApiOrder(data)) {
            throw new HttpsError("failed-precondition", "Tickets sold through the API can't be removed; void them instead.",
                {code: "api-order"});
        }
        txn.delete(attendeeRef);
        txn.set(recordRef(), recordDoc("ticket-attendee-delete", {
            performedBy: uid,
            performedByName: callerSnap.data()?.displayName ?? "",
            eventId,
            eventTitle,
            targetEmail: data.email ?? "",
            targetName: attendeeRecordName(data),
        }));
        walletPasses = data.walletPasses;
        return {deleted: true};
    });
    // Their tickets are gone, so their wallet passes go too.
    if (walletPasses && typeof walletPasses === "object") {
        const revoked = await revokeWalletPasses(walletPasses, Object.keys(walletPasses));
        await countWalletPasses(db.collection("upcomingEvents").doc(eventId), -revoked.length);
    }
    return reply;
});

export const sendTicketEmails = onCall(
    {maxInstances: 5, timeoutSeconds: 300, memory: "512MiB", secrets: [RESEND_API_KEY]},
    async (request) => {
        const uid = await requireAuth(request, "staff");
        const callerSnap = await requireAdmin(uid);

        const input = request.data as {
            eventId?: string;
            mode?: string;
            attendeeIds?: unknown;
            cursor?: unknown;
        };
        const eventId = validateDocId(input.eventId, "eventId");
        const mode = input.mode === "all" ? "all" : "unsent";
        let attendeeIds: string[] | null = null;
        if (Array.isArray(input.attendeeIds)) {
            attendeeIds = input.attendeeIds.map(id => validateDocId(id, "attendeeId"));
            if (attendeeIds.length > SEND_CHUNK_SIZE) {
                throw new HttpsError("invalid-argument",
                    `Too many attendee ids in a single send (max ${SEND_CHUNK_SIZE}).`);
            }
        }
        const cursor = typeof input.cursor === "string" && input.cursor.length > 0
            ? validateDocId(input.cursor, "cursor")
            : null;

        const eventSnap = await db.collection("upcomingEvents").doc(eventId).get();
        if (!eventSnap.exists) throw new HttpsError("not-found", "Event not found.");
        const eventData = eventSnap.data()!;

        const template = await readSavedTemplate(ticketTemplateRef(eventSnap.ref));
        const contactEmail = await contactEmailFor(template);
        const walletPass = await walletPassesOnFor(eventSnap.ref);

        // Target attendees — capped at SEND_CHUNK_SIZE.
        const attendeesCol = eventSnap.ref.collection("attendees");
        let targets: FirebaseFirestore.QueryDocumentSnapshot[];
        let queriedCount: number;
        if (attendeeIds && attendeeIds.length > 0) {
            const snaps = await Promise.all(attendeeIds.map(id => attendeesCol.doc(id).get()));
            let filtered = snaps.filter(s => s.exists) as FirebaseFirestore.QueryDocumentSnapshot[];
            if (mode === "unsent") {
                filtered = filtered.filter(s => s.data()?.emailSent !== true);
            }
            targets = filtered.slice(0, SEND_CHUNK_SIZE);
            queriedCount = filtered.length;
        } else if (mode === "unsent") {
            // A drain: processed attendees leave the result set. createdAt order keeps
            // chunks FIFO on the (emailSent, createdAt) index. The cursor steps past
            // the ones passed by and left in it, checked-in walk-ins, so however many
            // there are they never hold up the rest.
            let q = attendeesCol
                .where("emailSent", "==", false)
                .orderBy("createdAt", "asc")
                .limit(SEND_CHUNK_SIZE);
            if (cursor) {
                const after = await attendeesCol.doc(cursor).get();
                if (after.exists) q = q.startAfter(after);
            }
            const snap = await q.get();
            targets = snap.docs;
            queriedCount = snap.docs.length;
        } else {
            // Resend-all: cursor by doc id for stable chunked iteration.
            let q = attendeesCol.orderBy(FieldPath.documentId())
                .limit(SEND_CHUNK_SIZE);
            if (cursor) q = q.startAfter(cursor);
            const snap = await q.get();
            targets = snap.docs;
            queriedCount = snap.docs.length;
        }

        const eventTitle: string = eventData.title ?? "";

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
            // HomeTown emailed these itself; ours would be a second, different QR.
            if (data.source === "hometown") continue;
            // The seller's app delivered these, unless the order asked us to.
            if (isApiOrder(data) && data.apiSendEmail !== true) continue;
            // Already in at the door, so nothing is owed them. Left unsent rather
            // than marked, so a reset ticket brings them back; Resend Email still
            // sends to one on purpose.
            if (mode === "unsent" && isCheckedInWalkIn(data)) continue;
            const rawTickets: any[] = data.tickets ?? [];
            const activeTickets = rawTickets.filter(t => !t.voided);

            // A walk-in without an email has nowhere to send to.
            if (activeTickets.length === 0 || !data.email) {
                ticketlessTargets.push(target);
                continue;
            }

            candidates.push({target, data, tickets: activeTickets});
        }

        // No tickets, all voided, or no email: mark sent so the 'unsent' drain
        // doesn't spin on it.
        for (const target of ticketlessTargets) {
            ops.push(b => b.update(target.ref, {
                emailSent: true,
                emailSending: FieldValue.delete(),
                emailSentAt: FieldValue.serverTimestamp(),
                updatedAt: FieldValue.serverTimestamp(),
            }));
        }

        // Reserve daily-cap slots in a transaction that reads the quota cache
        // and writes the pre-charge together, so two concurrent sends can't
        // both spend the same slots: optimistic concurrency on
        // system/resendQuota retries the second. The reservation is released
        // once the send settles.
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
            const envelope = renderTicketEmail(template, contactEmail, {id: eventId, data: eventData},
                {name: data.name, email: data.email}, tickets, walletPass);
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
        // for an admin to flag. sentCount is all of the send slice or none.
        //
        // emailSending is an API order's own send that never settled (see
        // emailOrder in api.ts); deleting it is a no-op on anyone else.
        for (const {target} of sendCommitTargets.slice(0, sentCount)) {
            try {
                await target.ref.update({
                    emailSent: true,
                    emailSending: FieldValue.delete(),
                    emailSentAt: FieldValue.serverTimestamp(),
                    updatedAt: FieldValue.serverTimestamp(),
                });
            } catch (err) {
                console.error("sendTicketEmails: SENT but failed to mark attendee",
                    target.id, err);
            }
        }

        // Queue the overflow. targetPath lets the drain clear emailScheduled
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
                targetPath: target.ref.path,
            });
            // emailSent keeps the 'unsent' drain off it; emailScheduled makes
            // the admin UI say "Queued" until the drain ships it.
            batch.update(target.ref, {
                emailSent: true,
                emailScheduled: true,
                emailSending: FieldValue.delete(),
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
        const hasMore = !attendeeIds && (queriedCount >= SEND_CHUNK_SIZE || handled < targets.length);
        const resumeAfter = handled > 0 ? targets[handled - 1].id : cursor;
        const nextCursor = hasMore && resumeAfter ? resumeAfter : undefined;

        return {sentCount, queuedCount, hasMore, ...(nextCursor ? {nextCursor} : {})};
    });
export const getTicketEmailQuota = onCall({
    maxInstances: 5,
    // For syncProviderUsage; without it the read has no key and falls back to
    // the cached counter.
    secrets: [RESEND_API_KEY],
}, async (request) => {
    const uid = await requireAuth(request, "staff");
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
    const uid = await requireAuth(request, "staff");

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
        txn.set(ticketTemplateRef(eventSnap.ref), {
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

// How the event's wallet passes look (see WalletPassSettings), from its Emails
// section. Core staff and above, as the email template is.
export const updateWalletPassSettings = onCall({maxInstances: 10}, async (request) => {
    const uid = await requireAuth(request, "staff");

    const input = request.data as {
        eventId?: string;
        enabled?: unknown;
        color?: unknown;
        headerText?: unknown;
        notes?: unknown;
    };
    const eventId = validateDocId(input.eventId, "eventId");
    if (typeof input.enabled !== "boolean") throw new HttpsError("invalid-argument", "Invalid enabled.");
    const color = input.color;
    if (color !== "auto" && !(WALLET_COLORS as readonly unknown[]).includes(color)) {
        throw new HttpsError("invalid-argument", "Invalid color.");
    }
    const headerText = validateStr(input.headerText, "headerText", 64).trim();
    if (!Array.isArray(input.notes) || input.notes.length > WALLET_PASS_MAX_NOTES) {
        throw new HttpsError("invalid-argument", `notes must be an array of at most ${WALLET_PASS_MAX_NOTES}.`);
    }
    const notes = input.notes.map((n, i) => ({
        label: validateStr((n as any)?.label, `notes[${i}].label`, 64).trim(),
        value: validateStr((n as any)?.value, `notes[${i}].value`, 256, true).trim(),
    }));

    return adminTransaction(uid, async (txn, callerSnap) => {
        const eventSnap = await txn.get(db.collection("upcomingEvents").doc(eventId));
        if (!eventSnap.exists) throw new HttpsError("not-found", "Event not found.");
        // Merged, so passCount, kept beside the settings, stays.
        txn.set(walletPassSettingsRef(eventSnap.ref), {
            enabled: input.enabled, color, headerText, notes,
            updatedAt: FieldValue.serverTimestamp(),
            updatedBy: uid,
        }, {merge: true});
        txn.set(recordRef(), recordDoc("upcoming-event-wallet-pass-update", {
            performedBy: uid,
            performedByName: callerSnap.data()?.displayName ?? "",
            eventId,
            eventTitle: eventSnap.data()?.title ?? eventId,
        }));
        return {saved: true};
    });
});
