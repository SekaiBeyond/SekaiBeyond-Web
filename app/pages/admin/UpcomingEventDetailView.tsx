import { useEffect, useState } from 'react';
import { hasPermission, useAuth } from '~/components/AuthProvider';
import { useLanguage } from '~/components/LanguageContextProvider';
import {
    callArchiveUpcomingEvent,
    callCancelUpcomingEventDeletion,
    callRequestUpcomingEventDeletion,
    callSetUpcomingEventPublished,
} from '~/lib/firebase';
import type { UpcomingEvent } from '~/lib/upcomingEvents';
import type { Tag } from '~/lib/tags';
import { eventLocationDisplay, type Venue } from '~/lib/venues';
import type { UserRecord } from './types';
import { formatSiteTime } from '~/lib/siteTime';
import { localized } from '~/lib/localized';
import { fetchEventAttendees, fetchEventStaff, refreshAfterSave, type ShowToast } from './utils';
import { ClaimCodeSection } from './ClaimCodeSection';
import { EventAttendeesList } from './EventAttendeesList';
import { EventStaffSection } from './EventStaffSection';
import { TagMultiSelect } from './TagMultiSelect';
import { TicketsSubtab } from './tickets/TicketsSubtab';
import { EventActions, EventDetailHeader, PendingDeletionNote, SubTab, useEventLifecycle } from './useEventLifecycle';

interface UpcomingEventDetailViewProps {
    event: UpcomingEvent;
    venues: Venue[];
    tags: Tag[];
    readOnly: boolean;
    showToast: ShowToast;
    refreshEvents: () => Promise<void>;
    refreshPastEvents: () => Promise<void>;
    onBack: () => void;
    onEdit: (event: UpcomingEvent) => void;
    onLookupUser?: (uid: string) => void;
}

