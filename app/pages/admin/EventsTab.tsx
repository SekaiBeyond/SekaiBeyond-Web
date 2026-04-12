import { forwardRef, useImperativeHandle, useState } from 'react';
import { useLanguage } from '~/components/LanguageContextProvider';
import { callDeleteEvent, callSavePastEvent, callUploadAdminImage, } from '~/lib/firebase';
import type { PastEvent } from '~/lib/pastEvents';
import type { Tag } from '~/lib/tags';
import type { UserRecord } from './types';
import { fetchEventAttendees } from './utils';
import { BilingualFormField } from './BilingualFormField';
import { EventAttendeesList } from './EventAttendeesList';
import { ImageUploadField } from './ImageUploadField';

interface EventsTabProps {
    pastEvents: PastEvent[];
    refreshEvents: () => Promise<void>;
    tags: Tag[];
    showToast: (message: string, type: 'success' | 'error') => void;
}

export interface EventsTabHandle {
    selectManagedEvent: (eventId: string) => Promise<void>;
}

export const EventsTab = forwardRef<EventsTabHandle, EventsTabProps>(({
                                                                          pastEvents,
                                                                          refreshEvents,
                                                                          tags,
                                                                          showToast,
                                                                      }, forwardedRef) => {
    const {isEnglish} = useLanguage();
    const [managedEvent, setManagedEvent] = useState<string | null>(null);
    const [eventAttendees, setEventAttendees] = useState<UserRecord[]>([]);
    const [searching, setSearching] = useState(false);
    const [showCreateEvent, setShowCreateEvent] = useState(false);
    const [editingEvent, setEditingEvent] = useState<PastEvent | null>(null);
    const [eventForm, setEventForm] = useState({
        title: '', titleCn: '', tagId: '', date: '',
        location: '', description: '', descriptionCn: '', icon: '',
    });
    const [savingEvent, setSavingEvent] = useState(false);
    const [eventImage, setEventImage] = useState<File | null>(null);
    const [eventImagePreview, setEventImagePreview] = useState<string | null>(null);
    const [deletingId, setDeletingId] = useState<string | null>(null);

    const selectManagedEvent = async (eventId: string) => {
        setManagedEvent(eventId);
        setEventAttendees([]);
        try {
            await loadEventAttendees(eventId);
        } catch (err) {
            console.error('Failed to load attendees:', err);
        }
    };

    useImperativeHandle(forwardedRef, () => ({selectManagedEvent}));

    const resetEventForm = () => {
        setEventForm({
            title: '', titleCn: '', tagId: '', date: '',
            location: '', description: '', descriptionCn: '', icon: '',
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
            title: event.title, titleCn: event.titleCn, tagId: event.tagId,
            date: normalizedDate, location: event.location,
            description: event.description, descriptionCn: event.descriptionCn, icon: event.icon,
        });
        setEditingEvent(event);
        setEventImage(null);
        setEventImagePreview(event.icon || null);
        setShowCreateEvent(true);
    };

    const loadEventAttendees = async (eventId: string) => {
        setSearching(true);
        try {
            setEventAttendees(await fetchEventAttendees(eventId));
        } catch {
            showToast(isEnglish ? 'Failed to load attendees.' : '加载参加者失败。', 'error');
        } finally {
            setSearching(false);
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
                tagId: eventForm.tagId,
                date: eventForm.date,
                location: eventForm.location,
                description: eventForm.description,
                descriptionCn: eventForm.descriptionCn,
                icon: iconUrl,
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

    const deleteEvent = async (event: PastEvent) => {
        if (!confirm(isEnglish
            ? `Delete "${event.title}"? This cannot be undone.`
            : `删除"${event.title}"？此操作不可撤销。`
        )) return;
        setDeletingId(event.id);
        try {
            await callDeleteEvent({eventId: event.id});
            await refreshEvents();
            if (managedEvent === event.id) setManagedEvent(null);
            showToast(isEnglish ? 'Event deleted.' : '活动已删除。', 'success');
        } catch {
            showToast(isEnglish ? 'Failed to delete event.' : '删除活动失败。', 'error');
        } finally {
            setDeletingId(null);
        }
    };

    const managedEvt = managedEvent ? pastEvents.find(e => e.id === managedEvent) ?? null : null;

    return (
        <div className="admin-section">
            {!managedEvent ? (
                <>
                    {showCreateEvent ? (
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
                                <label>
                                    <span>{isEnglish ? 'Tag' : '标签'}</span>
                                    <select
                                        value={eventForm.tagId}
                                        onChange={e => setEventForm(f => ({...f, tagId: e.target.value}))}
                                        className="admin-search-input"
                                    >
                                        <option value="">{isEnglish ? 'None' : '无'}</option>
                                        {tags.map(t => (
                                            <option key={t.id} value={t.id}>
                                                {isEnglish ? t.name : t.nameCn} {t.nameCn && isEnglish ? `(${t.nameCn})` : t.name && !isEnglish ? `(${t.name})` : ''}
                                            </option>
                                        ))}
                                    </select>
                                </label>
                                <label>
                                    <span>{isEnglish ? 'Date' : '日期'}</span>
                                    <input
                                        type="date"
                                        value={eventForm.date}
                                        onChange={e => setEventForm(f => ({...f, date: e.target.value}))}
                                        className="admin-search-input"
                                    />
                                </label>
                                <label>
                                    <span>{isEnglish ? 'Location' : '地点'}</span>
                                    <input
                                        value={eventForm.location}
                                        onChange={e => setEventForm(f => ({...f, location: e.target.value}))}
                                        className="admin-search-input"
                                        placeholder={isEnglish ? 'Event location' : '活动地点'}
                                    />
                                </label>
                                <ImageUploadField
                                    label="Event Image" labelCn="活动图片"
                                    preview={eventImagePreview}
                                    onFileChange={(file, url) => {
                                        setEventImage(file);
                                        setEventImagePreview(url);
                                    }}
                                    onCleanupPreview={url => URL.revokeObjectURL(url)}
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
                            </div>
                            <div className="admin-btn-row">
                                <button
                                    className="admin-generate-btn"
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
                                    className="admin-back-btn"
                                    onClick={() => {
                                        setShowCreateEvent(false);
                                        setEditingEvent(null);
                                    }}
                                >
                                    {isEnglish ? 'Cancel' : '取消'}
                                </button>
                            </div>
                        </div>
                    ) : (
                        <button className="admin-generate-btn admin-section-mb" onClick={openCreateEvent}>
                            {isEnglish ? '+ New Event' : '+ 新建活动'}
                        </button>
                    )}
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
                                </div>
                            </button>
                        ))}
                    </div>
                </>
            ) : (
                <div className="admin-event-detail">
                    <button className="admin-back-btn" onClick={() => setManagedEvent(null)}>
                        &larr; {isEnglish ? 'All Events' : '所有活动'}
                    </button>

                    {managedEvt && (
                        <>
                            <div className="admin-event-detail-header">
                                <img src={managedEvt.icon} alt="" className="admin-event-detail-img"/>
                                <div>
                                    <h3>{isEnglish ? managedEvt.title : managedEvt.titleCn}</h3>
                                    <p className="admin-event-detail-meta">
                                        <span>{(() => {
                                            const tag = tags.find(t => t.id === managedEvt.tagId);
                                            return tag ? (isEnglish ? tag.name : tag.nameCn) : '';
                                        })()}</span>
                                        <span>{managedEvt.date}</span>
                                        <span>{managedEvt.location}</span>
                                    </p>
                                </div>
                            </div>
                            <div className="admin-form-actions admin-section-mb">
                                <button
                                    className="admin-generate-btn"
                                    onClick={() => {
                                        setManagedEvent(null);
                                        openEditEvent(managedEvt);
                                    }}
                                >
                                    {isEnglish ? 'Edit Event' : '编辑活动'}
                                </button>
                                <button
                                    className="admin-toggle-btn admin-toggle-revoke"
                                    onClick={() => deleteEvent(managedEvt)}
                                    disabled={deletingId === managedEvt.id}
                                >
                                    {deletingId === managedEvt.id
                                        ? (isEnglish ? 'Deleting...' : '删除中...')
                                        : (isEnglish ? 'Delete Event' : '删除活动')}
                                </button>
                            </div>
                        </>
                    )}

                    <h4 className="admin-badges-title admin-section-mb">
                        {isEnglish ? 'Attendees' : '参加者'}
                        {eventAttendees.length > 0 && (
                            <span className="admin-sub-tab-count">{eventAttendees.length}</span>
                        )}
                    </h4>
                    <EventAttendeesList loading={searching} attendees={eventAttendees}/>
                </div>
            )}
        </div>
    );
});

EventsTab.displayName = 'EventsTab';
