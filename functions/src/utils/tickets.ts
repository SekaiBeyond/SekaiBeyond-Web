/**
 * Whether a stored ticket got its holder through the door: redeemed, and not
 * voided since. Attendance is credited from this at sign-up and when a holder
 * opens their tickets, so the two agree on who was there.
 */
export function isScannedTicket(raw: unknown): boolean {
    const ticket = raw as {redeemed?: unknown; voided?: unknown} | null;
    return ticket?.redeemed === true && ticket.voided !== true;
}
