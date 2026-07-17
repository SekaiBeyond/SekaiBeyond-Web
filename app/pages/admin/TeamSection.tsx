import { useEffect, useState } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { accountEffectiveTitle, type UserGroup } from '~/components/AuthProvider';
import { useLanguage } from '~/components/LanguageContextProvider';
import { callSaveTeamMembers, getFirebaseDb } from '~/lib/firebase';
import type { TeamMemberConfig } from '~/lib/siteConfig';
import { MemberEditModal } from './MemberEditModal';

interface LinkedAccount {
    title: string;
    titleCn: string;
    group: UserGroup;
    photoURL: string;
}

// Legacy members used a single useAccountInfo toggle; treat it as both per-field flags.
// Names never follow an account, so no name flag is read here.
const memberFollows = (m: TeamMemberConfig) => {
    const legacy = (m as {useAccountInfo?: boolean}).useAccountInfo ?? false;
    return {
        role: m.useAccountRole ?? legacy,
        photo: m.useAccountPhoto ?? legacy,
    };
};

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
    const [accounts, setAccounts] = useState<Map<string, LinkedAccount>>(new Map());

    useEffect(() => {
        setMembers(teamMembers);
    }, [teamMembers]);

    // Mirror the public page: account-linked members that follow their account show its
    // live title/titleCn/photo, so the admin preview matches what visitors see.
    useEffect(() => {
        const uids = [...new Set(
            members
                .filter(m => {
                    const f = memberFollows(m);
                    return m.uid && (f.role || f.photo);
                })
                .map(m => m.uid as string)
        )];
        if (uids.length === 0) {
            setAccounts(new Map());
            return;
        }
        let active = true;
        (async () => {
            const db = getFirebaseDb();
            const snaps = await Promise.all(uids.map(uid => getDoc(doc(db, 'users', uid))));
            if (!active) return;
            const next = new Map<string, LinkedAccount>();
            snaps.forEach(snap => {
                if (!snap.exists()) return;
                const d = snap.data();
                next.set(snap.id, {
                    title: d.title ?? '',
                    titleCn: d.titleCn ?? '',
                    group: (d.group ?? 'visitor') as UserGroup,
                    photoURL: d.photoURL ?? '',
                });
            });
            setAccounts(next);
        })().catch(() => {
            if (active) setAccounts(new Map());
        });
        return () => {
            active = false;
        };
    }, [members]);

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
        saveChanges([...members, member]).then();
    };

    const updateMember = (index: number, member: TeamMemberConfig) => {
        setEditingIndex(null);
        const newMembers = [...members];
        newMembers[index] = member;
        saveChanges(newMembers).then();
    };

    const removeMember = (index: number) => {
        if (!confirm(isEnglish ? 'Remove this member?' : '删除此成员？')) return;
        const newMembers = [...members];
        newMembers.splice(index, 1);
        saveChanges(newMembers).then();
    };

    // Swap with the previous/next member sharing the same honorary status
    // so reordering within a group never crosses group boundaries.
    const moveMember = (index: number, direction: 'up' | 'down') => {
        const isHonorary = !!members[index].isHonorary;
        let targetIndex = -1;
        if (direction === 'up') {
            for (let i = index - 1; i >= 0; i--) {
                if (!!members[i].isHonorary === isHonorary) {
                    targetIndex = i;
                    break;
                }
            }
        } else {
            for (let i = index + 1; i < members.length; i++) {
                if (!!members[i].isHonorary === isHonorary) {
                    targetIndex = i;
                    break;
                }
            }
        }
        if (targetIndex === -1) return;
        const newMembers = [...members];
        const temp = newMembers[index];
        newMembers[index] = newMembers[targetIndex];
        newMembers[targetIndex] = temp;
        saveChanges(newMembers).then();
    };

    const activeIndices: number[] = [];
    const honoraryIndices: number[] = [];
    members.forEach((m, i) => {
        (m.isHonorary ? honoraryIndices : activeIndices).push(i);
    });

    const renderCard = (index: number, isFirstInGroup: boolean, isLastInGroup: boolean) => {
        const member = members[index];
        const acc = member.uid ? accounts.get(member.uid) : undefined;
        const f = memberFollows(member);
        // Followed role falls back to the account's group label (e.g. "President"), then to
        // the stored value; the photo falls back straight to the stored value.
        const accTitle = acc ? accountEffectiveTitle(acc.group, acc.title, acc.titleCn) : null;
        const displayName = member.name;
        const displayRole = f.role && accTitle ? (accTitle.en || member.role) : member.role;
        const displayRoleCn = f.role && accTitle ? (accTitle.zh || member.roleCn) : member.roleCn;
        const displayImage = f.photo && acc ? (acc.photoURL || member.imageUrl) : member.imageUrl;
        return (
            <div key={member.id} className="admin-event-card"
                 style={{
                     cursor: 'default',
                     flexDirection: 'column',
                     alignItems: 'stretch',
                     padding: '12px',
                     opacity: saving ? 0.7 : 1
                 }}>
                <div style={{display: 'flex', gap: '12px', alignItems: 'center'}}>
                    <img src={displayImage || '/mika.webp'} alt="" className="admin-event-card-img"
                         style={{
                             borderRadius: '50%',
                             opacity: member.isHonorary ? 0.7 : 1,
                             filter: member.isHonorary ? 'grayscale(40%)' : 'none'
                         }}/>
                    <div className="admin-event-card-info">
                        <span className="admin-event-card-title">
                            {isEnglish ? displayName : (member.nameCn || displayName)}
                        </span>
                        <span
                            className="admin-event-card-date">{isEnglish ? displayRole : (displayRoleCn || displayRole)}</span>
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
                            <button className="admin-btn admin-btn--link"
                                    style={{padding: '4px 8px', marginBottom: 0, minHeight: 0}}
                                    onClick={() => moveMember(index, 'up')} disabled={isFirstInGroup || saving}>↑
                            </button>
                            <button className="admin-btn admin-btn--link"
                                    style={{padding: '4px 8px', marginBottom: 0, minHeight: 0}}
                                    onClick={() => moveMember(index, 'down')}
                                    disabled={isLastInGroup || saving}>↓
                            </button>
                        </div>
                        <div style={{display: 'flex', gap: '8px'}}>
                            <button className="admin-btn admin-btn--link"
                                    style={{padding: '4px 8px', marginBottom: 0, minHeight: 0}}
                                    onClick={() => setEditingIndex(index)}
                                    disabled={saving}>
                                {isEnglish ? 'Edit' : '编辑'}
                            </button>
                            <button className="admin-btn admin-btn--link" style={{
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
        );
    };

    const groupHeadingStyle: React.CSSProperties = {
        marginTop: '24px',
        marginBottom: '8px',
        fontSize: '13px',
        fontWeight: 700,
        textTransform: 'uppercase',
        letterSpacing: '0.5px',
        color: 'var(--color-text-secondary)',
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
                    ? 'Configure the team members displayed on the main page. Changes are saved automatically. Leaving this empty will hide the section. Mark a member as honorary in their edit form to move them to the Honorary group.'
                    : '配置在主页上显示的团队成员。更改会自动保存。留空将隐藏该板块。在编辑表单中将成员标记为名誉成员可将其移至名誉组。'}
            </p>

            <div style={groupHeadingStyle}>
                {isEnglish ? `Active (${activeIndices.length})` : `活跃 (${activeIndices.length})`}
            </div>
            {activeIndices.length === 0 ? (
                <p className="admin-helper-text" style={{fontStyle: 'italic'}}>
                    {isEnglish ? 'No active members yet.' : '尚无活跃成员。'}
                </p>
            ) : (
                <div className="admin-event-grid">
                    {activeIndices.map((memberIndex, posInGroup) =>
                        renderCard(memberIndex, posInGroup === 0, posInGroup === activeIndices.length - 1)
                    )}
                </div>
            )}

            {honoraryIndices.length > 0 && (
                <>
                    <div style={groupHeadingStyle}>
                        {isEnglish ? `Honorary (${honoraryIndices.length})` : `名誉 (${honoraryIndices.length})`}
                    </div>
                    <div className="admin-event-grid">
                        {honoraryIndices.map((memberIndex, posInGroup) =>
                            renderCard(memberIndex, posInGroup === 0, posInGroup === honoraryIndices.length - 1)
                        )}
                    </div>
                </>
            )}

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
