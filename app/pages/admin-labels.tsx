import { useEffect, useState } from 'react';
import { addDoc, collection, deleteDoc, doc, getDocs, serverTimestamp, updateDoc } from 'firebase/firestore';
import { hasPermission, useAuth } from '~/components/AuthProvider';
import { LoginButton } from '~/components/LoginButton';
import { useLanguage } from '~/components/LanguageContextProvider';
import { getFirebaseDb } from '~/lib/firebase';
import { LanguageSwitcher } from '~/components/LanguageSwitcher';

interface EventLabel {
    id: string;
    name: string;
    nameCn: string;
}

export const AdminLabelsPage = () => {
    const {user, profile, loading} = useAuth();
    const {isEnglish} = useLanguage();

    const [labels, setLabels] = useState<EventLabel[]>([]);
    const [loadingLabels, setLoadingLabels] = useState(true);
    const [newName, setNewName] = useState('');
    const [newNameCn, setNewNameCn] = useState('');
    const [saving, setSaving] = useState(false);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editName, setEditName] = useState('');
    const [editNameCn, setEditNameCn] = useState('');

    useEffect(() => {
        if (loading || !user || !profile || !hasPermission(profile.group, 'core-staff')) return;
        const load = async () => {
            const db = getFirebaseDb();
            const snapshot = await getDocs(collection(db, 'eventLabels'));
            setLabels(snapshot.docs.map(d => ({id: d.id, name: d.data().name ?? '', nameCn: d.data().nameCn ?? ''})));
            setLoadingLabels(false);
        };
        load().then();
    }, [loading, user, profile]);

    if (loading) {
        return (
            <div className="profile-loading">
                <div className="profile-spinner"/>
            </div>
        );
    }

    if (!user || !profile || !hasPermission(profile.group, 'core-staff')) {
        return (
            <div className="profile-login-prompt">
                <div className="profile-login-card">
                    <h2>{isEnglish ? 'Access Denied' : '无权访问'}</h2>
                    <p>{isEnglish ? 'This page is for staff members only.' : '此页面仅限工作人员访问。'}</p>
                    <a href="/" className="profile-back-link">
                        {isEnglish ? 'Back to Home' : '返回首页'}
                    </a>
                </div>
            </div>
        );
    }

    const createLabel = async () => {
        if (!newName.trim()) return;
        setSaving(true);
        try {
            const db = getFirebaseDb();
            const docRef = await addDoc(collection(db, 'eventLabels'), {
                name: newName.trim(),
                nameCn: newNameCn.trim(),
            });
            setLabels(prev => [...prev, {id: docRef.id, name: newName.trim(), nameCn: newNameCn.trim()}]);
            await addDoc(collection(db, 'records'), {
                type: 'label-create',
                performedBy: user.uid,
                performedByName: profile.displayName,
                labelName: newName.trim(),
                timestamp: serverTimestamp(),
            });
            setNewName('');
            setNewNameCn('');
        } finally {
            setSaving(false);
        }
    };

    const saveEdit = async (labelId: string) => {
        if (!editName.trim()) return;
        const db = getFirebaseDb();
        await updateDoc(doc(db, 'eventLabels', labelId), {name: editName.trim(), nameCn: editNameCn.trim()});
        setLabels(prev => prev.map(l => l.id === labelId ? {
            ...l,
            name: editName.trim(),
            nameCn: editNameCn.trim()
        } : l));
        await addDoc(collection(db, 'records'), {
            type: 'label-edit',
            performedBy: user.uid,
            performedByName: profile.displayName,
            labelName: editName.trim(),
            timestamp: serverTimestamp(),
        });
        setEditingId(null);
    };

    const deleteLabel = async (labelId: string) => {
        const label = labels.find(l => l.id === labelId);
        const db = getFirebaseDb();
        await deleteDoc(doc(db, 'eventLabels', labelId));
        setLabels(prev => prev.filter(l => l.id !== labelId));
        await addDoc(collection(db, 'records'), {
            type: 'label-delete',
            performedBy: user.uid,
            performedByName: profile.displayName,
            labelName: label?.name ?? '',
            timestamp: serverTimestamp(),
        });
    };

    return (
        <>
            <nav className="profile-nav">
                <a href="/" className="profile-nav-home">
                    {isEnglish ? 'SEKAI BEYOND' : '彼世界动漫社'}
                </a>
                <span className="admin-nav-title">{isEnglish ? 'Event Labels' : '活动标签'}</span>
                <div className="nav-actions">
                    <LanguageSwitcher/>
                    <LoginButton/>
                </div>
            </nav>
            <div className="profile-page">
                <div className="admin-section">
                    <div style={{marginBottom: '16px'}}>
                        <a href="/admin?tab=events" className="admin-back-btn">
                            &larr; {isEnglish ? 'Back to Events' : '返回活动管理'}
                        </a>
                    </div>

                    <h4 className="admin-badges-title" style={{marginBottom: '16px'}}>
                        {isEnglish ? 'Create New Label' : '创建新标签'}
                    </h4>
                    <div style={{
                        display: 'flex',
                        gap: '8px',
                        alignItems: 'flex-end',
                        flexWrap: 'wrap',
                        marginBottom: '24px'
                    }}>
                        <input
                            value={newName}
                            onChange={e => setNewName(e.target.value)}
                            className="admin-search-input"
                            placeholder={isEnglish ? 'English name' : '英文名称'}
                            style={{flex: 1, minWidth: '120px'}}
                            onKeyDown={e => e.key === 'Enter' && createLabel()}
                        />
                        <input
                            value={newNameCn}
                            onChange={e => setNewNameCn(e.target.value)}
                            className="admin-search-input"
                            placeholder={isEnglish ? 'Chinese name' : '中文名称'}
                            style={{flex: 1, minWidth: '120px'}}
                            onKeyDown={e => e.key === 'Enter' && createLabel()}
                        />
                        <button
                            className="admin-generate-btn"
                            onClick={createLabel}
                            disabled={saving || !newName.trim()}
                        >
                            {saving ? '...' : (isEnglish ? '+ Create' : '+ 创建')}
                        </button>
                    </div>

                    <h4 className="admin-badges-title" style={{marginBottom: '16px'}}>
                        {isEnglish ? `All Labels (${labels.length})` : `所有标签 (${labels.length})`}
                    </h4>

                    {loadingLabels ? (
                        <div className="profile-loading">
                            <div className="profile-spinner"/>
                        </div>
                    ) : labels.length === 0 ? (
                        <p style={{color: '#999', textAlign: 'center'}}>
                            {isEnglish ? 'No labels yet.' : '暂无标签。'}
                        </p>
                    ) : (
                        <div style={{display: 'flex', flexDirection: 'column', gap: '8px'}}>
                            {labels.map(l => (
                                <div key={l.id} className="admin-badge-row">
                                    {editingId === l.id ? (
                                        <>
                                            <input
                                                value={editName}
                                                onChange={e => setEditName(e.target.value)}
                                                className="admin-search-input"
                                                style={{flex: 1, minWidth: '80px'}}
                                                onKeyDown={e => e.key === 'Enter' && saveEdit(l.id)}
                                            />
                                            <input
                                                value={editNameCn}
                                                onChange={e => setEditNameCn(e.target.value)}
                                                className="admin-search-input"
                                                style={{flex: 1, minWidth: '80px'}}
                                                onKeyDown={e => e.key === 'Enter' && saveEdit(l.id)}
                                            />
                                            <button
                                                className="admin-toggle-btn admin-toggle-grant"
                                                onClick={() => saveEdit(l.id)}
                                                disabled={!editName.trim()}
                                            >
                                                {isEnglish ? 'Save' : '保存'}
                                            </button>
                                            <button
                                                className="admin-toggle-btn"
                                                onClick={() => setEditingId(null)}
                                            >
                                                {isEnglish ? 'Cancel' : '取消'}
                                            </button>
                                        </>
                                    ) : (
                                        <>
                                            <div className="admin-badge-info" style={{flex: 1}}>
                                                <span className="admin-badge-name">{l.name}</span>
                                                {l.nameCn && (
                                                    <span className="admin-badge-date">{l.nameCn}</span>
                                                )}
                                            </div>
                                            <button
                                                className="admin-toggle-btn admin-toggle-grant"
                                                onClick={() => {
                                                    setEditingId(l.id);
                                                    setEditName(l.name);
                                                    setEditNameCn(l.nameCn);
                                                }}
                                            >
                                                {isEnglish ? 'Edit' : '编辑'}
                                            </button>
                                            <button
                                                className="admin-toggle-btn admin-toggle-revoke"
                                                onClick={() => deleteLabel(l.id)}
                                            >
                                                {isEnglish ? 'Delete' : '删除'}
                                            </button>
                                        </>
                                    )}
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </>
    );
};
