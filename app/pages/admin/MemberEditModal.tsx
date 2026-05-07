import { useEffect, useRef, useState } from 'react';
import { useLanguage } from '~/components/LanguageContextProvider';
import { callUploadAdminImage } from '~/lib/firebase';
import type { TeamMemberConfig } from '~/lib/siteConfig';
import { useModalEffects } from '~/lib/useModalEffects';
import { CreatorPicker } from './CreatorPicker';
import { ImageUploadField } from './ImageUploadField';
import type { UserRecord } from './types';
import type { ShowToast } from './utils';

interface MemberEditModalProps {
    member: TeamMemberConfig | null; // null for adding new
    onClose: () => void;
    onSave: (member: TeamMemberConfig) => void;
    showToast: ShowToast;
}

export const MemberEditModal = ({member, onClose, onSave, showToast}: MemberEditModalProps) => {
    const {isEnglish} = useLanguage();
    const overlayRef = useRef<HTMLDivElement>(null);
    useModalEffects(true, overlayRef);

    const [formData, setFormData] = useState<TeamMemberConfig>({
        id: member?.id || Math.random().toString(36).substring(2, 9),
        uid: member?.uid || '',
        name: member?.name || '',
        nameCn: member?.nameCn || '',
        role: member?.role || '',
        roleCn: member?.roleCn || '',
        imageUrl: member?.imageUrl || '',
    });

    const [uploading, setUploading] = useState(false);

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, [onClose]);

    const handleUserSelect = (user: UserRecord | null) => {
        if (user) {
            setFormData(prev => ({
                ...prev,
                uid: user.uid,
                name: prev.name || user.displayName,
                imageUrl: prev.imageUrl || user.photoURL,
            }));
        } else {
            setFormData(prev => ({...prev, uid: ''}));
        }
    };

    const handleImageChange = async (file: File) => {
        setUploading(true);
        try {
            showToast(isEnglish ? 'Uploading image...' : '正在上传图片...', 'warning');
            const url = await callUploadAdminImage(file, `team/${formData.id}.webp`);
            setFormData(prev => ({...prev, imageUrl: url}));
            showToast(isEnglish ? 'Image uploaded.' : '图片已上传。', 'success');
        } catch (err) {
            showToast(isEnglish ? 'Image upload failed.' : '图片上传失败。', 'error');
        } finally {
            setUploading(false);
        }
    };

    const canSave = formData.name.trim() && formData.role.trim() && !uploading;

    return (
        <div ref={overlayRef} className="admin-tickets-preview-modal" onClick={onClose}>
            <div className="admin-tickets-preview-content" onClick={e => e.stopPropagation()}>
                <div className="admin-tickets-preview-header">
                    <strong>{member ? (isEnglish ? 'Edit Member' : '编辑成员') : (isEnglish ? 'Add Member' : '添加成员')}</strong>
                    <button className="admin-tickets-preview-close" onClick={onClose}>×</button>
                </div>

                <div className="admin-tickets-attendee-edit">
                    <div style={{marginBottom: '16px'}}>
                        <CreatorPicker
                            selected={formData.uid ? {
                                uid: formData.uid,
                                displayName: formData.name,
                                email: '',
                                photoURL: formData.imageUrl
                            } as any : null}
                            onSelect={handleUserSelect}
                        />
                    </div>

                    <label className="admin-tickets-template-field">
                        <span>{isEnglish ? 'Name (English)' : '姓名（英文）'}</span>
                        <input
                            className="admin-search-input"
                            value={formData.name}
                            onChange={e => setFormData(prev => ({...prev, name: e.target.value}))}
                            placeholder={isEnglish ? 'Full name in English' : '英文全名'}
                        />
                    </label>

                    <label className="admin-tickets-template-field">
                        <span>{isEnglish ? 'Name (Chinese) (optional)' : '姓名（中文）（可选）'}</span>
                        <input
                            className="admin-search-input"
                            value={formData.nameCn}
                            onChange={e => setFormData(prev => ({...prev, nameCn: e.target.value}))}
                            placeholder={isEnglish ? 'Full name in Chinese' : '中文全名'}
                        />
                    </label>

                    <label className="admin-tickets-template-field">
                        <span>{isEnglish ? 'Role (English)' : '角色（英文）'}</span>
                        <input
                            className="admin-search-input"
                            value={formData.role}
                            onChange={e => setFormData(prev => ({...prev, role: e.target.value}))}
                            placeholder={isEnglish ? 'e.g. President' : '例如：社长'}
                        />
                    </label>

                    <label className="admin-tickets-template-field">
                        <span>{isEnglish ? 'Role (Chinese)' : '角色（中文）'}</span>
                        <input
                            className="admin-search-input"
                            value={formData.roleCn}
                            onChange={e => setFormData(prev => ({...prev, roleCn: e.target.value}))}
                            placeholder={isEnglish ? '例如：社长' : '例如：社长'}
                        />
                    </label>

                    <div style={{marginTop: '8px'}}>
                        <ImageUploadField
                            label="Member Avatar"
                            labelCn="成员头像"
                            preview={formData.imageUrl || null}
                            onFileChange={(file) => handleImageChange(file)}
                            convertToWebp
                            cropAspect={1}
                            showToast={showToast}
                        />
                    </div>

                    <div className="admin-btn-row" style={{marginTop: '24px'}}>
                        <button
                            className="admin-toggle-btn admin-toggle-save"
                            onClick={() => onSave(formData)}
                            disabled={!canSave}
                        >
                            {isEnglish ? 'Save Member' : '保存成员'}
                        </button>
                        <button
                            className="admin-toggle-btn admin-toggle-cancel"
                            onClick={onClose}
                        >
                            {isEnglish ? 'Cancel' : '取消'}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};
