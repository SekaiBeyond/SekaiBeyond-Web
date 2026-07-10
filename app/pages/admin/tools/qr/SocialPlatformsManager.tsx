import { useState } from 'react';
import { useLanguage } from '~/components/LanguageContextProvider';
import { callDeleteSocialPlatform, callSaveSocialPlatform, callSeedSocialPlatforms } from '~/lib/firebase';
import { type SocialPlatform, useSocialPlatforms } from '~/lib/socialPlatforms';

interface PlatformDraft {
    label: string;
    labelCn: string;
    order: number;
}

function platformToDraft(p: SocialPlatform): PlatformDraft {
    return {label: p.label, labelCn: p.labelCn ?? '', order: p.order};
}

function emptyDraft(order: number): PlatformDraft {
    return {label: '', labelCn: '', order};
}

interface SocialPlatformsManagerProps {
    onBack: () => void;
    showToast: (message: string, type: 'success' | 'warning' | 'error') => void;
    readOnly?: boolean;
}

/**
 * Admin manager for the editable platform list behind per-platform QR tracking.
 * Platforms are traffic-source tags: picking some while creating a tracked code
 * makes one code per platform for the same URL, so scan counts compare
 * click-through by platform. Until the defaults are seeded the list is
 * read-only (built-in defaults stand in); "Customize defaults" seeds all of
 * them so they can be edited, removed, or extended — seeding all at once avoids
 * a single new platform replacing the defaults in the picker.
 */
