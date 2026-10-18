import { useEffect, useState } from 'react';
import { useLanguage } from '~/components/LanguageContextProvider';
import {
    callArchiveUpcomingEvent,
    callCancelUpcomingEventDeletion,
    callRequestUpcomingEventDeletion,
    callSetUpcomingEventPublished,
} from '~/lib/firebase';
import type { UpcomingEvent } from '~/lib/upcomingEvents';
import type { Tag } from '~/lib/tags';
import type { Venue } from '~/lib/venues';
import { eventLocationDisplay } from '~/lib/venues';
import type { UserRecord } from './types';
import { formatSiteTime } from '~/lib/siteTime';
import { fetchEventAttendees, fetchEventStaffCount, refreshAfterSave } from './utils';
import { ClaimCodeSection } from './ClaimCodeSection';
import { EventAttendeesList } from './EventAttendeesList';
import { EventStaffSection } from './EventStaffSection';
import { TagMultiSelect } from './TagMultiSelect';
import { TicketsSubtab } from './tickets/TicketsSubtab';
import {
    DeleteOrCancelButton,
    PendingDeletionNote,
    PublishToggleButton,
    useEventLifecycle,
} from './useEventLifecycle';

interface UpcomingEventDetailViewProps {
    event: UpcomingEvent;
    venues: Venue[];
    tags: Tag[];
    readOnly?: boolean;
    showToast: (message: string, type: 'success' | 'warning' | 'error') => void;
    refreshEvents: () => Promise<void>;
    refreshPastEvents: () => Promise<void>;
    onBack: () => void;
    onEdit: (event: UpcomingEvent) => void;
}

