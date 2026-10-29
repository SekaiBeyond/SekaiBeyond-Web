import { forwardRef, useEffect, useImperativeHandle, useState } from 'react';
import { useLanguage } from '~/components/LanguageContextProvider';
import { callSaveUpcomingEvent, callUploadAdminImage, errorMessage } from '~/lib/firebase';
import type { UpcomingEvent } from '~/lib/upcomingEvents';
import type { Tag } from '~/lib/tags';
import { useVenues } from '~/lib/venues';
import { formatSiteTime, parseSiteTime, toDatetimeLocal } from '~/lib/siteTime';
import { localized } from '~/lib/localized';
import { refreshAfterSave, type ShowToast } from './utils';
import { BilingualFormField } from './BilingualFormField';
import { ListCard } from './CrudShell';
import { LocationFormField } from './LocationFormField';
import { ImageUploadField } from './ImageUploadField';
import { ImageCropModal } from './ImageCropModal';
import { UpcomingEventDetailView } from './UpcomingEventDetailView';

interface UpcomingEventsTabProps {
    upcomingEvents: UpcomingEvent[];
    refreshEvents: () => Promise<void>;
    refreshPastEvents: () => Promise<void>;
    tags: Tag[];
    showToast: ShowToast;
    readOnly?: boolean;
    onDetailChange?: (inDetail: boolean) => void;
    onLookupUser?: (uid: string) => void;
}

export interface UpcomingEventsTabHandle {
    selectEvent: (eventId: string) => void;
}

interface EventForm {
    title: string;
    titleCn: string;
    description: string;
    descriptionCn: string;
    location: string;
    locationCn: string;
    venueId: string;
    startAt: string;
    endAt: string;
    posterCredit: string;
    buyTicket: string;
    learnMore: string;
    customButtonText: string;
    customButtonTextCn: string;
    customButtonLink: string;
    paid: boolean;
}

const emptyForm: EventForm = {
    title: '', titleCn: '', description: '', descriptionCn: '',
    location: '', locationCn: '', venueId: '', startAt: '', endAt: '',
    posterCredit: '', buyTicket: '', learnMore: '',
    customButtonText: '', customButtonTextCn: '', customButtonLink: '',
    paid: false,
};

