import { useEffect, useRef, useState } from 'react';
import { useLanguage } from '~/components/LanguageContextProvider';
import { callDeletePassportDesign, callSavePassportDesign, callUploadAdminImage } from '~/lib/firebase';
import {
    DEFAULT_PASSPORT_TERM_DAYS,
    MAX_PASSPORT_TERM_DAYS,
    type PassportDesign,
    passportName,
} from '~/lib/passports';
import { BilingualFormField } from '../BilingualFormField';
import { CardEditDeleteActions } from '../CrudShell';
import { ImageUploadField } from '../ImageUploadField';
import type { ShowToast } from '../utils';

const TERM_PRESETS = [30, 90, 180, 365, 730];

/** Mirrors shownNames in functions/src/functions/passports.ts, which enforces it. */
const shownNames = (design: {name: string; nameCn: string}): string[] => {
    const name = design.name.trim();
    return [name.toLowerCase(), (design.nameCn.trim() || name).toLowerCase()];
};

interface PassportDesignsSectionProps {
    designs: PassportDesign[];
    loading: boolean;
    onBack: () => void;
    onChanged: () => Promise<void>;
    showToast: ShowToast;
    readOnly: boolean;
}

/**
 * The designs passports are generated from: a name, the year it belongs to, the
 * cover art the shelf and the public passport page render, and the membership
 * term its passports grant. A year can have several designs, so they're listed
 * under their year and a name may not repeat within one. The year is fixed once
 * the design exists, and a design can't be deleted once passports have been
 * generated from it.
 */
export const PassportDesignsSection = ({
                                           designs,
                                           loading,
                                           onBack,
                                           onChanged,
                                           showToast,
                                           readOnly,
                                       }: PassportDesignsSectionProps) => {
    const {isEnglish} = useLanguage();
    // One editor at a time: 'new', or the id of the design being edited.
    const [editing, setEditing] = useState<string | null>(null);
    const [deletingId, setDeletingId] = useState<string | null>(null);

    const saved = async () => {
        await onChanged();
        setEditing(null);
    };

    const remove = async (design: PassportDesign) => {
        const name = passportName(design, isEnglish);
        if (!window.confirm(isEnglish
            ? `Delete the ${design.year} design “${name}”? This is only possible while no passports have been generated from it.`
            : `删除 ${design.year} 年的设计「${name}」？仅在尚未用它生成通行证时可删除。`)) return;
        setDeletingId(design.id);
        try {
            await callDeletePassportDesign({designId: design.id});
            await onChanged();
            showToast(isEnglish ? 'Design deleted.' : '设计已删除。', 'warning');
        } catch (e: any) {
            showToast(e?.message ?? (isEnglish ? 'Failed to delete design.' : '删除设计失败。'), 'error');
        } finally {
            setDeletingId(null);
        }
    };

    // Already newest year first, so each year's designs are one contiguous run.
    const years: {year: number; list: PassportDesign[]}[] = [];
    for (const design of designs) {
        const last = years[years.length - 1];
        if (last?.year === design.year) last.list.push(design);
        else years.push({year: design.year, list: [design]});
    }

    return (
        <div className="admin-section">
            <div className="admin-tools-header">
                <button className="admin-btn admin-btn--link" onClick={onBack} type="button">
                    {isEnglish ? '← Back to Passports' : '← 返回通行证'}
                </button>
                <h3 className="admin-tools-title">{isEnglish ? 'Passport Designs' : '通行证设计'}</h3>
            </div>

            {!readOnly && (editing === 'new' ? (
                <DesignEditor
                    initial={null}
                    designs={designs}
                    onSaved={saved}
                    onCancel={() => setEditing(null)}
                    showToast={showToast}
                />
            ) : (
                <button className="admin-btn admin-btn--dashed admin-section-mb" onClick={() => setEditing('new')}>
                    {isEnglish ? '+ New Design' : '+ 新建设计'}
                </button>
            ))}

            {loading && designs.length === 0 ? (
                <div className="spinner spinner-centered"/>
            ) : designs.length === 0 ? (
                <p className="admin-no-results">{isEnglish ? 'No designs yet.' : '暂无设计。'}</p>
            ) : (
                <div className="admin-passport-design-years">
                    {years.map(({year, list}) => (
                        <section key={year}>
                            <h4 className="admin-passport-design-year">
                                {year}
                                <span className="admin-passport-design-year-count">
                                    {isEnglish
                                        ? `${list.length} design${list.length === 1 ? '' : 's'}`
                                        : `${list.length} 款设计`}
                                </span>
                            </h4>
                            <div className="admin-passport-designs">
                                {list.map(design => editing === design.id ? (
                                    <DesignEditor
                                        key={design.id}
                                        initial={design}
                                        designs={designs}
                                        onSaved={saved}
                                        onCancel={() => setEditing(null)}
                                        showToast={showToast}
                                    />
                                ) : (
                                    <DesignCard
                                        key={design.id}
                                        design={design}
                                        readOnly={readOnly}
                                        deleting={deletingId === design.id}
                                        onEdit={() => setEditing(design.id)}
                                        onDelete={() => void remove(design)}
                                    />
                                ))}
                            </div>
                        </section>
                    ))}
                </div>
            )}
        </div>
    );
};

