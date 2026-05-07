import { useEffect, useState } from 'react';
import { useLanguage } from '~/components/LanguageContextProvider';
import { callSaveTeamMembers, callUploadAdminImage } from '~/lib/firebase';
import type { TeamMemberConfig } from '~/lib/siteConfig';
import { ImageUploadField } from './ImageUploadField';
import { CreatorPicker } from './CreatorPicker';
import type { UserRecord } from './types';

interface TeamSectionProps {
    teamMembers: TeamMemberConfig[];
    refreshConfig: () => Promise<void>;
    showToast: (message: string, type: 'success' | 'warning' | 'error') => void;
    readOnly?: boolean;
}

export const TeamSection = ({teamMembers, refreshConfig, showToast, readOnly}: TeamSectionProps) => {
    const {isEnglish} = useLanguage();
    const [members, setMembers] = useState<TeamMemberConfig[]>([]);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        setMembers(teamMembers);
    }, [teamMembers]);

    const handleSave = async () => {
        setSaving(true);
        try {
            await callSaveTeamMembers({teamMembers: members});
            await refreshConfig();
            showToast(isEnglish ? 'Team saved.' : '团队已保存。', 'success');
        } catch (e: any) {
            showToast(isEnglish ? 'Failed to save team.' : '保存团队失败。', 'error');
        } finally {
            setSaving(false);
        }
    };

    const addMember = () => {
        setMembers([
            ...members,
            {id: Math.random().toString(36).substring(2, 9), name: '', nameCn: '', role: '', roleCn: '', imageUrl: ''}
        ]);
    };

    const removeMember = (index: number) => {
        const newMembers = [...members];
        newMembers.splice(index, 1);
        setMembers(newMembers);
    };

    const moveMember = (index: number, direction: 'up' | 'down') => {
        if (direction === 'up' && index === 0) return;
        if (direction === 'down' && index === members.length - 1) return;
        const newMembers = [...members];
        const targetIndex = direction === 'up' ? index - 1 : index + 1;
        const temp = newMembers[index];
        newMembers[index] = newMembers[targetIndex];
        newMembers[targetIndex] = temp;
        setMembers(newMembers);
    };

    const updateMember = (index: number, field: keyof TeamMemberConfig, value: any) => {
        const newMembers = [...members];
        newMembers[index] = {...newMembers[index], [field]: value};
        setMembers(newMembers);
    };

    const handleImageChange = async (index: number, file: File, previewUrl: string) => {
        const memberId = members[index].id;
        try {
            showToast(isEnglish ? 'Uploading image...' : '正在上传图片...', 'warning'); // using warning as info
            const url = await callUploadAdminImage(file, `config/team/${memberId}`);
            updateMember(index, 'imageUrl', url);
            showToast(isEnglish ? 'Image uploaded.' : '图片已上传。', 'success');
        } catch (err) {
            showToast(isEnglish ? 'Image upload failed.' : '图片上传失败。', 'error');
        }
    };

    const handleUserSelect = (index: number, user: UserRecord | null) => {
        const newMembers = [...members];
        if (user) {
            newMembers[index].uid = user.uid;
            newMembers[index].name = user.displayName;
            if (!newMembers[index].imageUrl) {
                newMembers[index].imageUrl = user.photoURL;
            }
        } else {
            newMembers[index].uid = '';
        }
        setMembers(newMembers);
    };

    return (
        <div className="admin-section">
            <h3 className="admin-badges-title">
                {isEnglish ? 'Our Team' : '我们的团队'}
            </h3>
            <p className="admin-helper-text">
                {isEnglish
                    ? 'Configure the team members displayed on the main page. Leaving this empty will use the default hardcoded officers.'
                    : '配置在主页上显示的团队成员。留空将使用默认的硬编码社团干部。'}
            </p>

            <div className="admin-mt-12" style={{display: 'flex', flexDirection: 'column', gap: '24px'}}>
                {members.map((member, index) => (
                    <div key={member.id} className="admin-form-grid"
                         style={{padding: '16px', border: '1px solid var(--color-border)', borderRadius: '8px'}}>
                        <div style={{display: 'flex', justifyContent: 'space-between', gridColumn: '1 / -1'}}>
                            <span
                                style={{fontWeight: 600}}>{isEnglish ? `Member ${index + 1}` : `成员 ${index + 1}`}</span>
                            {!readOnly && (
                                <div style={{display: 'flex', gap: '8px'}}>
                                    <button onClick={() => moveMember(index, 'up')} disabled={index === 0}>↑</button>
                                    <button onClick={() => moveMember(index, 'down')}
                                            disabled={index === members.length - 1}>↓
                                    </button>
                                    <button onClick={() => removeMember(index)} style={{color: 'var(--color-danger)'}}>
                                        {isEnglish ? 'Remove' : '删除'}
                                    </button>
                                </div>
                            )}
                        </div>

                        <div style={{gridColumn: '1 / -1'}}>
                            <CreatorPicker
                                selected={member.uid ? {
                                    uid: member.uid,
                                    displayName: member.name,
                                    email: '',
                                    photoURL: member.imageUrl
                                } as any : null}
                                onSelect={(u) => handleUserSelect(index, u)}
                                manualName={member.name}
                                onManualNameChange={(v) => updateMember(index, 'name', v)}
                                manualLink=""
                                onManualLinkChange={() => {
                                }}
                            />
                        </div>

                        {!member.uid && (
                            <>
                                <label>
                                    <span>{isEnglish ? 'Name (English)' : '姓名（英文）'}</span>
                                    <input
                                        className="admin-search-input"
                                        value={member.name}
                                        onChange={(e) => updateMember(index, 'name', e.target.value)}
                                        readOnly={readOnly}
                                    />
                                </label>
                            </>
                        )}

                        <label>
                            <span>{isEnglish ? 'Name (Chinese) (optional)' : '姓名（中文）（可选）'}</span>
                            <input
                                className="admin-search-input"
                                value={member.nameCn || ''}
                                onChange={(e) => updateMember(index, 'nameCn', e.target.value)}
                                readOnly={readOnly}
                            />
                        </label>

                        <label>
                            <span>{isEnglish ? 'Role (English)' : '角色（英文）'}</span>
                            <input
                                className="admin-search-input"
                                value={member.role}
                                onChange={(e) => updateMember(index, 'role', e.target.value)}
                                readOnly={readOnly}
                            />
                        </label>

                        <label>
                            <span>{isEnglish ? 'Role (Chinese)' : '角色（中文）'}</span>
                            <input
                                className="admin-search-input"
                                value={member.roleCn}
                                onChange={(e) => updateMember(index, 'roleCn', e.target.value)}
                                readOnly={readOnly}
                            />
                        </label>

                        <div style={{gridColumn: '1 / -1'}}>
                            <ImageUploadField
                                label="Member Avatar"
                                labelCn="成员头像"
                                preview={member.imageUrl || null}
                                onFileChange={(file, url) => handleImageChange(index, file, url)}
                                convertToWebp
                                cropAspect={1}
                                showToast={showToast}
                            />
                        </div>
                    </div>
                ))}
            </div>

            {!readOnly && (
                <div className="admin-btn-row admin-mt-12">
                    <button className="admin-toggle-btn" onClick={addMember}>
                        {isEnglish ? '+ Add Member' : '+ 添加成员'}
                    </button>
                    <button
                        className="admin-toggle-btn admin-toggle-save"
                        onClick={handleSave}
                        disabled={saving}
                    >
                        {saving
                            ? (isEnglish ? 'Saving...' : '保存中...')
                            : (isEnglish ? 'Save Team' : '保存团队')}
                    </button>
                </div>
            )}
        </div>
    );
};