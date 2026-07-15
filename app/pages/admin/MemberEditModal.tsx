import { useEffect, useRef, useState } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { accountEffectiveTitle, type UserGroup } from '~/components/AuthProvider';
import { useLanguage } from '~/components/LanguageContextProvider';
import { callUploadAdminImage, getFirebaseDb } from '~/lib/firebase';
import type { TeamMemberConfig } from '~/lib/siteConfig';
import { useModalEffects } from '~/lib/useModalEffects';
import { AccountPicker } from './AccountPicker';
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

    // Legacy members used a single useAccountInfo toggle; seed all three per-field flags from it.
    const legacyUseAccountInfo = (member as {useAccountInfo?: boolean} | null)?.useAccountInfo ?? false;

    const [formData, setFormData] = useState<TeamMemberConfig>({
        id: member?.id || Math.random().toString(36).substring(2, 9),
        uid: member?.uid || '',
        name: member?.name || '',
        nameCn: member?.nameCn || '',
        role: member?.role || '',
        roleCn: member?.roleCn || '',
        imageUrl: member?.imageUrl || '',
        isHonorary: member?.isHonorary || false,
        useAccountName: member?.useAccountName ?? legacyUseAccountInfo,
        useAccountRole: member?.useAccountRole ?? legacyUseAccountInfo,
        useAccountPhoto: member?.useAccountPhoto ?? legacyUseAccountInfo,
    });

    const [uploading, setUploading] = useState(false);
    // Live values of the linked account, so followed fields preview what visitors will see
    // (the stored formData values are only fallbacks for when the account has none).
    const [account, setAccount] = useState<{
        displayName: string;
        title: string;
        titleCn: string;
        group: UserGroup;
        photoURL: string
    } | null>(null);

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, [onClose]);

    useEffect(() => {
        const uid = formData.uid;
        if (!uid) {
            setAccount(null);
            return;
        }
        let active = true;
        (async () => {
            const snap = await getDoc(doc(getFirebaseDb(), 'users', uid));
            if (!active) return;
            if (!snap.exists()) {
                setAccount(null);
                return;
            }
            const d = snap.data();
            const acc = {
                displayName: (d.displayName as string) ?? '',
                title: (d.title as string) ?? '',
                titleCn: (d.titleCn as string) ?? '',
                group: ((d.group as string) ?? 'visitor') as UserGroup,
                photoURL: (d.photoURL as string) ?? '',
            };
            setAccount(acc);
            // Keep followed fields in step with the account's current info; the stored value
            // is only a fallback, so unchecking later reveals the up-to-date value, not a stale one.
            const accTitle = accountEffectiveTitle(acc.group, acc.title, acc.titleCn);
            setFormData(prev => ({
                ...prev,
                name: prev.useAccountName ? (acc.displayName || prev.name) : prev.name,
                role: prev.useAccountRole ? (accTitle.en || prev.role) : prev.role,
                roleCn: prev.useAccountRole ? (accTitle.zh || prev.roleCn) : prev.roleCn,
                imageUrl: prev.useAccountPhoto ? (acc.photoURL || prev.imageUrl) : prev.imageUrl,
            }));
        })().catch(() => {
            if (active) setAccount(null);
        });
        return () => {
            active = false;
        };
    }, [formData.uid]);

    const handleUserSelect = (user: UserRecord | null) => {
        if (user) {
            // Linking an account defaults every field to following it; snapshot the account's
            // current name/role/photo as a fallback for the public page (which live-resolves).
            const accTitle = accountEffectiveTitle(user.group, user.title, user.titleCn);
            setFormData(prev => ({
                ...prev,
                uid: user.uid,
                useAccountName: true,
                useAccountRole: true,
                useAccountPhoto: true,
                name: user.displayName || prev.name,
                role: accTitle.en || prev.role,
                roleCn: accTitle.zh || prev.roleCn,
                imageUrl: user.photoURL || prev.imageUrl,
            }));
        } else {
            setFormData(prev => ({
                ...prev,
                uid: '',
                useAccountName: false,
                useAccountRole: false,
                useAccountPhoto: false,
            }));
        }
    };

    const handleImageChange = async (file: File, previewUrl: string) => {
        setUploading(true);
        // Show local preview immediately
        setFormData(prev => ({...prev, imageUrl: previewUrl}));
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

    const accountLinked = !!formData.uid;
    // Each field can independently follow the linked account. A field that follows the
    // account is filled from its live value, so it's hidden here and not required to save.
    const nameFromAccount = accountLinked && !!formData.useAccountName;
    const roleFromAccount = accountLinked && !!formData.useAccountRole;
    const photoFromAccount = accountLinked && !!formData.useAccountPhoto;
    // Values shown for followed fields: the account's live value, falling back to the stored one.
    // Role uses the account's effective title (its title, or group label like "President").
    const accTitle = account ? accountEffectiveTitle(account.group, account.title, account.titleCn) : null;
    const accountName = account?.displayName || formData.name;
    const accountRole = accTitle?.en || formData.role;
    const accountRoleCn = accTitle?.zh || formData.roleCn;
    const accountPhoto = account?.photoURL || formData.imageUrl;
    const canSave = !uploading
        && (nameFromAccount || formData.name.trim() !== '')
        && (roleFromAccount || formData.role.trim() !== '');

    // Small "From account" checkbox shown alongside each account-backed field.
    const fromAccountToggleStyle: React.CSSProperties = {
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        margin: 0,
        fontWeight: 400,
        fontSize: '12px',
        color: 'var(--color-text-secondary)',
        cursor: 'pointer',
    };
    // Read-only presentation for a field whose value follows the linked account.
    const fromAccountValueStyle: React.CSSProperties = {
        opacity: 0.7,
        display: 'flex',
        alignItems: 'center',
    };

    return (
        <div ref={overlayRef} className="admin-tickets-preview-modal" onClick={onClose}>
            <div className="admin-tickets-preview-content" onClick={e => e.stopPropagation()}>
                <div className="admin-tickets-preview-header">
                    <strong>{member ? (isEnglish ? 'Edit Member' : '编辑成员') : (isEnglish ? 'Add Member' : '添加成员')}</strong>
                    <button className="admin-tickets-preview-close" onClick={onClose}>×</button>
                </div>

                <div className="admin-tickets-attendee-edit">
                    <div style={{marginBottom: '16px'}}>
                        <AccountPicker
                            label={isEnglish ? 'Linked Account (optional)' : '关联账户（可选）'}
                            selected={formData.uid ? {
                                uid: formData.uid,
                                displayName: formData.name,
                                email: '',
                                photoURL: formData.imageUrl
                            } as any : null}
                            onSelect={handleUserSelect}
                        />
                    </div>

                    {accountLinked && (
                        <p className="admin-helper-text" style={{marginTop: 0, marginBottom: '12px'}}>
                            {isEnglish
                                ? 'Tick "From account" on a field to have it follow the linked account and update automatically; untick to enter a custom value. The role follows the account in both English and Chinese. The Chinese name is always custom.'
                                : '在字段勾选“来自账户”，即可让其跟随关联账户并自动更新；取消勾选可输入自定义值。角色的中英文均跟随账户。中文姓名始终为自定义。'}
                        </p>
                    )}

                    <div className="admin-tickets-template-field">
                        <span style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            gap: '8px'
                        }}>
                            <span>{isEnglish ? 'Name (English)' : '姓名（英文）'}</span>
                            {accountLinked && (
                                <label style={fromAccountToggleStyle}>
                                    <input
                                        type="checkbox"
                                        checked={nameFromAccount}
                                        onChange={e => setFormData(prev => ({
                                            ...prev,
                                            useAccountName: e.target.checked,
                                            name: e.target.checked ? (account?.displayName || prev.name) : prev.name,
                                        }))}
                                    />
                                    {isEnglish ? 'From account' : '来自账户'}
                                </label>
                            )}
                        </span>
                        {nameFromAccount ? (
                            <div className="admin-input" style={fromAccountValueStyle}>
                                {accountName || (isEnglish ? '(from account)' : '（来自账户）')}
                            </div>
                        ) : (
                            <input
                                className="admin-input"
                                value={formData.name}
                                onChange={e => setFormData(prev => ({...prev, name: e.target.value}))}
                                placeholder={isEnglish ? 'Full name in English' : '英文全名'}
                            />
                        )}
                    </div>

                    <label className="admin-tickets-template-field">
                        <span>{isEnglish ? 'Name (Chinese) (optional)' : '姓名（中文）（可选）'}</span>
                        <input
                            className="admin-input"
                            value={formData.nameCn}
                            onChange={e => setFormData(prev => ({...prev, nameCn: e.target.value}))}
                            placeholder={isEnglish ? 'Full name in Chinese' : '中文全名'}
                        />
                    </label>

                    <div className="admin-tickets-template-field">
                        <span style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            gap: '8px'
                        }}>
                            <span>{isEnglish ? 'Role (English)' : '角色（英文）'}</span>
                            {accountLinked && (
                                <label style={fromAccountToggleStyle}>
                                    <input
                                        type="checkbox"
                                        checked={roleFromAccount}
                                        onChange={e => setFormData(prev => ({
                                            ...prev,
                                            useAccountRole: e.target.checked,
                                            role: e.target.checked ? (accTitle?.en || prev.role) : prev.role,
                                            roleCn: e.target.checked ? (accTitle?.zh || prev.roleCn) : prev.roleCn,
                                        }))}
                                    />
                                    {isEnglish ? 'From account' : '来自账户'}
                                </label>
                            )}
                        </span>
                        {roleFromAccount ? (
                            <div className="admin-input" style={fromAccountValueStyle}>
                                {accountRole || (isEnglish ? '(from account title)' : '（来自账户头衔）')}
                            </div>
                        ) : (
                            <input
                                className="admin-input"
                                value={formData.role}
                                onChange={e => setFormData(prev => ({...prev, role: e.target.value}))}
                                placeholder={isEnglish ? 'e.g. President' : '例如：社长'}
                            />
                        )}
                    </div>

                    <div className="admin-tickets-template-field">
                        <span>{isEnglish ? 'Role (Chinese)' : '角色（中文）'}</span>
                        {roleFromAccount ? (
                            <div className="admin-input" style={fromAccountValueStyle}>
                                {accountRoleCn || (isEnglish ? '(from account title)' : '（来自账户头衔）')}
                            </div>
                        ) : (
                            <input
                                className="admin-input"
                                value={formData.roleCn}
                                onChange={e => setFormData(prev => ({...prev, roleCn: e.target.value}))}
                                placeholder={isEnglish ? 'e.g. President' : '例如：社长'}
                            />
                        )}
                    </div>

                    <label className="admin-tickets-template-field"
                           style={{flexDirection: 'row', alignItems: 'center', gap: '8px'}}>
                        <input
                            type="checkbox"
                            checked={!!formData.isHonorary}
                            onChange={e => setFormData(prev => ({...prev, isHonorary: e.target.checked}))}
                        />
                        <span style={{margin: 0}}>
                            {isEnglish ? 'Honorary member (less active)' : '名誉成员（不太活跃）'}
                        </span>
                    </label>

                    <div style={{marginTop: '8px'}}>
                        {accountLinked && (
                            <label style={{...fromAccountToggleStyle, marginBottom: '8px'}}>
                                <input
                                    type="checkbox"
                                    checked={photoFromAccount}
                                    onChange={e => setFormData(prev => ({
                                        ...prev,
                                        useAccountPhoto: e.target.checked,
                                        imageUrl: e.target.checked ? (account?.photoURL || prev.imageUrl) : prev.imageUrl,
                                    }))}
                                />
                                {isEnglish ? 'Use account photo for avatar' : '头像使用账户照片'}
                            </label>
                        )}
                        {photoFromAccount ? (
                            <div className="admin-tickets-template-field">
                                <span>{isEnglish ? 'Member Avatar' : '成员头像'}</span>
                                <img
                                    src={accountPhoto || '/mika.webp'}
                                    alt=""
                                    referrerPolicy="no-referrer"
                                    style={{width: '64px', height: '64px', borderRadius: '50%', objectFit: 'cover'}}
                                />
                            </div>
                        ) : (
                            <ImageUploadField
                                label="Member Avatar"
                                labelCn="成员头像"
                                preview={formData.imageUrl || null}
                                onFileChange={(file, url) => handleImageChange(file, url)}
                                convertToWebp
                                cropAspect={1}
                                showToast={showToast}
                            />
                        )}
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
