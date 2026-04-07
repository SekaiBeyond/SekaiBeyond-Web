import { forwardRef, useImperativeHandle, useState } from 'react';
import { collection, doc, serverTimestamp, Timestamp, writeBatch, } from 'firebase/firestore';
import type { User } from 'firebase/auth';
import type { UserProfile } from '~/components/AuthProvider';
import { useLanguage } from '~/components/LanguageContextProvider';
import { callUploadAdminImage, getFirebaseDb } from '~/lib/firebase';
import type { UpcomingEvent } from '~/lib/upcomingEvents';
import type { Tag } from '~/lib/tags';
import { BilingualFormField } from './BilingualFormField';
import { ImageUploadField } from './ImageUploadField';

interface UpcomingEventsTabProps {
    upcomingEvents: UpcomingEvent[];
    refreshEvents: () => Promise<void>;
    refreshPastEvents: () => Promise<void>;
    tags: Tag[];
    user: User;
    profile: UserProfile;
    showToast: (message: string, type: 'success' | 'error') => void;
}

export interface UpcomingEventsTabHandle {
    selectEvent: (eventId: string) => void;
}

const toDatetimeLocal = (d: Date): string => {
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

interface EventForm {
    name: string;
    nameCn: string;
    description: string;
    descriptionCn: string;
    location: string;
    locationCn: string;
    startAt: string;
    endAt: string;
    posterCredit: string;
    buyTicket: string;
    learnMore: string;
    customButtonText: string;
    customButtonTextCn: string;
    customButtonLink: string;
}

const emptyForm: EventForm = {
    name: '', nameCn: '', description: '', descriptionCn: '',
    location: '', locationCn: '', startAt: '', endAt: '',
    posterCredit: '', buyTicket: '', learnMore: '',
    customButtonText: '', customButtonTextCn: '', customButtonLink: '',
};

export const UpcomingEventsTab = forwardRef<UpcomingEventsTabHandle, UpcomingEventsTabProps>(({
                                                                                                  upcomingEvents,
                                                                                                  refreshEvents,
                                                                                                  refreshPastEvents,
                                                                                                  tags,
                                                                                                  user,
                                                                                                  profile,
                                                                                                  showToast,
                                                                                              }, forwardedRef) => {
    const {isEnglish} = useLanguage();
    const [selectedEvent, setSelectedEvent] = useState<string | null>(null);
    const [showForm, setShowForm] = useState(false);
    const [editingEvent, setEditingEvent] = useState<UpcomingEvent | null>(null);
    const [form, setForm] = useState<EventForm>(emptyForm);
    const [posterImage, setPosterImage] = useState<File | null>(null);
    const [posterPreview, setPosterPreview] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);
    const [showArchive, setShowArchive] = useState(false);
    const [archiveTagId, setArchiveTagId] = useState('');
    const [archiving, setArchiving] = useState(false);
    const [deletingId, setDeletingId] = useState<string | null>(null);

    const selectEvent = (eventId: string) => setSelectedEvent(eventId);
    useImperativeHandle(forwardedRef, () => ({selectEvent}));

    const resetForm = () => {
        setForm(emptyForm);
        setPosterImage(null);
        if (posterPreview?.startsWith('blob:')) URL.revokeObjectURL(posterPreview);
        setPosterPreview(null);
    };

    const openCreate = () => {
        resetForm();
        setEditingEvent(null);
        setShowForm(true);
    };

    const openEdit = (event: UpcomingEvent) => {
        setForm({
            name: event.name,
            nameCn: event.nameCn,
            description: event.description,
            descriptionCn: event.descriptionCn,
            location: event.location,
            locationCn: event.locationCn,
            startAt: toDatetimeLocal(event.startAt),
            endAt: toDatetimeLocal(event.endAt),
            posterCredit: event.posterCredit,
            buyTicket: event.buyTicket,
            learnMore: event.learnMore,
            customButtonText: event.customButtonText,
            customButtonTextCn: event.customButtonTextCn,
            customButtonLink: event.customButtonLink,
        });
        setEditingEvent(event);
        setPosterImage(null);
        setPosterPreview(event.poster || null);
        setShowForm(true);
    };

    const saveEvent = async () => {
        if (!form.name.trim() || !form.startAt || !form.endAt) return;
        const startAt = new Date(form.startAt);
        const endAt = new Date(form.endAt);
        if (endAt <= startAt) {
            showToast(isEnglish ? 'End time must be after start time.' : '结束时间必须晚于开始时间。', 'error');
            return;
        }
        setSaving(true);
        try {
            const db = getFirebaseDb();

            let posterUrl = editingEvent?.poster ?? '';
            if (posterImage) {
                const imageId = crypto.randomUUID();
                posterUrl = await callUploadAdminImage(posterImage, `upcoming-events/${imageId}.webp`);
            }

            const data = {
                name: form.name,
                nameCn: form.nameCn,
                description: form.description,
                descriptionCn: form.descriptionCn,
                location: form.location,
                locationCn: form.locationCn,
                startAt: Timestamp.fromDate(startAt),
                endAt: Timestamp.fromDate(endAt),
                poster: posterUrl,
                posterCredit: form.posterCredit,
                buyTicket: form.buyTicket,
                learnMore: form.learnMore,
                customButtonText: form.customButtonText,
                customButtonTextCn: form.customButtonTextCn,
                customButtonLink: form.customButtonLink,
            };

            const batch = writeBatch(db);
            let newEventId: string;
            if (editingEvent) {
                batch.update(doc(db, 'upcomingEvents', editingEvent.id), data);
                newEventId = editingEvent.id;
            } else {
                const newDocRef = doc(collection(db, 'upcomingEvents'));
                batch.set(newDocRef, data);
                newEventId = newDocRef.id;
            }
            batch.set(doc(collection(db, 'records')), {
                type: editingEvent ? 'upcoming-event-edit' : 'upcoming-event-create',
                performedBy: user.uid,
                performedByName: profile.displayName,
                eventTitle: form.name,
                eventId: newEventId,
                timestamp: serverTimestamp(),
            });
            await batch.commit();

            await refreshEvents();
            showToast(
                editingEvent
                    ? (isEnglish ? 'Event updated.' : '活动已更新。')
                    : (isEnglish ? 'Event created.' : '活动已创建。'),
                'success',
            );
            setShowForm(false);
            resetForm();
            setEditingEvent(null);
        } catch {
            showToast(isEnglish ? 'Failed to save event.' : '保存活动失败。', 'error');
        } finally {
            setSaving(false);
        }
    };

    const deleteEvent = async (event: UpcomingEvent) => {
        if (!confirm(isEnglish
            ? `Delete "${event.name}"? This cannot be undone.`
            : `删除"${event.name}"？此操作不可撤销。`
        )) return;
        setDeletingId(event.id);
        try {
            const db = getFirebaseDb();
            const batch = writeBatch(db);
            batch.delete(doc(db, 'upcomingEvents', event.id));
            batch.set(doc(collection(db, 'records')), {
                type: 'upcoming-event-delete',
                performedBy: user.uid,
                performedByName: profile.displayName,
                eventTitle: event.name,
                eventId: event.id,
                timestamp: serverTimestamp(),
            });
            await batch.commit();

            await refreshEvents();
            if (selectedEvent === event.id) setSelectedEvent(null);
            showToast(isEnglish ? 'Event deleted.' : '活动已删除。', 'success');
        } catch {
            showToast(isEnglish ? 'Failed to delete event.' : '删除活动失败。', 'error');
        } finally {
            setDeletingId(null);
        }
    };

    const archiveEvent = async (event: UpcomingEvent) => {
        setArchiving(true);
        try {
            const db = getFirebaseDb();
            const batch = writeBatch(db);

            const pad = (n: number) => String(n).padStart(2, '0');
            const d = event.startAt;
            const dateStr = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

            const pastEventData = {
                title: event.name,
                titleCn: event.nameCn,
                date: dateStr,
                location: event.location,
                description: event.description,
                descriptionCn: event.descriptionCn,
                icon: event.poster,
                tagId: archiveTagId,
            };

            const newDocRef = doc(collection(db, 'pastEvents'));
            batch.set(newDocRef, pastEventData);
            batch.delete(doc(db, 'upcomingEvents', event.id));
            batch.set(doc(collection(db, 'records')), {
                type: 'upcoming-event-archive',
                performedBy: user.uid,
                performedByName: profile.displayName,
                eventTitle: event.name,
                eventId: newDocRef.id,
                timestamp: serverTimestamp(),
            });
            await batch.commit();

            await Promise.all([refreshEvents(), refreshPastEvents()]);
            setSelectedEvent(null);
            setShowArchive(false);
            setArchiveTagId('');
            showToast(isEnglish ? 'Event archived.' : '活动已归档。', 'success');
        } catch {
            showToast(isEnglish ? 'Failed to archive event.' : '归档活动失败。', 'error');
        } finally {
            setArchiving(false);
        }
    };

    const selectedEvt = selectedEvent ? upcomingEvents.find(e => e.id === selectedEvent) ?? null : null;

    return (
        <div className="admin-section">
            {!selectedEvent ? (
                <>
                    {showForm ? (
                        <div className="admin-create-badge-form">
                            <h4 className="admin-badges-title">
                                {editingEvent
                                    ? (isEnglish ? 'Edit Upcoming Event' : '编辑活动预告')
                                    : (isEnglish ? 'Create Upcoming Event' : '创建活动预告')}
                            </h4>
                            <div className="admin-form-grid">
                                <BilingualFormField
                                    label="Name" labelCn="名称"
                                    value={form.name} valueCn={form.nameCn}
                                    onChange={v => setForm(f => ({...f, name: v}))}
                                    onChangeCn={v => setForm(f => ({...f, nameCn: v}))}
                                    placeholder={isEnglish ? 'Event name' : '活动名称'}
                                    placeholderCn={isEnglish ? 'Event name in Chinese' : '活动中文名称'}
                                />
                                <label>
                                    <span>{isEnglish ? 'Start Time' : '开始时间'}</span>
                                    <input
                                        type="datetime-local"
                                        value={form.startAt}
                                        onChange={e => setForm(f => ({...f, startAt: e.target.value}))}
                                        className="admin-search-input"
                                    />
                                </label>
                                <label>
                                    <span>{isEnglish ? 'End Time' : '结束时间'}</span>
                                    <input
                                        type="datetime-local"
                                        value={form.endAt}
                                        onChange={e => setForm(f => ({...f, endAt: e.target.value}))}
                                        className="admin-search-input"
                                    />
                                </label>
                                <BilingualFormField
                                    label="Location" labelCn="地点"
                                    value={form.location} valueCn={form.locationCn}
                                    onChange={v => setForm(f => ({...f, location: v}))}
                                    onChangeCn={v => setForm(f => ({...f, locationCn: v}))}
                                    placeholder={isEnglish ? 'Event location' : '活动地点'}
                                    placeholderCn={isEnglish ? 'Location in Chinese' : '中文地点'}
                                />
                                <ImageUploadField
                                    label="Poster Image" labelCn="海报图片"
                                    preview={posterPreview}
                                    onFileChange={(file, url) => {
                                        setPosterImage(file);
                                        setPosterPreview(url);
                                    }}
                                    onCleanupPreview={url => URL.revokeObjectURL(url)}
                                />
                                <label>
                                    <span>{isEnglish ? 'Poster Credit' : '海报作者'}</span>
                                    <input
                                        value={form.posterCredit}
                                        onChange={e => setForm(f => ({...f, posterCredit: e.target.value}))}
                                        className="admin-search-input"
                                        placeholder={isEnglish ? 'Optional' : '可选'}
                                    />
                                </label>
                                <BilingualFormField
                                    label="Description" labelCn="描述"
                                    value={form.description} valueCn={form.descriptionCn}
                                    onChange={v => setForm(f => ({...f, description: v}))}
                                    onChangeCn={v => setForm(f => ({...f, descriptionCn: v}))}
                                    placeholder={isEnglish ? 'Event description' : '活动描述'}
                                    placeholderCn={isEnglish ? 'Description in Chinese' : '中文描述'}
                                    multiline fullWidth
                                />
                                <label>
                                    <span>{isEnglish ? 'Buy Ticket URL' : '购票链接'}</span>
                                    <input
                                        value={form.buyTicket}
                                        onChange={e => setForm(f => ({...f, buyTicket: e.target.value}))}
                                        className="admin-search-input"
                                        placeholder={isEnglish ? 'Optional' : '可选'}
                                    />
                                </label>
                                <label>
                                    <span>{isEnglish ? 'Learn More URL' : '了解更多链接'}</span>
                                    <input
                                        value={form.learnMore}
                                        onChange={e => setForm(f => ({...f, learnMore: e.target.value}))}
                                        className="admin-search-input"
                                        placeholder={isEnglish ? 'Optional' : '可选'}
                                    />
                                </label>
                                <label>
                                    <span>{isEnglish ? 'Custom Button Text (EN)' : '自定义按钮文本（英文）'}</span>
                                    <input
                                        value={form.customButtonText}
                                        onChange={e => setForm(f => ({...f, customButtonText: e.target.value}))}
                                        className="admin-search-input"
                                        placeholder={isEnglish ? 'Optional' : '可选'}
                                    />
                                </label>
                                <label>
                                    <span>{isEnglish ? 'Custom Button Text (CN)' : '自定义按钮文本（中文）'}</span>
                                    <input
                                        value={form.customButtonTextCn}
                                        onChange={e => setForm(f => ({...f, customButtonTextCn: e.target.value}))}
                                        className="admin-search-input"
                                        placeholder={isEnglish ? 'Optional' : '可选'}
                                    />
                                </label>
                                <label className="admin-form-grid-full">
                                    <span>{isEnglish ? 'Custom Button Link' : '自定义按钮链接'}</span>
                                    <input
                                        value={form.customButtonLink}
                                        onChange={e => setForm(f => ({...f, customButtonLink: e.target.value}))}
                                        className="admin-search-input"
                                        placeholder={isEnglish ? 'Optional' : '可选'}
                                    />
                                </label>
                            </div>
                            <div className="admin-btn-row">
                                <button
                                    className="admin-generate-btn"
                                    onClick={saveEvent}
                                    disabled={saving || !form.name.trim() || !form.startAt || !form.endAt}
                                >
                                    {saving
                                        ? (isEnglish ? 'Saving...' : '保存中...')
                                        : editingEvent
                                            ? (isEnglish ? 'Save Changes' : '保存更改')
                                            : (isEnglish ? 'Create Event' : '创建活动')}
                                </button>
                                <button
                                    className="admin-back-btn"
                                    onClick={() => {
                                        setShowForm(false);
                                        setEditingEvent(null);
                                    }}
                                >
                                    {isEnglish ? 'Cancel' : '取消'}
                                </button>
                            </div>
                        </div>
                    ) : (
                        <button className="admin-generate-btn admin-section-mb" onClick={openCreate}>
                            {isEnglish ? '+ New Upcoming Event' : '+ 新建活动预告'}
                        </button>
                    )}
                    <div className="admin-event-grid">
                        {upcomingEvents.map((event) => (
                            <button
                                key={event.id}
                                className="admin-event-card"
                                onClick={() => selectEvent(event.id)}
                            >
                                {event.poster ? (
                                    <img src={event.poster} alt="" className="admin-event-card-img"/>
                                ) : (
                                    <div className="admin-event-card-img admin-no-poster">
                                        {isEnglish ? 'No poster' : '无海报'}
                                    </div>
                                )}
                                <div className="admin-event-card-info">
                                    <span
                                        className="admin-event-card-title">{isEnglish ? event.name : event.nameCn}</span>
                                    <span className="admin-event-card-date">
                                        {event.startAt.toLocaleDateString(isEnglish ? 'en-US' : 'zh-CN', {
                                            year: 'numeric', month: 'short', day: 'numeric',
                                        })}
                                    </span>
                                    {event.endAt < new Date() && (
                                        <span className="admin-ended-tag">
                                            {isEnglish ? 'Ended' : '已结束'}
                                        </span>
                                    )}
                                </div>
                            </button>
                        ))}
                    </div>
                </>
            ) : (
                <div className="admin-event-detail">
                    <button className="admin-back-btn" onClick={() => setSelectedEvent(null)}>
                        &larr; {isEnglish ? 'All Upcoming Events' : '所有活动预告'}
                    </button>

                    {selectedEvt && (
                        <>
                            <div className="admin-event-detail-header">
                                {selectedEvt.poster && (
                                    <img src={selectedEvt.poster} alt="" className="admin-event-detail-img"/>
                                )}
                                <div>
                                    <h3>{isEnglish ? selectedEvt.name : selectedEvt.nameCn}</h3>
                                    <p className="admin-event-detail-meta">
                                        <span>
                                            {selectedEvt.startAt.toLocaleString(isEnglish ? 'en-US' : 'zh-CN', {
                                                year: 'numeric', month: 'long', day: 'numeric',
                                                hour: 'numeric', minute: 'numeric',
                                            })}
                                        </span>
                                        <span>{isEnglish ? selectedEvt.location : selectedEvt.locationCn}</span>
                                    </p>
                                    <p className="admin-description-text">
                                        {isEnglish ? selectedEvt.description : selectedEvt.descriptionCn}
                                    </p>
                                </div>
                            </div>
                            <div className="admin-form-actions admin-section-mb">
                                <button
                                    className="admin-generate-btn"
                                    onClick={() => {
                                        setSelectedEvent(null);
                                        openEdit(selectedEvt);
                                    }}
                                >
                                    {isEnglish ? 'Edit Event' : '编辑活动'}
                                </button>
                                <button
                                    className="admin-toggle-btn admin-toggle-revoke"
                                    onClick={() => deleteEvent(selectedEvt)}
                                    disabled={deletingId === selectedEvt.id}
                                >
                                    {deletingId === selectedEvt.id
                                        ? (isEnglish ? 'Deleting...' : '删除中...')
                                        : (isEnglish ? 'Delete Event' : '删除活动')}
                                </button>
                                <button
                                    className="admin-toggle-btn"
                                    onClick={() => setShowArchive(!showArchive)}
                                >
                                    {isEnglish ? 'Archive to Past Events' : '归档到往期活动'}
                                </button>
                            </div>
                            {showArchive && (
                                <div className="admin-create-badge-form admin-section-mb">
                                    <h4 className="admin-badges-title">
                                        {isEnglish ? 'Archive Event' : '归档活动'}
                                    </h4>
                                    <p className="admin-helper-text">
                                        {isEnglish
                                            ? 'This will move the event from Upcoming to Past Events. You can optionally add a label (e.g. "Workshop", "Convention").'
                                            : '此操作会将活动从预告移到往期活动。你可以选填标签（如"工作坊"、"展会"）。'}
                                    </p>
                                    <div className="admin-form-grid">
                                        <label>
                                            <span>{isEnglish ? 'Tag' : '标签'}</span>
                                            <select
                                                value={archiveTagId}
                                                onChange={e => setArchiveTagId(e.target.value)}
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
                                    </div>
                                    <div className="admin-btn-row admin-mt-12">
                                        <button
                                            className="admin-generate-btn"
                                            onClick={() => archiveEvent(selectedEvt)}
                                            disabled={archiving}
                                        >
                                            {archiving
                                                ? (isEnglish ? 'Archiving...' : '归档中...')
                                                : (isEnglish ? 'Confirm Archive' : '确认归档')}
                                        </button>
                                        <button
                                            className="admin-back-btn"
                                            onClick={() => setShowArchive(false)}
                                        >
                                            {isEnglish ? 'Cancel' : '取消'}
                                        </button>
                                    </div>
                                </div>
                            )}
                        </>
                    )}
                </div>
            )}
        </div>
    );
});

UpcomingEventsTab.displayName = 'UpcomingEventsTab';
