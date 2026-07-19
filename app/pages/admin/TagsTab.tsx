import { useState } from 'react';
import { FirebaseError } from 'firebase/app';
import { useLanguage } from '~/components/LanguageContextProvider';
import { callDeleteTag, callSaveTag } from '~/lib/firebase';
import type { Tag } from '~/lib/tags';
import { BilingualFormField } from './BilingualFormField';
import { CardEditDeleteActions, CardSaveCancel, CreateSection } from './CrudShell';

function isDuplicateError(err: unknown): boolean {
    return err instanceof FirebaseError && err.code === 'functions/already-exists';
}

interface TagsTabProps {
    tags: Tag[];
    refreshTags: () => Promise<void>;
    showToast: (message: string, type: 'success' | 'warning' | 'error') => void;
    readOnly?: boolean;
}

export const TagsTab = ({tags, refreshTags, showToast, readOnly = false}: TagsTabProps) => {
    const {isEnglish} = useLanguage();
    const [showCreate, setShowCreate] = useState(false);
    const [name, setName] = useState('');
    const [nameCn, setNameCn] = useState('');
    const [saving, setSaving] = useState(false);

    const [editingTag, setEditingTag] = useState<Tag | null>(null);
    const [editName, setEditName] = useState('');
    const [editNameCn, setEditNameCn] = useState('');
    const [savingEdit, setSavingEdit] = useState(false);
    const [deletingId, setDeletingId] = useState<string | null>(null);

    const createTag = async () => {
        if (!name.trim()) return;
        setSaving(true);
        try {
            await callSaveTag({name: name.trim(), nameCn: nameCn.trim()});
            await refreshTags();
            setName('');
            setNameCn('');
            setShowCreate(false);
            showToast(isEnglish ? 'Tag created.' : '标签已创建。', 'success');
        } catch (err) {
            showToast(isDuplicateError(err)
                ? (isEnglish ? 'A tag with this name already exists.' : '已存在同名标签。')
                : (isEnglish ? 'Failed to create tag.' : '创建标签失败。'), 'error');
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
            await callSaveTag({tagId: editingTag.id, name: editName.trim(), nameCn: editNameCn.trim()});
            await refreshTags();
            setEditingTag(null);
            showToast(isEnglish ? 'Tag updated.' : '标签已更新。', 'success');
        } catch (err) {
            showToast(isDuplicateError(err)
                ? (isEnglish ? 'A tag with this name already exists.' : '已存在同名标签。')
                : (isEnglish ? 'Failed to save tag.' : '保存标签失败。'), 'error');
        } finally {
            setSavingEdit(false);
        }
    };

    const deleteTag = async (tag: Tag) => {
        if (!confirm(isEnglish
            ? `Delete tag "${tag.name}"? Events using this tag will show no tag.`
            : `删除标签"${tag.name}"？使用此标签的活动将不显示标签。`
        )) return;
        setDeletingId(tag.id);
        try {
            await callDeleteTag({tagId: tag.id});
            await refreshTags();
            if (editingTag?.id === tag.id) setEditingTag(null);
            showToast(isEnglish ? 'Tag deleted.' : '标签已删除。', 'warning');
        } catch {
            showToast(isEnglish ? 'Failed to delete tag.' : '删除标签失败。', 'error');
        } finally {
            setDeletingId(null);
        }
    };

    return (
        <div className="admin-section">
            {!readOnly && (
                <CreateSection
                    show={showCreate}
                    setShow={setShowCreate}
                    newLabel={isEnglish ? '+ New Tag' : '+ 新建标签'}
                    title={isEnglish ? 'Create New Tag' : '创建新标签'}
                    ctaLabel={isEnglish ? 'Create Tag' : '创建标签'}
                    ctaBusyLabel={isEnglish ? 'Creating...' : '创建中...'}
                    busy={saving}
                    ctaDisabled={!name.trim()}
                    onCreate={createTag}
                >
                    <div className="admin-form-grid">
                        <BilingualFormField
                            label="Name" labelCn="名称"
                            value={name} valueCn={nameCn}
                            onChange={setName} onChangeCn={setNameCn}
                            placeholder='e.g. Workshop'
                            placeholderCn='e.g. 工坊'
                        />
                    </div>
                </CreateSection>
            )}

            {tags.length === 0 && !showCreate && (
                <p className="admin-no-results">{isEnglish ? 'No tags yet.' : '暂无标签。'}</p>
            )}

            <div className="admin-event-grid">
                {tags.map(tag => (
                    <div key={tag.id} className="admin-event-card admin-tag-card">
                        <div className="admin-event-card-info admin-tag-card-info">
                            {editingTag?.id === tag.id ? (
                                <>
                                    <input
                                        value={editName}
                                        onChange={e => setEditName(e.target.value)}
                                        className="admin-input admin-tag-input"
                                        placeholder={isEnglish ? 'English name' : '英文名称'}
                                    />
                                    <input
                                        value={editNameCn}
                                        onChange={e => setEditNameCn(e.target.value)}
                                        className="admin-input admin-tag-input"
                                        placeholder={isEnglish ? 'Chinese name' : '中文名称'}
                                    />
                                    <CardSaveCancel
                                        saving={savingEdit}
                                        saveDisabled={!editName.trim()}
                                        onSave={saveEdit}
                                        onCancel={() => setEditingTag(null)}
                                    />
                                </>
                            ) : (
                                <>
                                    <span className="admin-event-card-title">{tag.name}</span>
                                    {tag.nameCn && (
                                        <span className="admin-event-card-date">{tag.nameCn}</span>
                                    )}
                                    {!readOnly && (
                                        <CardEditDeleteActions
                                            onEdit={() => openEdit(tag)}
                                            onDelete={() => deleteTag(tag)}
                                            deleting={deletingId === tag.id}
                                        />
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
