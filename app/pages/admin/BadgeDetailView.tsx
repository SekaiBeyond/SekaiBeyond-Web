import { useEffect, useState } from 'react';
import {
    collection,
    doc,
    type DocumentSnapshot,
    getDoc,
    getDocs,
    limit,
    orderBy,
    query,
    type QueryConstraint,
    startAfter,
    where,
} from 'firebase/firestore';
import type { User } from 'firebase/auth';
import { formatGroupWithTitle } from '~/components/AuthProvider';
import { useLanguage } from '~/components/LanguageContextProvider';
import {
    callCancelBadgeDeletion,
    callDeleteBadgeActivationCode,
    callGenerateBadgeActivationCode,
    callRequestBadgeDeletion,
    callSaveBadge,
    callToggleBadgeCodeActive,
    callUploadAdminImage,
    getFirebaseDb,
} from '~/lib/firebase';
import { formatCode } from '~/lib/codes';
import { formatSiteTime, parseSiteTime } from '~/lib/siteTime';
import { isValidHttpUrl } from '~/lib/urls';
import type { BadgeActivationCode, BadgeDef, UserRecord } from './types';
import { docToUserRecord } from './utils';
import { AccountPicker } from './AccountPicker';
import { UserRow } from './UserRow';
import { BilingualFormField } from './BilingualFormField';
import { ImageUploadField } from './ImageUploadField';

const CODE_TIME_FORMAT: Intl.DateTimeFormatOptions = {
    year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
};

export interface BadgeForm {
    name: string;
    nameCn: string;
    description: string;
    descriptionCn: string;
    image: File | null;
    imagePreview: string | null;
    creatorUser: UserRecord | null;
    createdByName: string;
    createdByLink: string;
}

export const emptyBadgeForm: BadgeForm = {
    name: '', nameCn: '', description: '', descriptionCn: '',
    image: null, imagePreview: null,
    creatorUser: null, createdByName: '', createdByLink: '',
};

interface BadgeDetailViewProps {
    badgeDef: BadgeDef;
    onBack: () => void;
    onUpdateBadgeDef: (updated: BadgeDef) => void;
    user: User;
    onLookupUser: (uid: string) => void;
    showToast: (message: string, type: 'success' | 'warning' | 'error') => void;
    readOnly?: boolean;
}

