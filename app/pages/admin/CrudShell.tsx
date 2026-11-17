import type { ReactNode } from 'react';
import { useLanguage } from '~/components/LanguageContextProvider';

interface CreateSectionProps {
    show: boolean;
    setShow: (show: boolean) => void;
    newLabel: string;
    title: string;
    ctaLabel: string;
    ctaBusyLabel: string;
    busy: boolean;
    ctaDisabled?: boolean;
    onCreate: () => void;
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

export function ListCard({image, title, subtitle, tags = [], onClick}: {
    image: string;
    title: string;
    subtitle: string;
    tags?: (string | false)[];
    onClick: () => void;
}) {
    const {isEnglish} = useLanguage();
    return (
        <button className="admin-event-card" onClick={onClick}>
            {image ? (
                <img src={image} alt="" className="admin-event-card-img"/>
            ) : (
                <div className="admin-event-card-img admin-no-poster">
                    {isEnglish ? 'No poster' : '无海报'}
                </div>
            )}
            <div className="admin-event-card-info">
                <span className="admin-event-card-title">{title}</span>
                <span className="admin-event-card-date">{subtitle}</span>
                {tags.map(tag => tag && <span key={tag} className="admin-ended-tag">{tag}</span>)}
            </div>
        </button>
    );
}

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
