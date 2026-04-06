import { useState } from 'react';
import { collection, doc, writeBatch } from 'firebase/firestore';
import { useLanguage } from '~/components/LanguageContextProvider';
import { getFirebaseDb } from '~/lib/firebase';
import type { Tag } from '~/lib/tags';

interface TagsTabProps {
    tags: Tag[];
    refreshTags: () => Promise<void>;
}

export const TagsTab = ({tags, refreshTags}: TagsTabProps) => {
    const {isEnglish} = useLanguage();
    const [showCreate, setShowCreate] = useState(false);
    const [name, setName] = useState('');
    const [nameCn, setNameCn] = useState('');
    const [saving, setSaving] = useState(false);

    const [editingTag, setEditingTag] = useState<Tag | null>(null);
    const [editName, setEditName] = useState('');
    const [editNameCn, setEditNameCn] = useState('');
    const [savingEdit, setSavingEdit] = useState(false);

    const createTag = async () => {
        if (!name.trim()) return;
        setSaving(true);
        try {
            const db = getFirebaseDb();
            const newRef = doc(collection(db, 'eventLabels'));
            const batch = writeBatch(db);
            batch.set(newRef, {name: name.trim(), nameCn: nameCn.trim()});
            await batch.commit();
            await refreshTags();
            setName('');
            setNameCn('');
            setShowCreate(false);
        } catch {
            alert(isEnglish ? 'Failed to create tag.' : '创建标签失败。');
        } finally {
            setSaving(false);
        }
    };

    const openEdit = (tag: Tag) => {
        setEditingTag(tag);
        setEditName(tag.name);
        setEditNameCn(tag.nameCn);
    };

    const saveEdit = async () => {
        if (!editingTag || !editName.trim()) return;
        setSavingEdit(true);
        try {
            const db = getFirebaseDb();
            const newName = editName.trim();
            const newNameCn = editNameCn.trim();

            const batch = writeBatch(db);
            batch.update(doc(db, 'eventLabels', editingTag.id), {
                name: newName,
                nameCn: newNameCn,
            });
            await batch.commit();
            await refreshTags();
            setEditingTag(null);
        } catch {
            alert(isEnglish ? 'Failed to save tag.' : '保存标签失败。');
        } finally {
            setSavingEdit(false);
        }
    };

    const deleteTag = async (tag: Tag) => {
        if (!confirm(isEnglish
            ? `Delete tag "${tag.name}"? Events using this tag will show no tag.`
            : `删除标签"${tag.name}"？使用此标签的活动将不显示标签。`
        )) return;
        try {
            const db = getFirebaseDb();
            const batch = writeBatch(db);
            batch.delete(doc(db, 'eventLabels', tag.id));
            await batch.commit();
            await refreshTags();
            if (editingTag?.id === tag.id) setEditingTag(null);
        } catch {
            alert(isEnglish ? 'Failed to delete tag.' : '删除标签失败。');
        }
    };

    return (
        <div className="admin-section">
            {showCreate ? (
                <div className="admin-create-badge-form">
                    <h4 className="admin-badges-title">
                        {isEnglish ? 'Create New Tag' : '创建新标签'}
                    </h4>
                    <div className="admin-form-grid">
                        <label>
                            <span>{isEnglish ? 'Name (English)' : '名称（英文）'}</span>
                            <input
                                value={name}
                                onChange={e => setName(e.target.value)}
                                className="admin-search-input"
                                placeholder={isEnglish ? 'e.g. Workshop' : '例如 Workshop'}
                            />
                        </label>
                        <label>
                            <span>{isEnglish ? 'Name (Chinese)' : '名称（中文）'}</span>
                            <input
                                value={nameCn}
                                onChange={e => setNameCn(e.target.value)}
                                className="admin-search-input"
                                placeholder={isEnglish ? 'e.g. 工作坊' : '例如 工作坊'}
                            />
                        </label>
                    </div>
                    <div style={{display: 'flex', gap: '10px', marginTop: '12px'}}>
                        <button
                            className="admin-generate-btn"
                            onClick={createTag}
                            disabled={saving || !name.trim()}
                        >
                            {saving
                                ? (isEnglish ? 'Creating...' : '创建中...')
                                : (isEnglish ? 'Create Tag' : '创建标签')}
                        </button>
                        <button className="admin-back-btn" onClick={() => setShowCreate(false)}>
                            {isEnglish ? 'Cancel' : '取消'}
                        </button>
                    </div>
                </div>
            ) : (
                <button className="admin-generate-btn" onClick={() => setShowCreate(true)}
                        style={{marginBottom: '16px'}}>
                    {isEnglish ? '+ New Tag' : '+ 新建标签'}
                </button>
            )}

            {tags.length === 0 && !showCreate && (
                <p className="admin-no-results">{isEnglish ? 'No tags yet.' : '暂无标签。'}</p>
            )}

            <div className="admin-event-grid">
                {tags.map(tag => (
                    <div key={tag.id} className="admin-event-card" style={{cursor: 'default'}}>
                        <div className="admin-event-card-info" style={{padding: '16px'}}>
                            {editingTag?.id === tag.id ? (
                                <>
                                    <input
                                        value={editName}
                                        onChange={e => setEditName(e.target.value)}
                                        className="admin-search-input"
                                        placeholder={isEnglish ? 'English name' : '英文名称'}
                                        style={{marginBottom: '8px'}}
                                    />
                                    <input
                                        value={editNameCn}
                                        onChange={e => setEditNameCn(e.target.value)}
                                        className="admin-search-input"
                                        placeholder={isEnglish ? 'Chinese name' : '中文名称'}
                                        style={{marginBottom: '8px'}}
                                    />
                                    <div style={{display: 'flex', gap: '8px'}}>
                                        <button
                                            className="admin-generate-btn"
                                            onClick={saveEdit}
                                            disabled={savingEdit || !editName.trim()}
                                            style={{fontSize: '12px', padding: '4px 12px'}}
                                        >
                                            {savingEdit
                                                ? (isEnglish ? 'Saving...' : '保存中...')
                                                : (isEnglish ? 'Save' : '保存')}
                                        </button>
                                        <button
                                            className="admin-back-btn"
                                            onClick={() => setEditingTag(null)}
                                            style={{fontSize: '12px', padding: '4px 12px'}}
                                        >
                                            {isEnglish ? 'Cancel' : '取消'}
                                        </button>
                                    </div>
                                </>
                            ) : (
                                <>
                                    <span className="admin-event-card-title">{tag.name}</span>
                                    {tag.nameCn && (
                                        <span className="admin-event-card-date">{tag.nameCn}</span>
                                    )}
                                    <div style={{display: 'flex', gap: '8px', marginTop: '8px'}}>
                                        <button
                                            className="admin-toggle-btn"
                                            onClick={() => openEdit(tag)}
                                            style={{fontSize: '12px', padding: '4px 12px'}}
                                        >
                                            {isEnglish ? 'Edit' : '编辑'}
                                        </button>
                                        <button
                                            className="admin-toggle-btn admin-toggle-revoke"
                                            onClick={() => deleteTag(tag)}
                                            style={{fontSize: '12px', padding: '4px 12px'}}
                                        >
                                            {isEnglish ? 'Delete' : '删除'}
                                        </button>
                                    </div>
                                </>
                            )}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
};
