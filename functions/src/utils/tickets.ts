/**
 * Whether a stored ticket got its holder through the door: redeemed, and not
 * voided since. Attendance is credited from this at sign-up, when a holder opens
 * their tickets, and by scripts/backfill-ticket-attendance.mts, so the three
 * agree on who was there.
 */
export function isScannedTicket(raw: unknown): boolean {
    const ticket = raw as {redeemed?: unknown; voided?: unknown} | null;
    return ticket?.redeemed === true && ticket.voided !== true;
}
