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
import { getEventDoc } from "../utils/events";
import { type BatchOp, commitInChunks, isoOrNull } from "../utils/helpers";
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
import { accountByEmail, accountEmails, addressLedToAccount } from "../utils/accountEmail";
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
import { performer, recordDoc, type RecordFields, recordRef, type RecordType } from "../utils/records";
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
    TICKET_TYPES,
    ticketClaimUrl,
} from "../utils/tickets";

function validateTicketCount(value: unknown): number {
    if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 50) {
        throw new HttpsError("invalid-argument", "ticketCount must be an integer between 1 and 50.");
    }
    return value;
}

function validateTicketType(value: unknown): string {
    if (typeof value !== "string" || !TICKET_TYPES.includes(value)) {
        return "normal";
    }
    return value;
}

const TICKET_NOTES_MAX = 500;

function validateTicketNotes(value: unknown): string {
    return sanitizeDisplayText(validateStr(value, "notes", TICKET_NOTES_MAX));
}

function worksEvent(caller: FirebaseFirestore.DocumentData, eventId: string): boolean {
    const eventStaff: string[] = caller.eventStaffEvents ?? [];
    return isStaffOrAbove(caller.group) || eventStaff.includes(eventId);
}

async function creditAccountAttendance(
    txn: FirebaseFirestore.Transaction,
    email: string,
    eventId: string,
    boughtAt: unknown,
): Promise<boolean> {
    const account = await accountByEmail(email, boughtAt, txn);
    if (!account) return false;
    const attended: string[] = account.data().attendedEvents ?? [];
    if (!attended.includes(eventId)) {
        txn.update(account.ref, {attendedEvents: FieldValue.arrayUnion(eventId)});
    }
    return true;
}

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

