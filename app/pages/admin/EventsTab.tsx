import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { useLanguage } from '~/components/LanguageContextProvider';
import { callSavePastEvent, callUploadAdminImage, errorMessage } from '~/lib/firebase';
import type { PastEvent } from '~/lib/pastEvents';
import type { Tag } from '~/lib/tags';
import { useVenues } from '~/lib/venues';
import { localized } from '~/lib/localized';
import { refreshAfterSave, type ShowToast } from './utils';
import { BilingualFormField } from './BilingualFormField';
import { ListCard } from './CrudShell';
import { ConEditionField } from './ConEditionField';
import { EmptyRow } from './conContentShared';
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

/** Past events come in two lists: each year's Sekai Beyond Con, and the rest. */
type Section = 'con' | 'past';

const emptyForm = () => ({
    title: '', titleCn: '', tagIds: [] as string[], date: '',
    location: '', locationCn: '', venueId: '',
    description: '', descriptionCn: '', icon: '', recapLink: '', recapLinkCn: '',
    isCon: false,
});

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

    // The section the open form sits in, or null when it's closed.
    const [formSection, setFormSection] = useState<Section | null>(null);
    const [editingEvent, setEditingEvent] = useState<PastEvent | null>(null);
    const [eventForm, setEventForm] = useState(emptyForm);
    const [savingEvent, setSavingEvent] = useState(false);
    const [eventImage, setEventImage] = useState<File | null>(null);
    const [eventImagePreview, setEventImagePreview] = useState<string | null>(null);
    const formRef = useRef<HTMLDivElement>(null);
    // An edit opened from an event's page lands on the list, maybe below the
    // fold in Past Events, so it scrolls to the form.
    const [scrollToForm, setScrollToForm] = useState(false);

    useImperativeHandle(forwardedRef, () => ({selectManagedEvent: setManagedEvent}));

    useEffect(() => {
        if (!scrollToForm) return;
        formRef.current?.scrollIntoView({behavior: 'smooth', block: 'start'});
        setScrollToForm(false);
    }, [scrollToForm]);

    const {conEvents, otherEvents} = useMemo(() => ({
        conEvents: pastEvents
            .filter(e => e.con)
            .sort((a, b) => b.con!.year - a.con!.year || b.date.localeCompare(a.date)),
        otherEvents: pastEvents.filter(e => !e.con),
    }), [pastEvents]);

    const resetEventForm = () => {
        setEventForm(emptyForm());
        setEventImage(null);
        if (eventImagePreview?.startsWith('blob:')) URL.revokeObjectURL(eventImagePreview);
        setEventImagePreview(null);
    };

    const closeForm = () => {
        setFormSection(null);
        setEditingEvent(null);
    };

    const openCreateEvent = (section: Section) => {
        resetEventForm();
        if (section === 'con') {
            setEventForm(f => ({...f, isCon: true}));
        }
        setEditingEvent(null);
        setFormSection(section);
    };

    const openEditEvent = (event: PastEvent) => {
        setEventForm({
            title: event.title, titleCn: event.titleCn, tagIds: event.tagIds,
            date: event.date,
            location: event.location, locationCn: event.locationCn, venueId: event.venueId,
            description: event.description, descriptionCn: event.descriptionCn, icon: event.icon,
            recapLink: event.recapLink, recapLinkCn: event.recapLinkCn,
            isCon: !!event.con,
        });
        setEditingEvent(event);
        setEventImage(null);
        setEventImagePreview(event.icon || null);
        setFormSection(event.con ? 'con' : 'past');
        setScrollToForm(true);
    };

    const canSave = !savingEvent && !!eventForm.title.trim() && !!eventForm.date.trim();

    const saveEvent = async () => {
        if (!canSave) return;
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
                tagIds: eventForm.isCon ? [] : eventForm.tagIds,
                date: eventForm.date,
                location: eventForm.location,
                locationCn: eventForm.locationCn,
                venueId: eventForm.venueId,
                description: eventForm.description,
                descriptionCn: eventForm.descriptionCn,
                icon: iconUrl,
                recapLink: eventForm.recapLink.trim(),
                recapLinkCn: eventForm.recapLinkCn.trim(),
                con: eventForm.isCon,
            });

            await refreshAfterSave(refreshEvents, showToast, isEnglish);
            showToast(
                editingEvent
                    ? (isEnglish ? 'Event updated.' : '活动已更新。')
                    : (isEnglish ? 'Event created.' : '活动已创建。'),
                'success',
            );
            closeForm();
            resetEventForm();
        } catch (e) {
            showToast(errorMessage(e, isEnglish ? 'Failed to save event.' : '保存活动失败。'), 'error');
        } finally {
            setSavingEvent(false);
        }
    };

    const renderForm = () => (
        <div ref={formRef} className="admin-create-badge-form">
            <h4 className="admin-badges-title">
                {editingEvent
                    ? (isEnglish ? 'Edit Event' : '编辑活动')
                    : formSection === 'con'
                        ? (isEnglish ? 'New Con Edition' : '新建漫展年度')
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
                {/* A Con has no tags: the Con mark is its label. */}
                {!eventForm.isCon && (
                    <TagMultiSelect
                        tags={tags}
                        selected={eventForm.tagIds}
                        onChange={ids => setEventForm(f => ({...f, tagIds: ids}))}
                        isEnglish={isEnglish}
                    />
                )}
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
                    label={eventForm.isCon ? 'Poster' : 'Event Image'}
                    labelCn={eventForm.isCon ? '海报' : '活动图片'}
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
                <ConEditionField
                    value={eventForm.isCon}
                    onChange={isCon => setEventForm(f => ({...f, isCon}))}
                    date={eventForm.date}
                />
            </div>
            <div className="admin-btn-row">
                <button
                    className="admin-toggle-btn admin-toggle-save"
                    onClick={saveEvent}
                    disabled={!canSave}
                >
                    {savingEvent
                        ? (isEnglish ? 'Saving...' : '保存中...')
                        : editingEvent
                            ? (isEnglish ? 'Save Changes' : '保存更改')
                            : (isEnglish ? 'Create Event' : '创建活动')}
                </button>
                <button className="admin-toggle-btn admin-toggle-cancel" onClick={closeForm}>
                    {isEnglish ? 'Cancel' : '取消'}
                </button>
            </div>
        </div>
    );

    const renderCreate = (section: Section) => {
        if (readOnly) return null;
        if (formSection === section) return renderForm();
        return (
            <button className="admin-btn admin-btn--dashed admin-section-mb" onClick={() => openCreateEvent(section)}>
                {section === 'con'
                    ? (isEnglish ? '+ New Con Edition' : '+ 新建漫展年度')
                    : (isEnglish ? '+ New Event' : '+ 新建活动')}
            </button>
        );
    };

    const renderGrid = (events: PastEvent[]) => (
        <div className="admin-event-grid">
            {events.map((event) => (
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
    );

    const managedEvt = managedEvent ? pastEvents.find(e => e.id === managedEvent) ?? null : null;

    return (
        <div className="admin-section">
            {!managedEvent ? (
                <>
                    <div id="admin-sec-con">
                        <h2 className="admin-section-header admin-section-mt">
                            {isEnglish ? 'Sekai Beyond Con' : '彼世界动漫游戏展'}
                        </h2>
                        {renderCreate('con')}
                        {conEvents.length > 0 ? renderGrid(conEvents) : formSection !== 'con' && (
                            <EmptyRow label={{
                                en: 'No Con editions yet. An upcoming event marked as a Sekai Beyond Con edition moves here once archived.',
                                zh: '暂无漫展年度。标记为彼世界动漫游戏展的活动预告归档后会出现在这里。',
                            }}/>
                        )}
                    </div>
                    <div id="admin-sec-past">
                        <h2 className="admin-section-header admin-section-mt">
                            {isEnglish ? 'Past Events' : '往期活动'}
                        </h2>
                        {renderCreate('past')}
                        {renderGrid(otherEvents)}
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
