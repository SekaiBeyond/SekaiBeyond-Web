import { useEffect, useRef, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { FiCalendar, FiCheck, FiMapPin, FiMaximize2, FiX } from 'react-icons/fi';
import { useLanguage } from '~/components/LanguageContextProvider';
import { callGetMyTickets, type HeldTicket, type HeldTicketEvent } from '~/lib/firebase';
import { useModalEffects } from '~/lib/useModalEffects';
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
 * Keep the screen lit while a code is being held up to a scanner. A phone that
 * dims halfway through someone lining up the reader is the commonest reason a
 * ticket has to be presented twice, and the lock is dropped the moment the modal
 * closes. The browser drops it when the tab goes to the background too, so it is
 * taken again on the way back — a queue is exactly where someone opens something
 * else and returns. An unsupported browser and a refused request are both fine:
 * the screen then behaves as it normally would.
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
            // Backgrounding releases the lock on our behalf, so the held
            // sentinel is spent — drop it before asking for another.
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
 * Which of the three states a row is in. Void wins over scanned, the way the
 * status line reads it — a ticket can be voided after it was scanned, and the
 * voiding is the part its holder needs to act on.
 */
const ticketStateClass = (ticket: HeldTicket): string =>
    ticket.voided ? ' profile-ticket--void' : ticket.redeemed ? ' profile-ticket--used' : '';

/**
 * A ticket blown up to be scanned: the code as large as the screen allows, on
 * white, with nothing near it to distract a reader. This is the whole reason the
 * row draws no code of its own — one shrunk into a card has to be held still and
 * close to be read, and at a door it never is.
 *
 * Only a ticket that has not been scanned opens, so the code here is always one
 * a reader could still take. A voided one is the exception and is stamped rather
 * than withheld: the id beneath it is what staff read out when a scan won't
 * take, and a ticket that turns out to be void is something its holder should be
 * able to look at for themselves rather than be shown nothing.
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
                    {/* marginSize is the spec's 4-module quiet zone, drawn into the
                        SVG itself rather than left to the padding around it — a
                        reader needs that border of white, and CSS is the wrong
                        place to promise it in module widths. */}
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
 * One ticket in the list: what it admits, where it stands, and — while it can
 * still get someone in — the way to its code. The whole row is the button, since
 * a small target beside the words would be the wrong shape for the phone this is
 * read on.
 *
 * A scanned ticket is a row and nothing more. Its code is spent, so offering it
 * again would only send someone back to a reader that refuses it; the row ends
 * in a mark of what happened instead of a way to open anything.
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
 * The holder's tickets on /profile, grouped under the event each one is for.
 * Every ticket is listed, spent and voided ones included: holding four and
 * having used one, you want to see which of the four is gone, and someone
 * already through the door still wants the stub they came in on.
 *
 * No code is drawn until one is asked for. A wall of QRs is unreadable at the
 * size a card allows, and it puts every code a holder owns on screen at once in
 * a room full of phones — one at a time, full size, both scans and keeps the
 * rest covered.
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
