import { type Dispatch, type ReactNode, type SetStateAction, useEffect, useState } from 'react';
import { useLanguage } from '~/components/LanguageContextProvider';
import { callSaveConContent, callUploadAdminImage } from '~/lib/firebase';
import { type ConContent, type ConContentSection, refreshConContent, useConContent, } from '~/lib/conContent';
import { ROOM_ACCENTS, type RoomAccent } from '~/pages/con/content';
import type { Localized } from '~/pages/con/i18n';
import type { ShowToast } from './utils';
import { ImageUploadField } from './ImageUploadField';

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
    faq: {en: 'FAQ', zh: '常见问题'},
};

const BLANK: Localized = {en: '', zh: ''};

/* -------------------------------------------------------------------------- */
/* List helpers                                                               */
/* -------------------------------------------------------------------------- */

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

/* -------------------------------------------------------------------------- */
/* Section plumbing                                                           */
/* -------------------------------------------------------------------------- */

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
        } catch {
            // Keep the draft; it is what was just stored.
        }
        showToast(isEnglish ? `${label.en} saved.` : `${label.zh}已保存。`, 'success');
        setSaving(false);
    };

    return {draft, setDraft, saving, dirty, save, revert: () => setDraft(value)};
}

interface SectionShellProps<K extends ConContentSection> {
    section: K;
    helper: Localized;
    editor: SectionEditor<ConContent[K]>;
    readOnly?: boolean;
    children: ReactNode;
}

const SectionShell = <K extends ConContentSection, >(
    {section, helper, editor, readOnly, children}: SectionShellProps<K>,
) => {
    const {isEnglish} = useLanguage();
    const label = SECTION_LABELS[section];

    return (
        <div className="admin-section">
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

            {!readOnly && (
                <div className="admin-btn-row admin-mt-12">
                    <button
                        className="admin-toggle-btn admin-toggle-save"
                        onClick={editor.save}
                        disabled={editor.saving || !editor.dirty}
                    >
                        {editor.saving
                            ? (isEnglish ? 'Saving...' : '保存中...')
                            : (isEnglish ? 'Save' : '保存')}
                    </button>
                    <button
                        className="admin-toggle-btn admin-toggle-cancel"
                        onClick={editor.revert}
                        disabled={editor.saving || !editor.dirty}
                    >
                        {isEnglish ? 'Discard Changes' : '放弃更改'}
                    </button>
                </div>
            )}
        </div>
    );
};

/* -------------------------------------------------------------------------- */
/* Shared field pieces                                                        */
/* -------------------------------------------------------------------------- */

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

interface RowActionsProps {
    index: number;
    count: number;
    onMove: (delta: number) => void;
    onRemove: () => void;
    readOnly?: boolean;
}

