import { useState } from 'react';
import { useLanguage } from '~/components/LanguageContextProvider';
import { callDeleteSocialPlatform, callSaveSocialPlatform, callSeedSocialPlatforms } from '~/lib/firebase';
import { type SocialPlatform, useSocialPlatforms } from '~/lib/socialPlatforms';

interface PlatformDraft {
    label: string;
    labelCn: string;
    buildPrefix: string;
    pathPrefix: string;
    /** Hosts as a comma/space separated string while editing. */
    hosts: string;
    placeholder: string;
    order: number;
}

function platformToDraft(p: SocialPlatform): PlatformDraft {
    return {
        label: p.label,
        labelCn: p.labelCn ?? '',
        buildPrefix: p.buildPrefix,
        pathPrefix: p.pathPrefix,
        hosts: p.hosts.join(', '),
        placeholder: p.placeholder,
        order: p.order,
    };
}

function emptyDraft(order: number): PlatformDraft {
    return {label: '', labelCn: '', buildPrefix: 'https://', pathPrefix: '', hosts: '', placeholder: '', order};
}

/** Split the comma/space separated hosts field into a clean, deduped list. */
function parseHosts(raw: string): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const h of raw.split(/[\s,]+/)) {
        const host = h.trim().toLowerCase();
        if (host && !seen.has(host)) {
            seen.add(host);
            out.push(host);
        }
    }
    return out;
}

interface SocialPlatformsManagerProps {
    onBack: () => void;
    showToast: (message: string, type: 'success' | 'warning' | 'error') => void;
    readOnly?: boolean;
}

/**
 * Admin manager for the editable social-platform list behind the QR form's
 * "Social profile" mode. Until the defaults are seeded the list is read-only
 * (built-in defaults stand in); "Customize defaults" seeds all of them so they
 * can be edited, removed, or extended — seeding all at once avoids a single new
 * platform replacing the defaults in the picker.
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

    const validate = (draft: PlatformDraft): string | null => {
        if (!draft.label.trim()) return isEnglish ? 'A label is required.' : '请填写名称。';
        const prefix = draft.buildPrefix.trim();
        if (!/^https:\/\//i.test(prefix)) {
            return isEnglish ? 'Build prefix must be an https:// URL.' : '链接前缀必须为 https:// 链接。';
        }
        try {
            new URL(prefix);
        } catch {
            return isEnglish ? 'Build prefix is not a valid URL.' : '链接前缀不是有效的链接。';
        }
        if (parseHosts(draft.hosts).length === 0) {
            return isEnglish ? 'Add at least one host (e.g. example.com).' : '请至少填写一个域名（如 example.com）。';
        }
        return null;
    };

    const payloadFrom = (draft: PlatformDraft, id?: string) => ({
        ...(id ? {id} : {}),
        label: draft.label.trim(),
        labelCn: draft.labelCn.trim(),
        buildPrefix: draft.buildPrefix.trim(),
        hosts: parseHosts(draft.hosts),
        pathPrefix: draft.pathPrefix.trim(),
        placeholder: draft.placeholder.trim(),
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
        const err = validate(createDraft);
        if (err) {
            showToast(err, 'error');
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
        const err = validate(editDraft);
        if (err) {
            showToast(err, 'error');
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
            ? `Delete platform "${p.label}"? Existing QR codes keep their saved link.`
            : `删除平台"${p.label}"？已创建的二维码仍保留其链接。`
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
                <button className="admin-back-btn" onClick={onBack} type="button">
                    {isEnglish ? '← Back to QR Codes' : '← 返回二维码列表'}
                </button>
                <h3 className="admin-tools-title">{isEnglish ? 'Social Platforms' : '社交平台'}</h3>
            </div>

            <p className="admin-helper-text admin-section-intro">
                {isEnglish
                    ? 'These platforms power the "Social profile" link mode in the QR editor. Each one builds a profile URL from a handle and recognises that platform when editing a saved code.'
                    : '这些平台用于二维码编辑器中的"社交主页"链接模式。每个平台可根据账号生成主页链接，并在编辑已保存的二维码时识别该平台。'}
            </p>

            {!customized && !readOnly && (
                <div className="admin-create-badge-form admin-section-mb">
                    <p className="admin-helper-text">
                        {isEnglish
                            ? 'Showing built-in defaults. Load them to edit, remove, or add your own platforms.'
                            : '当前显示内置默认平台。加载后即可编辑、删除或添加自定义平台。'}
                    </p>
                    <button className="admin-generate-btn" onClick={seedDefaults} disabled={seeding}>
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
                <button className="admin-generate-btn admin-section-mb" onClick={() => setShowCreate(true)}>
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
                                    <span className="admin-helper-text admin-card-meta">
                                        {p.buildPrefix}{p.placeholder || '…'}
                                    </span>
                                    <span className="admin-helper-text admin-card-meta">
                                        {isEnglish ? 'Recognises: ' : '识别域名：'}{p.hosts.join(', ')}
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
    <>
        <div className="admin-form-grid">
            <label>
                <span>{isEnglish ? 'Name (English)' : '名称（英文）'}</span>
                <input
                    value={draft.label}
                    onChange={e => setDraft(prev => ({...prev, label: e.target.value}))}
                    className="admin-search-input"
                    placeholder="e.g. Threads"
                />
            </label>
            <label>
                <span>{isEnglish ? 'Name (Chinese)' : '名称（中文）'}</span>
                <input
                    value={draft.labelCn}
                    onChange={e => setDraft(prev => ({...prev, labelCn: e.target.value}))}
                    className="admin-search-input"
                    placeholder={isEnglish ? 'optional' : '可选'}
                />
            </label>
            <label className="admin-form-grid-full">
                <span>{isEnglish ? 'Build prefix' : '链接前缀'}</span>
                <input
                    value={draft.buildPrefix}
                    onChange={e => setDraft(prev => ({...prev, buildPrefix: e.target.value}))}
                    className="admin-search-input"
                    placeholder="https://www.threads.net/@"
                />
                <small className="admin-helper-text">
                    {isEnglish
                        ? 'The handle is appended to this. End it with / or @ as the profile URL needs.'
                        : '账号会拼接在其后。请按主页链接的格式以 / 或 @ 结尾。'}
                </small>
            </label>
            <label>
                <span>{isEnglish ? 'Handle placeholder' : '账号占位符'}</span>
                <input
                    value={draft.placeholder}
                    onChange={e => setDraft(prev => ({...prev, placeholder: e.target.value}))}
                    className="admin-search-input"
                    placeholder="@handle"
                />
            </label>
            <label>
                <span>{isEnglish ? 'Path prefix (advanced)' : '路径前缀（高级）'}</span>
                <input
                    value={draft.pathPrefix}
                    onChange={e => setDraft(prev => ({...prev, pathPrefix: e.target.value}))}
                    className="admin-search-input"
                    placeholder={isEnglish ? 'e.g. user/  (usually blank)' : '例如 user/（通常留空）'}
                />
            </label>
            <label className="admin-form-grid-full">
                <span>{isEnglish ? 'Recognised hosts' : '识别域名'}</span>
                <input
                    value={draft.hosts}
                    onChange={e => setDraft(prev => ({...prev, hosts: e.target.value}))}
                    className="admin-search-input"
                    placeholder="threads.net, www.threads.net"
                />
                <small className="admin-helper-text">
                    {isEnglish
                        ? 'Comma-separated domains used to detect this platform when editing a saved code (omit www).'
                        : '用逗号分隔的域名，用于在编辑已保存的二维码时识别此平台（无需 www）。'}
                </small>
            </label>
        </div>
    </>
);
