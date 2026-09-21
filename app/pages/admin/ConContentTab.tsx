import { type Dispatch, type ReactNode, type SetStateAction, useEffect, useState } from 'react';
import { useLanguage } from '~/components/LanguageContextProvider';
import { callSaveConContent, callUploadAdminImage } from '~/lib/firebase';
import { type ConContent, type ConContentSection, refreshConContent, useConDraft, } from '~/lib/conContent';
import { useVenues } from '~/lib/venues';
import { type EarlyBird, type InPersonSession, ROOM_ACCENTS, type RoomAccent } from '~/pages/con/content';
import type { Localized } from '~/pages/con/i18n';
import { formatPrice, formatSessionDay, sessionBounds, ticketFeeFor } from '~/pages/con/utils';
import type { ShowToast } from './utils';
import { ImageUploadField } from './ImageUploadField';
import { SectionNav } from './SectionNav';

/**
 * Editor for the public /con page's copy. Everything here is stored in
 * `conContent/main` and overlaid on the defaults in `app/pages/con/content.ts`.
 *
 * Each section owns its own Save button and writes only its own field, so two
 * people editing different parts of the page cannot clobber each other. The
 * parts of the con page that are not editable here — the hero video, the nav
 * links, the track names, the about copy, the venue travel notes — are tied to
 * files in public/, to section anchors, or to CSS class names, and stay in code.
 */

interface ConContentTabProps {
    showToast: ShowToast;
    readOnly?: boolean;
}

const SECTION_LABELS: Record<ConContentSection, Localized> = {
    settings: {en: 'Page Visibility', zh: '页面可见性'},
    event: {en: 'Event Details', zh: '活动信息'},
    rooms: {en: 'Rooms', zh: '场地房间'},
    schedule: {en: 'Schedule', zh: '活动日程'},
    guests: {en: 'Guests & Performers', zh: '嘉宾与演出者'},
    vendors: {en: 'Artist Alley', zh: '创作者市集'},
    tickets: {en: 'Tickets', zh: '门票'},
    ticketFee: {en: 'Online Transaction Fee', zh: '线上交易手续费'},
    inPersonSales: {en: 'In-Person Sales', zh: '线下售票'},
    faq: {en: 'FAQ', zh: '常见问题'},
};

/** The section navigator's order — keep it matching the order ConContentTab renders them in. */
const SECTION_ORDER: ConContentSection[] = [
    'settings', 'event', 'rooms', 'schedule', 'guests', 'vendors', 'tickets', 'ticketFee', 'inPersonSales', 'faq',
];

const conSectionId = (section: ConContentSection) => `admin-sec-con-${section}`;

const BLANK: Localized = {en: '', zh: ''};

/**
 * An id for a newly added row. Deliberately not derived from the list length:
 * deleting `room-2` from three rooms and adding one would mint `room-3` on top of
 * the `room-3` that is still there. Lowercase hex keeps it inside the slug shape
 * the server enforces for room ids.
 */
const newRowId = (prefix: string) => `${prefix}-${crypto.randomUUID().slice(0, 8)}`;

const replaceAt = <T, >(items: T[], index: number, next: T): T[] =>
    items.map((item, i) => (i === index ? next : item));

const removeAt = <T, >(items: T[], index: number): T[] => items.filter((_, i) => i !== index);

const moveAt = <T, >(items: T[], index: number, delta: number): T[] => {
    const target = index + delta;
    if (target < 0 || target >= items.length) return items;
    const next = [...items];
    [next[index], next[target]] = [next[target], next[index]];
    return next;
};

interface SectionEditor<T> {
    draft: T;
    setDraft: Dispatch<SetStateAction<T>>;
    saving: boolean;
    dirty: boolean;
    save: () => Promise<void>;
    revert: () => void;
}

/**
 * Holds one section's draft. The draft is seeded once the initial fetch lands
 * (the same `initialized` guard SiteConfigTab uses), and re-seeded after a save
 * from what the server stored — the function trims copy and fills in ids, so
 * echoing the draft back would leave the form disagreeing with the live page.
 */
function useSectionEditor<K extends ConContentSection>(
    section: K,
    value: ConContent[K],
    loading: boolean,
    showToast: ShowToast,
): SectionEditor<ConContent[K]> {
    const {isEnglish} = useLanguage();
    const [draft, setDraft] = useState<ConContent[K]>(value);
    const [initialized, setInitialized] = useState(false);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        if (!loading && !initialized) {
            setDraft(value);
            setInitialized(true);
        }
    }, [loading, value, initialized]);

    const label = SECTION_LABELS[section];
    const dirty = JSON.stringify(draft) !== JSON.stringify(value);

    const save = async () => {
        setSaving(true);
        try {
            await callSaveConContent({[section]: draft} as Partial<ConContent>);
        } catch (e: any) {
            showToast(
                e?.message ?? (isEnglish ? `Failed to save ${label.en}.` : `保存${label.zh}失败。`),
                'error',
            );
            setSaving(false);
            return;
        }
        // The write landed. A re-read that fails after it is a stale form, not a
        // failed save, so it must not be reported as one.
        try {
            const fresh = await refreshConContent();
            setDraft(fresh[section]);
            showToast(isEnglish ? `${label.en} saved.` : `${label.zh}已保存。`, 'success');
        } catch {
            // Keep the draft; it is what was just stored.
            showToast(
                isEnglish
                    ? `${label.en} saved, but the page could not re-read it. Reload to see the stored copy.`
                    : `${label.zh}已保存，但无法重新读取。请刷新页面以查看已存储的内容。`,
                'warning',
            );
        }
        setSaving(false);
    };

    return {draft, setDraft, saving, dirty, save, revert: () => setDraft(value)};
}

interface SectionShellProps<K extends ConContentSection> {
    section: K;
    helper: Localized;
    editor: SectionEditor<ConContent[K]>;
    /**
     * Blocks Save and Discard while something the draft depends on is still in
     * flight — an image upload leaves a local `blob:` preview in the draft, which
     * the server rejects outright.
     */
    busy?: boolean;
    busyLabel?: Localized;
    /**
     * Blocks Save while the draft is in a state the server would refuse, and says
     * why. Catching it here costs a round trip less, and lets the message name the
     * rows an admin has to go and fix rather than the id the server sees.
     */
    blocked?: Localized;
    readOnly?: boolean;
    children: ReactNode;
}

const SectionShell = <K extends ConContentSection, >(
    {section, helper, editor, busy, busyLabel, blocked, readOnly, children}: SectionShellProps<K>,
) => {
    const {isEnglish} = useLanguage();
    const label = SECTION_LABELS[section];

    return (
        <div id={conSectionId(section)} className="admin-section">
            <h3 className="admin-badges-title">
                {isEnglish ? label.en : label.zh}
                {editor.dirty && !readOnly && (
                    <span className="admin-con-dirty">
                        {isEnglish ? 'Unsaved changes' : '有未保存的更改'}
                    </span>
                )}
            </h3>
            <p className="admin-helper-text">{isEnglish ? helper.en : helper.zh}</p>

            <div className="admin-mt-12">{children}</div>

            {blocked && !readOnly && (
                <p className="admin-title-hint admin-warning-hint">
                    {isEnglish ? blocked.en : blocked.zh}
                </p>
            )}

            {!readOnly && (
                <div className="admin-btn-row admin-mt-12">
                    <button
                        className="admin-toggle-btn admin-toggle-save"
                        onClick={editor.save}
                        disabled={editor.saving || busy || !!blocked || !editor.dirty}
                    >
                        {editor.saving
                            ? (isEnglish ? 'Saving...' : '保存中...')
                            : (isEnglish ? 'Save' : '保存')}
                    </button>
                    <button
                        className="admin-toggle-btn admin-toggle-cancel"
                        onClick={editor.revert}
                        disabled={editor.saving || busy || !editor.dirty}
                    >
                        {isEnglish ? 'Discard Changes' : '放弃更改'}
                    </button>
                    {busy && busyLabel && (
                        <span className="admin-helper-text">
                            {isEnglish ? busyLabel.en : busyLabel.zh}
                        </span>
                    )}
                </div>
            )}
        </div>
    );
};