const RowActions = ({index, count, onMove, onRemove, readOnly}: RowActionsProps) => {
    const {isEnglish} = useLanguage();
    if (readOnly) return null;

    return (
        <div className="admin-con-actions">
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

const AddButton = ({label, onClick, readOnly}: {label: Localized; onClick: () => void; readOnly?: boolean}) => {
    const {isEnglish} = useLanguage();
    if (readOnly) return null;
    return (
        <button type="button" className="admin-btn admin-btn--link admin-con-add" onClick={onClick}>
            {isEnglish ? `+ Add ${label.en}` : `+ 添加${label.zh}`}
        </button>
    );
};

const EmptyRow = ({label}: {label: Localized}) => {
    const {isEnglish} = useLanguage();
    return <p className="admin-con-empty">{isEnglish ? label.en : label.zh}</p>;
};

/* -------------------------------------------------------------------------- */
/* Event details                                                              */
/* -------------------------------------------------------------------------- */

const EventSection = ({content, loading, showToast, readOnly}: SectionProps) => {
    const {isEnglish} = useLanguage();
    const editor = useSectionEditor('event', content.event, loading, showToast);
    const {draft, setDraft} = editor;

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
                    label={{en: 'Con name', zh: '漫展名称'}}
                    value={draft.name}
                    onChange={next => set('name', next)}
                    readOnly={readOnly}
                />
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

                <LocalizedField
                    label={{en: 'Doors line', zh: '开场提示'}}
                    value={draft.doorsOpen}
                    onChange={next => set('doorsOpen', next)}
                    readOnly={readOnly}
                />
                <LocalizedField
                    label={{en: 'Venue name', zh: '场地名称'}}
                    value={draft.venue.name}
                    onChange={next => set('venue', {...draft.venue, name: next})}
                    readOnly={readOnly}
                />
                <LocalizedField
                    label={{en: 'Room', zh: '房间'}}
                    value={draft.venue.room}
                    onChange={next => set('venue', {...draft.venue, room: next})}
                    readOnly={readOnly}
                />

                <label>
                    <span>{isEnglish ? 'Street address' : '街道地址'}</span>
                    <input
                        className="admin-input"
                        value={draft.venue.address}
                        onChange={e => !readOnly && set('venue', {...draft.venue, address: e.target.value})}
                        readOnly={readOnly}
                    />
                </label>
                <label>
                    <span>{isEnglish ? 'Map link' : '地图链接'}</span>
                    <input
                        className="admin-input"
                        type="url"
                        value={draft.venue.mapUrl}
                        onChange={e => !readOnly && set('venue', {...draft.venue, mapUrl: e.target.value})}
                        readOnly={readOnly}
                        placeholder="https://maps.google.com/..."
                    />
                </label>
            </div>
        </SectionShell>
    );
};

/* -------------------------------------------------------------------------- */
/* Page visibility                                                            */
/* -------------------------------------------------------------------------- */

const SettingsSection = ({content, loading, showToast, readOnly}: SectionProps) => {
    const {isEnglish} = useLanguage();
    const editor = useSectionEditor('settings', content.settings, loading, showToast);
    const {draft, setDraft} = editor;

    return (
        <SectionShell
            section="settings"
            helper={{
                en: 'While the page is unpublished, visitors get a short “coming soon” card instead. Core staff and the president still see the real page, with a banner across the top.',
                zh: '未发布时，访客将看到简短的「敬请期待」提示页。核心成员与社长仍可查看真实页面，顶部会显示提示横幅。',
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
                        ? 'Currently hidden from the public.'
                        : '当前对公众隐藏。')}
            </p>
        </SectionShell>
    );
};

/* -------------------------------------------------------------------------- */
/* Rooms                                                                      */
/* -------------------------------------------------------------------------- */

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

    /** How many saved schedule items point at a room — deleting one is not free. */
    const usageOf = (id: string) =>
        content.schedule.reduce(
            (total, block) => total + block.items.filter(item => item.room === id).length,
            0,
        );

    return (
        <SectionShell
            section="rooms"
            helper={{
                en: 'The rooms and stages your programming runs in. Each schedule item picks one, and its colour is the chip shown on the timeline. Removing a room that the schedule still uses is refused — reassign those items first.',
                zh: '活动所使用的房间与舞台。每个日程条目需选择其一，颜色即时间轴上显示的标签配色。若日程仍在使用某房间，删除将被拒绝——请先重新指派这些条目。',
            }}
            editor={editor}
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
                                    <span>{isEnglish ? 'Id' : '标识 (id)'}</span>
                                    <input
                                        className="admin-input"
                                        value={room.id}
                                        onChange={e => !readOnly && update(index, {...room, id: e.target.value})}
                                        readOnly={readOnly}
                                        placeholder="main-stage"
                                    />
                                    <span className="admin-helper-text admin-mt-4">
                                        {isEnglish
                                            ? 'Lowercase, numbers, hyphens. Schedule items refer to this — renaming it breaks them.'
                                            : '仅限小写字母、数字与连字符。日程条目通过它引用房间，重命名会导致引用失效。'}
                                    </span>
                                </label>
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
                        id: `room-${prev.length + 1}`,
                        name: BLANK,
                        accent: ROOM_ACCENTS[prev.length % ROOM_ACCENTS.length],
                    }])}
                    readOnly={readOnly}
                />
            </div>
        </SectionShell>
    );
};

/* -------------------------------------------------------------------------- */
/* Schedule                                                                   */
/* -------------------------------------------------------------------------- */

