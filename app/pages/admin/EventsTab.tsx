import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { useLanguage } from '~/components/LanguageContextProvider';
import {
    callCancelEventDeletion,
    callRequestEventDeletion,
    callSavePastEvent,
    callSetPastEventPublished,
    callUploadAdminImage,
} from '~/lib/firebase';
import type { PastEvent } from '~/lib/pastEvents';
import type { Tag } from '~/lib/tags';
import type { UpcomingEvent } from '~/lib/upcomingEvents';
import type { UserRecord } from './types';
import { eventLocationDisplay, useVenues } from '~/lib/venues';
import { fetchEventAttendees, fetchEventStaffCount, pastEventHasTickets } from './utils';
import { BilingualFormField } from './BilingualFormField';
import { LocationFormField } from './LocationFormField';
import { ClaimCodeSection } from './ClaimCodeSection';
import { EventStaffSection } from './EventStaffSection';
import { ImageUploadField } from './ImageUploadField';
import { PastEventAttendeesSection } from './PastEventAttendeesSection';
import { TagMultiSelect } from './TagMultiSelect';
import { TicketsSubtab } from './tickets/TicketsSubtab';
import {
    DeleteOrCancelButton,
    PendingDeletionNote,
    PublishToggleButton,
    useEventLifecycle,
} from './useEventLifecycle';

interface EventsTabProps {
    pastEvents: PastEvent[];
    refreshEvents: () => Promise<void>;
    tags: Tag[];
    showToast: (message: string, type: 'success' | 'warning' | 'error') => void;
    onDetailChange?: (inDetail: boolean) => void;
    readOnly?: boolean;
}

// Adapt an archived event to the UpcomingEvent shape TicketsSubtab expects.
// Only the fields the read-only Attendees/Stats view reads are meaningful; the
// rest are placeholders (the Import/Template/Send sections that consume them are
// hidden in readOnly mode).
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

export interface EventsTabHandle {
    selectManagedEvent: (eventId: string) => Promise<void>;
}