export const UpcomingEventDetailView = ({
                                            event,
                                            venues,
                                            tags,
                                            readOnly,
                                            showToast,
                                            refreshEvents,
                                            refreshPastEvents,
                                            onBack,
                                            onEdit,
                                            onLookupUser,
                                        }: UpcomingEventDetailViewProps) => {
    const {isEnglish} = useLanguage();
    const {profile} = useAuth();
    const [showArchive, setShowArchive] = useState(false);
    const [archiveTagIds, setArchiveTagIds] = useState<string[]>([]);
    const [archiving, setArchiving] = useState(false);
    const [eventSubTab, setEventSubTab] = useState<'codes' | 'attendees' | 'staff' | 'tickets'>(
        event.paid ? 'tickets' : 'codes',
    );
    const [eventAttendees, setEventAttendees] = useState<UserRecord[]>([]);
    const [searchingAttendees, setSearchingAttendees] = useState(false);
    const [staffCount, setStaffCount] = useState<number | null>(null);

    const lifecycle = useEventLifecycle({
        requestDeletion: callRequestUpcomingEventDeletion,
        cancelDeletion: callCancelUpcomingEventDeletion,
        setPublished: callSetUpcomingEventPublished,
        refresh: refreshEvents,
        showToast,
    });

    const viewer = profile && hasPermission(profile.group, 'staff') ? 'staff' : 'event-staff';
    useEffect(() => {
        let active = true;
        void fetchEventStaff(event.id, viewer)
            .then(staff => {
                if (active) setStaffCount(staff.length);
            })
            .catch(() => {
            });

        return () => {
            active = false;
        };
    }, [event.id, viewer]);

    const loadEventAttendees = async (eventId: string) => {
        setSearchingAttendees(true);
        try {
            setEventAttendees(await fetchEventAttendees(eventId));
        } catch {
            showToast(isEnglish ? 'Failed to load attendees.' : '加载参加者失败。', 'error');
        } finally {
            setSearchingAttendees(false);
        }
    };

    const archiveEvent = async () => {
        setArchiving(true);
        try {
            await callArchiveUpcomingEvent({eventId: event.id, tagIds: event.con ? [] : archiveTagIds});
            await refreshAfterSave(() => Promise.all([refreshEvents(), refreshPastEvents()]), showToast, isEnglish);
            onBack();
            showToast(isEnglish ? 'Event archived.' : '活动已归档。', 'success');
        } catch {
            showToast(isEnglish ? 'Failed to archive event.' : '归档活动失败。', 'error');
        } finally {
            setArchiving(false);
        }
    };

    const ended = event.endAt <= new Date();

    const subTab = event.paid && (eventSubTab === 'codes' || eventSubTab === 'attendees') ? 'tickets'
        : !event.paid && eventSubTab === 'tickets' ? 'codes'
            : eventSubTab;

    return (
        <div>
            <EventDetailHeader
                image={event.poster}
                title={localized(isEnglish, event.title, event.titleCn)}
                description={localized(isEnglish, event.description, event.descriptionCn)}
                onBack={onBack}
                backLabel={isEnglish ? 'All Upcoming Events' : '所有活动预告'}
            >
                {event.con && (
                    <span>{isEnglish ? `Sekai Beyond Con ${event.con.year}` : `${event.con.year} 彼世界动漫游戏展`}</span>
                )}
                <span>
                    {formatSiteTime(event.startAt, isEnglish, {
                        year: 'numeric', month: 'long', day: 'numeric',
                        hour: 'numeric', minute: 'numeric',
                    })}
                </span>
                <span>{eventLocationDisplay(event, venues, isEnglish)}</span>
            </EventDetailHeader>

            {!readOnly && (
                <>
                    <EventActions event={event} onEdit={() => onEdit(event)} lifecycle={lifecycle}>
                        <button
                            className="admin-toggle-btn admin-toggle-archive"
                            onClick={() => setShowArchive(!showArchive)}
                            disabled={!ended}
                            title={ended ? undefined : (isEnglish ? 'Available once the event has ended' : '活动结束后才能归档')}
                        >
                            {isEnglish ? 'Archive to Past Events' : '归档到往期活动'}
                        </button>
                    </EventActions>
                    <PendingDeletionNote deleteAt={event.deleteAt}/>
                </>
            )}

            {!readOnly && showArchive && ended && (
                <div className="admin-create-badge-form admin-section-mb">
                    <h4 className="admin-badges-title">
                        {isEnglish ? 'Archive Event' : '归档活动'}
                    </h4>
                    <p className="admin-helper-text">
                        {event.con
                            ? (isEnglish
                                ? `This will move the event from Upcoming to Sekai Beyond Con in Past Events, as the ${event.con.year} edition, keeping its poster.`
                                : `此操作会将活动从预告移到往期活动的“彼世界动漫游戏展”分组，作为 ${event.con.year} 年度，并保留其海报。`)
                            : (isEnglish
                                ? 'This will move the event from Upcoming to Past Events. You can optionally add one or more labels (e.g. "Workshop", "Game Night").'
                                : '此操作会将活动从预告移到往期活动。你可以选填一个或多个标签（如"工坊"、"游戏夜"）。')}
                    </p>
                    {!event.con && (
                        <div className="admin-form-grid">
                            <TagMultiSelect
                                tags={tags}
                                selected={archiveTagIds}
                                onChange={setArchiveTagIds}
                                isEnglish={isEnglish}
                            />
                        </div>
                    )}
                    <div className="admin-btn-row admin-mt-12">
                        <button
                            className="admin-toggle-btn admin-toggle-archive"
                            onClick={archiveEvent}
                            disabled={archiving}
                        >
                            {archiving
                                ? (isEnglish ? 'Archiving...' : '归档中...')
                                : (isEnglish ? 'Confirm Archive' : '确认归档')}
                        </button>
                        <button
                            className="admin-toggle-btn admin-toggle-cancel"
                            onClick={() => setShowArchive(false)}
                        >
                            {isEnglish ? 'Cancel' : '取消'}
                        </button>
                    </div>
                </div>
            )}

            <div className="admin-sub-tabs">
                {!event.paid && (
                    <SubTab active={subTab === 'codes'} onClick={() => setEventSubTab('codes')}>
                        {isEnglish ? 'Check-in Code' : '签到码'}
                    </SubTab>
                )}
                {!event.paid && (
                    <SubTab
                        active={subTab === 'attendees'}
                        onClick={() => {
                            setEventSubTab('attendees');
                            void loadEventAttendees(event.id);
                        }}
                        count={eventAttendees.length}
                    >
                        {isEnglish ? 'Attendees' : '参加者'}
                    </SubTab>
                )}
                {event.paid && (
                    <SubTab active={subTab === 'tickets'} onClick={() => setEventSubTab('tickets')}>
                        {isEnglish ? 'Tickets' : '门票'}
                    </SubTab>
                )}
                <SubTab active={subTab === 'staff'} onClick={() => setEventSubTab('staff')} count={staffCount}>
                    {isEnglish ? 'Staff' : '工作人员'}
                </SubTab>
            </div>

            {subTab === 'codes' && !event.paid && (
                <ClaimCodeSection
                    eventId={event.id}
                    variant="checkin"
                    showToast={showToast}
                    readOnly={readOnly}
                />
            )}

            {subTab === 'attendees' && !event.paid && (
                <EventAttendeesList
                    loading={searchingAttendees}
                    attendees={eventAttendees}
                    eventId={event.id}
                    onReload={() => loadEventAttendees(event.id)}
                    showToast={showToast}
                    readOnly={readOnly}
                />
            )}

            {subTab === 'staff' && !readOnly && (
                <ClaimCodeSection
                    eventId={event.id}
                    variant="staff"
                    showToast={showToast}
                    eventEndAt={event.endAt}
                />
            )}
            {subTab === 'staff' && (
                <EventStaffSection
                    eventId={event.id}
                    showToast={showToast}
                    readOnly={readOnly}
                    onCountChange={setStaffCount}
                    onLookupUser={onLookupUser}
                />
            )}

            {subTab === 'tickets' && event.paid && (
                <TicketsSubtab
                    event={event}
                    readOnly={readOnly}
                    scanAccess={readOnly ? 'event-days' : 'always'}
                    showToast={showToast}
                />
            )}
        </div>
    );
};