const DesignCard = ({design, readOnly, deleting, onEdit, onDelete}: {
    design: PassportDesign;
    readOnly: boolean;
    deleting: boolean;
    onEdit: () => void;
    onDelete: () => void;
}) => {
    const {isEnglish} = useLanguage();
    return (
        <div className="admin-passport-design-card">
            <div className="admin-passport-design-card-cover">
                {design.coverImageUrl
                    ? <img src={design.coverImageUrl} alt={passportName(design, isEnglish)}/>
                    : design.year}
            </div>
            <div className="admin-passport-design-card-body">
                <span className="admin-passport-design-card-name">{design.name}</span>
                {design.nameCn && <span className="admin-passport-design-card-name-cn">{design.nameCn}</span>}
                <span className="admin-passport-design-term">
                    {isEnglish ? `${design.termDays} days of membership` : `${design.termDays} 天会员资格`}
                </span>
                {!readOnly && <CardEditDeleteActions onEdit={onEdit} onDelete={onDelete} deleting={deleting}/>}
            </div>
        </div>
    );
};

interface DesignEditorProps {
    /** The design being edited, or null to create one. */
    initial: PassportDesign | null;
    /** Every design, for the per-year name check. */
    designs: PassportDesign[];
    /** Called once the save has landed; the parent refreshes and closes the editor. */
    onSaved: () => Promise<void>;
    onCancel: () => void;
    showToast: ShowToast;
}

/**
 * Create or edit one design. The cover sits beside the fields at the 3:4 it is
 * shown at everywhere, so what is saved is what the shelf and the passport page
 * will show.
 */
