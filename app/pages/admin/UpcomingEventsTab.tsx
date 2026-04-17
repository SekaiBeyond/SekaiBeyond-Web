import { forwardRef, useImperativeHandle, useState } from 'react';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { useLanguage } from '~/components/LanguageContextProvider';
import {
    callArchiveUpcomingEvent,
    callCancelUpcomingEventDeletion,
    callGenerateEventCode,
    callRequestUpcomingEventDeletion,
    callSaveClaimCodeTimeWindow,
    callSaveUpcomingEvent,
    callSetUpcomingEventPublished,
    callToggleClaimCodeActive,
    callUploadAdminImage,
    getFirebaseDb,
} from '~/lib/firebase';
import type { UpcomingEvent } from '~/lib/upcomingEvents';
import type { Tag } from '~/lib/tags';
import { QRCodeSVG } from 'qrcode.react';
import type { BadgeCode, UserRecord } from './types';
import { fetchEventAttendees, getClaimUrl } from './utils';
import { BilingualFormField } from './BilingualFormField';
import { EventAttendeesList } from './EventAttendeesList';
import { ImageUploadField } from './ImageUploadField';

interface UpcomingEventsTabProps {
    upcomingEvents: UpcomingEvent[];
    refreshEvents: () => Promise<void>;
    refreshPastEvents: () => Promise<void>;
    tags: Tag[];
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
    const [deletionBusyId, setDeletionBusyId] = useState<string | null>(null);
    const [eventSubTab, setEventSubTab] = useState<'codes' | 'attendees'>('codes');
    const [eventCode, setEventCode] = useState<BadgeCode | null>(null);
    const [codeFrom, setCodeFrom] = useState('');
    const [codeUntil, setCodeUntil] = useState('');
    const [generatingCode, setGeneratingCode] = useState(false);
    const [eventAttendees, setEventAttendees] = useState<UserRecord[]>([]);
    const [searchingAttendees, setSearchingAttendees] = useState(false);

    const loadEventCode = async (eventId: string) => {
        const db = getFirebaseDb();
        const codesRef = collection(db, 'claimCodes');
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
        setSearchingAttendees(true);
        try {
            setEventAttendees(await fetchEventAttendees(eventId));
        } catch {
            showToast(isEnglish ? 'Failed to load attendees.' : '加载参加者失败。', 'error');
        } finally {
            setSearchingAttendees(false);
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
            await callToggleClaimCodeActive({codeId: eventCode.id, active: newActive});
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
            await callSaveClaimCodeTimeWindow({codeId: eventCode.id, activeFrom, activeUntil});
            setEventCode({...eventCode, activeFrom, activeUntil});
        } catch {
            showToast(isEnglish ? 'Failed to save time window.' : '保存时间窗口失败。', 'error');
        }
    };

    const selectEvent = async (eventId: string) => {
        setSelectedEvent(eventId);
        setEventSubTab('codes');
        setEventCode(null);
        setEventAttendees([]);
        try {
            await loadEventCode(eventId);
        } catch (err) {
            console.error('Failed to load event code:', err);
            showToast(isEnglish ? 'Failed to load event code.' : '加载活动码失败。', 'error');
        }
    };
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
            let posterUrl = editingEvent?.poster ?? '';
            if (posterImage) {
                const imageId = crypto.randomUUID();
                posterUrl = await callUploadAdminImage(posterImage, `upcoming-events/${imageId}.webp`);
            }

            await callSaveUpcomingEvent({
                ...(editingEvent ? {eventId: editingEvent.id} : {}),
                name: form.name,
                nameCn: form.nameCn,
                description: form.description,
                descriptionCn: form.descriptionCn,
                location: form.location,
                locationCn: form.locationCn,
                startAt: startAt.toISOString(),
                endAt: endAt.toISOString(),
                poster: posterUrl,
                posterCredit: form.posterCredit,
                buyTicket: form.buyTicket,
                learnMore: form.learnMore,
                customButtonText: form.customButtonText,
                customButtonTextCn: form.customButtonTextCn,
                customButtonLink: form.customButtonLink,
            });

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

    const requestDeleteEvent = async (event: UpcomingEvent) => {
        if (!confirm(isEnglish
            ? `Request deletion of "${event.name}"? It will be permanently deleted in about 48 hours unless cancelled.`
            : `申请删除"${event.name}"？如不取消，约 48 小时后将被永久删除。`
        )) return;
        setDeletionBusyId(event.id);
        try {
            await callRequestUpcomingEventDeletion({eventId: event.id});
            await refreshEvents();
            showToast(isEnglish ? 'Deletion scheduled.' : '已计划删除。', 'success');
        } catch {
            showToast(isEnglish ? 'Failed to schedule deletion.' : '计划删除失败。', 'error');
        } finally {
            setDeletionBusyId(null);
        }
    };

