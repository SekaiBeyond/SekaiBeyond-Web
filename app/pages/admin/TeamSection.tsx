import { useEffect, useState } from 'react';
import { useLanguage } from '~/components/LanguageContextProvider';
import { callSaveTeamMembers } from '~/lib/firebase';
import type { TeamMemberConfig } from '~/lib/siteConfig';
import { MemberEditModal } from './MemberEditModal';

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
    const [editingIndex, setEditingIndex] = useState<number | null>(null);
    const [isAdding, setIsAdding] = useState(false);

    useEffect(() => {
        setMembers(teamMembers);
    }, [teamMembers]);

    const saveChanges = async (newMembers: TeamMemberConfig[]) => {
        setMembers(newMembers);
        setSaving(true);
        try {
            await callSaveTeamMembers({teamMembers: newMembers});
            await refreshConfig();
            showToast(isEnglish ? 'Team updated.' : '团队已更新。', 'success');
        } catch (e: any) {
            showToast(isEnglish ? 'Failed to update team.' : '更新团队失败。', 'error');
            // Revert state if saving failed
            setMembers(members);
        } finally {
            setSaving(false);
        }
    };

    const addMember = (member: TeamMemberConfig) => {
        setIsAdding(false);
        saveChanges([...members, member]);
    };

    const updateMember = (index: number, member: TeamMemberConfig) => {
        setEditingIndex(null);
        const newMembers = [...members];
        newMembers[index] = member;
        saveChanges(newMembers);
    };

    const removeMember = (index: number) => {
        if (!confirm(isEnglish ? 'Remove this member?' : '删除此成员？')) return;
        const newMembers = [...members];
        newMembers.splice(index, 1);
        saveChanges(newMembers);
    };

    const moveMember = (index: number, direction: 'up' | 'down') => {
        if (direction === 'up' && index === 0) return;
        if (direction === 'down' && index === members.length - 1) return;
        const newMembers = [...members];
        const targetIndex = direction === 'up' ? index - 1 : index + 1;
        const temp = newMembers[index];
        newMembers[index] = newMembers[targetIndex];
        newMembers[targetIndex] = temp;
        saveChanges(newMembers);
    };

    return (
        <div className="admin-section">
            <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center'}}>
                <h3 className="admin-badges-title" style={{marginBottom: 0}}>
                    {isEnglish ? 'Our Team' : '我们的团队'}
                    {saving && <span style={{marginLeft: '12px', fontSize: '12px', color: 'var(--color-primary)'}}>
                        {isEnglish ? 'Saving...' : '保存中...'}
                    </span>}
                </h3>
            </div>
            <p className="admin-helper-text" style={{marginTop: '4px'}}>
                {isEnglish
                    ? 'Configure the team members displayed on the main page. Changes are saved automatically. Leaving this empty will hide the section.'
                    : '配置在主页上显示的团队成员。更改会自动保存。留空将隐藏该板块。'}
            </p>

            <div className="admin-event-grid admin-mt-12">
                {members.map((member, index) => (
                    <div key={member.id} className="admin-event-card"
                         style={{
                             cursor: 'default',
                             flexDirection: 'column',
                             alignItems: 'stretch',
                             padding: '12px',
                             opacity: saving ? 0.7 : 1
                         }}>
                        <div style={{display: 'flex', gap: '12px', alignItems: 'center'}}>
                            <img src={member.imageUrl || '/images/mika.png'} alt="" className="admin-event-card-img"
                                 style={{borderRadius: '50%'}}/>
                            <div className="admin-event-card-info">
                                <span
                                    className="admin-event-card-title">{isEnglish ? member.name : (member.nameCn || member.name)}</span>
                                <span
                                    className="admin-event-card-date">{isEnglish ? member.role : (member.roleCn || member.role)}</span>
                            </div>
                        </div>
                        {!readOnly && (
                            <div style={{
                                display: 'flex',
                                justifyContent: 'space-between',
                                marginTop: '12px',
                                borderTop: '1px solid var(--color-border)',
                                paddingTop: '8px'
                            }}>
                                <div style={{display: 'flex', gap: '4px'}}>
                                    <button className="admin-back-btn"
                                            style={{padding: '4px 8px', marginBottom: 0, minHeight: 0}}
                                            onClick={() => moveMember(index, 'up')} disabled={index === 0 || saving}>↑
                                    </button>
                                    <button className="admin-back-btn"
                                            style={{padding: '4px 8px', marginBottom: 0, minHeight: 0}}
                                            onClick={() => moveMember(index, 'down')}
                                            disabled={index === members.length - 1 || saving}>↓
                                    </button>
                                </div>
                                <div style={{display: 'flex', gap: '8px'}}>
                                    <button className="admin-back-btn"
                                            style={{padding: '4px 8px', marginBottom: 0, minHeight: 0}}
                                            onClick={() => setEditingIndex(index)}
                                            disabled={saving}>
                                        {isEnglish ? 'Edit' : '编辑'}
                                    </button>
                                    <button className="admin-back-btn" style={{
                                        padding: '4px 8px',
                                        marginBottom: 0,
                                        minHeight: 0,
                                        color: saving ? 'var(--color-text-light)' : 'var(--color-danger)'
                                    }} onClick={() => removeMember(index)} disabled={saving}>
                                        {isEnglish ? 'Remove' : '删除'}
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                ))}
            </div>

            {!readOnly && (
                <div className="admin-btn-row admin-mt-12">
                    <button className="admin-toggle-btn" onClick={() => setIsAdding(true)} disabled={saving}>
                        {isEnglish ? '+ Add Member' : '+ 添加成员'}
                    </button>
                </div>
            )}

            {isAdding && (
                <MemberEditModal
                    member={null}
                    onClose={() => setIsAdding(false)}
                    onSave={addMember}
                    showToast={showToast}
                />
            )}

            {editingIndex !== null && (
                <MemberEditModal
                    member={members[editingIndex]}
                    onClose={() => setEditingIndex(null)}
                    onSave={(m) => updateMember(editingIndex, m)}
                    showToast={showToast}
                />
            )}
        </div>
    );
};