import { forwardRef, useImperativeHandle, useState } from 'react';
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
    serverTimestamp,
    startAfter,
    where,
    writeBatch,
} from 'firebase/firestore';
import { getDownloadURL, ref as storageRef, uploadBytes } from 'firebase/storage';
import type { User } from 'firebase/auth';
import { GROUP_LABELS, type UserProfile } from '~/components/AuthProvider';
import { useLanguage } from '~/components/LanguageContextProvider';
import { callGenerateBadgeActivationCode, getFirebaseDb, getFirebaseStorage } from '~/lib/firebase';
import type { BadgeActivationCode, BadgeDef, UserRecord } from './types';
import { docToUserRecord, isValidHttpUrl, validateImageFile } from './utils';
import { CreatorPicker } from './CreatorPicker';

interface BadgesTabProps {
    badgeDefs: BadgeDef[];
    setBadgeDefs: React.Dispatch<React.SetStateAction<BadgeDef[]>>;
    user: User;
    profile: UserProfile;
}

export interface BadgesTabHandle {
    selectBadgeById: (badgeId: string) => void;
}

export const BadgesTab = forwardRef<BadgesTabHandle, BadgesTabProps>(({
    badgeDefs, setBadgeDefs, user, profile,
}, ref) => {
    const { isEnglish } = useLanguage();

    const BADGE_HOLDER_PAGE_SIZE = 20;

    // Badge list state
    const [selectedBadgeDef, setSelectedBadgeDef] = useState<BadgeDef | null>(null);
    const [badgeHolders, setBadgeHolders] = useState<UserRecord[]>([]);
    const [loadingBadgeHolders, setLoadingBadgeHolders] = useState(false);
    const [badgeHolderLastDoc, setBadgeHolderLastDoc] = useState<DocumentSnapshot | null>(null);
    const [hasMoreBadgeHolders, setHasMoreBadgeHolders] = useState(false);

    // Create badge state
    const [showCreateBadge, setShowCreateBadge] = useState(false);
    const [newBadgeName, setNewBadgeName] = useState('');
    const [newBadgeNameCn, setNewBadgeNameCn] = useState('');
    const [newBadgeDesc, setNewBadgeDesc] = useState('');
    const [newBadgeDescCn, setNewBadgeDescCn] = useState('');
    const [newBadgeImage, setNewBadgeImage] = useState<File | null>(null);
    const [newBadgeImagePreview, setNewBadgeImagePreview] = useState<string | null>(null);
    const [creatingBadgeDef, setCreatingBadgeDef] = useState(false);
    const [newBadgeCreatorUser, setNewBadgeCreatorUser] = useState<UserRecord | null>(null);
    const [newBadgeCreatedByName, setNewBadgeCreatedByName] = useState('');
    const [newBadgeCreatedByLink, setNewBadgeCreatedByLink] = useState('');

    // Edit badge state
    const [editingBadgeDef, setEditingBadgeDef] = useState(false);
    const [editBadgeName, setEditBadgeName] = useState('');
    const [editBadgeNameCn, setEditBadgeNameCn] = useState('');
    const [editBadgeDesc, setEditBadgeDesc] = useState('');
    const [editBadgeDescCn, setEditBadgeDescCn] = useState('');
    const [editBadgeCreatorUser, setEditBadgeCreatorUser] = useState<UserRecord | null>(null);
    const [editBadgeCreatedByName, setEditBadgeCreatedByName] = useState('');
    const [editBadgeCreatedByLink, setEditBadgeCreatedByLink] = useState('');
    const [editBadgeImage, setEditBadgeImage] = useState<File | null>(null);
    const [editBadgeImagePreview, setEditBadgeImagePreview] = useState<string | null>(null);
    const [savingBadgeDef, setSavingBadgeDef] = useState(false);

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
        const creatorLink = newBadgeCreatorUser ? '' : newBadgeCreatedByLink.trim();
        if (creatorLink && !isValidHttpUrl(creatorLink)) {
            alert(isEnglish ? 'Creator link must be a valid URL (http/https).' : '创建者链接必须是有效的网址（http/https）。');
            return;
        }
        setCreatingBadgeDef(true);
        try {
            let imageUrl = '/images/mika.png';
            if (newBadgeImage) {
                const imageId = crypto.randomUUID();
                const sRef = storageRef(getFirebaseStorage(), `badges/${imageId}.webp`);
                await uploadBytes(sRef, newBadgeImage);
                imageUrl = await getDownloadURL(sRef);
            }

            const db = getFirebaseDb();
            const creatorUid = newBadgeCreatorUser?.uid ?? '';
            const creatorName = newBadgeCreatorUser?.displayName ?? newBadgeCreatedByName.trim();

            const batch = writeBatch(db);
            const newDocRef = doc(collection(db, 'badges'));
            batch.set(newDocRef, {
                name: newBadgeName.trim(),
                nameCn: newBadgeNameCn.trim(),
                description: newBadgeDesc.trim(),
                descriptionCn: newBadgeDescCn.trim(),
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
                badgeName: newBadgeName.trim(),
                timestamp: serverTimestamp(),
            });
            await batch.commit();

            setBadgeDefs(prev => [...prev, {
                id: newDocRef.id,
                name: newBadgeName.trim(),
                nameCn: newBadgeNameCn.trim(),
                description: newBadgeDesc.trim(),
                descriptionCn: newBadgeDescCn.trim(),
                imageUrl,
                createdBy: user.uid,
                createdByUid: creatorUid,
                createdByName: creatorName,
                createdByLink: creatorLink,
                createdAt: new Date(),
            }]);

            resetCreateForm();
        } catch {
            alert(isEnglish ? 'Failed to create badge.' : '创建徽章失败。');
        } finally {
            setCreatingBadgeDef(false);
        }
    };

    const resetCreateForm = () => {
        setNewBadgeName('');
        setNewBadgeNameCn('');
        setNewBadgeDesc('');
        setNewBadgeDescCn('');
        setNewBadgeImage(null);
        if (newBadgeImagePreview?.startsWith('blob:')) URL.revokeObjectURL(newBadgeImagePreview);
        setNewBadgeImagePreview(null);
        setNewBadgeCreatorUser(null);
        setNewBadgeCreatedByName('');
        setNewBadgeCreatedByLink('');
        setShowCreateBadge(false);
    };

    const deleteBadgeDef = async (bd: BadgeDef) => {
        if (!confirm(isEnglish
            ? `Delete badge "${bd.name}"? This cannot be undone.`
            : `删除徽章"${bd.name}"？此操作不可撤销。`
        )) return;
        try {
            const db = getFirebaseDb();

            // Find orphaned activation codes to clean up
            const codesSnap = await getDocs(query(
                collection(db, 'badgeActivationCodes'), where('badgeId', '==', bd.id),
            ));

            const batch = writeBatch(db);
            batch.delete(doc(db, 'badges', bd.id));
            batch.set(doc(collection(db, 'records')), {
                type: 'badge-delete',
                performedBy: user.uid,
                performedByName: profile.displayName,
                badgeId: bd.id,
                badgeName: bd.name,
                timestamp: serverTimestamp(),
            });
            for (const codeDoc of codesSnap.docs) {
                batch.delete(codeDoc.ref);
            }
            await batch.commit();

            setBadgeDefs(prev => prev.filter(d => d.id !== bd.id));
            setSelectedBadgeDef(null);
        } catch {
            alert(isEnglish ? 'Failed to delete badge.' : '删除徽章失败。');
        }
    };

    const updateBadgeDef = async () => {
        if (!selectedBadgeDef) return;
        const creatorLink = editBadgeCreatorUser ? '' : editBadgeCreatedByLink.trim();
        if (creatorLink && !isValidHttpUrl(creatorLink)) {
            alert(isEnglish ? 'Creator link must be a valid URL (http/https).' : '创建者链接必须是有效的网址（http/https）。');
            return;
        }
        setSavingBadgeDef(true);
        try {
            const db = getFirebaseDb();
            const creatorUid = editBadgeCreatorUser?.uid ?? '';
            const creatorName = editBadgeCreatorUser?.displayName ?? editBadgeCreatedByName.trim();
            const updates: Record<string, string> = {
                name: editBadgeName.trim(),
                nameCn: editBadgeNameCn.trim(),
                description: editBadgeDesc.trim(),
                descriptionCn: editBadgeDescCn.trim(),
                createdByUid: creatorUid,
                createdByName: creatorName,
                createdByLink: creatorLink,
            };

            if (editBadgeImage) {
                const imageId = crypto.randomUUID();
                const sRef = storageRef(getFirebaseStorage(), `badges/${imageId}.webp`);
                await uploadBytes(sRef, editBadgeImage);
                updates.imageUrl = await getDownloadURL(sRef);
            }

            const batch = writeBatch(db);
            batch.update(doc(db, 'badges', selectedBadgeDef.id), updates);
            batch.set(doc(collection(db, 'records')), {
                type: 'badge-edit',
                performedBy: user.uid,
                performedByName: profile.displayName,
                badgeId: selectedBadgeDef.id,
                badgeName: editBadgeName.trim(),
                timestamp: serverTimestamp(),
            });
            await batch.commit();

            const updated = { ...selectedBadgeDef, ...updates };
            setBadgeDefs(prev => prev.map(d => d.id === selectedBadgeDef.id ? updated : d));
            setSelectedBadgeDef(updated);
            setEditingBadgeDef(false);
            setEditBadgeImage(null);
            if (editBadgeImagePreview?.startsWith('blob:')) URL.revokeObjectURL(editBadgeImagePreview);
            setEditBadgeImagePreview(null);
        } catch {
            alert(isEnglish ? 'Failed to save badge.' : '保存徽章失败。');
        } finally {
            setSavingBadgeDef(false);
        }
    };

    const startEditBadge = async () => {
        if (!selectedBadgeDef) return;
        setEditBadgeName(selectedBadgeDef.name);
        setEditBadgeNameCn(selectedBadgeDef.nameCn);
        setEditBadgeDesc(selectedBadgeDef.description);
        setEditBadgeDescCn(selectedBadgeDef.descriptionCn);
        setEditBadgeImage(null);
        setEditBadgeImagePreview(null);

        if (selectedBadgeDef.createdByUid) {
            const db = getFirebaseDb();
            const snap = await getDoc(doc(db, 'users', selectedBadgeDef.createdByUid));
            if (snap.exists()) {
                setEditBadgeCreatorUser(docToUserRecord(snap));
            } else {
                setEditBadgeCreatorUser(null);
                setEditBadgeCreatedByName(selectedBadgeDef.createdByName);
                setEditBadgeCreatedByLink(selectedBadgeDef.createdByLink);
            }
        } else {
            setEditBadgeCreatorUser(null);
            setEditBadgeCreatedByName(selectedBadgeDef.createdByName);
            setEditBadgeCreatedByLink(selectedBadgeDef.createdByLink);
        }
        setEditingBadgeDef(true);
    };

    const createBadgeActivationCode = async (badgeId: string) => {
        setGeneratingActivationCode(true);
        try {
            const params: { badgeId: string; maxUses: number; activeFrom?: string; activeUntil?: string } = {
                badgeId,
                maxUses: newCodeMaxUses,
            };
            if (newCodeFrom) params.activeFrom = new Date(newCodeFrom).toISOString();
            if (newCodeUntil) params.activeUntil = new Date(newCodeUntil).toISOString();

            const result = await callGenerateBadgeActivationCode(params);
            const { id, code } = result.data;

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
            alert(isEnglish ? 'Failed to generate code.' : '生成激活码失败。');
        } finally {
            setGeneratingActivationCode(false);
        }
    };

    const toggleActivationCodeActive = async (ac: BadgeActivationCode) => {
        const newActive = !ac.active;
        setBadgeActivationCodes(prev => prev.map(c => c.id === ac.id ? { ...c, active: newActive } : c));
        try {
            const db = getFirebaseDb();
            const bd = badgeDefs.find(d => d.id === ac.badgeId);
            const batch = writeBatch(db);
            batch.update(doc(db, 'badgeActivationCodes', ac.id), { active: newActive });
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
            setBadgeActivationCodes(prev => prev.map(c => c.id === ac.id ? { ...c, active: ac.active } : c));
            alert(isEnglish ? 'Failed to update code status.' : '更新激活码状态失败。');
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
            alert(isEnglish ? 'Failed to delete code.' : '删除激活码失败。');
        }
    };

    const handleNewImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        if (!validateImageFile(file, isEnglish)) { e.target.value = ''; return; }
        setNewBadgeImage(file);
        if (newBadgeImagePreview?.startsWith('blob:')) URL.revokeObjectURL(newBadgeImagePreview);
        setNewBadgeImagePreview(URL.createObjectURL(file));
    };

    const handleEditImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        if (!validateImageFile(file, isEnglish)) { e.target.value = ''; return; }
        setEditBadgeImage(file);
        if (editBadgeImagePreview?.startsWith('blob:')) URL.revokeObjectURL(editBadgeImagePreview);
        setEditBadgeImagePreview(URL.createObjectURL(file));
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
                            <label>
                                <span>{isEnglish ? 'Name (English)' : '名称（英文）'}</span>
                                <input value={newBadgeName} onChange={e => setNewBadgeName(e.target.value)} className="admin-search-input" placeholder={isEnglish ? 'Badge name' : '徽章名称'} />
                            </label>
                            <label>
                                <span>{isEnglish ? 'Name (Chinese)' : '名称（中文）'}</span>
                                <input value={newBadgeNameCn} onChange={e => setNewBadgeNameCn(e.target.value)} className="admin-search-input" placeholder={isEnglish ? 'Badge name in Chinese' : '徽章中文名称'} />
                            </label>
                            <label>
                                <span>{isEnglish ? 'Description (English)' : '描述（英文）'}</span>
                                <textarea value={newBadgeDesc} onChange={e => setNewBadgeDesc(e.target.value)} className="admin-search-input admin-textarea" placeholder={isEnglish ? 'Badge description' : '徽章描述'} />
                            </label>
                            <label>
                                <span>{isEnglish ? 'Description (Chinese)' : '描述（中文）'}</span>
                                <textarea value={newBadgeDescCn} onChange={e => setNewBadgeDescCn(e.target.value)} className="admin-search-input admin-textarea" placeholder={isEnglish ? 'Badge description in Chinese' : '徽章中文描述'} />
                            </label>
                            <CreatorPicker
                                selected={newBadgeCreatorUser}
                                onSelect={setNewBadgeCreatorUser}
                                manualName={newBadgeCreatedByName}
                                onManualNameChange={setNewBadgeCreatedByName}
                                manualLink={newBadgeCreatedByLink}
                                onManualLinkChange={setNewBadgeCreatedByLink}
                            />
                            <label>
                                <span>{isEnglish ? 'Badge Image' : '徽章图片'}</span>
                                <input type="file" accept="image/webp" onChange={handleNewImageChange} />
                                {newBadgeImagePreview && <img src={newBadgeImagePreview} alt="" className="admin-badge-image-preview" />}
                            </label>
                        </div>
                        <div className="admin-form-actions">
                            <button className="admin-generate-btn" onClick={createBadgeDef} disabled={creatingBadgeDef || !newBadgeName.trim()}>
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
                                <img src={bd.imageUrl} alt="" className="admin-event-card-img" />
                                <div className="admin-event-card-info">
                                    <span className="admin-event-card-title">{isEnglish ? bd.name : bd.nameCn}</span>
                                    <span className="admin-event-card-date">{isEnglish ? bd.description : bd.descriptionCn}</span>
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
                    <img src={selectedBadgeDef.imageUrl} alt="" className="admin-event-detail-img" />
                    <div>
                        <h3>{isEnglish ? selectedBadgeDef.name : selectedBadgeDef.nameCn}</h3>
                        <p className="admin-event-detail-meta">
                            {isEnglish ? selectedBadgeDef.description : selectedBadgeDef.descriptionCn}
                        </p>
                        {selectedBadgeDef.createdByName && (
                            <p className="admin-event-detail-meta" style={{ marginTop: '4px' }}>
                                {isEnglish ? 'Created by: ' : '创建者：'}
                                {selectedBadgeDef.createdByUid ? (
                                    <a href={`/profile?uid=${selectedBadgeDef.createdByUid}`} style={{ color: '#6c63ff' }}>
                                        {selectedBadgeDef.createdByName}
                                    </a>
                                ) : selectedBadgeDef.createdByLink ? (
                                    <a href={selectedBadgeDef.createdByLink} target="_blank" rel="noopener noreferrer" style={{ color: '#6c63ff' }}>
                                        {selectedBadgeDef.createdByName}
                                    </a>
                                ) : selectedBadgeDef.createdByName}
                            </p>
                        )}
                    </div>
                </div>

                {editingBadgeDef ? (
                    <div className="admin-create-badge-form" style={{ marginBottom: '20px' }}>
                        <h4 className="admin-badges-title">{isEnglish ? 'Edit Badge' : '编辑徽章'}</h4>
                        <div className="admin-form-grid">
                            <label>
                                <span>{isEnglish ? 'Name (English)' : '名称（英文）'}</span>
                                <input value={editBadgeName} onChange={e => setEditBadgeName(e.target.value)} className="admin-search-input" />
                            </label>
                            <label>
                                <span>{isEnglish ? 'Name (Chinese)' : '名称（中文）'}</span>
                                <input value={editBadgeNameCn} onChange={e => setEditBadgeNameCn(e.target.value)} className="admin-search-input" />
                            </label>
                            <label>
                                <span>{isEnglish ? 'Description (English)' : '描述（英文）'}</span>
                                <textarea value={editBadgeDesc} onChange={e => setEditBadgeDesc(e.target.value)} className="admin-search-input admin-textarea" />
                            </label>
                            <label>
                                <span>{isEnglish ? 'Description (Chinese)' : '描述（中文）'}</span>
                                <textarea value={editBadgeDescCn} onChange={e => setEditBadgeDescCn(e.target.value)} className="admin-search-input admin-textarea" />
                            </label>
                            <CreatorPicker
                                selected={editBadgeCreatorUser}
                                onSelect={(u) => {
                                    setEditBadgeCreatorUser(u);
                                    if (!u) { setEditBadgeCreatedByName(''); setEditBadgeCreatedByLink(''); }
                                }}
                                manualName={editBadgeCreatedByName}
                                onManualNameChange={setEditBadgeCreatedByName}
                                manualLink={editBadgeCreatedByLink}
                                onManualLinkChange={setEditBadgeCreatedByLink}
                            />
                            <label>
                                <span>{isEnglish ? 'Badge Image' : '徽章图片'}</span>
                                <input type="file" accept="image/webp" onChange={handleEditImageChange} />
                                {editBadgeImagePreview && <img src={editBadgeImagePreview} alt="" className="admin-badge-image-preview" />}
                            </label>
                        </div>
                        <div className="admin-form-actions">
                            <button className="admin-generate-btn" onClick={updateBadgeDef} disabled={savingBadgeDef || !editBadgeName.trim()}>
                                {savingBadgeDef ? (isEnglish ? 'Saving...' : '保存中...') : (isEnglish ? 'Save Changes' : '保存更改')}
                            </button>
                            <button className="admin-back-btn" onClick={() => {
                                setEditingBadgeDef(false);
                                setEditBadgeImage(null);
                                if (editBadgeImagePreview?.startsWith('blob:')) URL.revokeObjectURL(editBadgeImagePreview);
                                setEditBadgeImagePreview(null);
                            }}>
                                {isEnglish ? 'Cancel' : '取消'}
                            </button>
                        </div>
                    </div>
                ) : (
                    <div className="admin-form-actions" style={{ marginBottom: '20px' }}>
                        <button className="admin-generate-btn" onClick={startEditBadge}>
                            {isEnglish ? 'Edit Badge' : '编辑徽章'}
                        </button>
                        <button className="admin-toggle-btn admin-toggle-revoke" onClick={() => deleteBadgeDef(selectedBadgeDef)}>
                            {isEnglish ? 'Delete Badge' : '删除徽章'}
                        </button>
                    </div>
                )}

                <h4 className="admin-badges-title">
                    {isEnglish ? 'Badge Holders' : '徽章持有者'}
                    {badgeHolders.length > 0 && <span className="admin-badges-count">{badgeHolders.length}</span>}
                </h4>

                {loadingBadgeHolders && <div className="profile-spinner" style={{ margin: '20px auto' }} />}
                {!loadingBadgeHolders && badgeHolders.length === 0 && (
                    <p className="admin-no-results">{isEnglish ? 'No one has this badge yet.' : '暂无人持有此徽章。'}</p>
                )}
                {!loadingBadgeHolders && badgeHolders.map((u) => (
                    <div key={u.uid} className="admin-user-row">
                        <img src={u.photoURL} alt="" className="admin-user-avatar" referrerPolicy="no-referrer" />
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
                <h4 className="admin-badges-title" style={{ marginTop: '28px' }}>
                    {isEnglish ? 'Activation Codes' : '激活码'}
                    {badgeActivationCodes.length > 0 && <span className="admin-badges-count">{badgeActivationCodes.length}</span>}
                </h4>

                <div className="admin-activation-create-form">
                    <div className="admin-code-time-inputs">
                        <label>
                            <span>{isEnglish ? 'Max Uses' : '最大使用次数'}</span>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
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
                                <label style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '13px', whiteSpace: 'nowrap' }}>
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
                            <input type="datetime-local" value={newCodeFrom} onChange={e => setNewCodeFrom(e.target.value)} className="admin-search-input" />
                        </label>
                        <label>
                            <span>{isEnglish ? 'Active Until' : '失效时间'}</span>
                            <input type="datetime-local" value={newCodeUntil} onChange={e => setNewCodeUntil(e.target.value)} className="admin-search-input" />
                        </label>
                    </div>
                    <button
                        className="admin-generate-btn"
                        onClick={() => createBadgeActivationCode(selectedBadgeDef.id)}
                        disabled={generatingActivationCode}
                        style={{ marginTop: '12px' }}
                    >
                        {generatingActivationCode
                            ? (isEnglish ? 'Generating...' : '生成中...')
                            : (isEnglish ? '+ Generate Activation Code' : '+ 生成激活码')}
                    </button>
                </div>

                {loadingActivationCodes && <div className="profile-spinner" style={{ margin: '20px auto' }} />}
                {!loadingActivationCodes && badgeActivationCodes.length === 0 && (
                    <p className="admin-no-results">{isEnglish ? 'No activation codes yet.' : '暂无激活码。'}</p>
                )}

                {!loadingActivationCodes && badgeActivationCodes.map((ac) => (
                    <div key={ac.id} className="admin-single-code" style={{ marginTop: '12px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                            <span className={ac.active ? 'admin-code-active-tag' : 'admin-code-inactive-tag'}>
                                {ac.active ? (isEnglish ? 'Active' : '活跃') : (isEnglish ? 'Inactive' : '已停用')}
                            </span>
                            <span style={{ fontSize: '13px', color: '#7a8190' }}>
                                {ac.maxUses === 0
                                    ? (isEnglish ? `Used ${ac.usedCount} / ∞ times` : `已使用 ${ac.usedCount} / ∞ 次`)
                                    : (isEnglish ? `Used ${ac.usedCount} / ${ac.maxUses} times` : `已使用 ${ac.usedCount} / ${ac.maxUses} 次`)}
                            </span>
                            {ac.activeFrom && (
                                <span style={{ fontSize: '12px', color: '#999' }}>
                                    {isEnglish ? 'From: ' : '从：'}{new Date(ac.activeFrom).toLocaleString()}
                                </span>
                            )}
                            {ac.activeUntil && (
                                <span style={{ fontSize: '12px', color: '#999' }}>
                                    {isEnglish ? 'Until: ' : '至：'}{new Date(ac.activeUntil).toLocaleString()}
                                </span>
                            )}
                        </div>
                        <div className="admin-code-url">
                            <input readOnly value={ac.code} className="admin-code-input" />
                            <button className="admin-copy-btn" onClick={() => navigator.clipboard.writeText(ac.code)}>
                                {isEnglish ? 'Copy' : '复制'}
                            </button>
                        </div>
                        <div className="admin-single-code-actions">
                            <button className="admin-toggle-btn admin-toggle-grant" onClick={() => toggleActivationCodeActive(ac)}>
                                {ac.active ? (isEnglish ? 'Deactivate' : '停用') : (isEnglish ? 'Activate' : '激活')}
                            </button>
                            <button className="admin-toggle-btn admin-toggle-revoke" onClick={() => deleteActivationCode(ac)}>
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
