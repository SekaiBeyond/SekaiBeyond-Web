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
