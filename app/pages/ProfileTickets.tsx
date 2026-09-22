import { useEffect, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { FiCalendar, FiCheck, FiMapPin, FiX } from 'react-icons/fi';
import { useLanguage } from '~/components/LanguageContextProvider';
import { callGetMyTickets, type HeldTicket, type HeldTicketEvent } from '~/lib/firebase';
import { eventLocationDisplay, useVenues } from '~/lib/venues';
import { ticketTypeLabel } from '~/pages/admin/tickets/types';

/**
 * The tickets the signed-in holder has for events that haven't ended: null while
 * the call is in flight, `failed` if it didn't land, and empty once every event
 * they hold a ticket for is over — the server cuts on the event's end, not on
 * the scan, so the card lasts exactly as long as the event does. Pass null to
 * skip the call — a ticket is its holder's own business, so nobody else's
 * profile has one.
 *
 * Matching is by email on the server, not by uid: a ticket is bought before the
 * buyer necessarily has an account, and the attendee list only ever knew the
 * address it was sold to.
 */
export function useHeldTickets(uid: string | null): {ticketEvents: HeldTicketEvent[] | null; failed: boolean} {
    const [ticketEvents, setTicketEvents] = useState<HeldTicketEvent[] | null>(null);
    const [failed, setFailed] = useState(false);

    useEffect(() => {
        setTicketEvents(null);
        setFailed(false);
        if (!uid) return;
        let stale = false;
        callGetMyTickets()
            .then(result => {
                if (!stale) setTicketEvents(result.data.events ?? []);
            })
            .catch(() => {
                if (!stale) setFailed(true);
            });
        return () => {
            stale = true;
        };
    }, [uid]);

    return {ticketEvents, failed};
}

/**
 * One ticket, as the door sees it. The QR carries the same /claim link the ticket
 * email does, so a screenshot and this page scan alike; redeeming it needs staff
 * rights for the event, which is why showing it to its holder is safe.
 *
 * A spent or voided ticket keeps its code on screen under a stamp rather than
 * losing it — the id is what staff read out when a scan won't take.
 */
const TicketStub = ({ticket, eventId, origin}: {ticket: HeldTicket; eventId: string; origin: string}) => {
    const {isEnglish} = useLanguage();
    const claimUrl =
        `${origin}/claim?ticket=${encodeURIComponent(ticket.ticketId)}&event=${encodeURIComponent(eventId)}`;
    const spent = ticket.voided || ticket.redeemed;
    const scannedAt = ticket.redeemedAt
        ? new Date(ticket.redeemedAt).toLocaleString(isEnglish ? 'en-US' : 'zh-CN', {
            month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
        })
        : '';

    return (
        <div
            className={`profile-ticket${ticket.voided ? ' profile-ticket--void'
                : ticket.redeemed ? ' profile-ticket--used' : ''}`}
        >
            <span className="profile-ticket-type">{ticketTypeLabel(ticket.type, isEnglish)}</span>
            <div className="profile-ticket-qr">
                <QRCodeSVG value={claimUrl} size={148} level="M"/>
                {spent && (
                    <span className="profile-ticket-stamp" aria-hidden="true">
                        {ticket.voided ? <FiX/> : <FiCheck/>}
                    </span>
                )}
            </div>
            <code className="profile-ticket-id">{ticket.ticketId}</code>
            <span className="profile-ticket-status">
                {ticket.voided
                    ? (isEnglish ? 'Void — please contact us' : '已作废 — 请联系我们')
                    : ticket.redeemed
                        ? (isEnglish ? `Checked in${scannedAt ? ` · ${scannedAt}` : ''}`
                            : `已入场${scannedAt ? ` · ${scannedAt}` : ''}`)
                        : (isEnglish ? 'Ready to scan' : '等待扫描')}
            </span>
        </div>
    );
};

/**
 * The holder's tickets on /profile, grouped under the event each one is for.
 * Every ticket is drawn, spent and voided ones included: holding four and having
 * used one, you want to see which of the four is gone, and someone already
 * through the door still wants the stub they came in on.
 */
export const ProfileTickets = ({ticketEvents}: {ticketEvents: HeldTicketEvent[]}) => {
    const {isEnglish} = useLanguage();
    const {venues} = useVenues();
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    const total = ticketEvents.reduce((sum, event) => sum + event.tickets.length, 0);

    return (
        <section className="profile-card">
            <div className="profile-card-head">
                <h2 className="profile-card-title">{isEnglish ? 'Your Tickets' : '你的门票'}</h2>
                <span className="profile-card-count">{total}</span>
            </div>

            <div className="profile-ticket-events">
                {ticketEvents.map(event => {
                    const title = isEnglish ? event.title : (event.titleCn || event.title);
                    const where = eventLocationDisplay(
                        event.location, event.locationCn, event.venueId, venues, isEnglish,
                    );
                    return (
                        <article key={event.eventId} className="profile-ticket-event">
                            <header className="profile-ticket-event-head">
                                {event.poster && (
                                    <img src={event.poster} alt="" className="profile-ticket-poster"/>
                                )}
                                <div className="profile-ticket-event-meta">
                                    <h3 className="profile-ticket-event-title">{title}</h3>
                                    <p className="profile-ticket-event-line">
                                        <FiCalendar aria-hidden="true"/>
                                        {new Date(event.startAt).toLocaleString(
                                            isEnglish ? 'en-US' : 'zh-CN',
                                            {
                                                year: 'numeric', month: 'long', day: 'numeric',
                                                hour: 'numeric', minute: '2-digit',
                                            },
                                        )}
                                    </p>
                                    {where && (
                                        <p className="profile-ticket-event-line">
                                            <FiMapPin aria-hidden="true"/>
                                            {where}
                                        </p>
                                    )}
                                </div>
                            </header>
                            <div className="profile-ticket-grid">
                                {event.tickets.map(ticket => (
                                    <TicketStub
                                        key={ticket.ticketId}
                                        ticket={ticket}
                                        eventId={event.eventId}
                                        origin={origin}
                                    />
                                ))}
                            </div>
                        </article>
                    );
                })}
            </div>

            <p className="profile-ticket-note">
                {isEnglish
                    ? 'Show a code at the door. Each one admits one person, once — please don’t post them publicly.'
                    : '入场时出示二维码。每个二维码仅可入场一人一次，请勿公开分享。'}
            </p>
        </section>
    );
};
