import * as crypto from "crypto";
import { Timestamp } from "firebase-admin/firestore";
import { PUBLIC_ORIGIN } from "./config";

export interface NewTicket {
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
    /** A staff comment, shown only to staff: in the admin panel and on the scanner. Absent until one is written. */
    notes?: string;
}

export function freshTicket(ticketId: string, type: string): NewTicket {
    return {
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
    };
}

export function buildFreshTickets(count: number, type = "normal", notes = ""): {
    tickets: NewTicket[];
    ticketIds: string[]
} {
    const tickets: NewTicket[] = [];
    const ticketIds: string[] = [];
    for (let i = 0; i < count; i++) {
        const ticketId = crypto.randomUUID();
        ticketIds.push(ticketId);
        tickets.push(notes ? {...freshTicket(ticketId, type), notes} : freshTicket(ticketId, type));
    }
    return {tickets, ticketIds};
}

/**
 * What a ticket's QR code holds: the claim page, which the door scanner reads
 * and a holder's phone opens. The API hands it out as is, so an app can draw
 * the code itself.
 */
export function ticketClaimUrl(ticketId: string, eventId: string): string {
    return `${PUBLIC_ORIGIN}/claim?ticket=${encodeURIComponent(ticketId)}&event=${encodeURIComponent(eventId)}`;
}

/**
 * Whether a stored ticket got its holder through the door: redeemed and not
 * voided since. Both sign-up and the tickets view credit attendance from this,
 * so they agree.
 */
export function isScannedTicket(raw: unknown): boolean {
    const ticket = raw as {redeemed?: unknown; voided?: unknown} | null;
    return ticket?.redeemed === true && ticket.voided !== true;
}

/**
 * A walk-in whose every live ticket is checked in: a ticket email would carry
 * nothing they can use, so Send Unsent passes them by. Mirrors checkedInWalkIn
 * in app/pages/admin/tickets/helpers.ts.
 */
export function isCheckedInWalkIn(data: {walkIn?: unknown; tickets?: unknown}): boolean {
    if (data.walkIn !== true || !Array.isArray(data.tickets)) return false;
    const live = data.tickets.filter(t => (t as {voided?: unknown} | null)?.voided !== true);
    return live.length > 0 && live.every(isScannedTicket);
}

/**
 * A HomeTown ticket number: its QR holds just these 12 digits, with no event or
 * signature, so an unknown one can't be told from a fake. Ours are UUIDs, so
 * the two never collide. Mirrors app/pages/admin/tickets/hometown.ts.
 */
const HOMETOWN_TICKET_RE = /^\d{12}$/;

export function isHometownTicketId(ticketId: string): boolean {
    return HOMETOWN_TICKET_RE.test(ticketId);
}

/**
 * The attendee doc holding one HomeTown ticket. Named for the number, so a
 * transaction reading it locks it even before it exists: two doors admitting
 * the same unlisted ticket can't both create it.
 */
export function hometownAttendeeId(ticketId: string): string {
    return `hometown-${ticketId}`;
}

/**
 * The attendee doc holding one order placed through the API. Named for the
 * seller and its order number, so a retried call finds the order it already
 * placed instead of issuing a second set of tickets, and another seller's
 * order with the same number is another doc. `seller` is empty for a key made
 * before seller IDs, whose orders are named for the number alone.
 */
export function apiOrderAttendeeId(seller: string, orderId: string): string {
    return seller ? `api_${seller}_${orderId}` : `api-${orderId}`;
}

/**
 * An order a seller placed through the API. Its buyer holds these exact ticket
 * IDs in the seller's app, so like a HomeTown ticket it's never re-issued,
 * replaced by an import or removed, nor emailed from here unless the order
 * asked for that (apiSendEmail), nor credited to an account (creditedEmail).
 */
export function isApiOrder(data: {source?: unknown} | undefined): boolean {
    return data?.source === "api";
}

/**
 * The address that finds the account an attendee's tickets count toward, at
 * check-in, in My Tickets and at sign-up. None for an API order: its buyer is
 * the seller's app user, and its email only says where the tickets were sent.
 */
export function creditedEmail(data: {source?: unknown; email?: unknown} | undefined): string {
    return !isApiOrder(data) && typeof data?.email === "string" ? data.email : "";
}