interface LocalizedFieldProps {
    label: Localized;
    value: Localized;
    onChange: (next: Localized) => void;
    readOnly?: boolean;
    multiline?: boolean;
    full?: boolean;
}

/**
 * The con page stores copy as {en, zh} pairs rather than the `field`/`fieldCn`
 * columns BilingualFormField expects, so this is the same two-input layout over
 * a single Localized value.
 */
const LocalizedField = ({label, value, onChange, readOnly, multiline, full}: LocalizedFieldProps) => {
    const {isEnglish} = useLanguage();
    const Tag = multiline ? 'textarea' : 'input';
    const cls = `admin-input${multiline ? ' admin-textarea' : ''}`;
    const wrapCls = full ? 'admin-form-grid-full' : undefined;

    return (
        <>
            <label className={wrapCls}>
                <span>{isEnglish ? `${label.en} (English)` : `${label.zh}（英文）`}</span>
                <Tag
                    className={cls}
                    value={value.en}
                    onChange={e => !readOnly && onChange({...value, en: e.target.value})}
                    readOnly={readOnly}
                />
            </label>
            <label className={wrapCls}>
                <span>{isEnglish ? `${label.en} (Chinese)` : `${label.zh}（中文）`}</span>
                <Tag
                    className={cls}
                    value={value.zh}
                    onChange={e => !readOnly && onChange({...value, zh: e.target.value})}
                    readOnly={readOnly}
                />
            </label>
        </>
    );
};

interface AmountFieldProps {
    label: Localized;
    value: number;
    onChange: (next: number) => void;
    readOnly?: boolean;
    helper?: Localized;
    /** Shown after the label. Dollars unless set. */
    unit?: Localized;
    max?: number;
}

/** A price or a fee is a number, not copy, so one input serves both languages. */
const AmountField = (
    {label, value, onChange, readOnly, helper, unit = {en: 'USD', zh: '美元'}, max}: AmountFieldProps,
) => {
    const {isEnglish} = useLanguage();
    // Held as text apart from the number: bound straight to `value`, React refills
    // a cleared number input with "0" and the next keystroke lands after it ("015").
    const [text, setText] = useState(String(value));
    useEffect(() => {
        // Follow outside changes (a discard, a fresh load) without undoing a blank
        // or a trailing "12." the admin is still typing.
        setText(prev => (Number(prev) === value ? prev : String(value)));
    }, [value]);

    return (
        <label>
            <span>{isEnglish ? `${label.en} (${unit.en})` : `${label.zh}（${unit.zh}）`}</span>
            <input
                className="admin-input"
                type="number"
                inputMode="decimal"
                min={0}
                max={max}
                step={0.01}
                value={text}
                onChange={e => {
                    if (readOnly) return;
                    setText(e.target.value);
                    onChange(Number(e.target.value));
                }}
                readOnly={readOnly}
            />
            {helper && (
                <span className="admin-helper-text admin-mt-4">{isEnglish ? helper.en : helper.zh}</span>
            )}
        </label>
    );
};

interface RowActionsProps {
    onRemove: () => void;
    readOnly?: boolean;
    /**
     * Reordering, for a section that keeps an order of its own. A section put in
     * order as it saves — the schedule, by start time — passes none of these and
     * gets the delete on its own, rather than arrows the next save would overrule.
     */
    index?: number;
    count?: number;
    onMove?: (delta: number) => void;
}

const RowActions = ({index = 0, count = 0, onMove, onRemove, readOnly}: RowActionsProps) => {
    const {isEnglish} = useLanguage();
    if (readOnly) return null;

    return (
        <div className="admin-con-actions">
            {onMove && (
                <>
                    <button
                        type="button"
                        className="admin-con-icon-btn"
                        onClick={() => onMove(-1)}
                        disabled={index === 0}
                        aria-label={isEnglish ? 'Move up' : '上移'}
                    >
                        ↑
                    </button>
                    <button
                        type="button"
                        className="admin-con-icon-btn"
                        onClick={() => onMove(1)}
                        disabled={index === count - 1}
                        aria-label={isEnglish ? 'Move down' : '下移'}
                    >
                        ↓
                    </button>
                </>
            )}
            <button
                type="button"
                className="admin-con-icon-btn admin-con-icon-btn--danger"
                onClick={onRemove}
                aria-label={isEnglish ? 'Remove' : '删除'}
            >
                ×
            </button>
        </div>
    );
};

interface AddButtonProps {
    label: Localized;
    onClick: () => void;
    readOnly?: boolean;
    /** Set when the row cannot be created yet, with `blockedHint` saying why. */
    blocked?: boolean;
    blockedHint?: Localized;
}

const AddButton = ({label, onClick, readOnly, blocked, blockedHint}: AddButtonProps) => {
    const {isEnglish} = useLanguage();
    if (readOnly) return null;
    return (
        <>
            <button
                type="button"
                className="admin-btn admin-btn--link admin-con-add"
                onClick={onClick}
                disabled={blocked}
            >
                {isEnglish ? `+ Add ${label.en}` : `+ 添加${label.zh}`}
            </button>
            {blocked && blockedHint && (
                <p className="admin-con-empty">{isEnglish ? blockedHint.en : blockedHint.zh}</p>
            )}
        </>
    );
};

const EmptyRow = ({label}: {label: Localized}) => {
    const {isEnglish} = useLanguage();
    return <p className="admin-con-empty">{isEnglish ? label.en : label.zh}</p>;
};

const EventSection = ({content, loading, showToast, readOnly}: SectionProps) => {
    const {isEnglish} = useLanguage();
    const editor = useSectionEditor('event', content.event, loading, showToast);
    const {draft, setDraft} = editor;
    const {venues, loading: venuesLoading} = useVenues();

    const set = <K extends keyof typeof draft, >(key: K, value: typeof draft[K]) =>
        setDraft(prev => ({...prev, [key]: value}));

    return (
        <SectionShell
            section="event"
            helper={{
                en: 'The date, venue, and ticket link shown in the hero, the countdown, the navbar button, and the venue card.',
                zh: '在首屏、倒计时、导航栏按钮与场地卡片中展示的日期、场地与购票链接。',
            }}
            editor={editor}
            readOnly={readOnly}
        >
            <div className="admin-form-grid">
                <label>
                    <span>{isEnglish ? 'Edition (year)' : '届次（年份）'}</span>
                    <input
                        className="admin-input"
                        type="number"
                        value={draft.edition}
                        onChange={e => !readOnly && set('edition', Number(e.target.value))}
                        readOnly={readOnly}
                    />
                </label>
                <label>
                    <span>{isEnglish ? 'Ticket link' : '购票链接'}</span>
                    <input
                        className="admin-input"
                        type="url"
                        value={draft.ticketUrl}
                        onChange={e => !readOnly && set('ticketUrl', e.target.value)}
                        readOnly={readOnly}
                        placeholder="https://..."
                    />
                </label>

                <LocalizedField
                    label={{en: 'Tagline', zh: '标语'}}
                    value={draft.tagline}
                    onChange={next => set('tagline', next)}
                    readOnly={readOnly}
                />
                <LocalizedField
                    label={{en: 'Intro', zh: '简介'}}
                    value={draft.intro}
                    onChange={next => set('intro', next)}
                    readOnly={readOnly}
                    multiline
                />

                <label>
                    <span>{isEnglish ? 'Starts' : '开始时间'}</span>
                    <input
                        className="admin-input"
                        type="datetime-local"
                        value={draft.date}
                        onChange={e => !readOnly && set('date', e.target.value)}
                        readOnly={readOnly}
                    />
                </label>
                <label>
                    <span>{isEnglish ? 'Ends' : '结束时间'}</span>
                    <input
                        className="admin-input"
                        type="datetime-local"
                        value={draft.endTime}
                        onChange={e => !readOnly && set('endTime', e.target.value)}
                        readOnly={readOnly}
                    />
                </label>

                <label className="admin-form-grid-full">
                    <span>{isEnglish ? 'Venue' : '场地'}</span>
                    <select
                        className="admin-input"
                        value={draft.venueId}
                        onChange={e => !readOnly && set('venueId', e.target.value)}
                        disabled={readOnly}
                    >
                        <option value="">{isEnglish ? '— Select a venue —' : '— 选择场地 —'}</option>
                        {/* A venue deleted from Locations still has to show as the
                            current value, or the select would quietly read as blank. */}
                        {draft.venueId && !venuesLoading && !venues.some(v => v.id === draft.venueId) && (
                            <option value={draft.venueId}>
                                {isEnglish ? '(Deleted venue)' : '（已删除的场地）'}
                            </option>
                        )}
                        {venues.map(v => (
                            <option key={v.id} value={v.id}>
                                {isEnglish ? v.nameEn : (v.nameCn || v.nameEn)}
                            </option>
                        ))}
                    </select>
                    <span className="admin-helper-text admin-mt-4">
                        {isEnglish
                            ? 'Add or edit venues in the Locations tab. The map button uses the venue’s coordinates.'
                            : '可在「场地管理」标签页中添加或编辑场地。地图按钮使用场地的坐标。'}
                    </span>
                </label>
            </div>
        </SectionShell>
    );
};