export const SocialPlatformsManager = ({onBack, showToast, readOnly = false}: SocialPlatformsManagerProps) => {
    const {isEnglish} = useLanguage();
    const {platforms, customized, refresh} = useSocialPlatforms();

    const [showCreate, setShowCreate] = useState(false);
    const [createDraft, setCreateDraft] = useState<PlatformDraft>(emptyDraft(0));
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editDraft, setEditDraft] = useState<PlatformDraft>(emptyDraft(0));
    const [saving, setSaving] = useState(false);
    const [seeding, setSeeding] = useState(false);
    const [deletingId, setDeletingId] = useState<string | null>(null);

    const editable = customized && !readOnly;

    const payloadFrom = (draft: PlatformDraft, id?: string) => ({
        ...(id ? {id} : {}),
        label: draft.label.trim(),
        labelCn: draft.labelCn.trim(),
        order: draft.order,
    });

    const seedDefaults = async () => {
        setSeeding(true);
        try {
            await callSeedSocialPlatforms();
            await refresh();
            showToast(isEnglish ? 'Defaults loaded — you can now edit them.' : '已加载默认平台，现在可以编辑。', 'success');
        } catch (e: any) {
            showToast(e?.message ?? (isEnglish ? 'Failed to load defaults.' : '加载默认平台失败。'), 'error');
        } finally {
            setSeeding(false);
        }
    };

    const createPlatform = async () => {
        if (!createDraft.label.trim()) {
            showToast(isEnglish ? 'A name is required.' : '请填写名称。', 'error');
            return;
        }
        setSaving(true);
        try {
            await callSaveSocialPlatform(payloadFrom({...createDraft, order: platforms.length}));
            await refresh();
            setCreateDraft(emptyDraft(0));
            setShowCreate(false);
            showToast(isEnglish ? 'Platform added.' : '平台已添加。', 'success');
        } catch (e: any) {
            showToast(e?.message ?? (isEnglish ? 'Failed to add platform.' : '添加平台失败。'), 'error');
        } finally {
            setSaving(false);
        }
    };

    const openEdit = (p: SocialPlatform) => {
        setEditingId(p.id);
        setEditDraft(platformToDraft(p));
    };

    const saveEdit = async () => {
        if (!editingId) return;
        if (!editDraft.label.trim()) {
            showToast(isEnglish ? 'A name is required.' : '请填写名称。', 'error');
            return;
        }
        setSaving(true);
        try {
            await callSaveSocialPlatform(payloadFrom(editDraft, editingId));
            await refresh();
            setEditingId(null);
            showToast(isEnglish ? 'Platform updated.' : '平台已更新。', 'success');
        } catch (e: any) {
            showToast(e?.message ?? (isEnglish ? 'Failed to save platform.' : '保存平台失败。'), 'error');
        } finally {
            setSaving(false);
        }
    };

    const deletePlatform = async (p: SocialPlatform) => {
        if (!confirm(isEnglish
            ? `Delete platform "${p.label}"? Existing QR codes keep their platform tag.`
            : `删除平台"${p.label}"？已创建的二维码仍保留其平台标签。`
        )) return;
        setDeletingId(p.id);
        try {
            await callDeleteSocialPlatform({id: p.id});
            await refresh();
            if (editingId === p.id) setEditingId(null);
            showToast(isEnglish ? 'Platform deleted.' : '平台已删除。', 'warning');
        } catch {
            showToast(isEnglish ? 'Failed to delete platform.' : '删除平台失败。', 'error');
        } finally {
            setDeletingId(null);
        }
    };

    return (
        <div className="admin-section">
            <div className="admin-tools-header">
                <button className="admin-btn admin-btn--link" onClick={onBack} type="button">
                    {isEnglish ? '← Back to QR Codes' : '← 返回二维码列表'}
                </button>
                <h3 className="admin-tools-title">{isEnglish ? 'Social Platforms' : '社交平台'}</h3>
            </div>

            <p className="admin-helper-text admin-section-intro">
                {isEnglish
                    ? 'These platforms power per-platform tracking in the QR editor. Selecting platforms when '
                    + 'creating a tracked code makes one code per platform for the same URL, so scan counts show '
                    + 'which platform drives the most clicks.'
                    : '这些平台用于二维码编辑器中的按平台追踪。创建可追踪二维码时选择平台，即可为同一链接按平台'
                    + '各生成一个二维码，通过扫描数对比各平台的点击表现。'}
            </p>

            {!customized && !readOnly && (
                <div className="admin-create-badge-form admin-section-mb">
                    <p className="admin-helper-text">
                        {isEnglish
                            ? 'Showing built-in defaults. Load them to edit, remove, or add your own platforms.'
                            : '当前显示内置默认平台。加载后即可编辑、删除或添加自定义平台。'}
                    </p>
                    <button className="admin-btn admin-btn--dashed" onClick={seedDefaults} disabled={seeding}>
                        {seeding
                            ? (isEnglish ? 'Loading...' : '加载中...')
                            : (isEnglish ? 'Customize defaults' : '自定义默认平台')}
                    </button>
                </div>
            )}

            {editable && (showCreate ? (
                <div className="admin-create-badge-form">
                    <h4 className="admin-badges-title">{isEnglish ? 'Add Platform' : '添加平台'}</h4>
                    <PlatformForm draft={createDraft} setDraft={setCreateDraft} isEnglish={isEnglish}/>
                    <div className="admin-btn-row admin-mt-12">
                        <button className="admin-toggle-btn admin-toggle-save" onClick={createPlatform}
                                disabled={saving}>
                            {saving ? (isEnglish ? 'Adding...' : '添加中...') : (isEnglish ? 'Add Platform' : '添加平台')}
                        </button>
                        <button
                            className="admin-toggle-btn admin-toggle-cancel"
                            onClick={() => {
                                setShowCreate(false);
                                setCreateDraft(emptyDraft(0));
                            }}
                        >
                            {isEnglish ? 'Cancel' : '取消'}
                        </button>
                    </div>
                </div>
            ) : (
                <button className="admin-btn admin-btn--dashed admin-section-mb" onClick={() => setShowCreate(true)}>
                    {isEnglish ? '+ New Platform' : '+ 新建平台'}
                </button>
            ))}

            <div className="admin-event-grid">
                {platforms.map(p => (
                    <div
                        key={p.id}
                        className={`admin-event-card${editingId === p.id ? ' admin-event-card-editing' : ''}`}
                    >
                        <div className="admin-event-card-info">
                            {editingId === p.id ? (
                                <>
                                    <PlatformForm draft={editDraft} setDraft={setEditDraft} isEnglish={isEnglish}/>
                                    <div className="admin-tag-actions admin-mt-12">
                                        <button
                                            className="admin-toggle-btn admin-toggle-save admin-btn-sm"
                                            onClick={saveEdit}
                                            disabled={saving}
                                        >
                                            {saving ? (isEnglish ? 'Saving...' : '保存中...') : (isEnglish ? 'Save' : '保存')}
                                        </button>
                                        <button
                                            className="admin-toggle-btn admin-toggle-cancel admin-btn-sm"
                                            onClick={() => setEditingId(null)}
                                        >
                                            {isEnglish ? 'Cancel' : '取消'}
                                        </button>
                                    </div>
                                </>
                            ) : (
                                <>
                                    <span className="admin-event-card-title">
                                        {p.label}
                                        {p.labelCn && p.labelCn !== p.label ? ` · ${p.labelCn}` : ''}
                                    </span>
                                    {editable && (
                                        <div className="admin-tag-actions">
                                            <button
                                                className="admin-toggle-btn admin-toggle-edit admin-btn-sm"
                                                onClick={() => openEdit(p)}
                                            >
                                                {isEnglish ? 'Edit' : '编辑'}
                                            </button>
                                            <button
                                                className="admin-toggle-btn admin-toggle-revoke admin-btn-sm"
                                                onClick={() => deletePlatform(p)}
                                                disabled={deletingId === p.id}
                                            >
                                                {deletingId === p.id
                                                    ? (isEnglish ? 'Deleting...' : '删除中...')
                                                    : (isEnglish ? 'Delete' : '删除')}
                                            </button>
                                        </div>
                                    )}
                                </>
                            )}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
};

interface PlatformFormProps {
    draft: PlatformDraft;
    setDraft: (updater: (prev: PlatformDraft) => PlatformDraft) => void;
    isEnglish: boolean;
}

const PlatformForm = ({draft, setDraft, isEnglish}: PlatformFormProps) => (
    <div className="admin-form-grid">
        <label>
            <span>{isEnglish ? 'Name (English)' : '名称（英文）'}</span>
            <input
                value={draft.label}
                onChange={e => setDraft(prev => ({...prev, label: e.target.value}))}
                className="admin-input"
                placeholder="e.g. WeChat"
            />
        </label>
        <label>
            <span>{isEnglish ? 'Name (Chinese)' : '名称（中文）'}</span>
            <input
                value={draft.labelCn}
                onChange={e => setDraft(prev => ({...prev, labelCn: e.target.value}))}
                className="admin-input"
                placeholder={isEnglish ? 'optional' : '可选'}
            />
        </label>
    </div>
);
