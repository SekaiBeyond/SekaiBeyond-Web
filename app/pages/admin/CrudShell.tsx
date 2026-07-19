import type { ReactNode } from 'react';
import { useLanguage } from '~/components/LanguageContextProvider';

/**
 * Shared chrome for the admin card-list CRUD tabs (tags, rates, lots, venues):
 * the "+ New X" button that flips into a create form, and the per-card action
 * rows. Each tab keeps its own state, handlers, and form fields — these
 * components only own the repeated markup and busy-label handling.
 */

interface CreateSectionProps {
    show: boolean;
    setShow: (show: boolean) => void;
    /** "+ New X" dashed-button label. */
    newLabel: string;
    /** Create-form heading, e.g. "Create New Tag". */
    title: string;
    ctaLabel: string;
    ctaBusyLabel: string;
    busy: boolean;
    /** Disables the submit button beyond `busy` (e.g. a required field is empty). */
    ctaDisabled?: boolean;
    onCreate: () => void;
    /** Runs when Cancel hides the form (e.g. to reset the draft). */
    onCancel?: () => void;
    children: ReactNode;
}

export function CreateSection({
                                  show,
                                  setShow,
                                  newLabel,
                                  title,
                                  ctaLabel,
                                  ctaBusyLabel,
                                  busy,
                                  ctaDisabled = false,
                                  onCreate,
                                  onCancel,
                                  children,
                              }: CreateSectionProps) {
    const {isEnglish} = useLanguage();

    if (!show) {
        return (
            <button className="admin-btn admin-btn--dashed admin-section-mb" onClick={() => setShow(true)}>
                {newLabel}
            </button>
        );
    }
    return (
        <div className="admin-create-badge-form">
            <h4 className="admin-badges-title">{title}</h4>
            {children}
            <div className="admin-btn-row admin-mt-12">
                <button
                    className="admin-toggle-btn admin-toggle-save"
                    onClick={onCreate}
                    disabled={busy || ctaDisabled}
                >
                    {busy ? ctaBusyLabel : ctaLabel}
                </button>
                <button
                    className="admin-toggle-btn admin-toggle-cancel"
                    onClick={() => {
                        setShow(false);
                        onCancel?.();
                    }}
                    disabled={busy}
                >
                    {isEnglish ? 'Cancel' : '取消'}
                </button>
            </div>
        </div>
    );
}

/** Save/Cancel pair for a card's inline edit form. */
export function CardSaveCancel({saving, saveDisabled = false, onSave, onCancel, topMargin = false}: {
    saving: boolean;
    saveDisabled?: boolean;
    onSave: () => void;
    onCancel: () => void;
    topMargin?: boolean;
}) {
    const {isEnglish} = useLanguage();
    return (
        <div className={`admin-tag-actions${topMargin ? ' admin-mt-12' : ''}`}>
            <button
                className="admin-toggle-btn admin-toggle-save admin-btn-sm"
                onClick={onSave}
                disabled={saving || saveDisabled}
            >
                {saving
                    ? (isEnglish ? 'Saving...' : '保存中...')
                    : (isEnglish ? 'Save' : '保存')}
            </button>
            <button className="admin-toggle-btn admin-toggle-cancel admin-btn-sm" onClick={onCancel} disabled={saving}>
                {isEnglish ? 'Cancel' : '取消'}
            </button>
        </div>
    );
}

/** Edit/Delete pair for a card in display mode. */
export function CardEditDeleteActions({onEdit, onDelete, deleting}: {
    onEdit: () => void;
    onDelete: () => void;
    deleting: boolean;
}) {
    const {isEnglish} = useLanguage();
    return (
        <div className="admin-tag-actions">
            <button className="admin-toggle-btn admin-toggle-edit admin-btn-sm" onClick={onEdit}>
                {isEnglish ? 'Edit' : '编辑'}
            </button>
            <button
                className="admin-toggle-btn admin-toggle-revoke admin-btn-sm"
                onClick={onDelete}
                disabled={deleting}
            >
                {deleting
                    ? (isEnglish ? 'Deleting...' : '删除中...')
                    : (isEnglish ? 'Delete' : '删除')}
            </button>
        </div>
    );
}