const SettingsSection = ({content, loading, showToast, readOnly}: SectionProps) => {
    const {isEnglish} = useLanguage();
    const editor = useSectionEditor('settings', content.settings, loading, showToast);
    const {draft, setDraft} = editor;

    return (
        <SectionShell
            section="settings"
            helper={{
                en: 'While the page is unpublished, visitors get a short “coming soon” card and none of the content below leaves the admin panel. Core staff and the president still see the real page, with a banner along the bottom.',
                zh: '未发布时，访客将看到简短的「敬请期待」提示页，下方内容不会离开管理面板。核心成员与社长仍可查看真实页面，底部会显示提示横幅。',
            }}
            editor={editor}
            readOnly={readOnly}
        >
            <label className="admin-checkbox-label">
                <input
                    type="checkbox"
                    checked={draft.published}
                    onChange={e => !readOnly && setDraft({published: e.target.checked})}
                    disabled={readOnly}
                />
                <span>
                    {isEnglish
                        ? 'Publish the con page at /con'
                        : '在 /con 公开发布漫展页面'}
                </span>
            </label>

            <p className={`admin-helper-text admin-mt-8${draft.published ? '' : ' admin-con-warning'}`}>
                {draft.published
                    ? (isEnglish ? 'Currently visible to everyone.' : '当前对所有人可见。')
                    : (isEnglish
                        ? 'Hidden from the public, and the saved copy is staff-only until you publish — safe for an unannounced line-up.'
                        : '当前对公众隐藏，且在发布前已保存的内容仅工作人员可见——可安全用于尚未公布的阵容。')}
            </p>
        </SectionShell>
    );
};

const ACCENT_LABELS: Record<RoomAccent, Localized> = {
    pink: {en: 'Pink', zh: '粉色'},
    violet: {en: 'Violet', zh: '紫色'},
    amber: {en: 'Amber', zh: '琥珀'},
    sky: {en: 'Sky', zh: '天蓝'},
    mint: {en: 'Mint', zh: '薄荷'},
    slate: {en: 'Slate', zh: '石灰'},
};

const RoomsSection = ({content, loading, showToast, readOnly}: SectionProps) => {
    const {isEnglish} = useLanguage();
    const editor = useSectionEditor('rooms', content.rooms, loading, showToast);
    const {draft, setDraft} = editor;

    const update = (index: number, next: ConContent['rooms'][number]) =>
        setDraft(prev => replaceAt(prev, index, next));

    /** How many schedule items point at a room — deleting one is not free. */
    const usageOf = (id: string) =>
        content.schedule.filter(item => item.room === id).length;

    /**
     * Rooms the schedule still uses that this edit would take away. The server
     * refuses the same thing, but only against a schedule it has stored: a con
     * still running on the built-in schedule reads as an empty one there, so
     * removing a room it uses saves cleanly and leaves the Schedule section unable
     * to save at all. `content.schedule` is the merged value, so this check sees
     * the built-in schedule the server cannot.
     *
     * Only rooms this edit removes, never one already missing when the form loaded.
     * A strand that is nobody's fault here has to be repaired in Schedule, and
     * holding Rooms hostage to it would block a room rename that is unrelated to it
     * and that the server would have accepted.
     */
    const stranded = [...new Set(content.schedule.flatMap(item => item.room ? [item.room] : []))]
        .filter(id => !draft.some(room => room.id === id) && content.rooms.some(room => room.id === id));

    return (
        <SectionShell
            section="rooms"
            helper={{
                en: 'The rooms and stages your programming runs in. Each schedule item picks one, and its colour is the chip shown on the schedule. Renaming a room is safe — items track the room itself, not what it is called. Removing one the schedule still uses is refused; reassign those items first.',
                zh: '活动所使用的房间与舞台。每个日程条目需选择其一，颜色即日程表上显示的标签配色。重命名房间是安全的——条目关联的是房间本身，而非名称。若日程仍在使用某房间，删除将被拒绝，请先重新指派这些条目。',
            }}
            editor={editor}
            blocked={stranded.length === 0 ? undefined : {
                en: `The schedule still uses ${stranded.length === 1 ? 'a room' : 'rooms'} this would remove: `
                    + `${stranded.join(', ')}. Reassign those items in Schedule first, or put the ${
                        stranded.length === 1 ? 'room' : 'rooms'} back.`,
                zh: `日程仍在使用将被删除的房间：${stranded.join('、')}。请先在「活动日程」中重新指派这些条目，或恢复这些房间。`,
            }}
            readOnly={readOnly}
        >
            <div className="admin-con-list">
                {draft.length === 0 && <EmptyRow label={{en: 'No rooms yet.', zh: '暂无房间。'}}/>}

                {draft.map((room, index) => {
                    const used = usageOf(room.id);
                    return (
                        <div key={index} className="admin-con-card">
                            <div className="admin-con-card-head">
                                <span className="admin-con-card-title">
                                    {room.name.en || (isEnglish ? `Room ${index + 1}` : `房间 ${index + 1}`)}
                                    {used > 0 && (
                                        <span className="admin-con-dirty">
                                            {isEnglish
                                                ? `used by ${used} item${used === 1 ? '' : 's'}`
                                                : `${used} 个条目正在使用`}
                                        </span>
                                    )}
                                </span>
                                <RowActions
                                    index={index}
                                    count={draft.length}
                                    onMove={delta => setDraft(prev => moveAt(prev, index, delta))}
                                    onRemove={() => setDraft(prev => removeAt(prev, index))}
                                    readOnly={readOnly}
                                />
                            </div>

                            <div className="admin-form-grid">
                                <LocalizedField
                                    label={{en: 'Room name', zh: '房间名称'}}
                                    value={room.name}
                                    onChange={next => update(index, {...room, name: next})}
                                    readOnly={readOnly}
                                />
                                <label>
                                    <span>{isEnglish ? 'Chip colour' : '标签配色'}</span>
                                    <select
                                        className="admin-input"
                                        value={room.accent}
                                        onChange={e => !readOnly && update(index, {
                                            ...room,
                                            accent: e.target.value as RoomAccent,
                                        })}
                                        disabled={readOnly}
                                    >
                                        {ROOM_ACCENTS.map(accent => (
                                            <option key={accent} value={accent}>
                                                {isEnglish ? ACCENT_LABELS[accent].en : ACCENT_LABELS[accent].zh}
                                            </option>
                                        ))}
                                    </select>
                                </label>
                            </div>
                        </div>
                    );
                })}

                <AddButton
                    label={{en: 'room', zh: '房间'}}
                    onClick={() => setDraft(prev => [...prev, {
                        id: newRowId('room'),
                        name: BLANK,
                        accent: ROOM_ACCENTS[prev.length % ROOM_ACCENTS.length],
                    }])}
                    readOnly={readOnly}
                />
            </div>
        </SectionShell>
    );
};

