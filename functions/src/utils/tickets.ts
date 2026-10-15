/**
 * Whether a stored ticket got its holder through the door: redeemed and not
 * voided since. Both sign-up and the tickets view credit attendance from this,
 * so they agree.
 */
export function isScannedTicket(raw: unknown): boolean {
    const ticket = raw as {redeemed?: unknown; voided?: unknown} | null;
    return ticket?.redeemed === true && ticket.voided !== true;
}
