import { forwardRef, useEffect, useImperativeHandle, useState } from 'react';
import { useLanguage } from '~/components/LanguageContextProvider';
import { callSavePastEvent, callUploadAdminImage, errorMessage } from '~/lib/firebase';
import type { PastEvent } from '~/lib/pastEvents';
import type { Tag } from '~/lib/tags';
import { useVenues } from '~/lib/venues';
import { localized } from '~/lib/localized';
import { refreshAfterSave, type ShowToast } from './utils';
import { BilingualFormField } from './BilingualFormField';
import { ListCard } from './CrudShell';
import { LocationFormField } from './LocationFormField';
import { ImageUploadField } from './ImageUploadField';
import { TagMultiSelect } from './TagMultiSelect';
import { PastEventDetailView } from './PastEventDetailView';

interface EventsTabProps {
    pastEvents: PastEvent[];
    refreshEvents: () => Promise<void>;
    tags: Tag[];
    showToast: ShowToast;
    onDetailChange?: (inDetail: boolean) => void;
    readOnly?: boolean;
    onLookupUser?: (uid: string) => void;
}

export interface EventsTabHandle {
    selectManagedEvent: (eventId: string) => void;
}

export const EventsTab = forwardRef<EventsTabHandle, EventsTabProps>(({
                                                                          pastEvents,
                                                                          refreshEvents,
                                                                          tags,
                                                                          showToast,
                                                                          onDetailChange,
                                                                          readOnly = false,
                                                                          onLookupUser,
                                                                      }, forwardedRef) => {
    const {isEnglish} = useLanguage();
    const {venues} = useVenues();
    const [managedEvent, setManagedEvent] = useState<string | null>(null);

    useEffect(() => {
        onDetailChange?.(managedEvent !== null);
    }, [managedEvent, onDetailChange]);

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

    useImperativeHandle(forwardedRef, () => ({selectManagedEvent: setManagedEvent}));

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
        setEventForm({
            title: event.title, titleCn: event.titleCn, tagIds: event.tagIds,
            date: event.date,
            location: event.location, locationCn: event.locationCn, venueId: event.venueId,
            description: event.description, descriptionCn: event.descriptionCn, icon: event.icon,
            recapLink: event.recapLink, recapLinkCn: event.recapLinkCn,
        });
        setEditingEvent(event);
        setEventImage(null);
        setEventImagePreview(event.icon || null);
        setShowCreateEvent(true);
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

            await refreshAfterSave(refreshEvents, showToast, isEnglish);
            showToast(
                editingEvent
                    ? (isEnglish ? 'Event updated.' : '活动已更新。')
                    : (isEnglish ? 'Event created.' : '活动已创建。'),
                'success',
            );
            setShowCreateEvent(false);
            resetEventForm();
            setEditingEvent(null);
        } catch (e) {
            showToast(errorMessage(e, isEnglish ? 'Failed to save event.' : '保存活动失败。'), 'error');
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
                            <ListCard
                                key={event.id}
                                image={event.icon}
                                title={localized(isEnglish, event.title, event.titleCn)}
                                subtitle={event.date}
                                tags={[
                                    !event.published && (isEnglish ? 'Unpublished' : '未发布'),
                                    !!event.deleteAt && (isEnglish ? 'Pending deletion' : '待删除'),
                                ]}
                                onClick={() => setManagedEvent(event.id)}
                            />
                        ))}
                    </div>
                </>
            ) : managedEvt ? (
                <PastEventDetailView
                    key={managedEvt.id}
                    event={managedEvt}
                    tags={tags}
                    venues={venues}
                    readOnly={readOnly}
                    showToast={showToast}
                    refreshEvents={refreshEvents}
                    onBack={() => setManagedEvent(null)}
                    onEdit={evt => {
                        setManagedEvent(null);
                        openEditEvent(evt);
                    }}
                    onLookupUser={onLookupUser}
                />
            ) : (
                <div className="admin-event-detail">
                    <button className="admin-btn admin-btn--link" onClick={() => setManagedEvent(null)}>
                        &larr; {isEnglish ? 'All Events' : '所有活动'}
                    </button>
                </div>
            )}
        </div>
    );
});

EventsTab.displayName = 'EventsTab';