const ScheduleSection = ({content, loading, showToast, readOnly}: SectionProps) => {
    const {isEnglish} = useLanguage();
    const editor = useSectionEditor('schedule', content.schedule, loading, showToast);
    const {draft, setDraft} = editor;
    const [roomFilter, setRoomFilter] = useState<string | null>(null);

    const update = (index: number, next: ConContent['schedule'][number]) =>
        setDraft(prev => replaceAt(prev, index, next));

    /**
     * Rooms the draft actually uses, listed in the order the Rooms section above
     * puts them. A room nothing is booked in gets no chip: its only possible result
     * is an empty section, which reads like the schedule was lost.
     */
    const booked = new Set(draft.flatMap(item => item.room ? [item.room] : []));
    const filterableRooms = content.rooms.filter(room => booked.has(room.id));

    // Derived, not stored: deleting the last item in a room, or reassigning it,
    // retires that chip on the same render, and the view falls back to showing
    // everything rather than to an empty list under a chip that no longer exists.
    const activeRoom = filterableRooms.some(room => room.id === roomFilter) ? roomFilter : null;
    const filtering = activeRoom !== null;

    /**
     * Items paired with their real index in the draft. Every edit and delete below
     * addresses that index — filtering changes what is on screen, never what a row
     * points at, so an edit made under a filter cannot land on the neighbour that
     * happened to take its place in the visible list.
     */
    const visible = draft
        .map((item, index) => ({item, index}))
        .filter(({item}) => !filtering || item.room === activeRoom);

    /**
     * Items pointing at a room the Rooms section no longer lists. The server refuses
     * the whole save for these, naming the room id — which says nothing about where
     * to go and look, and arrives after an admin has already edited something else.
     * The room filter above cannot reach them either: a missing room gets no chip.
     * So they are named here, by title, before Save is available.
     */
    const orphaned = draft.filter(item =>
        item.room !== undefined && !content.rooms.some(room => room.id === item.room));
    const orphanedNames = (lang: 'en' | 'zh') => {
        const titles = orphaned.map(item =>
            item.title[lang] || item.title[lang === 'en' ? 'zh' : 'en']
            || (lang === 'en' ? 'an untitled item' : '无标题条目'));
        const shown = titles.slice(0, 3).map(title => `“${title}”`).join(lang === 'en' ? ', ' : '、');
        const rest = titles.length - 3;
        if (rest <= 0) return shown;
        return lang === 'en' ? `${shown} and ${rest} more` : `${shown} 等 ${titles.length} 项`;
    };

    /** "12:00 – 13:30", or the TBA marker for an item with no time yet. */
    const timeLabel = (item: ConContent['schedule'][number]) => {
        if (item.start === undefined) return isEnglish ? 'TBA' : '待定';
        return `${item.start || '--:--'} – ${item.end || '--:--'}`;
    };

    return (
        <SectionShell
            section="schedule"
            helper={{
                en: 'Everything running on the day, in one list. Times are the local clock, and the list is put in start order when you save. Rooms come from the section above, and are asked for once an item has a time — until then it shows as TBA, in no room, and sorts to the end.',
                zh: '当天的全部安排，集中在一个列表中。时间为当地时间，保存时会按开始时间排序。房间选项来自上方的板块，并在条目确定时间后才需填写——在此之前显示为「待定」，不归属任何房间，并排在最后。',
            }}
            editor={editor}
            blocked={orphaned.length === 0 ? undefined : {
                en: `${orphanedNames('en')} ${orphaned.length === 1 ? 'is in a room' : 'are in rooms'} the Rooms `
                    + 'section no longer lists. Pick a room for each — they are marked “(missing)” below — or add '
                    + 'the room back above.',
                zh: `${orphanedNames('zh')}所在的房间已不在「场地房间」中。请为其重新选择房间（下方标记为「（不存在）」），或在上方恢复该房间。`,
            }}
            readOnly={readOnly}
        >
            {filterableRooms.length > 1 && (
                <div className="admin-con-filter" role="group"
                     aria-label={isEnglish ? 'Filter items by room' : '按房间筛选条目'}>
                    <button
                        type="button"
                        className="admin-con-filter-chip"
                        aria-pressed={activeRoom === null}
                        onClick={() => setRoomFilter(null)}
                    >
                        {isEnglish ? 'All rooms' : '全部房间'}
                    </button>

                    {filterableRooms.map(room => (
                        <button
                            key={room.id}
                            type="button"
                            className="admin-con-filter-chip"
                            aria-pressed={activeRoom === room.id}
                            onClick={() => setRoomFilter(room.id)}
                        >
                            {isEnglish ? room.name.en : room.name.zh}
                        </button>
                    ))}
                </div>
            )}

            <div className="admin-con-list">
                {draft.length === 0 && <EmptyRow label={{en: 'Nothing scheduled yet.', zh: '暂无日程。'}}/>}

                {visible.map(({item, index}) => (
                    <div key={index} className="admin-con-card">
                        <div className="admin-con-card-head">
                            <span className="admin-con-card-title">
                                {item.title.en || item.title.zh
                                    || (isEnglish ? `Item ${index + 1}` : `条目 ${index + 1}`)}
                                <span className="admin-con-dirty">{timeLabel(item)}</span>
                            </span>
                            <RowActions
                                onRemove={() => setDraft(prev => removeAt(prev, index))}
                                readOnly={readOnly}
                            />
                        </div>

                        <div className="admin-form-grid">
                            <label className="admin-checkbox-label admin-form-grid-full">
                                <input
                                    type="checkbox"
                                    checked={item.start === undefined}
                                    onChange={e => !readOnly && update(index, {
                                        ...item,
                                        start: e.target.checked ? undefined : '',
                                        end: e.target.checked ? undefined : '',
                                        // The room goes with the hour, and comes back
                                        // with it rather than as an empty picker.
                                        room: e.target.checked
                                            ? undefined
                                            : (item.room ?? activeRoom ?? content.rooms[0]?.id ?? ''),
                                    })}
                                    disabled={readOnly}
                                />
                                <span>{isEnglish ? 'Time to be announced' : '时间待定'}</span>
                            </label>

                            {item.start !== undefined && (
                                <>
                                    <label>
                                        <span>{isEnglish ? 'Start' : '开始'}</span>
                                        <input
                                            className="admin-input"
                                            type="time"
                                            value={item.start}
                                            onChange={e => !readOnly
                                                && update(index, {...item, start: e.target.value})}
                                            readOnly={readOnly}
                                        />
                                    </label>
                                    <label>
                                        <span>{isEnglish ? 'End' : '结束'}</span>
                                        <input
                                            className="admin-input"
                                            type="time"
                                            value={item.end ?? ''}
                                            onChange={e => !readOnly
                                                && update(index, {...item, end: e.target.value})}
                                            readOnly={readOnly}
                                        />
                                    </label>
                                </>
                            )}

                            {/* Only a scheduled item picks a room. A con books the hour
                                and the room together, so asking for one while the hour is
                                open invites a guess the page would then show as settled. */}
                            {item.start !== undefined && (
                                <>
                                    <label>
                                        <span>{isEnglish ? 'Room' : '房间'}</span>
                                        <select
                                            className="admin-input"
                                            value={item.room ?? ''}
                                            onChange={e => !readOnly
                                                && update(index, {...item, room: e.target.value})}
                                            disabled={readOnly}
                                        >
                                            {/* A saved item can point at a room that has since
                                                been removed; keep it selectable so the mismatch
                                                is visible rather than silently reassigned. */}
                                            {!content.rooms.some(room => room.id === item.room) && (
                                                <option value={item.room ?? ''}>
                                                    {item.room
                                                        ? (isEnglish ? `${item.room} (missing)` : `${item.room}（不存在）`)
                                                        : (isEnglish ? 'Pick a room' : '请选择房间')}
                                                </option>
                                            )}
                                            {content.rooms.map(room => (
                                                <option key={room.id} value={room.id}>
                                                    {isEnglish ? room.name.en : room.name.zh}
                                                </option>
                                            ))}
                                        </select>
                                    </label>
                                    <div/>
                                </>
                            )}

                            <LocalizedField
                                label={{en: 'Title', zh: '标题'}}
                                value={item.title}
                                onChange={next => update(index, {...item, title: next})}
                                readOnly={readOnly}
                            />
                            <LocalizedField
                                label={{en: 'Location note (optional)', zh: '地点补充（可选）'}}
                                value={item.location ?? BLANK}
                                onChange={next => update(index, {...item, location: next})}
                                readOnly={readOnly}
                            />
                            <LocalizedField
                                label={{en: 'Detail (optional)', zh: '详情（可选）'}}
                                value={item.detail ?? BLANK}
                                onChange={next => update(index, {...item, detail: next})}
                                readOnly={readOnly}
                                multiline
                            />
                        </div>
                    </div>
                ))}

                <AddButton
                    label={{en: 'item', zh: '条目'}}
                    onClick={() => setDraft(prev => [...prev, {
                        start: '',
                        end: '',
                        // Defaults to the room being filtered on, so a row added here
                        // is a row that stays on screen.
                        room: activeRoom ?? content.rooms[0]?.id ?? '',
                        title: BLANK,
                    }])}
                    // Every item must name a room server-side, so with no rooms to pick
                    // from the whole section would be rejected on Save.
                    blocked={content.rooms.length === 0}
                    blockedHint={{
                        en: 'Add and save a room above before adding schedule items.',
                        zh: '请先在上方添加并保存房间，然后再添加日程条目。',
                    }}
                    readOnly={readOnly}
                />
            </div>
        </SectionShell>
    );
};

