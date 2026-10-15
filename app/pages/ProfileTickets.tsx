import { useEffect, useRef, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { FiCalendar, FiCheck, FiMapPin, FiMaximize2, FiX } from 'react-icons/fi';
import { useLanguage } from '~/components/LanguageContextProvider';
import { callGetMyTickets, type HeldTicket, type HeldTicketEvent } from '~/lib/firebase';
import { formatSiteTime } from '~/lib/siteTime';
import { useModalEffects } from '~/lib/useModalEffects';
import { eventLocationDisplay, useVenues } from '~/lib/venues';
import { ticketTypeLabel } from '~/pages/admin/tickets/types';

/**
 * The signed-in holder's tickets for events not yet over: null in flight,
 * `failed` on error, empty once every event has ended. Pass null to skip: nobody
 * else's profile has tickets.
 *
 * Matched by email on the server, not uid: tickets are sold to an address, often
 * before there's an account.
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
 * Keep the screen lit while a code is held up to a scanner; dimming midway is
 * the commonest reason to present a ticket twice. Released when the modal
 * closes, and taken again on returning to the tab, since backgrounding drops it.
 * Unsupported or refused is fine.
 */
function useScreenAwake() {
    useEffect(() => {
        const wakeLock = (navigator as {
            wakeLock?: {request: (type: string) => Promise<{release: () => Promise<void>}>};
        }).wakeLock;
        if (!wakeLock?.request) return;

        let done = false;
        let sentinel: {release: () => Promise<void>} | null = null;

        const acquire = () => {
            if (done || sentinel || document.visibilityState !== 'visible') return;
            wakeLock.request('screen')
                .then(lock => {
                    // Closed while the request was in flight: let it go again.
                    if (done) {
                        void lock.release().catch(() => {
                        });
                        return;
                    }
                    sentinel = lock;
                })
                .catch(() => {
                });
        };

        const reacquire = () => {
            // Backgrounding already released it.
            if (document.visibilityState !== 'visible') sentinel = null;
            else acquire();
        };

        acquire();
        document.addEventListener('visibilitychange', reacquire);

        return () => {
            done = true;
            document.removeEventListener('visibilitychange', reacquire);
            void sentinel?.release().catch(() => {
            });
        };
    }, []);
}

/** What a ticket's state is called. */
const ticketStatusLabel = (ticket: HeldTicket, isEnglish: boolean): string => {
    if (ticket.voided) return isEnglish ? 'Void — please contact us' : '已作废 — 请联系我们';
    if (!ticket.redeemed) return isEnglish ? 'Ready to scan' : '等待扫描';
    const at = ticket.redeemedAt
        ? new Date(ticket.redeemedAt).toLocaleString(isEnglish ? 'en-US' : 'zh-CN', {
            month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
        })
        : '';
    return isEnglish ? `Checked in${at ? ` · ${at}` : ''}` : `已入场${at ? ` · ${at}` : ''}`;
};

/**
 * Void wins over scanned, as the status line reads: the voiding is what the
 * holder needs to act on.
 */
const ticketStateClass = (ticket: HeldTicket): string =>
    ticket.voided ? ' profile-ticket--void' : ticket.redeemed ? ' profile-ticket--used' : '';

/**
 * A ticket blown up to be scanned: the code as large as the screen allows, on
 * white. Rows draw no code because a small one is hard to read at a door.
 *
 * Only unscanned tickets open. A voided one opens stamped, so its holder can see
 * it and staff can read out the id.
 */
const TicketQrModal = ({ticket, eventTitle, claimUrl, onClose}: {
    ticket: HeldTicket;
    eventTitle: string;
    claimUrl: string;
    onClose: () => void;
}) => {
    const {isEnglish} = useLanguage();
    const ref = useRef<HTMLDivElement>(null);
    useModalEffects(true, ref, onClose);
    useScreenAwake();

    const type = ticketTypeLabel(ticket.type, isEnglish);

    return (
        <div ref={ref} className="modal-overlay" onClick={onClose}>
            <div
                className={`profile-ticket-modal${ticket.voided ? ' profile-ticket-modal--void' : ''}`}
                onClick={e => e.stopPropagation()}
                role="dialog"
                aria-modal="true"
                aria-label={isEnglish ? `${type} ticket for ${eventTitle}` : `${eventTitle} 的${type}门票`}
            >
                <button
                    type="button"
                    className="modal-close"
                    onClick={onClose}
                    aria-label={isEnglish ? 'Close' : '关闭'}
                >
                    ×
                </button>

                <p className="profile-ticket-modal-event">{eventTitle}</p>
                <span className="profile-ticket-type">{type}</span>

                <div className="profile-ticket-modal-qr">
                    {/* The spec's 4-module quiet zone, drawn into the SVG rather
                        than promised by CSS padding. */}
                    <QRCodeSVG value={claimUrl} size={512} level="M" marginSize={4}/>
                    {ticket.voided && (
                        <span className="profile-ticket-stamp" aria-hidden="true"><FiX/></span>
                    )}
                </div>

                <code className="profile-ticket-id">{ticket.ticketId}</code>
                <span className="profile-ticket-modal-status">{ticketStatusLabel(ticket, isEnglish)}</span>
            </div>
        </div>
    );
};

/**
 * One ticket: what it admits, where it stands, and while still usable, the way
 * to its code. The whole row is the button, for a phone. A scanned ticket's code
 * is spent, so it ends in a mark instead.
 */
const TicketStub = ({ticket, onOpen}: {ticket: HeldTicket; onOpen: () => void}) => {
    const {isEnglish} = useLanguage();
    const type = ticketTypeLabel(ticket.type, isEnglish);
    const state = ticketStateClass(ticket);
    const body = (
        <>
            <span className="profile-ticket-type">{type}</span>
            <span className="profile-ticket-status">{ticketStatusLabel(ticket, isEnglish)}</span>
        </>
    );

    if (ticket.redeemed) {
        return (
            <div className={`profile-ticket${state}`}>
                {body}
                <span className="profile-ticket-open" aria-hidden="true">
                    {ticket.voided ? <FiX/> : <FiCheck/>}
                </span>
            </div>
        );
    }

    return (
        <button
            type="button"
            className={`profile-ticket profile-ticket--tappable${state}`}
            onClick={onOpen}
            aria-label={isEnglish ? `Show the QR code for your ${type} ticket` : `显示${type}门票的二维码`}
        >
            {body}
            <FiMaximize2 className="profile-ticket-open" aria-hidden="true"/>
        </button>
    );
};

/** Which ticket's code is on screen, and what the modal needs to title it. */
interface OpenTicket {
    ticket: HeldTicket;
    eventId: string;
    eventTitle: string;
}

/**
 * The holder's tickets on /profile, grouped by event, spent and voided ones
 * included so they can see which is which. No code is drawn until asked for: a
 * wall of QRs is unreadable at card size and shows every code at once in a room
 * full of phones.
 */
export const ProfileTickets = ({ticketEvents}: {ticketEvents: HeldTicketEvent[]}) => {
    const {isEnglish} = useLanguage();
    const {venues} = useVenues();
    const [open, setOpen] = useState<OpenTicket | null>(null);
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
                                        {formatSiteTime(new Date(event.startAt), isEnglish, {
                                            year: 'numeric', month: 'long', day: 'numeric',
                                            hour: 'numeric', minute: '2-digit',
                                        })}
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
                                        onOpen={() => setOpen({
                                            ticket,
                                            eventId: event.eventId,
                                            eventTitle: title,
                                        })}
                                    />
                                ))}
                            </div>
                        </article>
                    );
                })}
            </div>

            <p className="profile-ticket-note">
                {isEnglish
                    ? 'Open a ticket and show its code at the door. Each one admits one person, once — please don’t post them publicly.'
                    : '入场时打开门票并出示二维码。每张门票仅可入场一人一次，请勿公开分享。'}
            </p>

            {open && (
                <TicketQrModal
                    ticket={open.ticket}
                    eventTitle={open.eventTitle}
                    claimUrl={`${origin}/claim?ticket=${encodeURIComponent(open.ticket.ticketId)}`
                        + `&event=${encodeURIComponent(open.eventId)}`}
                    onClose={() => setOpen(null)}
                />
            )}
        </section>
    );
};