export const UpcomingEventDetailView = ({
                                            event,
                                            venues,
                                            tags,
                                            readOnly = false,
                                            showToast,
                                            refreshEvents,
                                            refreshPastEvents,
                                            onBack,
                                            onEdit,
                                        }: UpcomingEventDetailViewProps) => {
    const {isEnglish} = useLanguage();
    const [showArchive, setShowArchive] = useState(false);
    const [archiveTagIds, setArchiveTagIds] = useState<string[]>([]);
    const [archiving, setArchiving] = useState(false);
    const [eventSubTab, setEventSubTab] = useState<'codes' | 'attendees' | 'staff' | 'tickets'>(
        event.paid ? 'tickets' : 'codes',
    );
    const [eventAttendees, setEventAttendees] = useState<UserRecord[]>([]);
    const [searchingAttendees, setSearchingAttendees] = useState(false);
    const [staffCount, setStaffCount] = useState<number | null>(null);

    const {deletionBusyId, requestDeleteEvent, cancelDeleteEvent, togglePublish} = useEventLifecycle({
        requestDeletion: callRequestUpcomingEventDeletion,
        cancelDeletion: callCancelUpcomingEventDeletion,
        setPublished: callSetUpcomingEventPublished,
        refresh: refreshEvents,
        showToast,
    });

    // The view is keyed on the event's id, so this runs once per event.
    useEffect(() => {
        let active = true;
        void fetchEventStaffCount(event.id)
            .then(count => {
                if (active) setStaffCount(count);
            })
            .catch(() => {
                /* Non-fatal — count badge just won't appear. */
            });

        return () => {
            active = false;
        };
    }, [event.id]);

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
            await callArchiveUpcomingEvent({eventId: event.id, tagIds: archiveTagIds});
            await refreshAfterSave(() => Promise.all([refreshEvents(), refreshPastEvents()]), showToast, isEnglish);
            onBack();
            showToast(isEnglish ? 'Event archived.' : '活动已归档。', 'success');
        } catch {
            showToast(isEnglish ? 'Failed to archive event.' : '归档活动失败。', 'error');
        } finally {
            setArchiving(false);
        }
    };

    // Derived, so switching an open event to or from paid never renders a tab it
    // doesn't have.
    const subTab = event.paid && (eventSubTab === 'codes' || eventSubTab === 'attendees') ? 'tickets'
        : !event.paid && eventSubTab === 'tickets' ? 'codes'
            : eventSubTab;

    return (
        <div className="admin-event-detail">
            <button
                className="admin-btn admin-btn--link"
                onClick={onBack}
            >
                &larr; {isEnglish ? 'All Upcoming Events' : '所有活动预告'}
            </button>

            <div className="admin-event-detail-header">
                {event.poster && (
                    <img src={event.poster} alt="" className="admin-event-detail-img"/>
                )}
                <div>
                    <h3>{isEnglish ? event.title : (event.titleCn || event.title)}</h3>
                    <p className="admin-event-detail-meta">
                        <span>
                            {formatSiteTime(event.startAt, isEnglish, {
                                year: 'numeric', month: 'long', day: 'numeric',
                                hour: 'numeric', minute: 'numeric',
                            })}
                        </span>
                        <span>{eventLocationDisplay(event.location, event.locationCn, event.venueId, venues, isEnglish)}</span>
                    </p>
                    <p className="admin-description-text">
                        {isEnglish ? event.description : (event.descriptionCn || event.description)}
                    </p>
                </div>
            </div>

            {!readOnly && (
                <>
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
                        <button
                            className="admin-toggle-btn admin-toggle-archive"
                            onClick={() => setShowArchive(!showArchive)}
                        >
                            {isEnglish ? 'Archive to Past Events' : '归档到往期活动'}
                        </button>
                    </div>
                    <PendingDeletionNote deleteAt={event.deleteAt}/>
                </>
            )}

            {!readOnly && showArchive && (
                <div className="admin-create-badge-form admin-section-mb">
                    <h4 className="admin-badges-title">
                        {isEnglish ? 'Archive Event' : '归档活动'}
                    </h4>
                    <p className="admin-helper-text">
                        {isEnglish
                            ? 'This will move the event from Upcoming to Past Events. You can optionally add one or more labels (e.g. "Workshop", "Convention").'
                            : '此操作会将活动从预告移到往期活动。你可以选填一个或多个标签（如"工作坊"、"展会"）。'}
                    </p>
                    <div className="admin-form-grid">
                        <TagMultiSelect
                            tags={tags}
                            selected={archiveTagIds}
                            onChange={setArchiveTagIds}
                            isEnglish={isEnglish}
                        />
                    </div>
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
                    <button
                        className={`admin-sub-tab ${subTab === 'codes' ? 'admin-sub-tab-active' : ''}`}
                        onClick={() => setEventSubTab('codes')}
                    >
                        {isEnglish ? 'Check-in Code' : '签到码'}
                    </button>
                )}
                {!event.paid && (
                    <button
                        className={`admin-sub-tab ${subTab === 'attendees' ? 'admin-sub-tab-active' : ''}`}
                        onClick={() => {
                            setEventSubTab('attendees');
                            void loadEventAttendees(event.id);
                        }}
                    >
                        {isEnglish ? 'Attendees' : '参加者'}
                        {eventAttendees.length > 0 && (
                            <span className="admin-sub-tab-count">{eventAttendees.length}</span>
                        )}
                    </button>
                )}
                {event.paid && (
                    <button
                        className={`admin-sub-tab ${subTab === 'tickets' ? 'admin-sub-tab-active' : ''}`}
                        onClick={() => setEventSubTab('tickets')}
                    >
                        {isEnglish ? 'Tickets' : '门票'}
                    </button>
                )}
                <button
                    className={`admin-sub-tab ${subTab === 'staff' ? 'admin-sub-tab-active' : ''}`}
                    onClick={() => setEventSubTab('staff')}
                >
                    {isEnglish ? 'Staff' : '工作人员'}
                    {staffCount != null && staffCount > 0 && (
                        <span className="admin-sub-tab-count">{staffCount}</span>
                    )}
                </button>
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
                />
            )}

            {subTab === 'tickets' && event.paid && (
                <TicketsSubtab
                    event={event}
                    readOnly={readOnly}
                    // Read-only means the staff group or event staff, who scan on
                    // the event's days.
                    scanAccess={readOnly ? 'event-days' : 'always'}
                    showToast={showToast}
                />
            )}
        </div>
    );
};