const GuestsSection = ({content, loading, showToast, readOnly}: SectionProps) => {
    const {isEnglish} = useLanguage();
    const editor = useSectionEditor('guests', content.guests, loading, showToast);
    const {draft, setDraft} = editor;
    /**
     * The in-flight upload's local preview, held beside the draft rather than in
     * it. A `blob:` URL is not something the server will accept, so putting it in
     * the draft means a Save landing mid-upload fails the whole section.
     */
    const [preview, setPreview] = useState<{index: number; url: string} | null>(null);

    const update = (index: number, next: ConContent['guests'][number]) =>
        setDraft(prev => replaceAt(prev, index, next));

    const uploadAvatar = async (index: number, file: File, previewUrl: string) => {
        setPreview({index, url: previewUrl});
        try {
            showToast(isEnglish ? 'Uploading photo...' : '正在上传照片...', 'warning');
            // Time-stamped rather than indexed: reordering the line-up must not
            // point an existing guest's stored URL at a newly uploaded photo.
            const url = await callUploadAdminImage(file, `config/con-guest-${Date.now().toString(36)}.webp`);
            setDraft(prev => replaceAt(prev, index, {...prev[index], avatar: url}));
            showToast(isEnglish ? 'Photo uploaded.' : '照片已上传。', 'success');
        } catch (e: any) {
            // Nothing to roll back — the draft never held the preview.
            showToast(e?.message ?? (isEnglish ? 'Photo upload failed.' : '照片上传失败。'), 'error');
        } finally {
            // Safe to revoke immediately: the <img> is swapping to the stored URL in
            // the same commit, so nothing refetches the blob.
            URL.revokeObjectURL(previewUrl);
            setPreview(null);
        }
    };

    return (
        <SectionShell
            section="guests"
            helper={{
                en: 'Cards appear in this order. A guest with no photo falls back to the first letter of their name.',
                zh: '嘉宾卡片按此顺序展示。未上传照片时将显示名字首字母。',
            }}
            editor={editor}
            busy={preview !== null}
            busyLabel={{en: 'Waiting for the photo upload...', zh: '正在等待照片上传...'}}
            readOnly={readOnly}
        >
            <div className="admin-con-list">
                {draft.length === 0 && <EmptyRow label={{en: 'No guests announced yet.', zh: '暂未公布嘉宾。'}}/>}

                {draft.map((guest, index) => (
                    <div key={index} className="admin-con-card">
                        <div className="admin-con-card-head">
                            <span className="admin-con-card-title">
                                {guest.name || (isEnglish ? `Guest ${index + 1}` : `嘉宾 ${index + 1}`)}
                                {preview?.index === index && (
                                    <span className="admin-con-dirty">
                                        {isEnglish ? 'Uploading...' : '上传中...'}
                                    </span>
                                )}
                            </span>
                            <RowActions
                                index={index}
                                count={draft.length}
                                onMove={delta => setDraft(prev => moveAt(prev, index, delta))}
                                onRemove={() => setDraft(prev => removeAt(prev, index))}
                                readOnly={readOnly}
                            />
                        </div>

                        <div className="admin-form-grid">
                            <label>
                                <span>{isEnglish ? 'Name' : '名称'}</span>
                                <input
                                    className="admin-input"
                                    value={guest.name}
                                    onChange={e => !readOnly && update(index, {...guest, name: e.target.value})}
                                    readOnly={readOnly}
                                />
                            </label>
                            <label>
                                <span>{isEnglish ? 'Link (optional)' : '链接（可选）'}</span>
                                <input
                                    className="admin-input"
                                    type="url"
                                    value={guest.link ?? ''}
                                    onChange={e => !readOnly && update(index, {...guest, link: e.target.value})}
                                    readOnly={readOnly}
                                    placeholder="https://..."
                                />
                            </label>

                            <LocalizedField
                                label={{en: 'Role', zh: '身份'}}
                                value={guest.role}
                                onChange={next => update(index, {...guest, role: next})}
                                readOnly={readOnly}
                            />
                            <LocalizedField
                                label={{en: 'Blurb', zh: '介绍'}}
                                value={guest.blurb}
                                onChange={next => update(index, {...guest, blurb: next})}
                                readOnly={readOnly}
                                multiline
                            />

                            {!readOnly && (
                                <div className="admin-form-grid-full">
                                    <ImageUploadField
                                        label="Photo"
                                        labelCn="照片"
                                        preview={(preview?.index === index ? preview.url : guest.avatar) || null}
                                        onFileChange={(file, url) => uploadAvatar(index, file, url)}
                                        onCleanupPreview={url => URL.revokeObjectURL(url)}
                                        cropAspect={1}
                                        convertToWebp
                                        showToast={showToast}
                                    />
                                </div>
                            )}
                        </div>
                    </div>
                ))}

                <AddButton
                    label={{en: 'guest', zh: '嘉宾'}}
                    onClick={() => setDraft(prev => [...prev, {name: '', role: BLANK, blurb: BLANK}])}
                    readOnly={readOnly}
                />
            </div>
        </SectionShell>
    );
};