const ScheduleSection = ({content, loading, showToast, readOnly}: SectionProps) => {
    const {isEnglish} = useLanguage();
    const editor = useSectionEditor('schedule', content.schedule, loading, showToast);
    const {draft, setDraft} = editor;

    const updateBlock = (index: number, next: ConContent['schedule'][number]) =>
        setDraft(prev => replaceAt(prev, index, next));

    return (
        <SectionShell
            section="schedule"
            helper={{
                en: 'Blocks run down the page in this order, and each block’s items run in the order below. Times are the local clock; an item with no time yet shows as TBA. Rooms come from the section above.',
                zh: '时段按此顺序在页面中排列，每个时段内的条目也按下方顺序展示。时间为当地时间；尚未确定时间的条目显示为「待定」。房间选项来自上方的板块。',
            }}
            editor={editor}
            readOnly={readOnly}
        >
            <div className="admin-con-list">
                {draft.length === 0 && <EmptyRow label={{en: 'No schedule blocks yet.', zh: '暂无时段。'}}/>}

                {draft.map((block, blockIndex) => (
                    <div key={blockIndex} className="admin-con-card">
                        <div className="admin-con-card-head">
                            <span className="admin-con-card-title">
                                {isEnglish ? `Block ${blockIndex + 1}` : `时段 ${blockIndex + 1}`}
                            </span>
                            <RowActions
                                index={blockIndex}
                                count={draft.length}
                                onMove={delta => setDraft(prev => moveAt(prev, blockIndex, delta))}
                                onRemove={() => setDraft(prev => removeAt(prev, blockIndex))}
                                readOnly={readOnly}
                            />
                        </div>

                        <div className="admin-form-grid">
                            <LocalizedField
                                label={{en: 'Block label', zh: '时段名称'}}
                                value={block.label}
                                onChange={next => updateBlock(blockIndex, {...block, label: next})}
                                readOnly={readOnly}
                            />
                        </div>

                        <div className="admin-con-list">
                            {block.items.map((item, itemIndex) => (
                                <div key={itemIndex} className="admin-con-item">
                                    <div className="admin-con-card-head">
                                        <span className="admin-con-card-title">
                                            {isEnglish ? `Item ${itemIndex + 1}` : `条目 ${itemIndex + 1}`}
                                        </span>
                                        <RowActions
                                            index={itemIndex}
                                            count={block.items.length}
                                            onMove={delta => updateBlock(blockIndex, {
                                                ...block,
                                                items: moveAt(block.items, itemIndex, delta),
                                            })}
                                            onRemove={() => updateBlock(blockIndex, {
                                                ...block,
                                                items: removeAt(block.items, itemIndex),
                                            })}
                                            readOnly={readOnly}
                                        />
                                    </div>

                                    <div className="admin-form-grid">
                                        <label className="admin-checkbox-label admin-form-grid-full">
                                            <input
                                                type="checkbox"
                                                checked={item.start === undefined}
                                                onChange={e => !readOnly && updateBlock(blockIndex, {
                                                    ...block,
                                                    items: replaceAt(block.items, itemIndex, {
                                                        ...item,
                                                        start: e.target.checked ? undefined : '',
                                                        end: e.target.checked ? undefined : '',
                                                    }),
                                                })}
                                                disabled={readOnly}
                                            />
                                            <span>
                                                {isEnglish
                                                    ? 'Time to be announced'
                                                    : '时间待定'}
                                            </span>
                                        </label>

                                        {item.start !== undefined && (
                                            <>
                                                <label>
                                                    <span>{isEnglish ? 'Start' : '开始'}</span>
                                                    <input
                                                        className="admin-input"
                                                        type="time"
                                                        value={item.start}
                                                        onChange={e => !readOnly && updateBlock(blockIndex, {
                                                            ...block,
                                                            items: replaceAt(block.items, itemIndex, {
                                                                ...item,
                                                                start: e.target.value,
                                                            }),
                                                        })}
                                                        readOnly={readOnly}
                                                    />
                                                </label>
                                                <label>
                                                    <span>{isEnglish ? 'End' : '结束'}</span>
                                                    <input
                                                        className="admin-input"
                                                        type="time"
                                                        value={item.end ?? ''}
                                                        onChange={e => !readOnly && updateBlock(blockIndex, {
                                                            ...block,
                                                            items: replaceAt(block.items, itemIndex, {
                                                                ...item,
                                                                end: e.target.value,
                                                            }),
                                                        })}
                                                        readOnly={readOnly}
                                                    />
                                                </label>
                                            </>
                                        )}

                                        <label
                                            className={item.start === undefined ? 'admin-form-grid-full' : undefined}>
                                            <span>{isEnglish ? 'Room' : '房间'}</span>
                                            <select
                                                className="admin-input"
                                                value={item.room}
                                                onChange={e => !readOnly && updateBlock(blockIndex, {
                                                    ...block,
                                                    items: replaceAt(block.items, itemIndex, {
                                                        ...item,
                                                        room: e.target.value,
                                                    }),
                                                })}
                                                disabled={readOnly}
                                            >
                                                {/* A saved item can point at a room that has since been
                                                    renamed; keep it selectable so the mismatch is visible
                                                    rather than silently reassigned by the dropdown. */}
                                                {!content.rooms.some(room => room.id === item.room) && (
                                                    <option value={item.room}>
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
                                        {item.start !== undefined && <div/>}

                                        <LocalizedField
                                            label={{en: 'Title', zh: '标题'}}
                                            value={item.title}
                                            onChange={next => updateBlock(blockIndex, {
                                                ...block,
                                                items: replaceAt(block.items, itemIndex, {...item, title: next}),
                                            })}
                                            readOnly={readOnly}
                                        />
                                        <LocalizedField
                                            label={{en: 'Location note (optional)', zh: '地点补充（可选）'}}
                                            value={item.location ?? BLANK}
                                            onChange={next => updateBlock(blockIndex, {
                                                ...block,
                                                items: replaceAt(block.items, itemIndex, {...item, location: next}),
                                            })}
                                            readOnly={readOnly}
                                        />
                                        <LocalizedField
                                            label={{en: 'Detail (optional)', zh: '详情（可选）'}}
                                            value={item.detail ?? BLANK}
                                            onChange={next => updateBlock(blockIndex, {
                                                ...block,
                                                items: replaceAt(block.items, itemIndex, {...item, detail: next}),
                                            })}
                                            readOnly={readOnly}
                                            multiline
                                        />
                                    </div>
                                </div>
                            ))}

                            <AddButton
                                label={{en: 'item', zh: '条目'}}
                                onClick={() => updateBlock(blockIndex, {
                                    ...block,
                                    items: [...block.items, {
                                        start: '',
                                        end: '',
                                        room: content.rooms[0]?.id ?? '',
                                        title: BLANK,
                                    }],
                                })}
                                readOnly={readOnly}
                            />
                        </div>
                    </div>
                ))}

                <AddButton
                    label={{en: 'block', zh: '时段'}}
                    onClick={() => setDraft(prev => [...prev, {id: '', label: BLANK, items: []}])}
                    readOnly={readOnly}
                />
            </div>
        </SectionShell>
    );
};

/* -------------------------------------------------------------------------- */
/* Guests                                                                     */
/* -------------------------------------------------------------------------- */

const GuestsSection = ({content, loading, showToast, readOnly}: SectionProps) => {
    const {isEnglish} = useLanguage();
    const editor = useSectionEditor('guests', content.guests, loading, showToast);
    const {draft, setDraft} = editor;
    const [uploading, setUploading] = useState<number | null>(null);

    const update = (index: number, next: ConContent['guests'][number]) =>
        setDraft(prev => replaceAt(prev, index, next));

    const uploadAvatar = async (index: number, guest: ConContent['guests'][number], file: File, previewUrl: string) => {
        setUploading(index);
        update(index, {...guest, avatar: previewUrl});
        try {
            showToast(isEnglish ? 'Uploading photo...' : '正在上传照片...', 'warning');
            // Time-stamped rather than indexed: reordering the line-up must not
            // point an existing guest's stored URL at a newly uploaded photo.
            const url = await callUploadAdminImage(file, `config/con-guest-${Date.now().toString(36)}.webp`);
            setDraft(prev => replaceAt(prev, index, {...prev[index], avatar: url}));
            showToast(isEnglish ? 'Photo uploaded.' : '照片已上传。', 'success');
        } catch (e: any) {
            setDraft(prev => replaceAt(prev, index, {...prev[index], avatar: guest.avatar}));
            showToast(e?.message ?? (isEnglish ? 'Photo upload failed.' : '照片上传失败。'), 'error');
        } finally {
            setUploading(null);
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
            readOnly={readOnly}
        >
            <div className="admin-con-list">
                {draft.length === 0 && <EmptyRow label={{en: 'No guests announced yet.', zh: '暂未公布嘉宾。'}}/>}

                {draft.map((guest, index) => (
                    <div key={index} className="admin-con-card">
                        <div className="admin-con-card-head">
                            <span className="admin-con-card-title">
                                {guest.name || (isEnglish ? `Guest ${index + 1}` : `嘉宾 ${index + 1}`)}
                                {uploading === index && (
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
                                        preview={guest.avatar || null}
                                        onFileChange={(file, url) => uploadAvatar(index, guest, file, url)}
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

/* -------------------------------------------------------------------------- */
/* Artist alley                                                               */
/* -------------------------------------------------------------------------- */

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

/* -------------------------------------------------------------------------- */
/* Tickets                                                                    */
/* -------------------------------------------------------------------------- */

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
                            <LocalizedField
                                label={{en: 'Price', zh: '价格'}}
                                value={tier.price}
                                onChange={next => update(index, {...tier, price: next})}
                                readOnly={readOnly}
                            />
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
                        id: '',
                        name: BLANK,
                        price: BLANK,
                        note: BLANK,
                        perks: [],
                    }])}
                    readOnly={readOnly}
                />
            </div>
        </SectionShell>
    );
};

/* -------------------------------------------------------------------------- */
/* FAQ                                                                        */
/* -------------------------------------------------------------------------- */

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

/* -------------------------------------------------------------------------- */
/* Tab                                                                        */
/* -------------------------------------------------------------------------- */

interface SectionProps {
    content: ConContent;
    loading: boolean;
    showToast: ShowToast;
    readOnly?: boolean;
}

export const ConContentTab = ({showToast, readOnly = false}: ConContentTabProps) => {
    const {isEnglish} = useLanguage();
    const {content, loading, failed} = useConContent();

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
            <FaqSection {...sectionProps}/>
        </>
    );
};
