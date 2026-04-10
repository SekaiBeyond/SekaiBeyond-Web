import { forwardRef, useImperativeHandle, useState } from 'react';
import {
    arrayRemove,
    collection,
    doc,
    type DocumentSnapshot,
    getDoc,
    getDocs,
    limit,
    orderBy,
    query,
    type QueryConstraint,
    serverTimestamp,
    startAfter,
    where,
    writeBatch,
} from 'firebase/firestore';
import type { User } from 'firebase/auth';
import { GROUP_LABELS, type UserProfile } from '~/components/AuthProvider';
import { useLanguage } from '~/components/LanguageContextProvider';
import {
    callDeleteAdminImage,
    callGenerateBadgeActivationCode,
    callUploadAdminImage,
    getFirebaseDb
} from '~/lib/firebase';
import type { BadgeActivationCode, BadgeDef, UserRecord } from './types';
import { commitInChunks, docToUserRecord, isValidHttpUrl } from './utils';
import { CreatorPicker } from './CreatorPicker';
import { BilingualFormField } from './BilingualFormField';
import { ImageUploadField } from './ImageUploadField';

interface BadgesTabProps {
    badgeDefs: BadgeDef[];
    setBadgeDefs: React.Dispatch<React.SetStateAction<BadgeDef[]>>;
    user: User;
    profile: UserProfile;
    showToast: (message: string, type: 'success' | 'error') => void;
}

export interface BadgesTabHandle {
    selectBadgeById: (badgeId: string) => void;
}