const VendorsSection = ({content, loading, showToast, readOnly}: SectionProps) => {
    const {isEnglish} = useLanguage();
    const editor = useSectionEditor('vendors', content.vendors, loading, showToast);
    const {draft, setDraft} = editor;

    const update = (index: number, next: ConContent['vendors']['list'][number]) =>
        setDraft(prev => ({...prev, list: replaceAt(prev.list, index, next)}));

    return (
        <SectionShell
            section="vendors"
            helper={{
                en: 'The table list and the “want a table?” callout underneath it.',
                zh: '摊位列表，以及下方「想要摊位？」的提示区块。',
            }}
            editor={editor}
            readOnly={readOnly}
        >
            <div className="admin-con-list">
                {draft.list.length === 0 && <EmptyRow label={{en: 'No tables listed yet.', zh: '暂无摊位。'}}/>}

                {draft.list.map((vendor, index) => (
                    <div key={index} className="admin-con-card">
                        <div className="admin-con-card-head">
                            <span className="admin-con-card-title">
                                {vendor.name || (isEnglish ? `Table ${index + 1}` : `摊位 ${index + 1}`)}
                            </span>
                            <RowActions
                                index={index}
                                count={draft.list.length}
                                onMove={delta => setDraft(prev => ({...prev, list: moveAt(prev.list, index, delta)}))}
                                onRemove={() => setDraft(prev => ({...prev, list: removeAt(prev.list, index)}))}
                                readOnly={readOnly}
                            />
                        </div>

                        <div className="admin-form-grid">
                            <label>
                                <span>{isEnglish ? 'Table / name' : '摊位名称'}</span>
                                <input
                                    className="admin-input"
                                    value={vendor.name}
                                    onChange={e => !readOnly && update(index, {...vendor, name: e.target.value})}
                                    readOnly={readOnly}
                                />
                            </label>
                            <label>
                                <span>{isEnglish ? 'Handle (optional)' : '社交账号（可选）'}</span>
                                <input
                                    className="admin-input"
                                    value={vendor.handle ?? ''}
                                    onChange={e => !readOnly && update(index, {...vendor, handle: e.target.value})}
                                    readOnly={readOnly}
                                    placeholder="@artist"
                                />
                            </label>
                            <LocalizedField
                                label={{en: 'Sells', zh: '售卖内容'}}
                                value={vendor.kind}
                                onChange={next => update(index, {...vendor, kind: next})}
                                readOnly={readOnly}
                            />
                            <label className="admin-form-grid-full">
                                <span>{isEnglish ? 'Link (optional)' : '链接（可选）'}</span>
                                <input
                                    className="admin-input"
                                    type="url"
                                    value={vendor.link ?? ''}
                                    onChange={e => !readOnly && update(index, {...vendor, link: e.target.value})}
                                    readOnly={readOnly}
                                    placeholder="https://..."
                                />
                            </label>
                        </div>
                    </div>
                ))}

                <AddButton
                    label={{en: 'table', zh: '摊位'}}
                    onClick={() => setDraft(prev => ({...prev, list: [...prev.list, {name: '', kind: BLANK}]}))}
                    readOnly={readOnly}
                />
            </div>

            <div className="admin-con-card admin-mt-12">
                <div className="admin-con-card-head">
                    <span className="admin-con-card-title">
                        {isEnglish ? 'Tabling callout' : '摊位招募区块'}
                    </span>
                </div>
                <div className="admin-form-grid">
                    <LocalizedField
                        label={{en: 'Heading', zh: '标题'}}
                        value={draft.cta.heading}
                        onChange={next => setDraft(prev => ({...prev, cta: {...prev.cta, heading: next}}))}
                        readOnly={readOnly}
                    />
                    <LocalizedField
                        label={{en: 'Body', zh: '正文'}}
                        value={draft.cta.body}
                        onChange={next => setDraft(prev => ({...prev, cta: {...prev.cta, body: next}}))}
                        readOnly={readOnly}
                        multiline
                    />
                    <LocalizedField
                        label={{en: 'Button label', zh: '按钮文字'}}
                        value={draft.cta.label}
                        onChange={next => setDraft(prev => ({...prev, cta: {...prev.cta, label: next}}))}
                        readOnly={readOnly}
                    />
                </div>
            </div>
        </SectionShell>
    );
};

interface EarlyBirdFieldsProps {
    earlyBird: EarlyBird;
    onChange: (next: EarlyBird) => void;
    readOnly?: boolean;
}

const EarlyBirdFields = ({earlyBird, onChange, readOnly}: EarlyBirdFieldsProps) => {
    const {isEnglish} = useLanguage();
    const ended = earlyBird.endsAt !== '' && new Date(earlyBird.endsAt).getTime() <= Date.now();

    return (
        <>
            <AmountField
                label={{en: 'Early bird price', zh: '早鸟价格'}}
                value={earlyBird.price}
                onChange={next => onChange({...earlyBird, price: next})}
                readOnly={readOnly}
            />
            <label>
                <span>{isEnglish ? 'Early bird ends' : '早鸟截止时间'}</span>
                <input
                    className="admin-input"
                    type="datetime-local"
                    value={earlyBird.endsAt}
                    onChange={e => !readOnly && onChange({...earlyBird, endsAt: e.target.value})}
                    readOnly={readOnly}
                />
                <span className={`admin-helper-text admin-mt-4${ended ? ' admin-con-warning' : ''}`}>
                    {ended
                        ? (isEnglish
                            ? 'This time has passed — visitors see only the regular price.'
                            : '该时间已过，访客只会看到常规价格。')
                        : (isEnglish
                            ? 'Until then the card shows the early bird price, when it ends, and the regular price after. It switches over on its own.'
                            : '截止前，卡片会显示早鸟价、截止时间以及之后的常规价格，到时自动切换。')}
                </span>
            </label>
        </>
    );
};