export const BadgeDetailView = ({
                                    badgeDef,
                                    onBack,
                                    onUpdateBadgeDef,
                                    user,
                                    onLookupUser,
                                    showToast,
                                    readOnly = false,
                                }: BadgeDetailViewProps) => {
    const {isEnglish} = useLanguage();
    const BADGE_HOLDER_PAGE_SIZE = 20;

    const [badgeHolders, setBadgeHolders] = useState<UserRecord[]>([]);
    const [loadingBadgeHolders, setLoadingBadgeHolders] = useState(false);
    const [badgeHolderLastDoc, setBadgeHolderLastDoc] = useState<DocumentSnapshot | null>(null);
    const [hasMoreBadgeHolders, setHasMoreBadgeHolders] = useState(false);

    // Edit badge state
    const [editingBadgeDef, setEditingBadgeDef] = useState(false);
    const [editForm, setEditForm] = useState<BadgeForm>(emptyBadgeForm);
    const [savingBadgeDef, setSavingBadgeDef] = useState(false);

    // Delete state
    const [deletionBusyId, setDeletionBusyId] = useState<string | null>(null);

    // Activation codes state
    const [badgeActivationCodes, setBadgeActivationCodes] = useState<BadgeActivationCode[]>([]);
    const [loadingActivationCodes, setLoadingActivationCodes] = useState(false);
    const [generatingActivationCode, setGeneratingActivationCode] = useState(false);
    const [newCodeMaxUses, setNewCodeMaxUses] = useState<number>(100);
    const [newCodeUnlimited, setNewCodeUnlimited] = useState(false);
    const [newCodeFrom, setNewCodeFrom] = useState('');
    const [newCodeUntil, setNewCodeUntil] = useState('');

    const loadBadgeHolders = async (badgeId: string, after?: DocumentSnapshot) => {
        setLoadingBadgeHolders(true);
        try {
            const db = getFirebaseDb();
            const constraints: QueryConstraint[] = [
                where('badges', 'array-contains', badgeId),
                limit(BADGE_HOLDER_PAGE_SIZE),
            ];
            if (after) constraints.push(startAfter(after));
            const snapshot = await getDocs(query(collection(db, 'users'), ...constraints));
            const newHolders = snapshot.docs.map(docToUserRecord);
            if (after) {
                setBadgeHolders(prev => [...prev, ...newHolders]);
            } else {
                setBadgeHolders(newHolders);
            }
            setBadgeHolderLastDoc(snapshot.docs[snapshot.docs.length - 1] ?? null);
            setHasMoreBadgeHolders(snapshot.docs.length === BADGE_HOLDER_PAGE_SIZE);
        } finally {
            setLoadingBadgeHolders(false);
        }
    };

    const loadBadgeActivationCodes = async (badgeId: string) => {
        setLoadingActivationCodes(true);
        try {
            const db = getFirebaseDb();
            const q = query(
                collection(db, 'badgeActivationCodes'),
                where('badgeId', '==', badgeId),
                orderBy('createdAt', 'desc'),
            );
            const snapshot = await getDocs(q);
            setBadgeActivationCodes(snapshot.docs.map(docSnap => {
                const data = docSnap.data();
                return {
                    id: docSnap.id,
                    code: data.code,
                    badgeId: data.badgeId,
                    active: data.active ?? true,
                    activeFrom: data.activeFrom ?? null,
                    activeUntil: data.activeUntil ?? null,
                    maxUses: data.maxUses ?? 0,
                    usedCount: data.usedCount ?? 0,
                    createdBy: data.createdBy ?? '',
                    createdAt: data.createdAt?.toDate?.() ?? new Date(),
                };
            }));
        } finally {
            setLoadingActivationCodes(false);
        }
    };

    useEffect(() => {
        loadBadgeHolders(badgeDef.id);
        if (!readOnly) loadBadgeActivationCodes(badgeDef.id);
    }, [badgeDef.id, readOnly]);

    const requestDeleteBadge = async () => {
        if (!confirm(isEnglish
            ? `Request deletion of badge "${badgeDef.name}"? It will be permanently deleted in about 48 hours unless cancelled.`
            : `申请删除徽章"${badgeDef.name}"？如不取消，约 48 小时后将被永久删除。`
        )) return;
        setDeletionBusyId(badgeDef.id);
        try {
            const result = await callRequestBadgeDeletion({badgeId: badgeDef.id});
            const deleteAt = new Date(result.data.deleteAt);
            onUpdateBadgeDef({...badgeDef, deleteAt});
            showToast(isEnglish ? 'Deletion scheduled.' : '已计划删除。', 'warning');
        } catch {
            showToast(isEnglish ? 'Failed to schedule deletion.' : '计划删除失败。', 'error');
        } finally {
            setDeletionBusyId(null);
        }
    };

    const cancelDeleteBadge = async () => {
        setDeletionBusyId(badgeDef.id);
        try {
            await callCancelBadgeDeletion({badgeId: badgeDef.id});
            onUpdateBadgeDef({...badgeDef, deleteAt: null});
            showToast(isEnglish ? 'Deletion cancelled.' : '已取消删除。', 'success');
        } catch {
            showToast(isEnglish ? 'Failed to cancel deletion.' : '取消删除失败。', 'error');
        } finally {
            setDeletionBusyId(null);
        }
    };

    const updateBadgeDef = async () => {
        const creatorLink = editForm.creatorUser ? '' : editForm.createdByLink.trim();
        if (creatorLink && !isValidHttpUrl(creatorLink)) {
            showToast(isEnglish ? 'Creator link must be a valid URL (http/https).' : '创建者链接必须是有效的网址（http/https）。', 'error');
            return;
        }
        setSavingBadgeDef(true);
        try {
            const creatorUid = editForm.creatorUser?.uid ?? '';
            const creatorName = editForm.creatorUser?.displayName ?? editForm.createdByName.trim();

            let imageUrl = badgeDef.imageUrl;
            if (editForm.image) {
                const imageId = crypto.randomUUID();
                imageUrl = await callUploadAdminImage(editForm.image, `badges/${imageId}.webp`);
            }

            await callSaveBadge({
                badgeId: badgeDef.id,
                name: editForm.name.trim(),
                nameCn: editForm.nameCn.trim(),
                description: editForm.description.trim(),
                descriptionCn: editForm.descriptionCn.trim(),
                imageUrl,
                createdByUid: creatorUid,
                createdByName: creatorName,
                createdByLink: creatorLink,
            });

            const updated: BadgeDef = {
                ...badgeDef,
                name: editForm.name.trim(),
                nameCn: editForm.nameCn.trim(),
                description: editForm.description.trim(),
                descriptionCn: editForm.descriptionCn.trim(),
                imageUrl,
                createdByUid: creatorUid,
                createdByName: creatorName,
                createdByLink: creatorLink,
            };
            onUpdateBadgeDef(updated);
            setEditingBadgeDef(false);
            if (editForm.imagePreview?.startsWith('blob:')) URL.revokeObjectURL(editForm.imagePreview);
            setEditForm(emptyBadgeForm);
            showToast(isEnglish ? 'Badge updated.' : '徽章已更新。', 'success');
        } catch (e: any) {
            showToast(e?.message ?? (isEnglish ? 'Failed to save badge.' : '保存徽章失败。'), 'error');
        } finally {
            setSavingBadgeDef(false);
        }
    };

    const startEditBadge = async () => {
        let creatorUser: UserRecord | null = null;
        let createdByName = '';
        let createdByLink = '';

        if (badgeDef.createdByUid) {
            const db = getFirebaseDb();
            const snap = await getDoc(doc(db, 'users', badgeDef.createdByUid));
            if (snap.exists()) {
                creatorUser = docToUserRecord(snap);
            } else {
                createdByName = badgeDef.createdByName;
                createdByLink = badgeDef.createdByLink;
            }
        } else {
            createdByName = badgeDef.createdByName;
            createdByLink = badgeDef.createdByLink;
        }

        setEditForm({
            name: badgeDef.name,
            nameCn: badgeDef.nameCn,
            description: badgeDef.description,
            descriptionCn: badgeDef.descriptionCn,
            image: null,
            imagePreview: null,
            creatorUser,
            createdByName,
            createdByLink,
        });
        setEditingBadgeDef(true);
    };

    const createBadgeActivationCode = async (badgeId: string) => {
        setGeneratingActivationCode(true);
        try {
            const params: {badgeId: string; maxUses: number; activeFrom?: string; activeUntil?: string} = {
                badgeId,
                maxUses: newCodeMaxUses,
            };
            if (newCodeFrom) params.activeFrom = parseSiteTime(newCodeFrom).toISOString();
            if (newCodeUntil) params.activeUntil = parseSiteTime(newCodeUntil).toISOString();

            const result = await callGenerateBadgeActivationCode(params);
            const {id, code} = result.data;

            setBadgeActivationCodes(prev => [{
                id, code, badgeId,
                active: true,
                activeFrom: params.activeFrom ?? null,
                activeUntil: params.activeUntil ?? null,
                maxUses: newCodeMaxUses,
                usedCount: 0,
                createdBy: user.uid,
                createdAt: new Date(),
            }, ...prev]);
            setNewCodeMaxUses(100);
            setNewCodeUnlimited(false);
            setNewCodeFrom('');
            setNewCodeUntil('');
            showToast(isEnglish ? 'Activation code generated.' : '激活码已生成。', 'success');
        } catch {
            showToast(isEnglish ? 'Failed to generate code.' : '生成激活码失败。', 'error');
        } finally {
            setGeneratingActivationCode(false);
        }
    };

    const toggleActivationCodeActive = async (ac: BadgeActivationCode) => {
        const newActive = !ac.active;
        setBadgeActivationCodes(prev => prev.map(c => c.id === ac.id ? {...c, active: newActive} : c));
        try {
            await callToggleBadgeCodeActive({codeId: ac.id, active: newActive});
            showToast(
                newActive
                    ? (isEnglish ? 'Code activated.' : '激活码已启用。')
                    : (isEnglish ? 'Code deactivated.' : '激活码已停用。'),
                newActive ? 'success' : 'warning',
            );
        } catch {
            setBadgeActivationCodes(prev => prev.map(c => c.id === ac.id ? {...c, active: ac.active} : c));
            showToast(isEnglish ? 'Failed to update code status.' : '更新激活码状态失败。', 'error');
        }
    };

    const deleteActivationCode = async (ac: BadgeActivationCode) => {
        const usedNote = ac.usedCount > 0
            ? (isEnglish ? ` It has been used ${ac.usedCount} time(s).` : `此码已被使用${ac.usedCount}次。`)
            : '';
        if (!window.confirm(
            isEnglish
                ? `Delete activation code "${formatCode(ac.code)}"?${usedNote} This cannot be undone.`
                : `删除激活码"${formatCode(ac.code)}"？${usedNote}此操作不可撤销。`
        )) return;
        const prevSnapshot = [...badgeActivationCodes];
        setBadgeActivationCodes(prev => prev.filter(c => c.id !== ac.id));
        try {
            await callDeleteBadgeActivationCode({codeId: ac.id});
            showToast(isEnglish ? 'Activation code deleted.' : '激活码已删除。', 'warning');
        } catch {
            setBadgeActivationCodes(prevSnapshot);
            showToast(isEnglish ? 'Failed to delete code.' : '删除激活码失败。', 'error');
        }
    };

    return (
        <div className="admin-section">
            <div className="admin-event-detail">
                <button className="admin-btn admin-btn--link" onClick={onBack}>
                    &larr; {isEnglish ? 'All Badges' : '所有徽章'}
                </button>

                <div className="admin-event-detail-header">
                    <img src={badgeDef.imageUrl} alt="" className="admin-event-detail-img"/>
                    <div>
                        <h3>{isEnglish ? badgeDef.name : (badgeDef.nameCn || badgeDef.name)}</h3>
                        <p className="admin-event-detail-meta">
                            {isEnglish ? badgeDef.description : (badgeDef.descriptionCn || badgeDef.description)}
                        </p>
                        {badgeDef.createdByName && (
                            <p className="admin-event-detail-meta admin-mt-4">
                                {isEnglish ? 'Created by: ' : '创建者：'}
                                {badgeDef.createdByUid ? (
                                    <a href={`/profile?uid=${badgeDef.createdByUid}`}
                                       className="admin-creator-link">
                                        {badgeDef.createdByName}
                                    </a>
                                ) : (badgeDef.createdByLink && isValidHttpUrl(badgeDef.createdByLink)) ? (
                                    <a href={badgeDef.createdByLink} target="_blank" rel="noopener noreferrer"
                                       className="admin-creator-link">
                                        {badgeDef.createdByName}
                                    </a>
                                ) : badgeDef.createdByName}
                            </p>
                        )}
                    </div>
                </div>

                {!readOnly && (editingBadgeDef ? (
                    <div className="admin-create-badge-form admin-section-mb">
                        <h4 className="admin-badges-title">{isEnglish ? 'Edit Badge' : '编辑徽章'}</h4>
                        <div className="admin-form-grid">
                            <BilingualFormField
                                label="Name" labelCn="名称"
                                value={editForm.name} valueCn={editForm.nameCn}
                                onChange={v => setEditForm(f => ({...f, name: v}))}
                                onChangeCn={v => setEditForm(f => ({...f, nameCn: v}))}
                            />
                            <BilingualFormField
                                label="Description" labelCn="描述"
                                value={editForm.description} valueCn={editForm.descriptionCn}
                                onChange={v => setEditForm(f => ({...f, description: v}))}
                                onChangeCn={v => setEditForm(f => ({...f, descriptionCn: v}))}
                                multiline
                            />
                            <AccountPicker
                                label={isEnglish ? 'Creator (optional)' : '创建者（可选）'}
                                selected={editForm.creatorUser}
                                onSelect={u => setEditForm(f => ({
                                    ...f,
                                    creatorUser: u,
                                    ...(u ? {} : {createdByName: '', createdByLink: ''}),
                                }))}
                                manualName={editForm.createdByName}
                                onManualNameChange={v => setEditForm(f => ({...f, createdByName: v}))}
                                manualLink={editForm.createdByLink}
                                onManualLinkChange={v => setEditForm(f => ({...f, createdByLink: v}))}
                            />
                            <ImageUploadField
                                label="Badge Image" labelCn="徽章图片"
                                preview={editForm.imagePreview}
                                onFileChange={(file, url) => setEditForm(f => ({
                                    ...f,
                                    image: file,
                                    imagePreview: url
                                }))}
                                onCleanupPreview={url => URL.revokeObjectURL(url)}
                                cropAspect={1}
                                showToast={showToast}
                            />
                        </div>
                        <div className="admin-form-actions">
                            <button className="admin-toggle-btn admin-toggle-save" onClick={updateBadgeDef}
                                    disabled={savingBadgeDef || !editForm.name.trim()}>
                                {savingBadgeDef ? (isEnglish ? 'Saving...' : '保存中...') : (isEnglish ? 'Save Changes' : '保存更改')}
                            </button>
                            <button className="admin-toggle-btn admin-toggle-cancel" onClick={() => {
                                setEditingBadgeDef(false);
                                if (editForm.imagePreview?.startsWith('blob:')) URL.revokeObjectURL(editForm.imagePreview);
                                setEditForm(emptyBadgeForm);
                            }}>
                                {isEnglish ? 'Cancel' : '取消'}
                            </button>
                        </div>
                    </div>
                ) : (
                    <>
                        <div className="admin-form-actions admin-section-mb">
                            <button className="admin-toggle-btn admin-toggle-edit" onClick={startEditBadge}>
                                {isEnglish ? 'Edit Badge' : '编辑徽章'}
                            </button>
                            {badgeDef.deleteAt ? (
                                <button className="admin-toggle-btn admin-toggle-grant"
                                        onClick={cancelDeleteBadge}
                                        disabled={deletionBusyId === badgeDef.id}>
                                    {deletionBusyId === badgeDef.id
                                        ? (isEnglish ? 'Working...' : '处理中...')
                                        : (isEnglish ? 'Cancel deletion' : '取消删除')}
                                </button>
                            ) : (
                                <button className="admin-toggle-btn admin-toggle-revoke"
                                        onClick={requestDeleteBadge}
                                        disabled={deletionBusyId === badgeDef.id}>
                                    {deletionBusyId === badgeDef.id
                                        ? (isEnglish ? 'Working...' : '处理中...')
                                        : (isEnglish ? 'Delete Badge' : '删除徽章')}
                                </button>
                            )}
                        </div>
                        {badgeDef.deleteAt && (
                            <p className="admin-helper-text">
                                {isEnglish
                                    ? `Pending deletion — scheduled around ${badgeDef.deleteAt.toLocaleString('en-US', {
                                        month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
                                    })}.`
                                    : `待删除 — 预计于 ${badgeDef.deleteAt.toLocaleString('zh-CN', {
                                        month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
                                    })} 前后执行。`}
                            </p>
                        )}
                    </>
                ))}

                <h4 className="admin-badges-title">
                    {isEnglish ? 'Badge Holders' : '徽章持有者'}
                    {badgeHolders.length > 0 && <span className="admin-badges-count">{badgeHolders.length}</span>}
                </h4>

                {loadingBadgeHolders && <div className="spinner spinner-centered"/>}
                {!loadingBadgeHolders && badgeHolders.length === 0 && (
                    <p className="admin-no-results">{isEnglish ? 'No one has this badge yet.' : '暂无人持有此徽章。'}</p>
                )}
                {!loadingBadgeHolders && badgeHolders.map((u) => (
                    <UserRow key={u.uid} user={u} onClick={() => onLookupUser(u.uid)}>
                        <span className="admin-user-group-tag" data-group={u.group}>
                            {formatGroupWithTitle(u.group, u.title, u.titleCn, isEnglish)}
                        </span>
                    </UserRow>
                ))}
                {!loadingBadgeHolders && hasMoreBadgeHolders && badgeHolders.length > 0 && (
                    <button
                        className="admin-btn admin-btn--outline"
                        onClick={() => loadBadgeHolders(badgeDef.id, badgeHolderLastDoc ?? undefined)}
                    >
                        {isEnglish ? 'Load More' : '加载更多'}
                    </button>
                )}

                {/* Activation Codes — hidden in read-only mode (staff cannot read that collection) */}
                {!readOnly && (
                    <>
                        <h4 className="admin-badges-title admin-section-mt">
                            {isEnglish ? 'Activation Codes' : '激活码'}
                            {badgeActivationCodes.length > 0 &&
                                <span className="admin-badges-count">{badgeActivationCodes.length}</span>}
                        </h4>

                        <div className="admin-activation-create-form">
                            <div className="admin-code-time-inputs">
                                <label>
                                    <span>{isEnglish ? 'Max Uses' : '最大使用次数'}</span>
                                    <div className="admin-activation-meta">
                                        <input
                                            type="number" min="1"
                                            value={newCodeUnlimited ? '' : newCodeMaxUses}
                                            disabled={newCodeUnlimited}
                                            onChange={e => {
                                                setNewCodeUnlimited(false);
                                                const val = parseInt(e.target.value);
                                                setNewCodeMaxUses(isNaN(val) ? 1 : Math.max(1, val));
                                            }}
                                            className="admin-input"
                                            placeholder={newCodeUnlimited ? '∞' : undefined}
                                        />
                                        <label className="admin-unlimited-label">
                                            <input
                                                type="checkbox" checked={newCodeUnlimited}
                                                onChange={e => {
                                                    setNewCodeUnlimited(e.target.checked);
                                                    if (e.target.checked) setNewCodeMaxUses(0);
                                                    else setNewCodeMaxUses(100);
                                                }}
                                            />
                                            {isEnglish ? 'Unlimited' : '无限次'}
                                        </label>
                                    </div>
                                </label>
                                <label>
                                    <span>{isEnglish ? 'Active From (Pacific)' : '生效时间（太平洋时间）'}</span>
                                    <input type="datetime-local" value={newCodeFrom}
                                           onChange={e => setNewCodeFrom(e.target.value)}
                                           className="admin-input"/>
                                </label>
                                <label>
                                    <span>{isEnglish ? 'Active Until (Pacific)' : '失效时间（太平洋时间）'}</span>
                                    <input type="datetime-local" value={newCodeUntil}
                                           onChange={e => setNewCodeUntil(e.target.value)}
                                           className="admin-input"/>
                                </label>
                            </div>
                            <button
                                className="admin-btn admin-btn--dashed admin-mt-12"
                                onClick={() => createBadgeActivationCode(badgeDef.id)}
                                disabled={generatingActivationCode}>
                                {generatingActivationCode
                                    ? (isEnglish ? 'Generating...' : '生成中...')
                                    : (isEnglish ? '+ Generate Activation Code' : '+ 生成激活码')}
                            </button>
                        </div>

                        {loadingActivationCodes && <div className="spinner spinner-centered"/>}
                        {!loadingActivationCodes && badgeActivationCodes.length === 0 && (
                            <p className="admin-no-results">{isEnglish ? 'No activation codes yet.' : '暂无激活码。'}</p>
                        )}

                        {!loadingActivationCodes && badgeActivationCodes.map((ac) => (
                            <div key={ac.id} className="admin-single-code admin-mt-12">
                                <div className="admin-activation-meta">
                                    <span className={ac.active ? 'admin-code-active-tag' : 'admin-code-inactive-tag'}>
                                        {ac.active ? (isEnglish ? 'Active' : '活跃') : (isEnglish ? 'Inactive' : '已停用')}
                                    </span>
                                    <span className="admin-activation-usage">
                                        {ac.maxUses === 0
                                            ? (isEnglish ? `Used ${ac.usedCount} / ∞ times` : `已使用 ${ac.usedCount} / ∞ 次`)
                                            : (isEnglish ? `Used ${ac.usedCount} / ${ac.maxUses} times` : `已使用 ${ac.usedCount} / ${ac.maxUses} 次`)}
                                    </span>
                                    {ac.activeFrom && (
                                        <span className="admin-activation-time">
                                            {isEnglish ? 'From: ' : '从：'}{formatSiteTime(parseSiteTime(ac.activeFrom), isEnglish, CODE_TIME_FORMAT)}
                                        </span>
                                    )}
                                    {ac.activeUntil && (
                                        <span className="admin-activation-time">
                                            {isEnglish ? 'Until: ' : '至：'}{formatSiteTime(parseSiteTime(ac.activeUntil), isEnglish, CODE_TIME_FORMAT)}
                                        </span>
                                    )}
                                </div>
                                <div className="admin-code-url">
                                    <input readOnly value={formatCode(ac.code)} className="admin-code-input"/>
                                    <button className="admin-btn admin-btn--purple"
                                            onClick={() => navigator.clipboard.writeText(formatCode(ac.code))}>
                                        {isEnglish ? 'Copy' : '复制'}
                                    </button>
                                </div>
                                <div className="admin-single-code-actions">
                                    <button
                                        className={`admin-toggle-btn ${ac.active ? 'admin-toggle-revoke' : 'admin-toggle-grant'}`}
                                        onClick={() => toggleActivationCodeActive(ac)}
                                    >
                                        {ac.active ? (isEnglish ? 'Deactivate' : '停用') : (isEnglish ? 'Activate' : '激活')}
                                    </button>
                                    <button className="admin-toggle-btn admin-toggle-revoke"
                                            onClick={() => deleteActivationCode(ac)}>
                                        {isEnglish ? 'Delete' : '删除'}
                                    </button>
                                </div>
                            </div>
                        ))}
                    </>
                )}
            </div>
        </div>
    );
};