export const EventsTab = forwardRef<EventsTabHandle, EventsTabProps>(({
                                                                          pastEvents,
                                                                          refreshEvents,
                                                                          tags,
                                                                          showToast,
                                                                          onDetailChange,
                                                                          readOnly = false,
                                                                      }, forwardedRef) => {
    const {isEnglish} = useLanguage();
    const {venues} = useVenues();
    const [managedEvent, setManagedEvent] = useState<string | null>(null);

    useEffect(() => {
        onDetailChange?.(managedEvent !== null);
    }, [managedEvent, onDetailChange]);
    const [eventAttendees, setEventAttendees] = useState<UserRecord[]>([]);
    const [searching, setSearching] = useState(false);
    const [showCreateEvent, setShowCreateEvent] = useState(false);
    const [editingEvent, setEditingEvent] = useState<PastEvent | null>(null);
    const [eventForm, setEventForm] = useState({
        title: '', titleCn: '', tagIds: [] as string[], date: '',
        location: '', locationCn: '', venueId: '',
        description: '', descriptionCn: '', icon: '', recapLink: '', recapLinkCn: '',
    });
    const [savingEvent, setSavingEvent] = useState(false);
    const [eventImage, setEventImage] = useState<File | null>(null);
    const [eventImagePreview, setEventImagePreview] = useState<string | null>(null);
    const [eventSubTab, setEventSubTab] = useState<'attendees' | 'staff' | 'tickets'>('attendees');
    const {deletionBusyId, requestDeleteEvent, cancelDeleteEvent, togglePublish} = useEventLifecycle({
        requestDeletion: callRequestEventDeletion,
        cancelDeletion: callCancelEventDeletion,
        setPublished: callSetPastEventPublished,
        refresh: refreshEvents,
        showToast,
    });
    const [staffCount, setStaffCount] = useState<number | null>(null);
    const [isPaidEvent, setIsPaidEvent] = useState(false);
    const selectGenRef = useRef(0);

    const selectManagedEvent = async (eventId: string) => {
        const gen = ++selectGenRef.current;
        const evt = pastEvents.find(e => e.id === eventId) ?? null;
        const flaggedPaid = evt?.paid === true;
        setManagedEvent(eventId);
        setEventAttendees([]);
        setStaffCount(null);
        // Paid events show the read-only Tickets/Stats view; free events the
        // user-record attendee list.
        setIsPaidEvent(flaggedPaid);
        setEventSubTab(flaggedPaid ? 'tickets' : 'attendees');

        let paid = flaggedPaid;
        if (!paid) {
            // Fall back to probing the ticket attendees subcollection for events
            // archived before the `paid` flag was stored on the past-event doc.
            try {
                paid = await pastEventHasTickets(eventId);
                if (selectGenRef.current !== gen) return;
                if (paid) {
                    setIsPaidEvent(true);
                    setEventSubTab('tickets');
                }
            } catch {
                // Non-fatal — fall back to the free attendee view.
            }
        }

        if (!paid) {
            try {
                await loadEventAttendees(eventId);
            } catch (err) {
                if (selectGenRef.current !== gen) return;
                console.error('Failed to load attendees:', err);
                showToast(isEnglish ? 'Failed to load attendees.' : '加载参加者失败。', 'error');
            }
        }
        try {
            const count = await fetchEventStaffCount(eventId);
            if (selectGenRef.current !== gen) return;
            setStaffCount(count);
        } catch {
            // Non-fatal — count badge just won't appear.
        }
    };

    useImperativeHandle(forwardedRef, () => ({selectManagedEvent}));

    const resetEventForm = () => {
        setEventForm({
            title: '', titleCn: '', tagIds: [], date: '',
            location: '', locationCn: '', venueId: '',
            description: '', descriptionCn: '', icon: '', recapLink: '', recapLinkCn: '',
        });
        setEventImage(null);
        if (eventImagePreview?.startsWith('blob:')) URL.revokeObjectURL(eventImagePreview);
        setEventImagePreview(null);
    };

    const openCreateEvent = () => {
        resetEventForm();
        setEditingEvent(null);
        setShowCreateEvent(true);
    };

    const openEditEvent = (event: PastEvent) => {
        const parts = event.date.split('-');
        const normalizedDate = parts.length === 3
            ? `${parts[0]}-${parts[1].padStart(2, '0')}-${parts[2].padStart(2, '0')}`
            : event.date;
        setEventForm({
            title: event.title, titleCn: event.titleCn, tagIds: event.tagIds,
            date: normalizedDate,
            location: event.location, locationCn: event.locationCn, venueId: event.venueId,
            description: event.description, descriptionCn: event.descriptionCn, icon: event.icon,
            recapLink: event.recapLink, recapLinkCn: event.recapLinkCn,
        });
        setEditingEvent(event);
        setEventImage(null);
        setEventImagePreview(event.icon || null);
        setShowCreateEvent(true);
    };

    const loadEventAttendees = async (eventId: string) => {
        const gen = selectGenRef.current;
        setSearching(true);
        try {
            const list = await fetchEventAttendees(eventId);
            if (selectGenRef.current !== gen) return;
            setEventAttendees(list);
        } catch {
            if (selectGenRef.current !== gen) return;
            showToast(isEnglish ? 'Failed to load attendees.' : '加载参加者失败。', 'error');
        } finally {
            if (selectGenRef.current === gen) setSearching(false);
        }
    };

    const saveEvent = async () => {
        if (!eventForm.title.trim() || !eventForm.date.trim()) return;
        setSavingEvent(true);
        try {
            let iconUrl = eventForm.icon;
            if (eventImage) {
                const imageId = crypto.randomUUID();
                iconUrl = await callUploadAdminImage(eventImage, `events/${imageId}.webp`);
            }

            await callSavePastEvent({
                ...(editingEvent ? {eventId: editingEvent.id} : {}),
                title: eventForm.title,
                titleCn: eventForm.titleCn,
                tagIds: eventForm.tagIds,
                date: eventForm.date,
                location: eventForm.location,
                locationCn: eventForm.locationCn,
                venueId: eventForm.venueId,
                description: eventForm.description,
                descriptionCn: eventForm.descriptionCn,
                icon: iconUrl,
                recapLink: eventForm.recapLink.trim(),
                recapLinkCn: eventForm.recapLinkCn.trim(),
            });

            await refreshEvents();
            showToast(
                editingEvent
                    ? (isEnglish ? 'Event updated.' : '活动已更新。')
                    : (isEnglish ? 'Event created.' : '活动已创建。'),
                'success',
            );
            setShowCreateEvent(false);
            resetEventForm();
            setEditingEvent(null);
        } catch {
            showToast(isEnglish ? 'Failed to save event.' : '保存活动失败。', 'error');
        } finally {
            setSavingEvent(false);
        }
    };

    const managedEvt = managedEvent ? pastEvents.find(e => e.id === managedEvent) ?? null : null;

    return (
        <div className="admin-section">
            {!managedEvent ? (
                <>
                    {!readOnly && showCreateEvent ? (
                        <div className="admin-create-badge-form">
                            <h4 className="admin-badges-title">
                                {editingEvent
                                    ? (isEnglish ? 'Edit Event' : '编辑活动')
                                    : (isEnglish ? 'Create New Event' : '创建新活动')}
                            </h4>
                            <div className="admin-form-grid">
                                <BilingualFormField
                                    label="Title" labelCn="标题"
                                    value={eventForm.title} valueCn={eventForm.titleCn}
                                    onChange={v => setEventForm(f => ({...f, title: v}))}
                                    onChangeCn={v => setEventForm(f => ({...f, titleCn: v}))}
                                    placeholder={isEnglish ? 'Event title' : '活动标题'}
                                    placeholderCn={isEnglish ? 'Event title in Chinese' : '活动中文标题'}
                                />
                                <TagMultiSelect
                                    tags={tags}
                                    selected={eventForm.tagIds}
                                    onChange={ids => setEventForm(f => ({...f, tagIds: ids}))}
                                    isEnglish={isEnglish}
                                />
                                <label>
                                    <span>{isEnglish ? 'Date' : '日期'}</span>
                                    <input
                                        type="date"
                                        value={eventForm.date}
                                        onChange={e => setEventForm(f => ({...f, date: e.target.value}))}
                                        className="admin-input"
                                    />
                                </label>
                                <LocationFormField
                                    value={eventForm.location} valueCn={eventForm.locationCn}
                                    venueId={eventForm.venueId}
                                    onChange={v => setEventForm(f => ({...f, location: v}))}
                                    onChangeCn={v => setEventForm(f => ({...f, locationCn: v}))}
                                    onChangeVenueId={v => setEventForm(f => ({...f, venueId: v}))}
                                    placeholder={isEnglish ? 'Event location' : '活动地点'}
                                    placeholderCn={isEnglish ? 'Location in Chinese' : '中文地点'}
                                />
                                <ImageUploadField
                                    label="Event Image" labelCn="活动图片"
                                    preview={eventImagePreview}
                                    onFileChange={(file, url) => {
                                        setEventImage(file);
                                        setEventImagePreview(url);
                                    }}
                                    onCleanupPreview={url => URL.revokeObjectURL(url)}
                                    convertToWebp
                                    showToast={showToast}
                                />
                                <BilingualFormField
                                    label="Description" labelCn="描述"
                                    value={eventForm.description} valueCn={eventForm.descriptionCn}
                                    onChange={v => setEventForm(f => ({...f, description: v}))}
                                    onChangeCn={v => setEventForm(f => ({...f, descriptionCn: v}))}
                                    placeholder={isEnglish ? 'Event description' : '活动描述'}
                                    placeholderCn={isEnglish ? 'Event description in Chinese' : '活动中文描述'}
                                    multiline fullWidth
                                />
                                <BilingualFormField
                                    label="Recap Link" labelCn="活动回顾链接"
                                    value={eventForm.recapLink} valueCn={eventForm.recapLinkCn}
                                    onChange={v => setEventForm(f => ({...f, recapLink: v}))}
                                    onChangeCn={v => setEventForm(f => ({...f, recapLinkCn: v}))}
                                    placeholder={isEnglish ? 'https://… (optional)' : 'https://…（可选）'}
                                    placeholderCn={isEnglish ? 'https://… (optional)' : 'https://…（可选）'}
                                />
                            </div>
                            <div className="admin-btn-row">
                                <button
                                    className="admin-toggle-btn admin-toggle-save"
                                    onClick={saveEvent}
                                    disabled={savingEvent || !eventForm.title.trim() || !eventForm.date.trim()}
                                >
                                    {savingEvent
                                        ? (isEnglish ? 'Saving...' : '保存中...')
                                        : editingEvent
                                            ? (isEnglish ? 'Save Changes' : '保存更改')
                                            : (isEnglish ? 'Create Event' : '创建活动')}
                                </button>
                                <button
                                    className="admin-toggle-btn admin-toggle-cancel"
                                    onClick={() => {
                                        setShowCreateEvent(false);
                                        setEditingEvent(null);
                                    }}
                                >
                                    {isEnglish ? 'Cancel' : '取消'}
                                </button>
                            </div>
                        </div>
                    ) : !readOnly ? (
                        <button className="admin-btn admin-btn--dashed admin-section-mb" onClick={openCreateEvent}>
                            {isEnglish ? '+ New Event' : '+ 新建活动'}
                        </button>
                    ) : null}
                    <div className="admin-event-grid">
                        {pastEvents.map((event) => (
                            <button
                                key={event.id}
                                className="admin-event-card"
                                onClick={() => selectManagedEvent(event.id)}
                            >
                                <img src={event.icon} alt="" className="admin-event-card-img"/>
                                <div className="admin-event-card-info">
                                    <span
                                        className="admin-event-card-title">{isEnglish ? event.title : event.titleCn}</span>
                                    <span className="admin-event-card-date">{event.date}</span>
                                    {!event.published && (
                                        <span className="admin-ended-tag">
                                            {isEnglish ? 'Unpublished' : '未发布'}
                                        </span>
                                    )}
                                    {event.deleteAt && (
                                        <span className="admin-ended-tag">
                                            {isEnglish ? 'Pending deletion' : '待删除'}
                                        </span>
                                    )}
                                </div>
                            </button>
                        ))}
                    </div>
                </>
            ) : (
                <div className="admin-event-detail">
                    <button className="admin-btn admin-btn--link" onClick={() => setManagedEvent(null)}>
                        &larr; {isEnglish ? 'All Events' : '所有活动'}
                    </button>

                    {managedEvt && (
                        <>
                            <div className="admin-event-detail-header">
                                <img src={managedEvt.icon} alt="" className="admin-event-detail-img"/>
                                <div>
                                    <h3>{isEnglish ? managedEvt.title : managedEvt.titleCn}</h3>
                                    <p className="admin-event-detail-meta">
                                        <span>{managedEvt.tagIds
                                            .map(id => tags.find(t => t.id === id))
                                            .filter((t): t is Tag => !!t)
                                            .map(t => isEnglish ? t.name : t.nameCn)
                                            .join(', ')}</span>
                                        <span>{managedEvt.date}</span>
                                        <span>{eventLocationDisplay(managedEvt.location, managedEvt.locationCn, managedEvt.venueId, venues, isEnglish)}</span>
                                    </p>
                                </div>
                            </div>
                            {!readOnly && (
                                <div className="admin-form-actions admin-section-mb">
                                    <button
                                        className="admin-toggle-btn admin-toggle-edit"
                                        onClick={() => {
                                            setManagedEvent(null);
                                            openEditEvent(managedEvt);
                                        }}
                                    >
                                        {isEnglish ? 'Edit Event' : '编辑活动'}
                                    </button>
                                    <PublishToggleButton
                                        published={managedEvt.published}
                                        onToggle={() => togglePublish(managedEvt)}
                                    />
                                    <DeleteOrCancelButton
                                        deleteAt={managedEvt.deleteAt}
                                        busy={deletionBusyId === managedEvt.id}
                                        onRequest={() => requestDeleteEvent(managedEvt)}
                                        onCancel={() => cancelDeleteEvent(managedEvt)}
                                    />
                                </div>
                            )}
                            <PendingDeletionNote deleteAt={managedEvt.deleteAt}/>
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
                                // Archived paid event — tickets are read-only and live
                                // under pastEvents (migrated on archive). canScan is off
                                // because the event is over.
                                <TicketsSubtab
                                    event={toTicketEvent(managedEvt)}
                                    readOnly
                                    canScan={false}
                                    collectionRoot="pastEvents"
                                    showToast={showToast}
                                />
                            )}

                            {!isPaidEvent && eventSubTab === 'attendees' && (
                                <PastEventAttendeesSection
                                    eventId={managedEvt.id}
                                    attendees={eventAttendees}
                                    loading={searching}
                                    onReload={() => loadEventAttendees(managedEvt.id)}
                                    showToast={showToast}
                                    readOnly={readOnly}
                                />
                            )}

                            {eventSubTab === 'staff' && !readOnly && (
                                <ClaimCodeSection
                                    eventId={managedEvt.id}
                                    variant="staff"
                                    showToast={showToast}
                                />
                            )}

                            {eventSubTab === 'staff' && (
                                <EventStaffSection
                                    eventId={managedEvt.id}
                                    showToast={showToast}
                                    onCountChange={setStaffCount}
                                    onAttendeeRemoved={() => loadEventAttendees(managedEvt.id)}
                                    readOnly={readOnly}
                                />
                            )}
                        </>
                    )}
                </div>
            )}
        </div>
    );
});

EventsTab.displayName = 'EventsTab';