const TicketsSection = ({content, loading, showToast, readOnly}: SectionProps) => {
    const {isEnglish} = useLanguage();
    const editor = useSectionEditor('tickets', content.tickets, loading, showToast);
    const {draft, setDraft} = editor;

    const update = (index: number, next: ConContent['tickets'][number]) =>
        setDraft(prev => replaceAt(prev, index, next));

    return (
        <SectionShell
            section="tickets"
            helper={{
                en: 'Tiers appear left to right in this order. “Most popular” highlights one card — the page shows the flag on every tier you mark, so mark one.',
                zh: '票种按此顺序从左至右展示。「最受欢迎」会高亮显示对应卡片，建议只标记一个。',
            }}
            editor={editor}
            readOnly={readOnly}
        >
            <div className="admin-con-list">
                {draft.length === 0 && <EmptyRow label={{en: 'No ticket tiers yet.', zh: '暂无票种。'}}/>}

                {draft.map((tier, index) => (
                    <div key={index} className="admin-con-card">
                        <div className="admin-con-card-head">
                            <span className="admin-con-card-title">
                                {tier.name.en || (isEnglish ? `Tier ${index + 1}` : `票种 ${index + 1}`)}
                            </span>
                            <RowActions
                                index={index}
                                count={draft.length}
                                onMove={delta => setDraft(prev => moveAt(prev, index, delta))}
                                onRemove={() => setDraft(prev => removeAt(prev, index))}
                                readOnly={readOnly}
                            />
                        </div>

                        <div className="admin-form-grid">
                            <LocalizedField
                                label={{en: 'Tier name', zh: '票种名称'}}
                                value={tier.name}
                                onChange={next => update(index, {...tier, name: next})}
                                readOnly={readOnly}
                            />
                            <AmountField
                                label={tier.earlyBird
                                    ? {en: 'Regular price', zh: '常规价格'}
                                    : {en: 'Price', zh: '价格'}}
                                value={tier.price}
                                onChange={next => update(index, {...tier, price: next})}
                                readOnly={readOnly}
                                helper={{en: '0 shows as “Free”.', zh: '填 0 时显示为「免费」。'}}
                            />

                            <label className="admin-checkbox-label admin-form-grid-full">
                                <input
                                    type="checkbox"
                                    checked={!!tier.earlyBird}
                                    onChange={e => !readOnly && update(index, {
                                        ...tier,
                                        earlyBird: e.target.checked ? {price: 0, endsAt: ''} : undefined,
                                    })}
                                    disabled={readOnly}
                                />
                                <span>{isEnglish ? 'Offer an early bird price' : '提供早鸟价'}</span>
                            </label>

                            {tier.earlyBird && (
                                <EarlyBirdFields
                                    earlyBird={tier.earlyBird}
                                    onChange={next => update(index, {...tier, earlyBird: next})}
                                    readOnly={readOnly}
                                />
                            )}

                            <LocalizedField
                                label={{en: 'Note', zh: '说明'}}
                                value={tier.note}
                                onChange={next => update(index, {...tier, note: next})}
                                readOnly={readOnly}
                            />

                            <label className="admin-checkbox-label admin-form-grid-full">
                                <input
                                    type="checkbox"
                                    checked={tier.featured === true}
                                    onChange={e => !readOnly && update(index, {...tier, featured: e.target.checked})}
                                    disabled={readOnly}
                                />
                                <span>{isEnglish ? 'Mark as most popular' : '标记为最受欢迎'}</span>
                            </label>
                        </div>

                        <div className="admin-con-list">
                            <span className="admin-con-card-title">{isEnglish ? 'Perks' : '权益'}</span>
                            {tier.perks.map((perk, perkIndex) => (
                                <div key={perkIndex} className="admin-con-item">
                                    <div className="admin-con-card-head">
                                        <span className="admin-con-card-title">
                                            {isEnglish ? `Perk ${perkIndex + 1}` : `权益 ${perkIndex + 1}`}
                                        </span>
                                        <RowActions
                                            index={perkIndex}
                                            count={tier.perks.length}
                                            onMove={delta => update(index, {
                                                ...tier,
                                                perks: moveAt(tier.perks, perkIndex, delta),
                                            })}
                                            onRemove={() => update(index, {
                                                ...tier,
                                                perks: removeAt(tier.perks, perkIndex),
                                            })}
                                            readOnly={readOnly}
                                        />
                                    </div>
                                    <div className="admin-form-grid">
                                        <LocalizedField
                                            label={{en: 'Perk', zh: '权益'}}
                                            value={perk}
                                            onChange={next => update(index, {
                                                ...tier,
                                                perks: replaceAt(tier.perks, perkIndex, next),
                                            })}
                                            readOnly={readOnly}
                                        />
                                    </div>
                                </div>
                            ))}
                            <AddButton
                                label={{en: 'perk', zh: '权益'}}
                                onClick={() => update(index, {...tier, perks: [...tier.perks, BLANK]})}
                                readOnly={readOnly}
                            />
                        </div>
                    </div>
                ))}

                <AddButton
                    label={{en: 'tier', zh: '票种'}}
                    onClick={() => setDraft(prev => [...prev, {
                        id: newRowId('tier'),
                        name: BLANK,
                        price: 0,
                        note: BLANK,
                        perks: [],
                    }])}
                    readOnly={readOnly}
                />
            </div>
        </SectionShell>
    );
};

const TicketFeeSection = ({content, loading, showToast, readOnly}: SectionProps) => {
    const {isEnglish} = useLanguage();
    const editor = useSectionEditor('ticketFee', content.ticketFee, loading, showToast);
    const {draft, setDraft} = editor;
    const lang = isEnglish ? 'en' : 'zh';

    /** "$10 + $0.59 fee = $10.59" for one price under the fee being edited. */
    const previewAt = (price: number) => {
        const fee = ticketFeeFor(price, draft);
        return isEnglish
            ? `${formatPrice(price, lang)} + ${formatPrice(fee, lang)} fee = ${formatPrice(price + fee, lang)}`
            : `${formatPrice(price, lang)} + 手续费 ${formatPrice(fee, lang)} = ${formatPrice(price + fee, lang)}`;
    };

    // Against the saved tiers, since those are the prices visitors actually see.
    const previews = content.tickets.flatMap(tier => {
        const name = isEnglish ? tier.name.en : tier.name.zh;
        const rows: string[] = [];
        if (tier.earlyBird && tier.earlyBird.price > 0) {
            rows.push(`${name} (${isEnglish ? 'early bird' : '早鸟'}): ${previewAt(tier.earlyBird.price)}`);
        }
        if (tier.price > 0) rows.push(`${name}: ${previewAt(tier.price)}`);
        return rows;
    });
    const charging = draft.percent > 0 || draft.flat > 0;

    return (
        <SectionShell
            section="ticketFee"
            helper={{
                en: 'What buying online adds to each paid ticket, shown on its card as “+ $0.59 transaction fee online”. Free tickets never show one. Leave both at 0 for no fee line.',
                zh: '线上购票时每张付费门票额外收取的费用，将在票种卡片上显示为「线上购票另收 $0.59 手续费」。免费门票不显示手续费。两项均为 0 时不显示。',
            }}
            editor={editor}
            readOnly={readOnly}
        >
            <div className="admin-form-grid">
                <AmountField
                    label={{en: 'Percent of the price', zh: '按票价百分比'}}
                    unit={{en: '%', zh: '%'}}
                    max={100}
                    value={draft.percent}
                    onChange={next => setDraft(prev => ({...prev, percent: next}))}
                    readOnly={readOnly}
                />
                <AmountField
                    label={{en: 'Flat amount per ticket', zh: '每张固定金额'}}
                    value={draft.flat}
                    onChange={next => setDraft(prev => ({...prev, flat: next}))}
                    readOnly={readOnly}
                    helper={{en: 'Charged on top of the percent.', zh: '在百分比之外另加收取。'}}
                />
            </div>

            {charging && previews.length > 0 && (
                <div className="admin-mt-12">
                    <p className="admin-helper-text">
                        {isEnglish ? 'With the saved ticket prices:' : '按已保存的票价计算：'}
                    </p>
                    {previews.map((row, i) => (
                        <p key={i} className="admin-helper-text">{row}</p>
                    ))}
                </div>
            )}
        </SectionShell>
    );
};