    const cancelDeleteEvent = async (event: UpcomingEvent) => {
        setDeletionBusyId(event.id);
        try {
            await callCancelUpcomingEventDeletion({eventId: event.id});
            await refreshEvents();
            showToast(isEnglish ? 'Deletion cancelled.' : '已取消删除。', 'success');
        } catch {
            showToast(isEnglish ? 'Failed to cancel deletion.' : '取消删除失败。', 'error');
        } finally {
            setDeletionBusyId(null);
        }
    };

    const archiveEvent = async (event: UpcomingEvent) => {
        setArchiving(true);
        try {
            await callArchiveUpcomingEvent({eventId: event.id, tagId: archiveTagId});
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

    const togglePublish = async (event: UpcomingEvent) => {
        const newPublished = !event.published;
        try {
            await callSetUpcomingEventPublished({eventId: event.id, published: newPublished});
            await refreshEvents();
            showToast(
                newPublished
                    ? (isEnglish ? 'Event published.' : '活动已发布。')
                    : (isEnglish ? 'Event unpublished.' : '活动已取消发布。'),
                'success',
            );
        } catch (err) {
            console.error('[togglePublish]', err);
            showToast(isEnglish ? 'Failed to update publish status.' : '更新发布状态失败。', 'error');
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
                                    convertToWebp
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
                                    className="admin-toggle-btn admin-toggle-save"
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
                                    className="admin-toggle-btn admin-toggle-cancel"
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
                                    {!event.published && (
                                        <span className="admin-ended-tag">
                                            {isEnglish ? 'Unpublished' : '未发布'}
                                        </span>
                                    )}
                                    {event.endAt < new Date() && (
                                        <span className="admin-ended-tag">
                                            {isEnglish ? 'Ended' : '已结束'}
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
                                    className="admin-toggle-btn admin-toggle-edit"
                                    onClick={() => {
                                        setSelectedEvent(null);
                                        openEdit(selectedEvt);
                                    }}
                                >
                                    {isEnglish ? 'Edit Event' : '编辑活动'}
                                </button>
                                <button
                                    className={`admin-toggle-btn ${selectedEvt.published ? 'admin-toggle-revoke' : 'admin-toggle-grant'}`}
                                    onClick={() => togglePublish(selectedEvt)}
                                >
                                    {selectedEvt.published
                                        ? (isEnglish ? 'Unpublish' : '取消发布')
                                        : (isEnglish ? 'Publish' : '发布')}
                                </button>
                                {selectedEvt.deleteAt ? (
                                    <button
                                        className="admin-toggle-btn admin-toggle-grant"
                                        onClick={() => cancelDeleteEvent(selectedEvt)}
                                        disabled={deletionBusyId === selectedEvt.id}
                                    >
                                        {deletionBusyId === selectedEvt.id
                                            ? (isEnglish ? 'Working...' : '处理中...')
                                            : (isEnglish ? 'Cancel deletion' : '取消删除')}
                                    </button>
                                ) : (
                                    <button
                                        className="admin-toggle-btn admin-toggle-revoke"
                                        onClick={() => requestDeleteEvent(selectedEvt)}
                                        disabled={deletionBusyId === selectedEvt.id}
                                    >
                                        {deletionBusyId === selectedEvt.id
                                            ? (isEnglish ? 'Working...' : '处理中...')
                                            : (isEnglish ? 'Delete Event' : '删除活动')}
                                    </button>
                                )}
                                <button
                                    className="admin-toggle-btn admin-toggle-archive"
                                    onClick={() => setShowArchive(!showArchive)}
                                >
                                    {isEnglish ? 'Archive to Past Events' : '归档到往期活动'}
                                </button>
                            </div>
                            {selectedEvt.deleteAt && (
                                <p className="admin-helper-text">
                                    {isEnglish
                                        ? `Pending deletion — scheduled around ${selectedEvt.deleteAt.toLocaleString('en-US', {
                                            month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
                                        })}.`
                                        : `待删除 — 预计于 ${selectedEvt.deleteAt.toLocaleString('zh-CN', {
                                            month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
                                        })} 前后执行。`}
                                </p>
                            )}
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
                                            className="admin-toggle-btn admin-toggle-archive"
                                            onClick={() => archiveEvent(selectedEvt)}
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
                                        loadEventAttendees(selectedEvent!);
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
                                                onClick={() => generateEventCodeFn(selectedEvent!)}
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
                                                    className="admin-toggle-btn admin-toggle-save"
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
                                                <button
                                                    className={`admin-toggle-btn ${eventCode.active ? 'admin-toggle-revoke' : 'admin-toggle-grant'}`}
                                                    onClick={toggleCodeActive}
                                                >
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
                                                        if (window.confirm(msg)) generateEventCodeFn(selectedEvent!);
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
                                <EventAttendeesList loading={searchingAttendees} attendees={eventAttendees}/>
                            )}
                        </>
                    )}
                </div>
            )}
        </div>
    );
});

UpcomingEventsTab.displayName = 'UpcomingEventsTab';
