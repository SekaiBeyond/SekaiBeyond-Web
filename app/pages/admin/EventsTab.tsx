import { forwardRef, useImperativeHandle, useState } from 'react';
import { useLanguage } from '~/components/LanguageContextProvider';
import {
    callCancelEventDeletion,
    callRequestEventDeletion,
    callSavePastEvent,
    callSetPastEventPublished,
    callUploadAdminImage,
    functionsErrorCode,
} from '~/lib/firebase';
import type { PastEvent } from '~/lib/pastEvents';
import type { Tag } from '~/lib/tags';
import type { UserRecord } from './types';
import { fetchEventAttendees, fetchEventStaffCount } from './utils';
import { BilingualFormField } from './BilingualFormField';
import { EventStaffSection } from './EventStaffSection';
import { ImageUploadField } from './ImageUploadField';
import { PastEventAttendeesSection } from './PastEventAttendeesSection';

interface EventsTabProps {
    pastEvents: PastEvent[];
    refreshEvents: () => Promise<void>;
    tags: Tag[];
    showToast: (message: string, type: 'success' | 'warning' | 'error') => void;
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
        location: '', locationCn: '',
        description: '', descriptionCn: '', icon: '',
    });
    const [savingEvent, setSavingEvent] = useState(false);
    const [eventImage, setEventImage] = useState<File | null>(null);
    const [eventImagePreview, setEventImagePreview] = useState<string | null>(null);
    const [deletionBusyId, setDeletionBusyId] = useState<string | null>(null);
    const [eventSubTab, setEventSubTab] = useState<'attendees' | 'staff'>('attendees');
    const [staffCount, setStaffCount] = useState<number | null>(null);

    const selectManagedEvent = async (eventId: string) => {
        setManagedEvent(eventId);
        setEventAttendees([]);
        setStaffCount(null);
        setEventSubTab('attendees');
        try {
            await loadEventAttendees(eventId);
        } catch (err) {
            console.error('Failed to load attendees:', err);
            showToast(isEnglish ? 'Failed to load attendees.' : '加载参加者失败。', 'error');
        }
        try {
            setStaffCount(await fetchEventStaffCount(eventId));
        } catch {
            // Non-fatal — count badge just won't appear.
        }
    };

    useImperativeHandle(forwardedRef, () => ({selectManagedEvent}));

    const resetEventForm = () => {
        setEventForm({
            title: '', titleCn: '', tagId: '', date: '',
            location: '', locationCn: '',
            description: '', descriptionCn: '', icon: '',
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
            date: normalizedDate,
            location: event.location, locationCn: event.locationCn,
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
                locationCn: eventForm.locationCn,
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

    const togglePublish = async (event: PastEvent) => {
        const newPublished = !event.published;
        try {
            await callSetPastEventPublished({eventId: event.id, published: newPublished});
            await refreshEvents();
            showToast(
                newPublished
                    ? (isEnglish ? 'Event published.' : '活动已发布。')
                    : (isEnglish ? 'Event unpublished.' : '活动已取消发布。'),
                newPublished ? 'success' : 'warning',
            );
        } catch (err) {
            console.error('[togglePublish]', err);
            showToast(isEnglish ? 'Failed to update publish status.' : '更新发布状态失败。', 'error');
        }
    };

    const requestDeleteEvent = async (event: PastEvent) => {
        if (!confirm(isEnglish
            ? `Request deletion of "${event.title}"? It will be permanently deleted in about 48 hours unless cancelled.`
            : `申请删除"${event.title}"？如不取消，约 48 小时后将被永久删除。`
        )) return;
        setDeletionBusyId(event.id);
        try {
            await callRequestEventDeletion({eventId: event.id});
            await refreshEvents();
            showToast(isEnglish ? 'Deletion scheduled.' : '已计划删除。', 'warning');
        } catch (err) {
            const code = functionsErrorCode(err);
            const msg = code === 'deletion-already-pending'
                ? (isEnglish
                    ? 'Deletion already pending — cancel it first.'
                    : '已在计划删除中，请先取消。')
                : (isEnglish ? 'Failed to schedule deletion.' : '计划删除失败。');
            showToast(msg, 'error');
        } finally {
            setDeletionBusyId(null);
        }
    };

    const cancelDeleteEvent = async (event: PastEvent) => {
        setDeletionBusyId(event.id);
        try {
            await callCancelEventDeletion({eventId: event.id});
            await refreshEvents();
            showToast(isEnglish ? 'Deletion cancelled.' : '已取消删除。', 'success');
        } catch {
            showToast(isEnglish ? 'Failed to cancel deletion.' : '取消删除失败。', 'error');
        } finally {
            setDeletionBusyId(null);
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
                                <BilingualFormField
                                    label="Location" labelCn="地点"
                                    value={eventForm.location} valueCn={eventForm.locationCn}
                                    onChange={v => setEventForm(f => ({...f, location: v}))}
                                    onChangeCn={v => setEventForm(f => ({...f, locationCn: v}))}
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
                                        <span>{isEnglish ? managedEvt.location : (managedEvt.locationCn || managedEvt.location)}</span>
                                    </p>
                                </div>
                            </div>
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
                                <button
                                    className={`admin-toggle-btn ${managedEvt.published ? 'admin-toggle-revoke' : 'admin-toggle-grant'}`}
                                    onClick={() => togglePublish(managedEvt)}
                                >
                                    {managedEvt.published
                                        ? (isEnglish ? 'Unpublish' : '取消发布')
                                        : (isEnglish ? 'Publish' : '发布')}
                                </button>
                                {managedEvt.deleteAt ? (
                                    <button
                                        className="admin-toggle-btn admin-toggle-grant"
                                        onClick={() => cancelDeleteEvent(managedEvt)}
                                        disabled={deletionBusyId === managedEvt.id}
                                    >
                                        {deletionBusyId === managedEvt.id
                                            ? (isEnglish ? 'Working...' : '处理中...')
                                            : (isEnglish ? 'Cancel deletion' : '取消删除')}
                                    </button>
                                ) : (
                                    <button
                                        className="admin-toggle-btn admin-toggle-revoke"
                                        onClick={() => requestDeleteEvent(managedEvt)}
                                        disabled={deletionBusyId === managedEvt.id}
                                    >
                                        {deletionBusyId === managedEvt.id
                                            ? (isEnglish ? 'Working...' : '处理中...')
                                            : (isEnglish ? 'Delete Event' : '删除活动')}
                                    </button>
                                )}
                            </div>
                            {managedEvt.deleteAt && (
                                <p className="admin-helper-text">
                                    {isEnglish
                                        ? `Pending deletion — scheduled around ${managedEvt.deleteAt.toLocaleString('en-US', {
                                            month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
                                        })}.`
                                        : `待删除 — 预计于 ${managedEvt.deleteAt.toLocaleString('zh-CN', {
                                            month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
                                        })} 前后执行。`}
                                </p>
                            )}
                            <div className="admin-sub-tabs">
                                <button
                                    className={`admin-sub-tab ${eventSubTab === 'attendees' ? 'admin-sub-tab-active' : ''}`}
                                    onClick={() => setEventSubTab('attendees')}
                                >
                                    {isEnglish ? 'Attendees' : '参加者'}
                                    {eventAttendees.length > 0 && (
                                        <span className="admin-sub-tab-count">{eventAttendees.length}</span>
                                    )}
                                </button>
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

                            {eventSubTab === 'attendees' && (
                                <PastEventAttendeesSection
                                    eventId={managedEvt.id}
                                    attendees={eventAttendees}
                                    loading={searching}
                                    onReload={() => loadEventAttendees(managedEvt.id)}
                                    showToast={showToast}
                                />
                            )}

                            {eventSubTab === 'staff' && (
                                <EventStaffSection
                                    eventId={managedEvt.id}
                                    showToast={showToast}
                                    onCountChange={setStaffCount}
                                    onAttendeeRemoved={() => loadEventAttendees(managedEvt.id)}
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