const InPersonSalesSection = ({content, loading, showToast, readOnly}: SectionProps) => {
    const {isEnglish} = useLanguage();
    const editor = useSectionEditor('inPersonSales', content.inPersonSales, loading, showToast);
    const {draft, setDraft} = editor;

    const updateSession = (index: number, next: InPersonSession) =>
        setDraft(prev => ({...prev, sessions: replaceAt(prev.sessions, index, next)}));

    return (
        <SectionShell
            section="inPersonSales"
            helper={{
                en: 'Days you sell tickets at a table in person. While any of them is still to come, a block under the ticket cards lists them — and, if the online fee above is set, tells visitors that buying there skips it. Each day drops off the page once it ends. Days are put in date order when you save.',
                zh: '现场摆摊售票的日期。只要还有未到的日期，门票卡片下方就会显示一个区块列出这些日期；若上方设置了线上手续费，还会提示访客在现场购票可免手续费。每个日期结束后会自动从页面上移除。保存时会按日期排序。',
            }}
            editor={editor}
            readOnly={readOnly}
        >
            <div className="admin-form-grid">
                <LocalizedField
                    label={{en: 'Location', zh: '地点'}}
                    value={draft.location}
                    onChange={next => setDraft(prev => ({...prev, location: next}))}
                    readOnly={readOnly}
                />
                <LocalizedField
                    label={{en: 'Note (optional)', zh: '补充说明（可选）'}}
                    value={draft.note}
                    onChange={next => setDraft(prev => ({...prev, note: next}))}
                    readOnly={readOnly}
                    multiline
                />
            </div>

            <div className="admin-con-list admin-mt-12">
                {draft.sessions.length === 0 && (
                    <EmptyRow label={{
                        en: 'No sale days yet, so the page shows nothing for in-person sales.',
                        zh: '暂无售票日期，页面不会显示线下售票区块。',
                    }}/>
                )}

                {draft.sessions.map((session, index) => {
                    const closes = new Date(sessionBounds(session).closes).getTime();
                    const ended = Number.isFinite(closes) && closes <= Date.now();

                    return (
                        <div key={index} className="admin-con-card">
                            <div className="admin-con-card-head">
                                <span className="admin-con-card-title">
                                    {session.date
                                        ? formatSessionDay(session.date, isEnglish ? 'en' : 'zh')
                                        : (isEnglish ? `Day ${index + 1}` : `第 ${index + 1} 天`)}
                                </span>
                                {!readOnly && (
                                    <div className="admin-con-actions">
                                        <button
                                            type="button"
                                            className="admin-con-icon-btn admin-con-icon-btn--danger"
                                            onClick={() => setDraft(prev => ({
                                                ...prev,
                                                sessions: removeAt(prev.sessions, index),
                                            }))}
                                            aria-label={isEnglish ? 'Remove' : '删除'}
                                        >
                                            ×
                                        </button>
                                    </div>
                                )}
                            </div>

                            <div className="admin-form-grid">
                                <label className="admin-form-grid-full">
                                    <span>{isEnglish ? 'Date' : '日期'}</span>
                                    <input
                                        className="admin-input"
                                        type="date"
                                        value={session.date}
                                        onChange={e => !readOnly && updateSession(index, {
                                            ...session,
                                            date: e.target.value
                                        })}
                                        readOnly={readOnly}
                                    />
                                    {ended && (
                                        <span className="admin-helper-text admin-mt-4 admin-con-warning">
                                            {isEnglish
                                                ? 'This day is over — it no longer shows on the page.'
                                                : '该日期已结束，页面上不再显示。'}
                                        </span>
                                    )}
                                </label>
                                <label>
                                    <span>{isEnglish ? 'Opens' : '开始'}</span>
                                    <input
                                        className="admin-input"
                                        type="time"
                                        value={session.start}
                                        onChange={e => !readOnly && updateSession(index, {
                                            ...session,
                                            start: e.target.value
                                        })}
                                        readOnly={readOnly}
                                    />
                                </label>
                                <label>
                                    <span>{isEnglish ? 'Closes' : '结束'}</span>
                                    <input
                                        className="admin-input"
                                        type="time"
                                        value={session.end}
                                        onChange={e => !readOnly && updateSession(index, {
                                            ...session,
                                            end: e.target.value
                                        })}
                                        readOnly={readOnly}
                                    />
                                </label>
                            </div>
                        </div>
                    );
                })}

                <AddButton
                    label={{en: 'sale day', zh: '售票日期'}}
                    onClick={() => setDraft(prev => {
                        // The table usually keeps the same hours day to day, so a new
                        // day starts from the last one's and only needs its date.
                        const last = prev.sessions[prev.sessions.length - 1];
                        return {
                            ...prev,
                            sessions: [...prev.sessions, {date: '', start: last?.start ?? '', end: last?.end ?? ''}],
                        };
                    })}
                    readOnly={readOnly}
                />
            </div>
        </SectionShell>
    );
};

const FaqSection = ({content, loading, showToast, readOnly}: SectionProps) => {
    const {isEnglish} = useLanguage();
    const editor = useSectionEditor('faq', content.faq, loading, showToast);
    const {draft, setDraft} = editor;

    const update = (index: number, next: ConContent['faq'][number]) =>
        setDraft(prev => replaceAt(prev, index, next));

    return (
        <SectionShell
            section="faq"
            helper={{
                en: 'Questions appear in this order, collapsed until a visitor opens them.',
                zh: '问题按此顺序展示，默认折叠，访客点击后展开。',
            }}
            editor={editor}
            readOnly={readOnly}
        >
            <div className="admin-con-list">
                {draft.length === 0 && <EmptyRow label={{en: 'No questions yet.', zh: '暂无问题。'}}/>}

                {draft.map((entry, index) => (
                    <div key={index} className="admin-con-card">
                        <div className="admin-con-card-head">
                            <span className="admin-con-card-title">
                                {entry.q.en || (isEnglish ? `Question ${index + 1}` : `问题 ${index + 1}`)}
                            </span>
                            <RowActions
                                index={index}
                                count={draft.length}
                                onMove={delta => setDraft(prev => moveAt(prev, index, delta))}
                                onRemove={() => setDraft(prev => removeAt(prev, index))}
                                readOnly={readOnly}
                            />
                        </div>
                        <div className="admin-form-grid">
                            <LocalizedField
                                label={{en: 'Question', zh: '问题'}}
                                value={entry.q}
                                onChange={next => update(index, {...entry, q: next})}
                                readOnly={readOnly}
                            />
                            <LocalizedField
                                label={{en: 'Answer', zh: '回答'}}
                                value={entry.a}
                                onChange={next => update(index, {...entry, a: next})}
                                readOnly={readOnly}
                                multiline
                            />
                        </div>
                    </div>
                ))}

                <AddButton
                    label={{en: 'question', zh: '问题'}}
                    onClick={() => setDraft(prev => [...prev, {q: BLANK, a: BLANK}])}
                    readOnly={readOnly}
                />
            </div>
        </SectionShell>
    );
};

interface SectionProps {
    content: ConContent;
    loading: boolean;
    showToast: ShowToast;
    readOnly?: boolean;
}

export const ConContentTab = ({showToast, readOnly = false}: ConContentTabProps) => {
    const {isEnglish} = useLanguage();
    const {content, loading, failed} = useConDraft();

    if (loading) {
        return (
            <div className="admin-section">
                <div className="policy-spinner-wrap">
                    <div className="spinner"/>
                </div>
            </div>
        );
    }

    // Editing here would mean saving the shipped defaults over whatever is
    // actually stored, so the form stays closed until a read succeeds.
    if (failed) {
        return (
            <div className="admin-section">
                <h3 className="admin-badges-title">
                    {isEnglish ? 'Could not load con content' : '无法加载漫展内容'}
                </h3>
                <p className="admin-helper-text">
                    {isEnglish
                        ? 'The saved content could not be read, so the editor is showing the site’s built-in copy. Reload the page before editing — saving now would replace what is stored.'
                        : '无法读取已保存的内容，编辑器当前显示的是网站内置文案。请重新加载页面后再编辑——此时保存会覆盖已存储的内容。'}
                </p>
            </div>
        );
    }

    const sectionProps: SectionProps = {content, loading, showToast, readOnly};

    return (
        <>
            <div className="admin-section">
                <p className="admin-helper-text">
                    {isEnglish
                        ? 'Edits here go live on /con as soon as they are saved. Each section saves on its own, so you can leave the rest untouched. Anything never saved keeps showing the copy shipped with the site.'
                        : '此处的修改保存后立即在 /con 页面生效。每个板块单独保存，不会影响其他板块。从未保存过的板块将继续显示网站内置的文案。'}
                </p>
            </div>

            <SettingsSection {...sectionProps}/>
            <div className="admin-divider"/>
            <EventSection {...sectionProps}/>
            <div className="admin-divider"/>
            <RoomsSection {...sectionProps}/>
            <div className="admin-divider"/>
            <ScheduleSection {...sectionProps}/>
            <div className="admin-divider"/>
            <GuestsSection {...sectionProps}/>
            <div className="admin-divider"/>
            <VendorsSection {...sectionProps}/>
            <div className="admin-divider"/>
            <TicketsSection {...sectionProps}/>
            <div className="admin-divider"/>
            <TicketFeeSection {...sectionProps}/>
            <div className="admin-divider"/>
            <InPersonSalesSection {...sectionProps}/>
            <div className="admin-divider"/>
            <FaqSection {...sectionProps}/>

            <SectionNav
                sections={SECTION_ORDER.map(section => ({
                    id: conSectionId(section),
                    label: isEnglish ? SECTION_LABELS[section].en : SECTION_LABELS[section].zh,
                }))}
            />
        </>
    );
};
