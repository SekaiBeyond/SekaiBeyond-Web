import { type Dispatch, type ReactNode, type SetStateAction, useEffect, useState } from 'react';
import { useLanguage } from '~/components/LanguageContextProvider';
import { callSaveConContent } from '~/lib/firebase';
import {
    type ConContent,
    type ConContentSection,
    HIDEABLE_SECTIONS,
    type HideableSection,
    refreshConContent,
} from '~/lib/conContent';
import type { Localized } from '~/pages/con/i18n';
import type { ShowToast } from './utils';

export const SECTION_LABELS: Record<ConContentSection, Localized> = {
    settings: {en: 'Page Visibility', zh: '页面可见性'},
    event: {en: 'Event Details', zh: '活动信息'},
    heroVideo: {en: 'Hero Video', zh: '首屏视频'},
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
export const SECTION_ORDER: ConContentSection[] = [
    'settings', 'event', 'heroVideo', 'rooms', 'schedule', 'guests', 'vendors', 'tickets', 'ticketFee',
    'inPersonSales', 'faq',
];

export const conSectionId = (section: ConContentSection) => `admin-sec-con-${section}`;

export const BLANK: Localized = {en: '', zh: ''};

/**
 * An id for a newly added row. Deliberately not derived from the list length:
 * deleting `room-2` from three rooms and adding one would mint `room-3` on top of
 * the `room-3` that is still there. Lowercase hex keeps it inside the slug shape
 * the server enforces for room ids.
 */
export const newRowId = (prefix: string) => `${prefix}-${crypto.randomUUID().slice(0, 8)}`;

export const replaceAt = <T, >(items: T[], index: number, next: T): T[] =>
    items.map((item, i) => (i === index ? next : item));

export const removeAt = <T, >(items: T[], index: number): T[] => items.filter((_, i) => i !== index);

export const moveAt = <T, >(items: T[], index: number, delta: number): T[] => {
    const target = index + delta;
    if (target < 0 || target >= items.length) return items;
    const next = [...items];
    [next[index], next[target]] = [next[target], next[index]];
    return next;
};

/** Kept in HIDEABLE_SECTIONS order, so ticking a box off and on again reads as no change. */
export const setHidden = (hidden: HideableSection[], section: HideableSection, hide: boolean): HideableSection[] =>
    HIDEABLE_SECTIONS.filter(s => (s === section ? hide : hidden.includes(s)));

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
export function useSectionEditor<K extends ConContentSection>(
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
    readOnly?: boolean;
    children: ReactNode;
}

export const SectionShell = <K extends ConContentSection, >(
    {section, helper, editor, busy, busyLabel, readOnly, children}: SectionShellProps<K>,
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

            {!readOnly && (
                <div className="admin-btn-row admin-mt-12">
                    <button
                        className="admin-toggle-btn admin-toggle-save"
                        onClick={editor.save}
                        disabled={editor.saving || busy || !editor.dirty}
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
export const LocalizedField = ({label, value, onChange, readOnly, multiline, full}: LocalizedFieldProps) => {
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
export const AmountField = (
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
    /** Holds the row in place while something is due to land in the list by position. */
    disabled?: boolean;
    /**
     * Reordering, for a section that keeps an order of its own. A section put in
     * order as it saves — the schedule, by start time — passes none of these and
     * gets the delete on its own, rather than arrows the next save would overrule.
     */
    index?: number;
    count?: number;
    onMove?: (delta: number) => void;
}

export const RowActions = ({index = 0, count = 0, onMove, onRemove, readOnly, disabled}: RowActionsProps) => {
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
                        disabled={disabled || index === 0}
                        aria-label={isEnglish ? 'Move up' : '上移'}
                    >
                        ↑
                    </button>
                    <button
                        type="button"
                        className="admin-con-icon-btn"
                        onClick={() => onMove(1)}
                        disabled={disabled || index === count - 1}
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
                disabled={disabled}
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

export const AddButton = ({label, onClick, readOnly, blocked, blockedHint}: AddButtonProps) => {
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

export const EmptyRow = ({label}: {label: Localized}) => {
    const {isEnglish} = useLanguage();
    return <p className="admin-con-empty">{isEnglish ? label.en : label.zh}</p>;
};

/**
 * Flags a section whose saved settings keep it off /con, so nobody edits it
 * wondering why the page has not changed.
 */
export const HiddenSectionNote = ({content, section}: {content: ConContent; section: HideableSection}) => {
    const {isEnglish} = useLanguage();
    if (!content.settings.hiddenSections.includes(section)) return null;

    return (
        <p className="admin-helper-text admin-con-warning">
            {isEnglish
                ? 'Hidden from /con. Show it again under Page Visibility.'
                : '已在 /con 隐藏。可在「页面可见性」中重新显示。'}
        </p>
    );
};

export interface SectionProps {
    content: ConContent;
    loading: boolean;
    showToast: ShowToast;
    readOnly?: boolean;
}
