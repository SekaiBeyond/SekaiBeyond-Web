import { forwardRef, useImperativeHandle, useState } from 'react';
import { collection, doc, serverTimestamp, Timestamp, writeBatch, } from 'firebase/firestore';
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import type { User } from 'firebase/auth';
import type { UserProfile } from '~/components/AuthProvider';
import { useLanguage } from '~/components/LanguageContextProvider';
import { getFirebaseDb, getFirebaseStorage } from '~/lib/firebase';
import type { UpcomingEvent } from '~/lib/upcomingEvents';
import { validateImageFile } from './utils';

interface UpcomingEventsTabProps {
    upcomingEvents: UpcomingEvent[];
    refreshEvents: () => Promise<void>;
    user: User;
    profile: UserProfile;
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
                                                                                                  user,
                                                                                                  profile,
                                                                                              }, forwardedRef) => {
    const {isEnglish} = useLanguage();
    const [selectedEvent, setSelectedEvent] = useState<string | null>(null);
    const [showForm, setShowForm] = useState(false);
    const [editingEvent, setEditingEvent] = useState<UpcomingEvent | null>(null);
    const [form, setForm] = useState<EventForm>(emptyForm);
    const [posterImage, setPosterImage] = useState<File | null>(null);
    const [posterPreview, setPosterPreview] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);

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
            alert(isEnglish ? 'End time must be after start time.' : '结束时间必须晚于开始时间。');
            return;
        }
        setSaving(true);
        try {
            const db = getFirebaseDb();

            let posterUrl = editingEvent?.poster ?? '';
            if (posterImage) {
                const imageId = crypto.randomUUID();
                const storageRef = ref(getFirebaseStorage(), `upcoming-events/${imageId}.webp`);
                await uploadBytes(storageRef, posterImage);
                posterUrl = await getDownloadURL(storageRef);
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
            setShowForm(false);
            resetForm();
            setEditingEvent(null);
        } catch {
            alert(isEnglish ? 'Failed to save event.' : '保存活动失败。');
        } finally {
            setSaving(false);
        }
    };

    const deleteEvent = async (event: UpcomingEvent) => {
        if (!confirm(isEnglish
            ? `Delete "${event.name}"? This cannot be undone.`
            : `删除"${event.name}"？此操作不可撤销。`
        )) return;
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
        } catch {
            alert(isEnglish ? 'Failed to delete event.' : '删除活动失败。');
        }
    };

    const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        if (!validateImageFile(file, isEnglish)) {
            e.target.value = '';
            return;
        }
        setPosterImage(file);
        if (posterPreview?.startsWith('blob:')) URL.revokeObjectURL(posterPreview);
        setPosterPreview(URL.createObjectURL(file));
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
                                <label>
                                    <span>{isEnglish ? 'Name (English)' : '名称（英文）'}</span>
                                    <input
                                        value={form.name}
                                        onChange={e => setForm(f => ({...f, name: e.target.value}))}
                                        className="admin-search-input"
                                        placeholder={isEnglish ? 'Event name' : '活动名称'}
                                    />
                                </label>
                                <label>
                                    <span>{isEnglish ? 'Name (Chinese)' : '名称（中文）'}</span>
                                    <input
                                        value={form.nameCn}
                                        onChange={e => setForm(f => ({...f, nameCn: e.target.value}))}
                                        className="admin-search-input"
                                        placeholder={isEnglish ? 'Event name in Chinese' : '活动中文名称'}
                                    />
                                </label>
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
                                <label>
                                    <span>{isEnglish ? 'Location (English)' : '地点（英文）'}</span>
                                    <input
                                        value={form.location}
                                        onChange={e => setForm(f => ({...f, location: e.target.value}))}
                                        className="admin-search-input"
                                        placeholder={isEnglish ? 'Event location' : '活动地点'}
                                    />
                                </label>
                                <label>
                                    <span>{isEnglish ? 'Location (Chinese)' : '地点（中文）'}</span>
                                    <input
                                        value={form.locationCn}
                                        onChange={e => setForm(f => ({...f, locationCn: e.target.value}))}
                                        className="admin-search-input"
                                        placeholder={isEnglish ? 'Location in Chinese' : '中文地点'}
                                    />
                                </label>
                                <label>
                                    <span>{isEnglish ? 'Poster Image' : '海报图片'}</span>
                                    <input type="file" accept="image/webp" onChange={handleImageChange}/>
                                    {posterPreview && (
                                        <img src={posterPreview} alt="" className="admin-badge-image-preview"/>
                                    )}
                                </label>
                                <label>
                                    <span>{isEnglish ? 'Poster Credit' : '海报作者'}</span>
                                    <input
                                        value={form.posterCredit}
                                        onChange={e => setForm(f => ({...f, posterCredit: e.target.value}))}
                                        className="admin-search-input"
                                        placeholder={isEnglish ? 'Optional' : '可选'}
                                    />
                                </label>
                                <label style={{gridColumn: '1 / -1'}}>
                                    <span>{isEnglish ? 'Description (English)' : '描述（英文）'}</span>
                                    <textarea
                                        value={form.description}
                                        onChange={e => setForm(f => ({...f, description: e.target.value}))}
                                        className="admin-search-input admin-textarea"
                                        placeholder={isEnglish ? 'Event description' : '活动描述'}
                                    />
                                </label>
                                <label style={{gridColumn: '1 / -1'}}>
                                    <span>{isEnglish ? 'Description (Chinese)' : '描述（中文）'}</span>
                                    <textarea
                                        value={form.descriptionCn}
                                        onChange={e => setForm(f => ({...f, descriptionCn: e.target.value}))}
                                        className="admin-search-input admin-textarea"
                                        placeholder={isEnglish ? 'Description in Chinese' : '中文描述'}
                                    />
                                </label>
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
                                <label style={{gridColumn: '1 / -1'}}>
                                    <span>{isEnglish ? 'Custom Button Link' : '自定义按钮链接'}</span>
                                    <input
                                        value={form.customButtonLink}
                                        onChange={e => setForm(f => ({...f, customButtonLink: e.target.value}))}
                                        className="admin-search-input"
                                        placeholder={isEnglish ? 'Optional' : '可选'}
                                    />
                                </label>
                            </div>
                            <div style={{display: 'flex', gap: '10px'}}>
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
                        <button className="admin-generate-btn" onClick={openCreate} style={{marginBottom: '16px'}}>
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
                                    <div className="admin-event-card-img" style={{
                                        background: '#2a2a3e',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        color: '#888',
                                        fontSize: '12px'
                                    }}>
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
                                        <span style={{color: '#f44336', fontSize: '11px'}}>
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
                                    <p style={{color: '#aaa', marginTop: '8px', fontSize: '14px'}}>
                                        {isEnglish ? selectedEvt.description : selectedEvt.descriptionCn}
                                    </p>
                                </div>
                            </div>
                            <div className="admin-form-actions" style={{marginBottom: '20px'}}>
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
                                >
                                    {isEnglish ? 'Delete Event' : '删除活动'}
                                </button>
                            </div>
                        </>
                    )}
                </div>
            )}
        </div>
    );
});

UpcomingEventsTab.displayName = 'UpcomingEventsTab';
