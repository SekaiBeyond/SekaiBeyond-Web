import { useEffect, useRef, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { FiCalendar, FiCheck, FiMapPin, FiMaximize2, FiX } from 'react-icons/fi';
import { useLanguage } from '~/components/LanguageContextProvider';
import { callGetMyTickets, type HeldTicket, type HeldTicketEvent } from '~/lib/firebase';
import { formatSiteTime } from '~/lib/siteTime';
import { useModalEffects } from '~/lib/useModalEffects';
import { eventLocationDisplay, useVenues } from '~/lib/venues';
import { localized } from '~/lib/localized';
import { ticketTypeLabel } from '~/pages/admin/tickets/types';

export const fetchHeldTickets = async (): Promise<HeldTicketEvent[]> => (await callGetMyTickets()).data.events;

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

const ticketStateClass = (ticket: HeldTicket): string =>
    ticket.voided ? ' profile-ticket--void' : ticket.redeemed ? ' profile-ticket--used' : '';

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

interface OpenTicket {
    ticket: HeldTicket;
    eventId: string;
    eventTitle: string;
}

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
                    const title = localized(isEnglish, event.title, event.titleCn);
                    const where = eventLocationDisplay(event, venues, isEnglish);
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
