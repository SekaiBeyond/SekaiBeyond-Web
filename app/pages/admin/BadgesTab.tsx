import { forwardRef, useImperativeHandle, useState } from 'react';
import { useLanguage } from '~/components/LanguageContextProvider';
import { callSaveBadge, callUploadAdminImage } from '~/lib/firebase';
import type { BadgeDef } from '~/lib/badges';
import { AccountPicker } from './AccountPicker';
import { BilingualFormField } from './BilingualFormField';
import { ImageUploadField } from './ImageUploadField';
import {
    badgeCreatorLinkValid,
    BadgeDetailView,
    type BadgeForm,
    badgeFormFields,
    emptyBadgeForm,
} from './BadgeDetailView';
import type { ShowToast } from './utils';

interface BadgesTabProps {
    badgeDefs: BadgeDef[];
    setBadgeDefs: React.Dispatch<React.SetStateAction<BadgeDef[]>>;
    onLookupUser: (uid: string) => void;
    showToast: ShowToast;
    readOnly?: boolean;
}

export interface BadgesTabHandle {
    selectBadgeById: (badgeId: string) => void;
}

export const BadgesTab = forwardRef<BadgesTabHandle, BadgesTabProps>(({
                                                                          badgeDefs,
                                                                          setBadgeDefs,
                                                                          onLookupUser,
                                                                          showToast,
                                                                          readOnly = false,
                                                                      }, ref) => {
    const {isEnglish} = useLanguage();

    const [selectedBadgeDef, setSelectedBadgeDef] = useState<BadgeDef | null>(null);

    // Create badge state
    const [showCreateBadge, setShowCreateBadge] = useState(false);
    const [createForm, setCreateForm] = useState<BadgeForm>(emptyBadgeForm);
    const [creatingBadgeDef, setCreatingBadgeDef] = useState(false);

    useImperativeHandle(ref, () => ({
        selectBadgeById: (badgeId: string) => {
            const bd = badgeDefs.find(d => d.id === badgeId);
            if (bd) setSelectedBadgeDef(bd);
        },
    }));

    const createBadgeDef = async () => {
        if (!badgeCreatorLinkValid(createForm)) {
            showToast(isEnglish ? 'Creator link must be a valid URL (http/https).' : '创建者链接必须是有效的网址（http/https）。', 'error');
            return;
        }
        setCreatingBadgeDef(true);
        try {
            let imageUrl = '/mika.webp';
            if (createForm.image) {
                const imageId = crypto.randomUUID();
                imageUrl = await callUploadAdminImage(createForm.image, `badges/${imageId}.webp`);
            }

            const fields = badgeFormFields(createForm, imageUrl);
            const result = await callSaveBadge(fields);
            setBadgeDefs(prev => [...prev, {id: result.data.badgeId, ...fields, deleteAt: null}]);

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

    const handleUpdateBadgeDef = (updated: BadgeDef) => {
        setBadgeDefs(prev => prev.map(d => d.id === updated.id ? updated : d));
        setSelectedBadgeDef(updated);
    };

    if (selectedBadgeDef) {
        return (
            <BadgeDetailView
                badgeDef={selectedBadgeDef}
                onBack={() => setSelectedBadgeDef(null)}
                onUpdateBadgeDef={handleUpdateBadgeDef}
                onLookupUser={onLookupUser}
                showToast={showToast}
                readOnly={readOnly}
            />
        );
    }

    return (
        <div className="admin-section">
            {!readOnly && showCreateBadge ? (
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
                        <AccountPicker
                            label={isEnglish ? 'Creator (optional)' : '创建者（可选）'}
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
                            cropAspect={1}
                            showToast={showToast}
                        />
                    </div>
                    <div className="admin-form-actions">
                        <button className="admin-toggle-btn admin-toggle-save" onClick={createBadgeDef}
                                disabled={creatingBadgeDef || !createForm.name.trim()}>
                            {creatingBadgeDef ? (isEnglish ? 'Creating...' : '创建中...') : (isEnglish ? 'Create Badge' : '创建徽章')}
                        </button>
                        <button className="admin-toggle-btn admin-toggle-cancel" onClick={resetCreateForm}>
                            {isEnglish ? 'Cancel' : '取消'}
                        </button>
                    </div>
                </div>
            ) : !readOnly ? (
                <button className="admin-btn admin-btn--dashed" onClick={() => setShowCreateBadge(true)}>
                    {isEnglish ? '+ Create Badge' : '+ 创建徽章'}
                </button>
            ) : null}

            {badgeDefs.length === 0 && !showCreateBadge && (
                <p className="admin-no-results">
                    {isEnglish ? 'No badges yet. Create one above.' : '暂无徽章，点击上方按钮创建。'}
                </p>
            )}
            {badgeDefs.length > 0 && (
                <div className="admin-event-grid">
                    {badgeDefs.map(bd => (
                        <button key={bd.id} className="admin-event-card" onClick={() => setSelectedBadgeDef(bd)}>
                            <img src={bd.imageUrl} alt="" className="admin-event-card-img"/>
                            <div className="admin-event-card-info">
                                <span className="admin-event-card-title">
                                    {isEnglish ? bd.name : (bd.nameCn || bd.name)}
                                </span>
                                <span className="admin-event-card-date">
                                    {isEnglish ? bd.description : (bd.descriptionCn || bd.description)}
                                </span>
                                {bd.deleteAt && (
                                    <span className="admin-ended-tag">
                                        {isEnglish ? 'Pending deletion' : '待删除'}
                                    </span>
                                )}
                            </div>
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
});

BadgesTab.displayName = 'BadgesTab';