interface BadgeForm {
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

const emptyBadgeForm: BadgeForm = {
    name: '', nameCn: '', description: '', descriptionCn: '',
    image: null, imagePreview: null,
    creatorUser: null, createdByName: '', createdByLink: '',
};

export const BadgesTab = forwardRef<BadgesTabHandle, BadgesTabProps>(({
                                                                          badgeDefs,
                                                                          setBadgeDefs,
                                                                          user,
                                                                          profile,
                                                                          showToast,
                                                                      }, ref) => {
    const {isEnglish} = useLanguage();

    const BADGE_HOLDER_PAGE_SIZE = 20;

    // Badge list state
    const [selectedBadgeDef, setSelectedBadgeDef] = useState<BadgeDef | null>(null);
    const [badgeHolders, setBadgeHolders] = useState<UserRecord[]>([]);
    const [loadingBadgeHolders, setLoadingBadgeHolders] = useState(false);
    const [badgeHolderLastDoc, setBadgeHolderLastDoc] = useState<DocumentSnapshot | null>(null);
    const [hasMoreBadgeHolders, setHasMoreBadgeHolders] = useState(false);

    // Create badge state
    const [showCreateBadge, setShowCreateBadge] = useState(false);
    const [createForm, setCreateForm] = useState<BadgeForm>(emptyBadgeForm);
    const [creatingBadgeDef, setCreatingBadgeDef] = useState(false);

    // Edit badge state
    const [editingBadgeDef, setEditingBadgeDef] = useState(false);
    const [editForm, setEditForm] = useState<BadgeForm>(emptyBadgeForm);
    const [savingBadgeDef, setSavingBadgeDef] = useState(false);

    // Delete state
    const [deletingId, setDeletingId] = useState<string | null>(null);

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

    const selectBadgeDef = async (bd: BadgeDef) => {
        setSelectedBadgeDef(bd);
        setBadgeActivationCodes([]);
        setBadgeHolderLastDoc(null);
        setHasMoreBadgeHolders(false);
        await loadBadgeHolders(bd.id);
        loadBadgeActivationCodes(bd.id).then();
    };

    useImperativeHandle(ref, () => ({
        selectBadgeById: (badgeId: string) => {
            const bd = badgeDefs.find(d => d.id === badgeId);
            if (bd) selectBadgeDef(bd);
        },
    }));

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

    const createBadgeDef = async () => {
        const creatorLink = createForm.creatorUser ? '' : createForm.createdByLink.trim();
        if (creatorLink && !isValidHttpUrl(creatorLink)) {
            showToast(isEnglish ? 'Creator link must be a valid URL (http/https).' : '创建者链接必须是有效的网址（http/https）。', 'error');
            return;
        }
        setCreatingBadgeDef(true);
        try {
            let imageUrl = '/images/mika.png';
            if (createForm.image) {
                const imageId = crypto.randomUUID();
                imageUrl = await callUploadAdminImage(createForm.image, `badges/${imageId}.webp`);
            }

            const db = getFirebaseDb();
            const creatorUid = createForm.creatorUser?.uid ?? '';
            const creatorName = createForm.creatorUser?.displayName ?? createForm.createdByName.trim();

            const batch = writeBatch(db);
            const newDocRef = doc(collection(db, 'badges'));
            batch.set(newDocRef, {
                name: createForm.name.trim(),
                nameCn: createForm.nameCn.trim(),
                description: createForm.description.trim(),
                descriptionCn: createForm.descriptionCn.trim(),
                imageUrl,
                createdBy: user.uid,
                createdByUid: creatorUid,
                createdByName: creatorName,
                createdByLink: creatorLink,
                createdAt: serverTimestamp(),
            });
            batch.set(doc(collection(db, 'records')), {
                type: 'badge-create',
                performedBy: user.uid,
                performedByName: profile.displayName,
                badgeId: newDocRef.id,
                badgeName: createForm.name.trim(),
                timestamp: serverTimestamp(),
            });
            await batch.commit();

            setBadgeDefs(prev => [...prev, {
                id: newDocRef.id,
                name: createForm.name.trim(),
                nameCn: createForm.nameCn.trim(),
                description: createForm.description.trim(),
                descriptionCn: createForm.descriptionCn.trim(),
                imageUrl,
                createdBy: user.uid,
                createdByUid: creatorUid,
                createdByName: creatorName,
                createdByLink: creatorLink,
                createdAt: new Date(),
            }]);

            resetCreateForm();
            showToast(isEnglish ? 'Badge created.' : '徽章已创建。', 'success');
        } catch {
            showToast(isEnglish ? 'Failed to create badge.' : '创建徽章失败。', 'error');
        } finally {
            setCreatingBadgeDef(false);
        }
    };

    const resetCreateForm = () => {
        if (createForm.imagePreview?.startsWith('blob:')) URL.revokeObjectURL(createForm.imagePreview);
        setCreateForm(emptyBadgeForm);
        setShowCreateBadge(false);
    };

    const deleteBadgeDef = async (bd: BadgeDef) => {
        if (!confirm(isEnglish
            ? `Delete badge "${bd.name}"? This cannot be undone.`
            : `删除徽章"${bd.name}"？此操作不可撤销。`
        )) return;
        setDeletingId(bd.id);
        try {
            const db = getFirebaseDb();

            // Find orphaned activation codes and badge holders to clean up
            const [codesSnap, holdersSnap] = await Promise.all([
                getDocs(query(collection(db, 'badgeActivationCodes'), where('badgeId', '==', bd.id))),
                getDocs(query(collection(db, 'users'), where('badges', 'array-contains', bd.id))),
            ]);

            const ops: ((b: ReturnType<typeof writeBatch>) => void)[] = [
                b => b.delete(doc(db, 'badges', bd.id)),
                b => b.set(doc(collection(db, 'records')), {
                    type: 'badge-delete',
                    performedBy: user.uid,
                    performedByName: profile.displayName,
                    badgeId: bd.id,
                    badgeName: bd.name,
                    timestamp: serverTimestamp(),
                }),
                ...codesSnap.docs.map(codeDoc => (b: ReturnType<typeof writeBatch>) => b.delete(codeDoc.ref)),
                ...holdersSnap.docs.map(userDoc => (b: ReturnType<typeof writeBatch>) => b.update(userDoc.ref, {badges: arrayRemove(bd.id)})),
            ];
            await commitInChunks(db, ops);
            await callDeleteAdminImage(bd.imageUrl).catch(() => {
            });

            setBadgeDefs(prev => prev.filter(d => d.id !== bd.id));
            setSelectedBadgeDef(null);
            showToast(isEnglish ? 'Badge deleted.' : '徽章已删除。', 'success');
        } catch {
            showToast(isEnglish ? 'Failed to delete badge.' : '删除徽章失败。', 'error');
        } finally {
            setDeletingId(null);
        }
    };

    const updateBadgeDef = async () => {
        if (!selectedBadgeDef) return;
        const creatorLink = editForm.creatorUser ? '' : editForm.createdByLink.trim();
        if (creatorLink && !isValidHttpUrl(creatorLink)) {
            showToast(isEnglish ? 'Creator link must be a valid URL (http/https).' : '创建者链接必须是有效的网址（http/https）。', 'error');
            return;
        }
        setSavingBadgeDef(true);
        try {
            const db = getFirebaseDb();
            const creatorUid = editForm.creatorUser?.uid ?? '';
            const creatorName = editForm.creatorUser?.displayName ?? editForm.createdByName.trim();
            const updates: Record<string, string> = {
                name: editForm.name.trim(),
                nameCn: editForm.nameCn.trim(),
                description: editForm.description.trim(),
                descriptionCn: editForm.descriptionCn.trim(),
                createdByUid: creatorUid,
                createdByName: creatorName,
                createdByLink: creatorLink,
            };

            if (editForm.image) {
                const imageId = crypto.randomUUID();
                updates.imageUrl = await callUploadAdminImage(editForm.image, `badges/${imageId}.webp`);
            }

            const batch = writeBatch(db);
            batch.update(doc(db, 'badges', selectedBadgeDef.id), updates);
            batch.set(doc(collection(db, 'records')), {
                type: 'badge-edit',
                performedBy: user.uid,
                performedByName: profile.displayName,
                badgeId: selectedBadgeDef.id,
                badgeName: editForm.name.trim(),
                timestamp: serverTimestamp(),
            });
            await batch.commit();

            const updated = {...selectedBadgeDef, ...updates};
            setBadgeDefs(prev => prev.map(d => d.id === selectedBadgeDef.id ? updated : d));
            setSelectedBadgeDef(updated);
            setEditingBadgeDef(false);
            if (editForm.imagePreview?.startsWith('blob:')) URL.revokeObjectURL(editForm.imagePreview);
            setEditForm(emptyBadgeForm);
            showToast(isEnglish ? 'Badge updated.' : '徽章已更新。', 'success');
        } catch {
            showToast(isEnglish ? 'Failed to save badge.' : '保存徽章失败。', 'error');
        } finally {
            setSavingBadgeDef(false);
        }
    };

    const startEditBadge = async () => {
        if (!selectedBadgeDef) return;
        let creatorUser: UserRecord | null = null;
        let createdByName = '';
        let createdByLink = '';

        if (selectedBadgeDef.createdByUid) {
            const db = getFirebaseDb();
            const snap = await getDoc(doc(db, 'users', selectedBadgeDef.createdByUid));
            if (snap.exists()) {
                creatorUser = docToUserRecord(snap);
            } else {
                createdByName = selectedBadgeDef.createdByName;
                createdByLink = selectedBadgeDef.createdByLink;
            }
        } else {
            createdByName = selectedBadgeDef.createdByName;
            createdByLink = selectedBadgeDef.createdByLink;
        }

        setEditForm({
            name: selectedBadgeDef.name,
            nameCn: selectedBadgeDef.nameCn,
            description: selectedBadgeDef.description,
            descriptionCn: selectedBadgeDef.descriptionCn,
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
            if (newCodeFrom) params.activeFrom = new Date(newCodeFrom).toISOString();
            if (newCodeUntil) params.activeUntil = new Date(newCodeUntil).toISOString();

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
            const db = getFirebaseDb();
            const bd = badgeDefs.find(d => d.id === ac.badgeId);
            const batch = writeBatch(db);
            batch.update(doc(db, 'badgeActivationCodes', ac.id), {active: newActive});
            batch.set(doc(collection(db, 'records')), {
                type: newActive ? 'code-activate' : 'code-deactivate',
                performedBy: user.uid,
                performedByName: profile.displayName,
                badgeId: ac.badgeId,
                badgeName: bd?.name ?? ac.badgeId,
                code: ac.code,
                timestamp: serverTimestamp(),
            });
            await batch.commit();
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
                ? `Delete activation code "${ac.code}"?${usedNote} This cannot be undone.`
                : `删除激活码"${ac.code}"？${usedNote}此操作不可撤销。`
        )) return;
        const prevSnapshot = [...badgeActivationCodes];
        setBadgeActivationCodes(prev => prev.filter(c => c.id !== ac.id));
        try {
            const db = getFirebaseDb();
            const bd = badgeDefs.find(d => d.id === ac.badgeId);
            const batch = writeBatch(db);
            batch.delete(doc(db, 'badgeActivationCodes', ac.id));
            batch.set(doc(collection(db, 'records')), {
                type: 'code-delete',
                performedBy: user.uid,
                performedByName: profile.displayName,
                badgeId: ac.badgeId,
                badgeName: bd?.name ?? ac.badgeId,
                code: ac.code,
                timestamp: serverTimestamp(),
            });
            await batch.commit();
        } catch {
            setBadgeActivationCodes(prevSnapshot);
            showToast(isEnglish ? 'Failed to delete code.' : '删除激活码失败。', 'error');
        }
    };

    // Badge list view
    if (!selectedBadgeDef) {
        return (
            <div className="admin-section">
                {showCreateBadge ? (
                    <div className="admin-create-badge-form">
                        <h4 className="admin-badges-title">
                            {isEnglish ? 'Create New Badge' : '创建新徽章'}
                        </h4>
                        <div className="admin-form-grid">
                            <BilingualFormField
                                label="Name" labelCn="名称"
                                value={createForm.name} valueCn={createForm.nameCn}
                                onChange={v => setCreateForm(f => ({...f, name: v}))}
                                onChangeCn={v => setCreateForm(f => ({...f, nameCn: v}))}
                                placeholder={isEnglish ? 'Badge name' : '徽章名称'}
                                placeholderCn={isEnglish ? 'Badge name in Chinese' : '徽章中文名称'}
                            />
                            <BilingualFormField
                                label="Description" labelCn="描述"
                                value={createForm.description} valueCn={createForm.descriptionCn}
                                onChange={v => setCreateForm(f => ({...f, description: v}))}
                                onChangeCn={v => setCreateForm(f => ({...f, descriptionCn: v}))}
                                placeholder={isEnglish ? 'Badge description' : '徽章描述'}
                                placeholderCn={isEnglish ? 'Badge description in Chinese' : '徽章中文描述'}
                                multiline
                            />
                            <CreatorPicker
                                selected={createForm.creatorUser}
                                onSelect={u => setCreateForm(f => ({...f, creatorUser: u}))}
                                manualName={createForm.createdByName}
                                onManualNameChange={v => setCreateForm(f => ({...f, createdByName: v}))}
                                manualLink={createForm.createdByLink}
                                onManualLinkChange={v => setCreateForm(f => ({...f, createdByLink: v}))}
                            />
                            <ImageUploadField
                                label="Badge Image" labelCn="徽章图片"
                                preview={createForm.imagePreview}
                                onFileChange={(file, url) => setCreateForm(f => ({
                                    ...f,
                                    image: file,
                                    imagePreview: url
                                }))}
                                onCleanupPreview={url => URL.revokeObjectURL(url)}
                            />
                        </div>
                        <div className="admin-form-actions">
                            <button className="admin-generate-btn" onClick={createBadgeDef}
                                    disabled={creatingBadgeDef || !createForm.name.trim()}>
                                {creatingBadgeDef ? (isEnglish ? 'Creating...' : '创建中...') : (isEnglish ? 'Create Badge' : '创建徽章')}
                            </button>
                            <button className="admin-back-btn" onClick={resetCreateForm}>
                                {isEnglish ? 'Cancel' : '取消'}
                            </button>
                        </div>
                    </div>
                ) : (
                    <button className="admin-generate-btn" onClick={() => setShowCreateBadge(true)}>
                        {isEnglish ? '+ Create Badge' : '+ 创建徽章'}
                    </button>
                )}

                {badgeDefs.length === 0 && !showCreateBadge && (
                    <p className="admin-no-results">
                        {isEnglish ? 'No badges yet. Create one above.' : '暂无徽章，点击上方按钮创建。'}
                    </p>
                )}
                {badgeDefs.length > 0 && (
                    <div className="admin-event-grid">
                        {badgeDefs.map(bd => (
                            <button key={bd.id} className="admin-event-card" onClick={() => selectBadgeDef(bd)}>
                                <img src={bd.imageUrl} alt="" className="admin-event-card-img"/>
                                <div className="admin-event-card-info">
                                    <span className="admin-event-card-title">{isEnglish ? bd.name : bd.nameCn}</span>
                                    <span
                                        className="admin-event-card-date">{isEnglish ? bd.description : bd.descriptionCn}</span>
                                </div>
                            </button>
                        ))}
                    </div>
                )}
            </div>
        );
    }

    // Badge detail view
    return (
        <div className="admin-section">
            <div className="admin-event-detail">
                <button className="admin-back-btn" onClick={() => {
                    setSelectedBadgeDef(null);
                    setBadgeHolders([]);
                    setEditingBadgeDef(false);
                }}>
                    &larr; {isEnglish ? 'All Badges' : '所有徽章'}
                </button>

                <div className="admin-event-detail-header">
                    <img src={selectedBadgeDef.imageUrl} alt="" className="admin-event-detail-img"/>
                    <div>
                        <h3>{isEnglish ? selectedBadgeDef.name : selectedBadgeDef.nameCn}</h3>
                        <p className="admin-event-detail-meta">
                            {isEnglish ? selectedBadgeDef.description : selectedBadgeDef.descriptionCn}
                        </p>
                        {selectedBadgeDef.createdByName && (
                            <p className="admin-event-detail-meta admin-mt-4">
                                {isEnglish ? 'Created by: ' : '创建者：'}
                                {selectedBadgeDef.createdByUid ? (
                                    <a href={`/profile?uid=${selectedBadgeDef.createdByUid}`}
                                       className="admin-creator-link">
                                        {selectedBadgeDef.createdByName}
                                    </a>
                                ) : (selectedBadgeDef.createdByLink && isValidHttpUrl(selectedBadgeDef.createdByLink)) ? (
                                    <a href={selectedBadgeDef.createdByLink} target="_blank" rel="noopener noreferrer"
                                       className="admin-creator-link">
                                        {selectedBadgeDef.createdByName}
                                    </a>
                                ) : selectedBadgeDef.createdByName}
                            </p>
                        )}
                    </div>
                </div>

                {editingBadgeDef ? (
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
                            <CreatorPicker
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
                                onFileChange={(file, url) => setEditForm(f => ({...f, image: file, imagePreview: url}))}
                                onCleanupPreview={url => URL.revokeObjectURL(url)}
                            />
                        </div>
                        <div className="admin-form-actions">
                            <button className="admin-generate-btn" onClick={updateBadgeDef}
                                    disabled={savingBadgeDef || !editForm.name.trim()}>
                                {savingBadgeDef ? (isEnglish ? 'Saving...' : '保存中...') : (isEnglish ? 'Save Changes' : '保存更改')}
                            </button>
                            <button className="admin-back-btn" onClick={() => {
                                setEditingBadgeDef(false);
                                if (editForm.imagePreview?.startsWith('blob:')) URL.revokeObjectURL(editForm.imagePreview);
                                setEditForm(emptyBadgeForm);
                            }}>
                                {isEnglish ? 'Cancel' : '取消'}
                            </button>
                        </div>
                    </div>
                ) : (
                    <div className="admin-form-actions admin-section-mb">
                        <button className="admin-generate-btn" onClick={startEditBadge}>
                            {isEnglish ? 'Edit Badge' : '编辑徽章'}
                        </button>
                        <button className="admin-toggle-btn admin-toggle-revoke"
                                onClick={() => deleteBadgeDef(selectedBadgeDef)}
                                disabled={deletingId === selectedBadgeDef.id}>
                            {deletingId === selectedBadgeDef.id
                                ? (isEnglish ? 'Deleting...' : '删除中...')
                                : (isEnglish ? 'Delete Badge' : '删除徽章')}
                        </button>
                    </div>
                )}

                <h4 className="admin-badges-title">
                    {isEnglish ? 'Badge Holders' : '徽章持有者'}
                    {badgeHolders.length > 0 && <span className="admin-badges-count">{badgeHolders.length}</span>}
                </h4>

                {loadingBadgeHolders && <div className="profile-spinner admin-spinner-center"/>}
                {!loadingBadgeHolders && badgeHolders.length === 0 && (
                    <p className="admin-no-results">{isEnglish ? 'No one has this badge yet.' : '暂无人持有此徽章。'}</p>
                )}
                {!loadingBadgeHolders && badgeHolders.map((u) => (
                    <div key={u.uid} className="admin-user-row">
                        <img src={u.photoURL} alt="" className="admin-user-avatar" referrerPolicy="no-referrer"/>
                        <div>
                            <div className="admin-user-name">{u.displayName}</div>
                            <div className="admin-user-email">{u.email}</div>
                        </div>
                        <span className="admin-user-group-tag" data-group={u.group}>
                            {isEnglish ? GROUP_LABELS[u.group].en : GROUP_LABELS[u.group].zh}
                        </span>
                    </div>
                ))}
                {!loadingBadgeHolders && hasMoreBadgeHolders && badgeHolders.length > 0 && (
                    <button
                        className="admin-load-more-btn"
                        onClick={() => loadBadgeHolders(selectedBadgeDef.id, badgeHolderLastDoc ?? undefined)}
                    >
                        {isEnglish ? 'Load More' : '加载更多'}
                    </button>
                )}

                {/* Activation Codes */}
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
                                    className="admin-search-input"
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
                            <span>{isEnglish ? 'Active From' : '生效时间'}</span>
                            <input type="datetime-local" value={newCodeFrom}
                                   onChange={e => setNewCodeFrom(e.target.value)} className="admin-search-input"/>
                        </label>
                        <label>
                            <span>{isEnglish ? 'Active Until' : '失效时间'}</span>
                            <input type="datetime-local" value={newCodeUntil}
                                   onChange={e => setNewCodeUntil(e.target.value)} className="admin-search-input"/>
                        </label>
                    </div>
                    <button
                        className="admin-generate-btn admin-mt-12"
                        onClick={() => createBadgeActivationCode(selectedBadgeDef.id)}
                        disabled={generatingActivationCode}>
                        {generatingActivationCode
                            ? (isEnglish ? 'Generating...' : '生成中...')
                            : (isEnglish ? '+ Generate Activation Code' : '+ 生成激活码')}
                    </button>
                </div>

                {loadingActivationCodes && <div className="profile-spinner admin-spinner-center"/>}
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
                                    {isEnglish ? 'From: ' : '从：'}{new Date(ac.activeFrom).toLocaleString()}
                                </span>
                            )}
                            {ac.activeUntil && (
                                <span className="admin-activation-time">
                                    {isEnglish ? 'Until: ' : '至：'}{new Date(ac.activeUntil).toLocaleString()}
                                </span>
                            )}
                        </div>
                        <div className="admin-code-url">
                            <input readOnly value={ac.code} className="admin-code-input"/>
                            <button className="admin-copy-btn" onClick={() => navigator.clipboard.writeText(ac.code)}>
                                {isEnglish ? 'Copy' : '复制'}
                            </button>
                        </div>
                        <div className="admin-single-code-actions">
                            <button className="admin-toggle-btn admin-toggle-grant"
                                    onClick={() => toggleActivationCodeActive(ac)}>
                                {ac.active ? (isEnglish ? 'Deactivate' : '停用') : (isEnglish ? 'Activate' : '激活')}
                            </button>
                            <button className="admin-toggle-btn admin-toggle-revoke"
                                    onClick={() => deleteActivationCode(ac)}>
                                {isEnglish ? 'Delete' : '删除'}
                            </button>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
});

BadgesTab.displayName = 'BadgesTab';
