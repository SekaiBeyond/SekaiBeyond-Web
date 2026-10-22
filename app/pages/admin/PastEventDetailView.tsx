import { useEffect, useState } from 'react';
import { useLanguage } from '~/components/LanguageContextProvider';
import { callCancelEventDeletion, callRequestEventDeletion, callSetPastEventPublished, } from '~/lib/firebase';
import type { PastEvent } from '~/lib/pastEvents';
import type { Tag } from '~/lib/tags';
import type { UpcomingEvent } from '~/lib/upcomingEvents';
import type { Venue } from '~/lib/venues';
import { eventLocationDisplay } from '~/lib/venues';
import type { UserRecord } from './types';
import { fetchEventAttendees, fetchEventStaffCount, pastEventHasTickets } from './utils';
import { ClaimCodeSection } from './ClaimCodeSection';
import { EventStaffSection } from './EventStaffSection';
import { PastEventAttendeesSection } from './PastEventAttendeesSection';
import { TicketsSubtab } from './tickets/TicketsSubtab';
import {
    DeleteOrCancelButton,
    PendingDeletionNote,
    PublishToggleButton,
    useEventLifecycle,
} from './useEventLifecycle';

interface PastEventDetailViewProps {
    event: PastEvent;
    tags: Tag[];
    venues: Venue[];
    readOnly?: boolean;
    showToast: (message: string, type: 'success' | 'warning' | 'error') => void;
    refreshEvents: () => Promise<void>;
    onBack: () => void;
    onEdit: (event: PastEvent) => void;
    onLookupUser?: (uid: string) => void;
}

// An archived event in the UpcomingEvent shape TicketsSubtab expects; only the
// read-only views' fields matter.
const toTicketEvent = (e: PastEvent): UpcomingEvent => ({
    id: e.id,
    title: e.title,
    titleCn: e.titleCn,
    description: e.description,
    descriptionCn: e.descriptionCn,
    location: e.location,
    locationCn: e.locationCn,
    venueId: e.venueId,
    startAt: e.date ? new Date(e.date) : new Date(),
    endAt: e.date ? new Date(e.date) : new Date(),
    poster: '',
    emailHeaderBg: '',
    posterCredit: '',
    buyTicket: '',
    learnMore: '',
    customButtonText: '',
    customButtonTextCn: '',
    customButtonLink: '',
    published: e.published,
    paid: true,
    deleteAt: e.deleteAt,
});