async function importTarget(uid: string, eventId: string): Promise<{eventTitle: string; callerName: string}> {
    return adminTransaction(uid, async (txn, callerSnap) => {
        const eventSnap = await txn.get(db.collection("upcomingEvents").doc(eventId));
        if (!eventSnap.exists) throw new HttpsError("not-found", "Event not found.");
        return {eventTitle: eventSnap.data()?.title ?? eventId, callerName: callerSnap.data()?.displayName ?? ""};
    });
}

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

        const buf = await QRCode.toBuffer(url, {errorCorrectionLevel: "M", width: 600, margin: 1});

        res.set("Content-Type", "image/png");
        res.set("Cache-Control", "public, max-age=31536000, s-maxage=31536000");
        res.send(buf);
    } catch (err) {
        console.error("[serveTicketQr] Error generating QR:", err);
        res.status(500).send("Failed to generate QR code");
    }
});

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
        const name = sanitizeDisplayText(validateStr(r.name, "name", 100));
        const ticketCount = validateTicketCount(r.ticketCount);
        const type = validateTicketType(r.type);
        const notes = validateTicketNotes(r.notes);

        let timestamp: Date | undefined;
        if (r.timestamp && typeof r.timestamp === "string") {
            const parsed = new Date(r.timestamp);
            if (!isNaN(parsed.getTime())) timestamp = parsed;
        }

        normalized.set(email, {email, name, ticketCount, type, notes, timestamp});
    }

    const {eventTitle, callerName} = await importTarget(uid, eventId);

    const attendeesCol = db.collection("upcomingEvents").doc(eventId).collection("attendees");

    const emails = Array.from(normalized.keys());
    const existingByEmail = new Map<string, FirebaseFirestore.QueryDocumentSnapshot>();
    for (let i = 0; i < emails.length; i += 30) {
        const chunk = emails.slice(i, i + 30);
        const snap = await attendeesCol.where("email", "in", chunk).get();
        for (const doc of snap.docs) {
            if (doc.data().source === "hometown" || isApiOrder(doc.data())) continue;
            const email = doc.data().email;
            if (typeof email === "string") existingByEmail.set(email, doc);
        }
    }

    let addedCount = 0;
    let replacedCount = 0;
    let skippedCount = 0;
    const ops: BatchOp[] = [];

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

        if (existing) {
            replacedCount++;
            const dataToUpdate: Record<string, unknown> = {
                email: row.email,
                ticketCount: row.ticketCount,
                tickets,
                ticketIds,
                emailSent: false,
                emailSentAt: null,
                updatedAt: customDate || now,
            };
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
        const callerData = (await txn.get(db.collection("users").doc(uid))).data() ?? {};
        if (!worksEvent(callerData, eventId)) {
            throw new HttpsError("permission-denied", "Not authorized to add walk-ins for this event.",
                {code: "not-authorized"});
        }

        const eventRef = db.collection("upcomingEvents").doc(eventId);
        const attendeesCol = eventRef.collection("attendees");
        const eventSnap = await txn.get(eventRef);
        if (!eventSnap.exists) throw new HttpsError("not-found", "Event not found.");

        const now = Timestamp.now();
        if (!isOnEventDay(eventSnap.data()?.startAt, eventSnap.data()?.endAt, now.toMillis())) {
            throw new HttpsError("failed-precondition", "Walk-ins can only be added on the day of the event.",
                {code: "not-event-day"});
        }

        if (email) {
            const existing = await txn.get(attendeesCol.where("email", "==", email).limit(1));
            if (!existing.empty) {
                throw new HttpsError("already-exists", "An attendee with this email already exists.",
                    {code: "attendee-exists"});
            }
        }
        const userCheckedIn = checkIn && await creditAccountAttendance(txn, email, eventId, now);

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

const HOMETOWN_IMPORT_CONCURRENCY = 20;

const HOMETOWN_COMPLETE_MAX = 20_000;

function hometownDetailsDiffer(row: HometownRow, data: FirebaseFirestore.DocumentData): boolean {
    return row.name !== (data.name ?? "")
        || row.email !== (data.email ?? "")
        || row.orderId !== (data.hometownOrderId ?? "")
        || row.type !== ((data.tickets?.[0]?.type as string | undefined) ?? "normal");
}

type HometownOutcome = "added" | "confirmed" | "updated" | "skipped";

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
    const seenAt = Timestamp.now();

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

    const creditScannedBuyer = async (
        txn: FirebaseFirestore.Transaction,
        email: string,
        data: FirebaseFirestore.DocumentData,
        tickets: NewTicket[],
    ): Promise<boolean> => {
        if (email === (data.email ?? "") || !tickets.some(isScannedTicket)) return false;
        return creditAccountAttendance(txn, email, eventId, data.createdAt);
    };

    const applyRow = async (
        txn: FirebaseFirestore.Transaction,
        ref: FirebaseFirestore.DocumentReference,
        row: HometownRow,
        data: FirebaseFirestore.DocumentData,
        fields: Record<string, FieldValue>,
    ): Promise<void> => {
        const tickets = (data.tickets ?? []) as NewTicket[];
        const credited = await creditScannedBuyer(txn, row.email, data, tickets);
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

    const readTicket = async (txn: FirebaseFirestore.Transaction, ref: FirebaseFirestore.DocumentReference) => {
        const [eventSnap, snap] = await Promise.all([txn.get(eventRef), txn.get(ref)]);
        if (!eventSnap.exists) throw new HttpsError("not-found", "Event not found.");
        return snap;
    };

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

    const updateRow = (row: HometownRow) => db.runTransaction(async (txn): Promise<HometownOutcome> => {
        const ref = attendeesCol.doc(hometownAttendeeId(row.ticketId));
        const data = (await readTicket(txn, ref)).data();
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

    if (seenOnly.length > 0) {
        await commitInChunks(seenOnly.map((ref): BatchOp => b =>
            b.update(ref, {hometownSeenAt: seenAt, missingFromHometown: FieldValue.delete()})));
    }

    let missingCount = 0;
    if (complete) {
        const onFile = await attendeesCol.where("source", "==", "hometown").get();
        const toFlag: FirebaseFirestore.DocumentReference[] = [];
        for (const doc of onFile.docs) {
            const data = doc.data();
            if (data.unlisted === true || complete.has(data.ticketIds?.[0] ?? "")) continue;
            missingCount++;
            if (data.missingFromHometown !== true) toFlag.push(doc.ref);
        }
        if (toFlag.length > 0) {
            await commitInChunks(toFlag.map((ref): BatchOp => b =>
                b.update(ref, {missingFromHometown: true})));
        }
    }

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

const HOMETOWN_ORDER_TIME_MIN = Date.UTC(2020, 0, 1);

const HOMETOWN_ORDER_TIME_SKEW_MS = 24 * 60 * 60 * 1000;

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

    const syncRow = (ref: FirebaseFirestore.DocumentReference) => db.runTransaction(async (txn) => {
        const [eventSnap, snap] = await Promise.all([txn.get(eventRef), txn.get(ref)]);
        if (!eventSnap.exists) throw new HttpsError("not-found", "Event not found.");
        const data = snap.data();
        const time = times.get(data?.hometownOrderId ?? "");
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

export const setHometownAdmitUnlisted = onCall({maxInstances: 10}, async (request) => {
    const uid = await requireAuth(request, "staff");

    const input = request.data as {eventId?: string; enabled?: unknown};
    const eventId = validateDocId(input.eventId, "eventId");
    const enabled = validateBoolean(input.enabled, "enabled");

    return adminTransaction(uid, async (txn, callerSnap) => {
        const eventRef = db.collection("upcomingEvents").doc(eventId);
        const eventSnap = await txn.get(eventRef);
        if (!eventSnap.exists) throw new HttpsError("not-found", "Event not found.");

        txn.set(eventRef.collection("settings").doc("hometown"), {
            admitUnlisted: enabled,
            updatedAt: FieldValue.serverTimestamp(),
            updatedBy: uid,
        }, {merge: true});
        txn.set(recordRef(), recordDoc("hometown-admit-unlisted", {
            ...performer(uid, callerSnap),
            eventId,
            eventTitle: eventSnap.data()?.title ?? eventId,
            enabled,
        }));
        return {enabled};
    });
});

interface HeldTicket {
    ticketId: string;
    type: string;
    redeemed: boolean;
    redeemedAt: string | null;
    voided: boolean;
}

export const getMyTickets = onCall({maxInstances: 20}, async (request) => {
    const uid = await requireAuth(request);
    const userRef = db.collection("users").doc(uid);
    const userSnap = await userRef.get();
    const userData = userSnap.data();
    const emails = accountEmails(userData);
    if (emails.length === 0) return {events: []};

    const liveSnap = await db.collection("upcomingEvents")
        .where("endAt", ">", Timestamp.now()).get();
    const liveEvents = liveSnap.docs.filter(doc => {
        const data = doc.data();
        return data.paid === true && data.published === true;
    });

    const found = await Promise.all(liveEvents.map(async (eventDoc) => {
        const attendeeSnap = await eventDoc.ref.collection("attendees")
            .where("email", "in", emails).get();
        if (attendeeSnap.empty) return null;

        const tickets: HeldTicket[] = [];
        for (const doc of attendeeSnap.docs) {
            if (isApiOrder(doc.data())) continue;
            if (!addressLedToAccount(userData, doc.get("email"), doc.get("createdAt"))) continue;
            const rawTickets: unknown[] = Array.isArray(doc.data().tickets) ? doc.data().tickets : [];
            for (const raw of rawTickets) {
                const ticket = raw as Partial<NewTicket>;
                if (typeof ticket.ticketId !== "string" || !ticket.ticketId) continue;
                tickets.push({
                    ticketId: ticket.ticketId,
                    type: ticket.type || "normal",
                    redeemed: ticket.redeemed === true,
                    redeemedAt: isoOrNull(ticket.redeemedAt),
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
            roomIds: Array.isArray(eventData.roomIds) ? eventData.roomIds : [],
            poster: (eventData.poster as string) ?? "",
            startAt: isoOrNull(eventData.startAt) ?? new Date().toISOString(),
            tickets,
        };
    }));

    const events = found.filter((e): e is NonNullable<typeof e> => e !== null);
    events.sort((a, b) => a.startAt.localeCompare(b.startAt));

    const scannedInto = events
        .filter(e => e.tickets.some(isScannedTicket))
        .map(e => e.eventId);
    if (scannedInto.length > 0) {
        try {
            const attended: string[] = userSnap.data()?.attendedEvents ?? [];
            const missing = scannedInto.filter(id => !attended.includes(id));
            if (missing.length > 0) {
                await userRef.update({attendedEvents: FieldValue.arrayUnion(...missing)});
            }
        } catch (err) {
            console.error(`getMyTickets: attendance backfill failed for ${uid}`, err);
        }
    }

    return {events};
});
const ACCOUNT_LOOKUP_MAX = 500;

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

    const callerData = (await db.collection("users").doc(uid).get()).data() ?? {};
    if (!worksEvent(callerData, eventId)) {
        throw new HttpsError("permission-denied", "Not authorized to read this event's attendees.");
    }
    const namesAccounts = isStaffOrAbove(callerData.group);

    const emails = Array.from(new Set(
        input.emails
            .map(raw => (typeof raw === "string" ? raw.trim().toLowerCase() : ""))
            .filter(email => email.length > 0 && email.length <= 320 && EMAIL_RE.test(email))
    ));
    if (emails.length === 0) return {accounts: []};

    const event = await getEventDoc(eventId);
    if (!event.snap.exists) throw new HttpsError("not-found", "Event not found.");
    if (!namesAccounts && event.archived) {
        throw new HttpsError("permission-denied", "Not authorized to read this event's attendees.");
    }

    const chunked = (list: string[]): string[][] => {
        const chunks: string[][] = [];
        for (let i = 0; i < list.length; i += 30) chunks.push(list.slice(i, i + 30));
        return chunks;
    };

    const attendeesCol = event.snap.ref.collection("attendees");
    const listedSnaps = await Promise.all(
        chunked(emails).map(chunk => attendeesCol.where("email", "in", chunk).get()));
    const boughtAt = new Map<string, Timestamp | null>();
    for (const doc of listedSnaps.flatMap(snap => snap.docs)) {
        const email: unknown = doc.get("email");
        if (typeof email !== "string") continue;
        const at: unknown = doc.get("createdAt");
        const earliest = boughtAt.get(email);
        if (!(at instanceof Timestamp)) {
            if (earliest === undefined) boughtAt.set(email, null);
        } else if (!earliest || at.toMillis() < earliest.toMillis()) {
            boughtAt.set(email, at);
        }
    }

    let asked = emails;
    if (!namesAccounts) {
        const walkInDay = isOnEventDay(event.snap.get("startAt"), event.snap.get("endAt"), Date.now());
        const walkIn = walkInDay ? emails.find(email => !boughtAt.has(email)) : undefined;
        asked = emails.filter(email => boughtAt.has(email) || email === walkIn);
        if (asked.length === 0) return {accounts: []};
    }

    const chunks = chunked(asked);
    const users = db.collection("users");
    const [currentSnaps, formerSnaps] = await Promise.all([
        Promise.all(chunks.map(chunk => users.where("email", "in", chunk).get())),
        Promise.all(chunks.map(chunk => users.where("formerEmails", "array-contains-any", chunk).get())),
    ]);

    const addHolder = (
        map: Map<string, Map<string, FirebaseFirestore.QueryDocumentSnapshot>>,
        email: string,
        doc: FirebaseFirestore.QueryDocumentSnapshot,
    ) => {
        const docs = map.get(email) ?? new Map<string, FirebaseFirestore.QueryDocumentSnapshot>();
        docs.set(doc.id, doc);
        map.set(email, docs);
    };

    const currentHolders = new Map<string, Map<string, FirebaseFirestore.QueryDocumentSnapshot>>();
    for (const doc of currentSnaps.flatMap(snap => snap.docs)) {
        const email = doc.get("email");
        if (typeof email === "string") addHolder(currentHolders, email, doc);
    }

    const wanted = new Set(asked);
    const formerHolders = new Map<string, Map<string, FirebaseFirestore.QueryDocumentSnapshot>>();
    for (const doc of formerSnaps.flatMap(snap => snap.docs)) {
        const former: unknown = doc.get("formerEmails");
        if (!Array.isArray(former)) continue;
        for (const email of former) {
            if (typeof email === "string" && wanted.has(email)) addHolder(formerHolders, email, doc);
        }
    }

    const now = Timestamp.now();
    const accounts: {email: string; uid?: string; displayName?: string}[] = [];
    for (const email of asked) {
        const current = currentHolders.get(email);
        const docs = current ?? formerHolders.get(email);
        if (docs?.size !== 1) continue;
        const [doc] = docs.values();
        if (!current && !addressLedToAccount(doc.data(), email, boughtAt.get(email) ?? now)) continue;
        accounts.push(namesAccounts
            ? {email, uid: doc.id, displayName: doc.get("displayName") ?? ""}
            : {email});
    }

    return {accounts};
});
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

        const eventSnap = await txn.get(db.collection("upcomingEvents").doc(eventId));
        if (!eventSnap.exists) {
            throw new HttpsError("not-found", "Event not found.", {code: "event-missing"});
        }

        const now = Timestamp.now();
        if (!isCoreStaffOrAbove
            && !isOnEventDay(eventSnap.data()?.startAt, eventSnap.data()?.endAt, now.toMillis())) {
            throw new HttpsError("failed-precondition", "Tickets can only be scanned on the day of the event.",
                {code: "not-event-day"});
        }

        const callerName: string = callerData.displayName ?? "";
        const eventTitle: string = eventSnap.data()?.title ?? "";

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
                    redeemedAt: isoOrNull(ticket.redeemedAt),
                };
            }

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

        if (source.unlisted) await refuseUnlisted();

        const userCheckedIn = await creditAccountAttendance(
            txn, creditedEmail(attendeeData), eventId, attendeeData.createdAt);
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

function attendeeRecordName(data: FirebaseFirestore.DocumentData): string {
    if (data.name) return data.name as string;
    if (!data.email && data.source === "hometown") return `HomeTown #${data.ticketIds?.[0] ?? ""}`;
    return "";
}

async function readAttendee(txn: FirebaseFirestore.Transaction, eventId: string, attendeeId: string) {
    const eventRef = db.collection("upcomingEvents").doc(eventId);
    const ref = eventRef.collection("attendees").doc(attendeeId);
    const [eventSnap, snap] = await Promise.all([txn.get(eventRef), txn.get(ref)]);
    if (!eventSnap.exists) throw new HttpsError("not-found", "Event not found.");
    if (!snap.exists) throw new HttpsError("not-found", "Attendee not found.");
    return {ref, data: snap.data()!, eventTitle: (eventSnap.data()?.title ?? eventId) as string};
}

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

interface TicketEdit<R> {
    reply: R;
    ticket?: NewTicket;
    record?: RecordFields;
}

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
            if (ticket.redeemed) return {reply: {redeemed: false, alreadyRedeemed: true}};

            const userCheckedIn = await creditAccountAttendance(
                txn, creditedEmail(data), target.eventId, data.createdAt);
            return {
                ticket: admitted(ticket, {uid, name: callerName}, Timestamp.now(), userCheckedIn),
                reply: {redeemed: true},
            };
        });
});
export const resetTicket = onCall({maxInstances: 10}, async (request) => {
    const uid = await requireAuth(request, "staff");
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

        if (data.source === "hometown" && (countChanged || typeChanged)) {
            throw new HttpsError("failed-precondition", "HomeTown tickets can't be re-issued.",
                {code: "hometown-ticket"});
        }
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
            return {updated: true, regenerated: false, ...(notes !== undefined && {notes})};
        }

        const {tickets: freshTickets, ticketIds} = buildFreshTickets(ticketCount, type, notes);
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
        if (data.source === "hometown") {
            throw new HttpsError("failed-precondition", "HomeTown tickets can't be removed; void them instead.",
                {code: "hometown-ticket"});
        }
        if (isApiOrder(data)) {
            throw new HttpsError("failed-precondition", "Tickets sold through the API can't be removed; void them instead.",
                {code: "api-order"});
        }
        txn.delete(attendeeRef);
        txn.set(recordRef(), recordDoc("ticket-attendee-delete", {
            ...performer(uid, callerSnap),
            eventId,
            eventTitle,
            targetEmail: data.email ?? "",
            targetName: attendeeRecordName(data),
        }));
        walletPasses = data.walletPasses;
        return {deleted: true};
    });
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
            let q = attendeesCol.orderBy(FieldPath.documentId())
                .limit(SEND_CHUNK_SIZE);
            if (cursor) q = q.startAfter(cursor);
            const snap = await q.get();
            targets = snap.docs;
            queriedCount = snap.docs.length;
        }

        const eventTitle: string = eventData.title ?? "";

        await syncProviderUsage();
        const {sentToday, dailyCap} = await computeEmailQuota();
        const prelimRemainingToday = Math.max(0, dailyCap - sentToday);
        const initialQueueDepth = await getScheduledMailQueueDepth();
        const queueCapacity = Math.max(0, RESEND_QUEUE_CAP - initialQueueDepth);
        if (prelimRemainingToday === 0 && queueCapacity === 0) {
            throw new HttpsError("resource-exhausted",
                "Daily cap reached and overflow queue is full.", {code: "quota-exceeded"});
        }

        const ops: BatchOp[] = [];

        const ticketlessTargets: FirebaseFirestore.QueryDocumentSnapshot[] = [];
        const candidates: {
            target: FirebaseFirestore.QueryDocumentSnapshot;
            data: FirebaseFirestore.DocumentData;
            tickets: any[];
        }[] = [];
        const prelimBudget = prelimRemainingToday + queueCapacity;
        let handled = targets.length;
        for (const [i, target] of targets.entries()) {
            if (candidates.length >= prelimBudget) {
                handled = i;
                break;
            }
            const data = target.data();
            if (data.source === "hometown") continue;
            if (isApiOrder(data) && data.apiSendEmail !== true) continue;
            if (mode === "unsent" && isCheckedInWalkIn(data)) continue;
            const rawTickets: any[] = data.tickets ?? [];
            const activeTickets = rawTickets.filter(t => !t.voided);

            if (activeTickets.length === 0 || !data.email) {
                ticketlessTargets.push(target);
                continue;
            }

            candidates.push({target, data, tickets: activeTickets});
        }

        for (const target of ticketlessTargets) {
            ops.push(b => b.update(target.ref, {
                emailSent: true,
                emailSending: FieldValue.delete(),
                emailSentAt: FieldValue.serverTimestamp(),
                updatedAt: FieldValue.serverTimestamp(),
            }));
        }

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

        const reservedCount = expectedSentCount + expectedQueuedCount;
        if (reservedCount < candidates.length) {
            handled = Math.min(handled, targets.indexOf(candidates[reservedCount].target));
        }
        const sendableTargets = candidates.slice(0, reservedCount).map((c, i) => ({
            ...c,
            queued: i >= expectedSentCount,
        }));

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

        if (sendAuditRef) {
            if (sentCount === 0) await sendAuditRef.delete();
            else if (sentCount !== expectedSentCount) await sendAuditRef.update({sentCount});
        }
        if (queueAuditRef) {
            if (queuedCount === 0) await queueAuditRef.delete();
            else if (queuedCount !== expectedQueuedCount) await queueAuditRef.update({sentCount: queuedCount});
        }

        if (sendError && sentCount === 0 && expectedSentCount > 0) {
            throw new HttpsError("internal",
                "Email send failed; queued items (if any) will still drain.",
                {
                    code: "send-failed",
                    queuedCount,
                    cause: sendError instanceof Error ? sendError.message : String(sendError),
                });
        }

        const hasMore = !attendeeIds && (queriedCount >= SEND_CHUNK_SIZE || handled < targets.length);
        const resumeAfter = handled > 0 ? targets[handled - 1].id : cursor;
        const nextCursor = hasMore && resumeAfter ? resumeAfter : undefined;

        return {sentCount, queuedCount, hasMore, ...(nextCursor ? {nextCursor} : {})};
    });
export const getTicketEmailQuota = onCall({
    maxInstances: 5,
    secrets: [RESEND_API_KEY],
}, async (request) => {
    const uid = await requireAuth(request, "staff");
    await requireAdmin(uid);

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
            ...performer(uid, callerSnap),
            eventId,
            eventTitle: eventSnap.data()?.title ?? eventId,
        }));
        return {saved: true};
    });
});

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
    const enabled = validateBoolean(input.enabled, "enabled");
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
        txn.set(walletPassSettingsRef(eventSnap.ref), {
            enabled, color, headerText, notes,
            updatedAt: FieldValue.serverTimestamp(),
            updatedBy: uid,
        }, {merge: true});
        txn.set(recordRef(), recordDoc("upcoming-event-wallet-pass-update", {
            ...performer(uid, callerSnap),
            eventId,
            eventTitle: eventSnap.data()?.title ?? eventId,
        }));
        return {saved: true};
    });
});