const DesignEditor = ({initial, designs, onSaved, onCancel, showToast}: DesignEditorProps) => {
    const {isEnglish} = useLanguage();
    const isNew = !initial;
    const [year, setYear] = useState(initial?.year ?? new Date().getFullYear());
    const [name, setName] = useState(initial?.name ?? '');
    const [nameCn, setNameCn] = useState(initial?.nameCn ?? '');
    // Kept as typed, so the field can be cleared and retyped without snapping back.
    const [termInput, setTermInput] = useState(String(initial?.termDays ?? DEFAULT_PASSPORT_TERM_DAYS));
    const [coverFile, setCoverFile] = useState<File | null>(null);
    const [coverPreview, setCoverPreview] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);

    // ImageUploadField revokes a preview it replaces; the last one picked is this
    // editor's to revoke when it closes, saved or not.
    const previewUrl = useRef<string | null>(null);
    useEffect(() => () => {
        if (previewUrl.current) URL.revokeObjectURL(previewUrl.current);
    }, []);

    const termDays = Number(termInput);
    const termValid = Number.isInteger(termDays) && termDays >= 1 && termDays <= MAX_PASSPORT_TERM_DAYS;
    const hasCover = !!coverFile || !!initial?.coverImageUrl;
    // Caught here so the form can say why Save is disabled; the server refuses it
    // too, since two designs of a year under one name couldn't be told apart.
    const draftNames = shownNames({name, nameCn});
    const nameTaken = !!name.trim() && designs.some(d =>
        d.id !== initial?.id && d.year === year && shownNames(d).some(n => draftNames.includes(n)));
    const canSave = hasCover && !!name.trim() && !nameTaken && termValid;

    const save = async () => {
        if (!canSave) return;
        setSaving(true);
        try {
            let coverImageUrl = initial?.coverImageUrl ?? '';
            if (coverFile) {
                coverImageUrl = await callUploadAdminImage(
                    coverFile,
                    `passports/design-${year}-${Date.now().toString(36)}.webp`,
                );
            }
            await callSavePassportDesign({
                ...(initial ? {designId: initial.id} : {year}),
                name: name.trim(),
                nameCn: nameCn.trim(),
                coverImageUrl,
                termDays,
            });
            showToast(isEnglish ? 'Design saved.' : '设计已保存。', 'success');
        } catch (e: any) {
            showToast(e?.message ?? (isEnglish ? 'Failed to save design.' : '保存设计失败。'), 'error');
            setSaving(false);
            return;
        }
        await onSaved();
    };

    return (
        <div className="admin-passport-design-editor">
            <h4 className="admin-badges-title">
                {!initial
                    ? (isEnglish ? 'New Passport Design' : '新建通行证设计')
                    : (isEnglish ? `Edit “${passportName(initial, true)}”` : `编辑「${passportName(initial, false)}」`)}
            </h4>

            <div className="admin-passport-design-editor-body">
                <ImageUploadField
                    variant="cover"
                    preview={coverPreview ?? (initial?.coverImageUrl || null)}
                    onFileChange={(file, url) => {
                        setCoverFile(file);
                        setCoverPreview(url);
                        previewUrl.current = url;
                    }}
                    onCleanupPreview={url => URL.revokeObjectURL(url)}
                    convertToWebp
                    showToast={showToast}
                />

                <div className="admin-form-grid">
                    <BilingualFormField
                        label="Name" labelCn="名称"
                        value={name} valueCn={nameCn}
                        onChange={setName} onChangeCn={setNameCn}
                        placeholder="e.g. 2026 Summer Passport"
                        placeholderCn={isEnglish ? 'Optional — the English name stands in' : '选填，留空则显示英文名称'}
                    />
                    {nameTaken && (
                        <p className="admin-passport-design-hint admin-passport-design-hint--warn admin-form-grid-full">
                            {isEnglish
                                ? `${year} already has a design with this name.`
                                : `${year} 年已有同名设计。`}
                        </p>
                    )}

                    <label>
                        <span>{isEnglish ? 'Year' : '年份'}</span>
                        <input
                            type="number"
                            className="admin-input"
                            min={2000}
                            max={2100}
                            value={year}
                            disabled={!isNew}
                            onChange={e => setYear(Number(e.target.value) || year)}
                        />
                        <small className="admin-passport-design-hint">
                            {isNew
                                ? (isEnglish ? 'Can’t be changed once the design is created.' : '设计创建后无法更改。')
                                : (isEnglish ? 'Fixed once a design is created.' : '设计创建后年份固定。')}
                        </small>
                    </label>

                    {/* A div, not the label: the preset chips are buttons of their own. */}
                    <div className="admin-passport-term-field">
                        <label>
                            <span>{isEnglish ? 'Membership term' : '会员期限'}</span>
                            <span className="admin-passport-term">
                                <input
                                    type="number"
                                    className="admin-input"
                                    min={1}
                                    max={MAX_PASSPORT_TERM_DAYS}
                                    step={1}
                                    value={termInput}
                                    onChange={e => setTermInput(e.target.value)}
                                />
                                <span className="admin-passport-term-unit">{isEnglish ? 'days' : '天'}</span>
                            </span>
                        </label>
                        {!termValid && (
                            <small className="admin-passport-design-hint admin-passport-design-hint--warn">
                                {isEnglish
                                    ? `Enter a whole number of days from 1 to ${MAX_PASSPORT_TERM_DAYS}.`
                                    : `请输入 1 到 ${MAX_PASSPORT_TERM_DAYS} 之间的整数天数。`}
                            </small>
                        )}
                        <div className="admin-group-actions admin-passport-term-presets">
                            {TERM_PRESETS.map(days => (
                                <button
                                    key={days}
                                    type="button"
                                    className={`admin-btn admin-btn--chip${termDays === days ? ' admin-btn--chip-active' : ''}`}
                                    onClick={() => setTermInput(String(days))}
                                >
                                    {isEnglish ? `${days} days` : `${days} 天`}
                                </button>
                            ))}
                        </div>
                        <p className="admin-passport-design-hint">
                            {isEnglish
                                ? 'Granted when a passport is activated, on top of any membership the holder already has.'
                                : '通行证激活时授予，并在持有者现有会员期限上累加。'}
                            {initial && (isEnglish
                                ? ` Changes only reach batches generated after you save — passports already generated keep the term they were made with.`
                                : ` 修改仅对保存后生成的批次生效 — 已生成的通行证保留生成时的期限。`)}
                        </p>
                    </div>
                </div>
            </div>

            <div className="admin-btn-row admin-mt-12">
                <button
                    className="admin-toggle-btn admin-toggle-save"
                    onClick={() => void save()}
                    disabled={saving || !canSave}
                    type="button"
                >
                    {saving
                        ? (isEnglish ? 'Saving...' : '保存中...')
                        : isNew
                            ? (isEnglish ? 'Create Design' : '创建设计')
                            : (isEnglish ? 'Save Changes' : '保存修改')}
                </button>
                <button className="admin-toggle-btn admin-toggle-cancel" onClick={onCancel} disabled={saving}
                        type="button">
                    {isEnglish ? 'Cancel' : '取消'}
                </button>
            </div>
        </div>
    );
};
