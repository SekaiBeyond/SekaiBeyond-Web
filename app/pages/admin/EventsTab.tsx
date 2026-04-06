import { forwardRef, useImperativeHandle, useState } from 'react';
import { arrayRemove, collection, doc, getDocs, query, serverTimestamp, where, writeBatch, } from 'firebase/firestore';
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import type { User } from 'firebase/auth';
import { GROUP_LABELS, type UserProfile } from '~/components/AuthProvider';
import { useLanguage } from '~/components/LanguageContextProvider';
import { callGenerateEventCode, getFirebaseDb, getFirebaseStorage } from '~/lib/firebase';
import type { PastEvent } from '~/lib/pastEvents';
import { QRCodeSVG } from 'qrcode.react';
import type { Tag } from '~/lib/tags';
import type { BadgeCode, UserRecord } from './types';
import { commitInChunks, docToUserRecord, getClaimUrl } from './utils';
import { BilingualFormField } from './BilingualFormField';
import { ImageUploadField } from './ImageUploadField';

interface EventsTabProps {
    pastEvents: PastEvent[];
    refreshEvents: () => Promise<void>;
    tags: Tag[];
    user: User;
    profile: UserProfile;
    showToast: (message: string, type: 'success' | 'error') => void;
}

export interface EventsTabHandle {
    selectManagedEvent: (eventId: string) => Promise<void>;
}

