import { useState } from 'react';
import { useLanguage } from '~/components/LanguageContextProvider';
import { callDeletePassportDesign, callSavePassportDesign, callUploadAdminImage } from '~/lib/firebase';
import { type PassportDesign, passportName } from '~/lib/passports';
import { CardEditDeleteActions, CardSaveCancel, CreateSection } from '../CrudShell';
import { ImageUploadField } from '../ImageUploadField';
import type { ShowToast } from '../utils';

const emptyDraft = (year: number): PassportDesign => ({
    year,
    coverImageUrl: '',
});

interface PassportDesignsSectionProps {
    designs: PassportDesign[];
    loading: boolean;
    onBack: () => void;
    onChanged: () => Promise<void>;
    showToast: ShowToast;
    readOnly: boolean;
}

/**
 * One design per year: the cover art the shelf and the public passport page
 * render, which is all a design is — a passport goes by its year, so there is
 * nothing to name or describe. A year's design has to exist before its passports
 * can be generated, and can't be deleted once any have been.
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
    const [showCreate, setShowCreate] = useState(false);
    const [draft, setDraft] = useState<PassportDesign>(() => emptyDraft(new Date().getFullYear()));
    const [coverFile, setCoverFile] = useState<File | null>(null);
    const [coverPreview, setCoverPreview] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);
    const [editingYear, setEditingYear] = useState<number | null>(null);
    const [deletingYear, setDeletingYear] = useState<number | null>(null);

    // ImageUploadField only revokes when a *replacement* file is picked, so
    // whoever drops the preview owns the object URL — as every other tab's reset
    // does. Picking an image and cancelling would otherwise leak it, and its
    // decoded bitmap, for the life of the document.
    const clearCover = () => {
        if (coverPreview?.startsWith('blob:')) URL.revokeObjectURL(coverPreview);
        setCoverFile(null);
        setCoverPreview(null);
    };

    const resetDraft = () => {
        setDraft(emptyDraft(new Date().getFullYear()));
        clearCover();
    };

    // The art is the design, so there is nothing to save without it.
    const hasCover = !!coverFile || !!draft.coverImageUrl;
    // A design is keyed on its year and saved with a merge, so creating one for a
    // year that already has a design would silently replace the cover art every
    // printed passport of that year points at.
    const yearTaken = designs.some(d => d.year === draft.year);

    const save = async (isNew: boolean) => {
        if (!hasCover || (isNew && yearTaken)) return;
        setSaving(true);
        try {
            let coverImageUrl = draft.coverImageUrl;
            if (coverFile) {
                coverImageUrl = await callUploadAdminImage(
                    coverFile,
                    `passports/design-${draft.year}-${Date.now().toString(36)}.webp`,
                );
            }
            await callSavePassportDesign({year: draft.year, coverImageUrl});
            await onChanged();
            if (isNew) {
                setShowCreate(false);
            } else {
                setEditingYear(null);
            }
            resetDraft();
            showToast(isEnglish ? 'Design saved.' : '设计已保存。', 'success');
        } catch (e: any) {
            showToast(e?.message ?? (isEnglish ? 'Failed to save design.' : '保存设计失败。'), 'error');
        } finally {
            setSaving(false);
        }
    };

    const remove = async (design: PassportDesign) => {
        if (!window.confirm(isEnglish
            ? `Delete the ${design.year} design? This is only possible while no passports exist for that year.`
            : `删除 ${design.year} 年的设计？仅在该年度尚无通行证时可删除。`)) return;
        setDeletingYear(design.year);
        try {
            await callDeletePassportDesign({year: design.year});
            await onChanged();
            showToast(isEnglish ? 'Design deleted.' : '设计已删除。', 'warning');
        } catch (e: any) {
            showToast(e?.message ?? (isEnglish ? 'Failed to delete design.' : '删除设计失败。'), 'error');
        } finally {
            setDeletingYear(null);
        }
    };

    const fields = (isNew: boolean) => (
        <div className="admin-form-grid">
            {isNew && (
                <label>
                    <span>{isEnglish ? 'Year' : '年份'}</span>
                    <input
                        type="number"
                        className="admin-input"
                        min={2000}
                        max={2100}
                        value={draft.year}
                        onChange={e => setDraft(d => ({...d, year: Number(e.target.value) || d.year}))}
                    />
                    {yearTaken && (
                        <span className="admin-helper-text admin-field-hint">
                            {isEnglish
                                ? `${draft.year} already has a design. Edit it below to change its art.`
                                : `${draft.year} 年已有设计。如需更换封面，请在下方编辑。`}
                        </span>
                    )}
                </label>
            )}
            <div className="admin-form-grid-full">
                <ImageUploadField
                    label="Cover art"
                    labelCn="封面图"
                    preview={coverPreview ?? (draft.coverImageUrl || null)}
                    onFileChange={(file, previewUrl) => {
                        setCoverFile(file);
                        setCoverPreview(previewUrl);
                    }}
                    onCleanupPreview={url => URL.revokeObjectURL(url)}
                    convertToWebp
                    showToast={showToast}
                />
            </div>
        </div>
    );

    return (
        <div className="admin-section">
            <div className="admin-tools-header">
                <button className="admin-btn admin-btn--link" onClick={onBack} type="button">
                    {isEnglish ? '← Back to Passports' : '← 返回通行证'}
                </button>
                <h3 className="admin-tools-title">{isEnglish ? 'Passport Designs' : '通行证设计'}</h3>
            </div>

            {!readOnly && (
                <CreateSection
                    show={showCreate}
                    setShow={show => {
                        setShowCreate(show);
                        if (show) {
                            setEditingYear(null);
                            resetDraft();
                        }
                    }}
                    newLabel={isEnglish ? '+ New Design' : '+ 新建设计'}
                    title={isEnglish ? 'Create Passport Design' : '创建通行证设计'}
                    ctaLabel={isEnglish ? 'Create Design' : '创建设计'}
                    ctaBusyLabel={isEnglish ? 'Saving...' : '保存中...'}
                    busy={saving}
                    ctaDisabled={!hasCover || yearTaken}
                    onCreate={() => void save(true)}
                    onCancel={resetDraft}
                >
                    {fields(true)}
                </CreateSection>
            )}

            {loading && designs.length === 0 ? (
                <div className="spinner spinner-centered"/>
            ) : designs.length === 0 ? (
                <p className="admin-no-results">{isEnglish ? 'No designs yet.' : '暂无设计。'}</p>
            ) : (
                <div className="admin-event-grid">
                    {designs.map(design => (
                        <div key={design.year} className="admin-event-card">
                            <div className="admin-event-card-info">
                                {editingYear === design.year ? (
                                    <>
                                        {fields(false)}
                                        <CardSaveCancel
                                            saving={saving}
                                            saveDisabled={!hasCover}
                                            onSave={() => void save(false)}
                                            onCancel={() => {
                                                setEditingYear(null);
                                                resetDraft();
                                            }}
                                            topMargin
                                        />
                                    </>
                                ) : (
                                    <>
                                        {design.coverImageUrl && (
                                            <img
                                                src={design.coverImageUrl}
                                                alt={passportName(design.year, isEnglish)}
                                                className="admin-passport-design-cover"
                                            />
                                        )}
                                        <span className="admin-event-card-title">{design.year}</span>
                                        {!readOnly && (
                                            <CardEditDeleteActions
                                                onEdit={() => {
                                                    setShowCreate(false);
                                                    clearCover();
                                                    setDraft({...design});
                                                    setEditingYear(design.year);
                                                }}
                                                onDelete={() => void remove(design)}
                                                deleting={deletingYear === design.year}
                                            />
                                        )}
                                    </>
                                )}
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};
