import { useEffect, useState } from 'react';
import { useLanguage } from '~/components/LanguageContextProvider';
import { callCancelEventDeletion, callRequestEventDeletion, callSetPastEventPublished, } from '~/lib/firebase';
import type { PastEvent } from '~/lib/pastEvents';
import type { Tag } from '~/lib/tags';
import type { UpcomingEvent } from '~/lib/upcomingEvents';
import { eventLocationDisplay, type Venue } from '~/lib/venues';
import { localized } from '~/lib/localized';
import type { UserRecord } from './types';
import { fetchEventAttendees, fetchEventStaff, type ShowToast } from './utils';
import { ClaimCodeSection } from './ClaimCodeSection';
import { EventStaffSection } from './EventStaffSection';
import { PastEventAttendeesSection } from './PastEventAttendeesSection';
import { TicketsSubtab } from './tickets/TicketsSubtab';
import { EventActions, EventDetailHeader, PendingDeletionNote, SubTab, useEventLifecycle } from './useEventLifecycle';

interface PastEventDetailViewProps {
    event: PastEvent;
    tags: Tag[];
    venues: Venue[];
    readOnly: boolean;
    showToast: ShowToast;
    refreshEvents: () => Promise<void>;
    onBack: () => void;
    onEdit: (event: PastEvent) => void;
    onLookupUser?: (uid: string) => void;
}

const toTicketEvent = (e: PastEvent): UpcomingEvent => ({
    id: e.id,
    title: e.title,
    titleCn: e.titleCn,
    description: e.description,
    descriptionCn: e.descriptionCn,
    location: e.location,
    locationCn: e.locationCn,
    venueId: e.venueId,
    roomIds: e.roomIds,
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
    con: e.con,
});

export const PastEventDetailView = ({
                                        event,
                                        tags,
                                        venues,
                                        readOnly,
                                        showToast,
                                        refreshEvents,
                                        onBack,
                                        onEdit,
                                        onLookupUser,
                                    }: PastEventDetailViewProps) => {
    const {isEnglish} = useLanguage();
    const [eventAttendees, setEventAttendees] = useState<UserRecord[]>([]);
    const [searching, setSearching] = useState(false);
    const [eventSubTab, setEventSubTab] = useState<'attendees' | 'staff' | 'tickets'>(
        event.paid ? 'tickets' : 'attendees',
    );
    const [staffCount, setStaffCount] = useState<number | null>(null);

    const lifecycle = useEventLifecycle({
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

    useEffect(() => {
        let active = true;

        const init = async () => {
            if (!event.paid) {
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
                const staff = await fetchEventStaff(event.id);
                if (!active) return;
                setStaffCount(staff.length);
            } catch {
            }
        };

        void init();

        return () => {
            active = false;
        };
    }, [event.id, event.paid, showToast]);

    return (
        <div>
            <EventDetailHeader
                image={event.icon}
                title={localized(isEnglish, event.title, event.titleCn)}
                onBack={onBack}
                backLabel={isEnglish ? 'All Events' : '所有活动'}
            >
                {event.con && (
                    <span>{isEnglish ? `Sekai Beyond Con ${event.con.year}` : `${event.con.year} 彼世界动漫游戏展`}</span>
                )}
                <span>{event.tagIds
                    .map(id => tags.find(t => t.id === id))
                    .filter((t): t is Tag => !!t)
                    .map(t => localized(isEnglish, t.name, t.nameCn))
                    .join(', ')}</span>
                <span>{event.date}</span>
                <span>{eventLocationDisplay(event, venues, isEnglish)}</span>
            </EventDetailHeader>

            {!readOnly && <EventActions event={event} onEdit={() => onEdit(event)} lifecycle={lifecycle}/>}
            <PendingDeletionNote deleteAt={event.deleteAt}/>
            <div className="admin-sub-tabs">
                {event.paid ? (
                    <SubTab active={eventSubTab === 'tickets'} onClick={() => setEventSubTab('tickets')}>
                        {isEnglish ? 'Tickets' : '门票'}
                    </SubTab>
                ) : (
                    <SubTab active={eventSubTab === 'attendees'} onClick={() => setEventSubTab('attendees')}
                            count={eventAttendees.length}>
                        {isEnglish ? 'Attendees' : '参加者'}
                    </SubTab>
                )}
                <SubTab active={eventSubTab === 'staff'} onClick={() => setEventSubTab('staff')} count={staffCount}>
                    {isEnglish ? 'Staff' : '工作人员'}
                </SubTab>
            </div>

            {event.paid && eventSubTab === 'tickets' && (
                <TicketsSubtab
                    event={toTicketEvent(event)}
                    readOnly
                    scanAccess="none"
                    collectionRoot="pastEvents"
                    showToast={showToast}
                />
            )}

            {!event.paid && eventSubTab === 'attendees' && (
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