export const UpcomingEventsTab = forwardRef<UpcomingEventsTabHandle, UpcomingEventsTabProps>(({
                                                                                                  upcomingEvents,
                                                                                                  refreshEvents,
                                                                                                  refreshPastEvents,
                                                                                                  tags,
                                                                                                  showToast,
                                                                                                  readOnly = false,
                                                                                                  onDetailChange,
                                                                                                  onLookupUser,
                                                                                              }, forwardedRef) => {
    const {isEnglish} = useLanguage();
    const {venues} = useVenues();
    const [selectedEvent, setSelectedEvent] = useState<string | null>(null);

    useEffect(() => {
        onDetailChange?.(selectedEvent !== null);
    }, [selectedEvent, onDetailChange]);

    const [showForm, setShowForm] = useState(false);
    const [editingEvent, setEditingEvent] = useState<UpcomingEvent | null>(null);
    const [form, setForm] = useState<EventForm>(emptyForm);
    const [posterImage, setPosterImage] = useState<File | null>(null);
    const [posterPreview, setPosterPreview] = useState<string | null>(null);
    const [emailHeaderBgImage, setEmailHeaderBgImage] = useState<File | null>(null);
    const [emailHeaderBgPreview, setEmailHeaderBgPreview] = useState<string | null>(null);
    const [showPosterCropModal, setShowPosterCropModal] = useState(false);
    const [saving, setSaving] = useState(false);

    useImperativeHandle(forwardedRef, () => ({selectEvent: setSelectedEvent}));

    const resetForm = () => {
        setForm(emptyForm);
        setPosterImage(null);
        if (posterPreview?.startsWith('blob:')) URL.revokeObjectURL(posterPreview);
        setPosterPreview(null);
        setEmailHeaderBgImage(null);
        if (emailHeaderBgPreview?.startsWith('blob:')) URL.revokeObjectURL(emailHeaderBgPreview);
        setEmailHeaderBgPreview(null);
    };

    const openCreate = () => {
        resetForm();
        setEditingEvent(null);
        setShowForm(true);
    };

    const openEdit = (event: UpcomingEvent) => {
        setForm({
            title: event.title,
            titleCn: event.titleCn,
            description: event.description,
            descriptionCn: event.descriptionCn,
            location: event.location,
            locationCn: event.locationCn,
            venueId: event.venueId,
            startAt: toDatetimeLocal(event.startAt),
            endAt: toDatetimeLocal(event.endAt),
            posterCredit: event.posterCredit,
            buyTicket: event.buyTicket,
            learnMore: event.learnMore,
            customButtonText: event.customButtonText,
            customButtonTextCn: event.customButtonTextCn,
            customButtonLink: event.customButtonLink,
            paid: event.paid,
        });
        setEditingEvent(event);
        setPosterImage(null);
        setPosterPreview(event.poster || null);
        setEmailHeaderBgImage(null);
        setEmailHeaderBgPreview(event.emailHeaderBg || null);
        setShowForm(true);
    };

    const saveEvent = async () => {
        if (!form.title.trim() || !form.startAt || !form.endAt) return;
        const startAt = parseSiteTime(form.startAt);
        const endAt = parseSiteTime(form.endAt);
        if (endAt <= startAt) {
            showToast(isEnglish ? 'End time must be after start time.' : '结束时间必须晚于开始时间。', 'error');
            return;
        }
        if (editingEvent && editingEvent.paid && !form.paid) {
            const ok = confirm(isEnglish
                ? 'Switching this event from paid to free will hide the tickets tab. Attendee and ticket data is kept on the server so you can switch back, but it will no longer be visible here. To permanently delete attendees, do that from the tickets tab before switching. Continue?'
                : '将此活动从付费切换为免费将隐藏门票选项卡。服务器上的参与者与门票数据会保留以便切换回去，但此处将不再显示。如需永久删除参与者，请先在门票选项卡中操作再切换。是否继续？');
            if (!ok) return;
        }
        setSaving(true);
        try {
            let posterUrl = editingEvent?.poster ?? '';
            if (posterImage) {
                const imageId = crypto.randomUUID();
                posterUrl = await callUploadAdminImage(posterImage, `upcoming-events/${imageId}.webp`);
            }
            let emailHeaderBgUrl = editingEvent?.emailHeaderBg ?? '';
            if (emailHeaderBgImage) {
                const imageId = crypto.randomUUID();
                emailHeaderBgUrl = await callUploadAdminImage(emailHeaderBgImage, `upcoming-events/headers/${imageId}.webp`);
            } else if (!emailHeaderBgPreview) {
                emailHeaderBgUrl = '';
            }

            await callSaveUpcomingEvent({
                ...(editingEvent ? {eventId: editingEvent.id} : {}),
                title: form.title,
                titleCn: form.titleCn,
                description: form.description,
                descriptionCn: form.descriptionCn,
                location: form.location,
                locationCn: form.locationCn,
                venueId: form.venueId,
                startAt: startAt.toISOString(),
                endAt: endAt.toISOString(),
                poster: posterUrl,
                emailHeaderBg: emailHeaderBgUrl,
                posterCredit: form.posterCredit,
                buyTicket: form.buyTicket,
                learnMore: form.learnMore,
                customButtonText: form.customButtonText,
                customButtonTextCn: form.customButtonTextCn,
                customButtonLink: form.customButtonLink,
                paid: form.paid,
            });

            await refreshAfterSave(refreshEvents, showToast, isEnglish);
            showToast(
                editingEvent
                    ? (isEnglish ? 'Event updated.' : '活动已更新。')
                    : (isEnglish ? 'Event created.' : '活动已创建。'),
                'success',
            );
            setShowForm(false);
            resetForm();
            setEditingEvent(null);
        } catch (e) {
            showToast(errorMessage(e, isEnglish ? 'Failed to save event.' : '保存活动失败。'), 'error');
        } finally {
            setSaving(false);
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
                                    label="Title" labelCn="标题"
                                    value={form.title} valueCn={form.titleCn}
                                    onChange={v => setForm(f => ({...f, title: v}))}
                                    onChangeCn={v => setForm(f => ({...f, titleCn: v}))}
                                    placeholder={isEnglish ? 'Event title' : '活动标题'}
                                    placeholderCn={isEnglish ? 'Event title in Chinese' : '活动中文标题'}
                                />
                                <label>
                                    <span>{isEnglish ? 'Start Time (Pacific)' : '开始时间（太平洋时间）'}</span>
                                    <input
                                        type="datetime-local"
                                        value={form.startAt}
                                        onChange={e => setForm(f => ({...f, startAt: e.target.value}))}
                                        className="admin-input"
                                    />
                                </label>
                                <label>
                                    <span>{isEnglish ? 'End Time (Pacific)' : '结束时间（太平洋时间）'}</span>
                                    <input
                                        type="datetime-local"
                                        value={form.endAt}
                                        onChange={e => setForm(f => ({...f, endAt: e.target.value}))}
                                        className="admin-input"
                                    />
                                </label>
                                <LocationFormField
                                    value={form.location} valueCn={form.locationCn}
                                    venueId={form.venueId}
                                    onChange={v => setForm(f => ({...f, location: v}))}
                                    onChangeCn={v => setForm(f => ({...f, locationCn: v}))}
                                    onChangeVenueId={v => setForm(f => ({...f, venueId: v}))}
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
                                    showToast={showToast}
                                />
                                <div className="admin-tickets-template-field">
                                    <ImageUploadField
                                        label="Email Header Background" labelCn="邮件页眉背景"
                                        preview={emailHeaderBgPreview}
                                        onFileChange={(file, url) => {
                                            setEmailHeaderBgImage(file);
                                            setEmailHeaderBgPreview(url);
                                        }}
                                        onCleanupPreview={url => URL.revokeObjectURL(url)}
                                        convertToWebp
                                        showToast={showToast}
                                    />
                                    {(posterPreview || posterImage) && (
                                        <button
                                            type="button"
                                            className="admin-toggle-btn admin-toggle-edit"
                                            style={{marginTop: '4px', alignSelf: 'flex-start'}}
                                            onClick={() => setShowPosterCropModal(true)}
                                        >
                                            {isEnglish ? 'Crop from Poster' : '从海报裁剪'}
                                        </button>
                                    )}
                                </div>
                                <label>
                                    <span>{isEnglish ? 'Poster Credit' : '海报作者'}</span>
                                    <input
                                        value={form.posterCredit}
                                        onChange={e => setForm(f => ({...f, posterCredit: e.target.value}))}
                                        className="admin-input"
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
                                        className="admin-input"
                                        placeholder={isEnglish
                                            ? (form.paid ? 'Optional' : 'Enable Paid event to edit')
                                            : (form.paid ? '可选' : '启用付费活动后可编辑')}
                                        disabled={!form.paid}
                                    />
                                </label>
                                <label>
                                    <span>{isEnglish ? 'Learn More URL' : '了解更多链接'}</span>
                                    <input
                                        value={form.learnMore}
                                        onChange={e => setForm(f => ({...f, learnMore: e.target.value}))}
                                        className="admin-input"
                                        placeholder={isEnglish ? 'Optional' : '可选'}
                                    />
                                </label>
                                <label>
                                    <span>{isEnglish ? 'Custom Button Text (EN)' : '自定义按钮文本（英文）'}</span>
                                    <input
                                        value={form.customButtonText}
                                        onChange={e => setForm(f => ({...f, customButtonText: e.target.value}))}
                                        className="admin-input"
                                        placeholder={isEnglish ? 'Optional' : '可选'}
                                    />
                                </label>
                                <label>
                                    <span>{isEnglish ? 'Custom Button Text (CN)' : '自定义按钮文本（中文）'}</span>
                                    <input
                                        value={form.customButtonTextCn}
                                        onChange={e => setForm(f => ({...f, customButtonTextCn: e.target.value}))}
                                        className="admin-input"
                                        placeholder={isEnglish ? 'Optional' : '可选'}
                                    />
                                </label>
                                <label className="admin-form-grid-full">
                                    <span>{isEnglish ? 'Custom Button Link' : '自定义按钮链接'}</span>
                                    <input
                                        value={form.customButtonLink}
                                        onChange={e => setForm(f => ({...f, customButtonLink: e.target.value}))}
                                        className="admin-input"
                                        placeholder={isEnglish ? 'Optional' : '可选'}
                                    />
                                </label>
                                <label className="admin-form-grid-full admin-checkbox-label">
                                    <input
                                        type="checkbox"
                                        checked={form.paid}
                                        onChange={e => setForm(f => ({...f, paid: e.target.checked}))}
                                    />
                                    <span>
                                        {isEnglish
                                            ? 'Paid event (enables ticket management)'
                                            : '付费活动（启用门票管理）'}
                                    </span>
                                </label>
                                {editingEvent && !editingEvent.paid && form.paid && (
                                    <p className="admin-form-grid-full admin-title-hint admin-warning-hint">
                                        {isEnglish
                                            ? 'Switching to paid will delete this event’s check-in code. Attendee management moves to the Tickets tab; existing attendance records are kept.'
                                            : '切换为付费活动将删除该活动的签到码。参加者将通过门票页面管理；已有的签到记录会保留。'}
                                    </p>
                                )}
                            </div>
                            <div className="admin-btn-row">
                                <button
                                    className="admin-toggle-btn admin-toggle-save"
                                    onClick={saveEvent}
                                    disabled={saving || !form.title.trim() || !form.startAt || !form.endAt}
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
                            {showPosterCropModal && (posterImage || posterPreview) && (
                                <ImageCropModal
                                    imageSource={posterImage || posterPreview!}
                                    aspect={4} // 600x150
                                    onConfirm={(cropped) => {
                                        setEmailHeaderBgImage(cropped);
                                        setEmailHeaderBgPreview(URL.createObjectURL(cropped));
                                        setShowPosterCropModal(false);
                                    }}
                                    onCancel={() => setShowPosterCropModal(false)}
                                    showToast={showToast}
                                />
                            )}
                        </div>
                    ) : !readOnly ? (
                        <button className="admin-btn admin-btn--dashed admin-section-mb" onClick={openCreate}>
                            {isEnglish ? '+ New Upcoming Event' : '+ 新建活动预告'}
                        </button>
                    ) : null}
                    <div className="admin-event-grid">
                        {upcomingEvents.map((event) => (
                            <ListCard
                                key={event.id}
                                image={event.poster}
                                title={localized(isEnglish, event.title, event.titleCn)}
                                subtitle={formatSiteTime(event.startAt, isEnglish, {
                                    year: 'numeric', month: 'short', day: 'numeric',
                                })}
                                tags={[
                                    !event.published && (isEnglish ? 'Unpublished' : '未发布'),
                                    event.endAt < new Date() && (isEnglish ? 'Ended' : '已结束'),
                                    !!event.deleteAt && (isEnglish ? 'Pending deletion' : '待删除'),
                                ]}
                                onClick={() => setSelectedEvent(event.id)}
                            />
                        ))}
                    </div>
                </>
            ) : selectedEvt ? (
                <UpcomingEventDetailView
                    key={selectedEvt.id}
                    event={selectedEvt}
                    venues={venues}
                    tags={tags}
                    readOnly={readOnly}
                    showToast={showToast}
                    refreshEvents={refreshEvents}
                    refreshPastEvents={refreshPastEvents}
                    onBack={() => setSelectedEvent(null)}
                    onEdit={evt => {
                        setSelectedEvent(null);
                        openEdit(evt);
                    }}
                    onLookupUser={onLookupUser}
                />
            ) : (
                <div className="admin-event-detail">
                    <button
                        className="admin-btn admin-btn--link"
                        onClick={() => setSelectedEvent(null)}
                    >
                        &larr; {isEnglish ? 'All Upcoming Events' : '所有活动预告'}
                    </button>
                </div>
            )}
        </div>
    );
});

UpcomingEventsTab.displayName = 'UpcomingEventsTab';