export const PastEventDetailView = ({
                                        event,
                                        tags,
                                        venues,
                                        readOnly = false,
                                        showToast,
                                        refreshEvents,
                                        onBack,
                                        onEdit,
                                        onLookupUser,
                                    }: PastEventDetailViewProps) => {
    const {isEnglish} = useLanguage();
    const [eventAttendees, setEventAttendees] = useState<UserRecord[]>([]);
    const [searching, setSearching] = useState(false);
    // Paid events show Tickets/Stats; free ones the attendee list.
    const [eventSubTab, setEventSubTab] = useState<'attendees' | 'staff' | 'tickets'>(
        event.paid ? 'tickets' : 'attendees',
    );
    const [staffCount, setStaffCount] = useState<number | null>(null);
    const [isPaidEvent, setIsPaidEvent] = useState(event.paid === true);

    const {deletionBusyId, requestDeleteEvent, cancelDeleteEvent, togglePublish} = useEventLifecycle({
        requestDeletion: callRequestEventDeletion,
        cancelDeletion: callCancelEventDeletion,
        setPublished: callSetPastEventPublished,
        refresh: refreshEvents,
        showToast,
    });

    const loadEventAttendees = async (eventId: string) => {
        setSearching(true);
        try {
            const list = await fetchEventAttendees(eventId);
            setEventAttendees(list);
        } catch {
            showToast(isEnglish ? 'Failed to load attendees.' : '加载参加者失败。', 'error');
        } finally {
            setSearching(false);
        }
    };

    // Once per event: the view is keyed on its id, and `paid` is fixed at
    // archive.
    useEffect(() => {
        let active = true;

        const init = async () => {
            let paid = event.paid === true;
            if (!paid) {
                // No `paid` flag on the doc: probe for ticket attendees instead.
                try {
                    paid = await pastEventHasTickets(event.id);
                    if (!active) return;
                    if (paid) {
                        setIsPaidEvent(true);
                        setEventSubTab('tickets');
                    }
                } catch {
                    /* Non-fatal — fall back to the free attendee view. */
                }
            }

            if (!paid) {
                setSearching(true);
                try {
                    const attendees = await fetchEventAttendees(event.id);
                    if (!active) return;
                    setEventAttendees(attendees);
                } catch (err) {
                    if (!active) return;
                    console.error('Failed to load attendees:', err);
                    showToast(isEnglish ? 'Failed to load attendees.' : '加载参加者失败。', 'error');
                } finally {
                    if (active) setSearching(false);
                }
            }

            try {
                const count = await fetchEventStaffCount(event.id);
                if (!active) return;
                setStaffCount(count);
            } catch {
                /* Non-fatal — count badge just won't appear. */
            }
        };

        void init();

        return () => {
            active = false;
        };
        // Not keyed on isEnglish: a language toggle shouldn't refetch.
    }, [event.id, event.paid, showToast]);

    return (
        <div className="admin-event-detail">
            <button className="admin-btn admin-btn--link" onClick={onBack}>
                &larr; {isEnglish ? 'All Events' : '所有活动'}
            </button>

            <div className="admin-event-detail-header">
                {event.icon && (
                    <img src={event.icon} alt="" className="admin-event-detail-img"/>
                )}
                <div>
                    <h3>{isEnglish ? event.title : (event.titleCn || event.title)}</h3>
                    <p className="admin-event-detail-meta">
                        <span>{event.tagIds
                            .map(id => tags.find(t => t.id === id))
                            .filter((t): t is Tag => !!t)
                            .map(t => isEnglish ? t.name : (t.nameCn || t.name))
                            .join(', ')}</span>
                        <span>{event.date}</span>
                        <span>{eventLocationDisplay(event.location, event.locationCn, event.venueId, venues, isEnglish)}</span>
                    </p>
                </div>
            </div>

            {!readOnly && (
                <div className="admin-form-actions admin-section-mb">
                    <button
                        className="admin-toggle-btn admin-toggle-edit"
                        onClick={() => onEdit(event)}
                    >
                        {isEnglish ? 'Edit Event' : '编辑活动'}
                    </button>
                    <PublishToggleButton
                        published={event.published}
                        onToggle={() => togglePublish(event)}
                    />
                    <DeleteOrCancelButton
                        deleteAt={event.deleteAt}
                        busy={deletionBusyId === event.id}
                        onRequest={() => requestDeleteEvent(event)}
                        onCancel={() => cancelDeleteEvent(event)}
                    />
                </div>
            )}
            <PendingDeletionNote deleteAt={event.deleteAt}/>
            <div className="admin-sub-tabs">
                {isPaidEvent ? (
                    <button
                        className={`admin-sub-tab ${eventSubTab === 'tickets' ? 'admin-sub-tab-active' : ''}`}
                        onClick={() => setEventSubTab('tickets')}
                    >
                        {isEnglish ? 'Tickets' : '门票'}
                    </button>
                ) : (
                    <button
                        className={`admin-sub-tab ${eventSubTab === 'attendees' ? 'admin-sub-tab-active' : ''}`}
                        onClick={() => setEventSubTab('attendees')}
                    >
                        {isEnglish ? 'Attendees' : '参加者'}
                        {eventAttendees.length > 0 && (
                            <span className="admin-sub-tab-count">{eventAttendees.length}</span>
                        )}
                    </button>
                )}
                <button
                    className={`admin-sub-tab ${eventSubTab === 'staff' ? 'admin-sub-tab-active' : ''}`}
                    onClick={() => setEventSubTab('staff')}
                >
                    {isEnglish ? 'Staff' : '工作人员'}
                    {staffCount != null && staffCount > 0 && (
                        <span className="admin-sub-tab-count">{staffCount}</span>
                    )}
                </button>
            </div>

            {isPaidEvent && eventSubTab === 'tickets' && (
                // Read-only: copied under pastEvents on archive, and the event
                // is over.
                <TicketsSubtab
                    event={toTicketEvent(event)}
                    readOnly
                    scanAccess="none"
                    collectionRoot="pastEvents"
                    showToast={showToast}
                />
            )}

            {!isPaidEvent && eventSubTab === 'attendees' && (
                <PastEventAttendeesSection
                    eventId={event.id}
                    attendees={eventAttendees}
                    loading={searching}
                    onReload={() => loadEventAttendees(event.id)}
                    showToast={showToast}
                    readOnly={readOnly}
                />
            )}

            {eventSubTab === 'staff' && !readOnly && (
                <ClaimCodeSection
                    eventId={event.id}
                    variant="staff"
                    showToast={showToast}
                />
            )}

            {eventSubTab === 'staff' && (
                <EventStaffSection
                    eventId={event.id}
                    showToast={showToast}
                    onCountChange={setStaffCount}
                    onAttendeeRemoved={() => loadEventAttendees(event.id)}
                    onLookupUser={onLookupUser}
                    readOnly={readOnly}
                />
            )}
        </div>
    );
};