export const EventsTab = forwardRef<EventsTabHandle, EventsTabProps>(({
                                                                          pastEvents,
                                                                          refreshEvents,
                                                                          tags,
                                                                          user,
                                                                          profile,
                                                                          showToast,
                                                                      }, forwardedRef) => {
    const {isEnglish} = useLanguage();
    const [managedEvent, setManagedEvent] = useState<string | null>(null);
    const [eventSubTab, setEventSubTab] = useState<'codes' | 'attendees'>('codes');
    const [eventCode, setEventCode] = useState<BadgeCode | null>(null);
    const [codeFrom, setCodeFrom] = useState('');
    const [codeUntil, setCodeUntil] = useState('');
    const [generatingCode, setGeneratingCode] = useState(false);
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
        setEventSubTab('codes');
        setEventCode(null);
        setEventAttendees([]);
        try {
            await loadEventCode(eventId);
        } catch (err) {
            console.error('Failed to load event code:', err);
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

    const loadEventCode = async (eventId: string) => {
        const db = getFirebaseDb();
        const codesRef = collection(db, 'badgeCodes');
        const q = query(codesRef, where('eventId', '==', eventId));
        const snapshot = await getDocs(q);

        const codes: BadgeCode[] = snapshot.docs.map(docSnap => {
            const data = docSnap.data();
            return {
                id: docSnap.id,
                code: data.code,
                eventId: data.eventId ?? '',
                active: data.active ?? true,
                activeFrom: data.activeFrom ?? null,
                activeUntil: data.activeUntil ?? null,
            };
        });
        const active = codes.find(c => c.active);
        const picked = active ?? codes[0] ?? null;
        setEventCode(picked);
        setCodeFrom(picked?.activeFrom ?? '');
        setCodeUntil(picked?.activeUntil ?? '');
    };

    const loadEventAttendees = async (eventId: string) => {
        setSearching(true);
        try {
            const db = getFirebaseDb();
            const q = query(collection(db, 'users'), where('attendedEvents', 'array-contains', eventId));
            const snapshot = await getDocs(q);
            setEventAttendees(snapshot.docs.map(docToUserRecord));
        } catch {
            showToast(isEnglish ? 'Failed to load attendees.' : '加载参加者失败。', 'error');
        } finally {
            setSearching(false);
        }
    };

    const generateEventCodeFn = async (eventId: string) => {
        setGeneratingCode(true);
        try {
            const result = await callGenerateEventCode({eventId});
            const {id, code} = result.data;
            setEventCode({id, code, eventId, active: true, activeFrom: null, activeUntil: null});
            setCodeFrom('');
            setCodeUntil('');
        } catch {
            showToast(isEnglish ? 'Failed to generate code.' : '生成签到码失败。', 'error');
        } finally {
            setGeneratingCode(false);
        }
    };

    const toggleCodeActive = async () => {
        if (!eventCode) return;
        const newActive = !eventCode.active;
        try {
            const db = getFirebaseDb();
            const evt = managedEvent ? pastEvents.find(e => e.id === managedEvent) : null;
            const batch = writeBatch(db);
            batch.update(doc(db, 'badgeCodes', eventCode.id), {active: newActive});
            batch.set(doc(collection(db, 'records')), {
                type: newActive ? 'event-code-activate' : 'event-code-deactivate',
                performedBy: user.uid,
                performedByName: profile.displayName,
                eventTitle: evt?.title ?? managedEvent,
                eventId: managedEvent,
                code: eventCode.code,
                timestamp: serverTimestamp(),
            });
            await batch.commit();
            setEventCode({...eventCode, active: newActive});
        } catch {
            showToast(isEnglish ? 'Failed to update code status.' : '更新签到码状态失败。', 'error');
        }
    };

    const saveCodeTimeWindow = async () => {
        if (!eventCode) return;
        const activeFrom = codeFrom || null;
        const activeUntil = codeUntil || null;
        try {
            const db = getFirebaseDb();
            const evt = managedEvent ? pastEvents.find(e => e.id === managedEvent) : null;
            const batch = writeBatch(db);
            batch.update(doc(db, 'badgeCodes', eventCode.id), {activeFrom, activeUntil});
            batch.set(doc(collection(db, 'records')), {
                type: 'event-code-time-window' as const,
                performedBy: user.uid,
                performedByName: profile.displayName,
                eventTitle: evt?.title ?? managedEvent,
                eventId: managedEvent,
                code: eventCode.code,
                timestamp: serverTimestamp(),
            });
            await batch.commit();
            setEventCode({...eventCode, activeFrom, activeUntil});
        } catch {
            showToast(isEnglish ? 'Failed to save time window.' : '保存时间窗口失败。', 'error');
        }
    };

    const saveEvent = async () => {
        if (!eventForm.title.trim() || !eventForm.date.trim()) return;
        setSavingEvent(true);
        try {
            const db = getFirebaseDb();

            let iconUrl = eventForm.icon;
            if (eventImage) {
                const imageId = crypto.randomUUID();
                const storageRef = ref(getFirebaseStorage(), `events/${imageId}.webp`);
                await uploadBytes(storageRef, eventImage);
                iconUrl = await getDownloadURL(storageRef);
            }

            const data: Record<string, string> = {
                tagId: eventForm.tagId,
                title: eventForm.title,
                titleCn: eventForm.titleCn,
                date: eventForm.date,
                location: eventForm.location,
                description: eventForm.description,
                descriptionCn: eventForm.descriptionCn,
                icon: iconUrl,
            };

            const batch = writeBatch(db);
            let newEventId: string;
            if (editingEvent) {
                batch.update(doc(db, 'pastEvents', editingEvent.id), data);
                newEventId = editingEvent.id;
            } else {
                const newDocRef = doc(collection(db, 'pastEvents'));
                batch.set(newDocRef, data);
                newEventId = newDocRef.id;
            }
            batch.set(doc(collection(db, 'records')), {
                type: editingEvent ? 'event-edit' : 'event-create',
                performedBy: user.uid,
                performedByName: profile.displayName,
                eventTitle: eventForm.title,
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
            const db = getFirebaseDb();

            // Find orphaned codes and attendees to clean up
            const [codesSnap, attendeesSnap] = await Promise.all([
                getDocs(query(collection(db, 'badgeCodes'), where('eventId', '==', event.id))),
                getDocs(query(collection(db, 'users'), where('attendedEvents', 'array-contains', event.id))),
            ]);

            const ops: ((b: ReturnType<typeof writeBatch>) => void)[] = [
                b => b.delete(doc(db, 'pastEvents', event.id)),
                b => b.set(doc(collection(db, 'records')), {
                    type: 'event-delete',
                    performedBy: user.uid,
                    performedByName: profile.displayName,
                    eventTitle: event.title,
                    eventId: event.id,
                    timestamp: serverTimestamp(),
                }),
                ...codesSnap.docs.map(codeDoc => (b: ReturnType<typeof writeBatch>) => b.delete(codeDoc.ref)),
                ...attendeesSnap.docs.map(userDoc => (b: ReturnType<typeof writeBatch>) => b.update(userDoc.ref, {attendedEvents: arrayRemove(event.id)})),
            ];
            await commitInChunks(db, ops);

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

                    <div className="admin-sub-tabs">
                        <button
                            className={`admin-sub-tab ${eventSubTab === 'codes' ? 'admin-sub-tab-active' : ''}`}
                            onClick={() => setEventSubTab('codes')}
                        >
                            {isEnglish ? 'Check-in Code' : '签到码'}
                        </button>
                        <button
                            className={`admin-sub-tab ${eventSubTab === 'attendees' ? 'admin-sub-tab-active' : ''}`}
                            onClick={() => {
                                setEventSubTab('attendees');
                                loadEventAttendees(managedEvent).then();
                            }}
                        >
                            {isEnglish ? 'Attendees' : '参加者'}
                            {eventAttendees.length > 0 && (
                                <span className="admin-sub-tab-count">{eventAttendees.length}</span>
                            )}
                        </button>
                    </div>

                    {eventSubTab === 'codes' && (
                        <div className="admin-codes-section">
                            {!eventCode ? (
                                <>
                                    <p className="admin-no-results">
                                        {isEnglish ? 'No check-in code yet.' : '暂无签到码。'}
                                    </p>
                                    <button
                                        className="admin-generate-btn"
                                        onClick={() => generateEventCodeFn(managedEvent)}
                                        disabled={generatingCode}
                                    >
                                        {generatingCode
                                            ? (isEnglish ? 'Generating...' : '生成中...')
                                            : (isEnglish ? '+ Generate Code' : '+ 生成签到码')}
                                    </button>
                                </>
                            ) : (
                                <div className="admin-single-code">
                                    <div className="admin-single-code-qr">
                                        <QRCodeSVG value={getClaimUrl(eventCode.code)} size={200} level="M"/>
                                    </div>
                                    <div className="admin-code-url">
                                        <input
                                            readOnly
                                            value={getClaimUrl(eventCode.code)}
                                            onClick={(e) => (e.target as HTMLInputElement).select()}
                                            className="admin-code-input"
                                        />
                                        <button
                                            className="admin-copy-btn"
                                            onClick={() => navigator.clipboard.writeText(getClaimUrl(eventCode.code))}
                                        >
                                            {isEnglish ? 'Copy' : '复制'}
                                        </button>
                                    </div>
                                    <span
                                        className={eventCode.active ? 'admin-code-active-tag' : 'admin-code-inactive-tag'}>
                                        {eventCode.active
                                            ? (isEnglish ? 'Active' : '启用')
                                            : (isEnglish ? 'Disabled' : '已停用')}
                                    </span>
                                    <div className="admin-code-time-inputs">
                                        <label>
                                            <span>{isEnglish ? 'Active from' : '开始时间'}</span>
                                            <input
                                                type="datetime-local"
                                                value={codeFrom}
                                                onChange={(e) => setCodeFrom(e.target.value)}
                                                className="admin-datetime-input"
                                            />
                                        </label>
                                        <label>
                                            <span>{isEnglish ? 'Active until' : '结束时间'}</span>
                                            <input
                                                type="datetime-local"
                                                value={codeUntil}
                                                onChange={(e) => setCodeUntil(e.target.value)}
                                                className="admin-datetime-input"
                                            />
                                        </label>
                                        <button
                                            className="admin-toggle-btn admin-toggle-grant"
                                            onClick={saveCodeTimeWindow}
                                            disabled={codeFrom === (eventCode.activeFrom ?? '') && codeUntil === (eventCode.activeUntil ?? '')}
                                        >
                                            {isEnglish ? 'Save' : '保存'}
                                        </button>
                                    </div>
                                    <p className="admin-time-hint">
                                        {isEnglish ? 'Leave empty for no time limit.' : '留空表示不限时间。'}
                                    </p>
                                    <div className="admin-single-code-actions">
                                        <button className="admin-toggle-btn" onClick={toggleCodeActive}>
                                            {eventCode.active
                                                ? (isEnglish ? 'Disable' : '停用')
                                                : (isEnglish ? 'Enable' : '启用')}
                                        </button>
                                        <button
                                            className="admin-toggle-btn admin-toggle-revoke"
                                            onClick={() => {
                                                const msg = isEnglish
                                                    ? 'This will deactivate the current code and generate a new one. Users with the old QR code will no longer be able to check in. Continue?'
                                                    : '此操作将停用当前签到码并生成新码。持有旧二维码的用户将无法签到。是否继续？';
                                                if (window.confirm(msg)) generateEventCodeFn(managedEvent);
                                            }}
                                            disabled={generatingCode}
                                        >
                                            {generatingCode
                                                ? (isEnglish ? 'Regenerating...' : '重新生成中...')
                                                : (isEnglish ? 'Regenerate' : '重新生成')}
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>
                    )}

                    {eventSubTab === 'attendees' && (
                        <div className="admin-attendees-section">
                            {searching && <div className="profile-spinner admin-spinner-center"/>}
                            {!searching && eventAttendees.length === 0 && (
                                <p className="admin-no-results">{isEnglish ? 'No attendees yet.' : '暂无参加者。'}</p>
                            )}
                            {!searching && eventAttendees.length > 0 && (
                                <p className="admin-attendees-count">
                                    {eventAttendees.length} {isEnglish ? 'attendees' : '人参加'}
                                </p>
                            )}
                            {!searching && eventAttendees.map((u) => (
                                <div key={u.uid} className="admin-user-row">
                                    <img src={u.photoURL} alt="" className="admin-user-avatar"
                                         referrerPolicy="no-referrer"/>
                                    <div>
                                        <div className="admin-user-name">{u.displayName}</div>
                                        <div className="admin-user-email">{u.email}</div>
                                    </div>
                                    <span className="admin-user-group-tag" data-group={u.group}>
                                        {isEnglish ? GROUP_LABELS[u.group].en : GROUP_LABELS[u.group].zh}
                                    </span>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
});

EventsTab.displayName = 'EventsTab';
