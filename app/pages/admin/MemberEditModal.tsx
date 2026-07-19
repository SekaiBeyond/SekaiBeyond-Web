import { useEffect, useState } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { accountEffectiveTitle, type UserGroup } from '~/components/AuthProvider';
import { useLanguage } from '~/components/LanguageContextProvider';
import { callUploadAdminImage, getFirebaseDb } from '~/lib/firebase';
import type { TeamMemberConfig } from '~/lib/siteConfig';
import { ModalShell } from './ModalShell';
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

// Legacy members used a single useAccountInfo toggle; seed both per-field flags from it.
const seedFormData = (member: TeamMemberConfig | null): TeamMemberConfig => {
    const legacyUseAccountInfo = (member as {useAccountInfo?: boolean} | null)?.useAccountInfo ?? false;
    return {
        id: member?.id || Math.random().toString(36).substring(2, 9),
        uid: member?.uid || '',
        name: member?.name || '',
        nameCn: member?.nameCn || '',
        role: member?.role || '',
        roleCn: member?.roleCn || '',
        imageUrl: member?.imageUrl || '',
        isHonorary: member?.isHonorary || false,
        useAccountRole: member?.useAccountRole ?? legacyUseAccountInfo,
        useAccountPhoto: member?.useAccountPhoto ?? legacyUseAccountInfo,
    };
};

export const MemberEditModal = ({member, onClose, onSave, showToast}: MemberEditModalProps) => {
    const {isEnglish} = useLanguage();

    // The member as currently saved, normalized like the form so single fields can be
    // compared against it and put back.
    const [saved] = useState<TeamMemberConfig>(() => seedFormData(member));
    const [formData, setFormData] = useState<TeamMemberConfig>(saved);

    const [uploading, setUploading] = useState(false);
    // Live values of the linked account, so followed fields preview what visitors will see
    // (the stored formData values are only fallbacks for when the account has none).
    const [account, setAccount] = useState<{
        title: string;
        titleCn: string;
        group: UserGroup;
        photoURL: string
    } | null>(null);

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
            // Linking an account defaults role and photo to following it; snapshot their current
            // values as a fallback for the public page (which live-resolves). The name never
            // follows, so the account's only fills a blank one rather than replacing what the
            // admin typed.
            const accTitle = accountEffectiveTitle(user.group, user.title, user.titleCn);
            setFormData(prev => ({
                ...prev,
                uid: user.uid,
                useAccountRole: true,
                useAccountPhoto: true,
                name: prev.name || user.displayName,
                role: accTitle.en || prev.role,
                roleCn: accTitle.zh || prev.roleCn,
                imageUrl: user.photoURL || prev.imageUrl,
            }));
        } else {
            setFormData(prev => ({
                ...prev,
                uid: '',
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
            // A fresh path per upload, as badges and events do: writing to a path derived from
            // the member id would overwrite the live image before the admin saves, so cancelling
            // would leave the saved member pointing at a replaced file. saveTeamMembers deletes
            // whichever team/ image the save orphans.
            const url = await callUploadAdminImage(file, `team/${crypto.randomUUID()}.webp`);
            setFormData(prev => ({...prev, imageUrl: url}));
            showToast(isEnglish ? 'Image uploaded.' : '图片已上传。', 'success');
        } catch (err) {
            showToast(isEnglish ? 'Image upload failed.' : '图片上传失败。', 'error');
        } finally {
            setUploading(false);
        }
    };

    const accountLinked = !!formData.uid;
    // Role and photo can each independently follow the linked account. A field that follows the
    // account is filled from its live value, so it's hidden here and not required to save.
    // Names are always custom, so both are always editable and the English one is always required.
    const roleFromAccount = accountLinked && !!formData.useAccountRole;
    const photoFromAccount = accountLinked && !!formData.useAccountPhoto;
    // Values shown for followed fields: the account's live value, falling back to the stored one.
    // Role uses the account's effective title (its title, or group label like "President").
    const accTitle = account ? accountEffectiveTitle(account.group, account.title, account.titleCn) : null;
    const accountRole = accTitle?.en || formData.role;
    const accountRoleCn = accTitle?.zh || formData.roleCn;
    const accountPhoto = account?.photoURL || formData.imageUrl;
    const canSave = !uploading
        && formData.name.trim() !== ''
        && (roleFromAccount || formData.role.trim() !== '');

    // Per-field revert back to the saved member. A field that follows the account shows the
    // account's live value, so its stored value is only an invisible fallback: while it is
    // followed, the fallback drifting is not a change the admin made and does not count as
    // edited. Restoring a followed field re-reads the account, mirroring what ticking
    // "From account" does. Adding a member has nothing saved to go back to.
    const isEditing = !!member;
    const revertField = (patch: Partial<TeamMemberConfig>) => setFormData(prev => ({...prev, ...patch}));
    const accountEdited = isEditing && formData.uid !== saved.uid;
    const nameEdited = isEditing && formData.name !== saved.name;
    const nameCnEdited = isEditing && formData.nameCn !== saved.nameCn;
    const roleEdited = isEditing && (formData.useAccountRole !== saved.useAccountRole
        || (!formData.useAccountRole
            && (formData.role !== saved.role || formData.roleCn !== saved.roleCn)));
    const honoraryEdited = isEditing && !!formData.isHonorary !== !!saved.isHonorary;
    const photoEdited = isEditing && (formData.useAccountPhoto !== saved.useAccountPhoto
        || (!formData.useAccountPhoto && formData.imageUrl !== saved.imageUrl));

    // Undoes everything picking an account did, since that is what handleUserSelect changed;
    // the uid change re-runs the effect above, refreshing whichever fields follow the account.
    const revertAccount = () => revertField({
        uid: saved.uid,
        useAccountRole: saved.useAccountRole,
        useAccountPhoto: saved.useAccountPhoto,
        name: saved.name,
        role: saved.role,
        roleCn: saved.roleCn,
        imageUrl: saved.imageUrl,
    });
    const revertRole = () => revertField({
        useAccountRole: saved.useAccountRole,
        role: saved.useAccountRole ? (accTitle?.en || saved.role) : saved.role,
        roleCn: saved.useAccountRole ? (accTitle?.zh || saved.roleCn) : saved.roleCn,
    });
    const revertPhoto = () => revertField({
        useAccountPhoto: saved.useAccountPhoto,
        imageUrl: saved.useAccountPhoto ? (account?.photoURL || saved.imageUrl) : saved.imageUrl,
    });

    // Only rendered once a field differs from the saved member, so it is never a no-op.
    const revertButton = (edited: boolean, onRevert: () => void, titleEn: string, titleCn: string) => (
        edited ? (
            <button
                type="button"
                className="admin-btn admin-btn--revert"
                onClick={onRevert}
                title={isEnglish ? titleEn : titleCn}
            >
                ↺ {isEnglish ? 'Revert' : '还原'}
            </button>
        ) : null
    );

    // Field label on the left, its "From account" / revert controls on the right.
    const fieldHeaderStyle: React.CSSProperties = {
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: '8px',
    };
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
        <ModalShell
            title={member ? (isEnglish ? 'Edit Member' : '编辑成员') : (isEnglish ? 'Add Member' : '添加成员')}
            onClose={onClose}
        >
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
                    {accountEdited && (
                        <div style={{display: 'flex', justifyContent: 'flex-end', marginTop: '6px'}}>
                            {revertButton(
                                accountEdited,
                                revertAccount,
                                'Revert the linked account, and the name, role and photo it filled in, to the saved values',
                                '将关联账户，以及它填入的姓名、角色和照片，还原为已保存的值',
                            )}
                        </div>
                    )}
                </div>

                {accountLinked && (
                    <p className="admin-helper-text" style={{marginTop: 0, marginBottom: '12px'}}>
                        {isEnglish
                            ? 'Tick "From account" on the role, or "Use account photo", to have that field follow the linked account and update automatically; untick to set it yourself. The role follows the account in both English and Chinese. Names are always custom — linking an account only fills in a blank name.'
                            : '在角色勾选“来自账户”，或勾选“头像使用账户照片”，即可让该字段跟随关联账户并自动更新；取消勾选可自行设置。角色的中英文均跟随账户。姓名始终为自定义——关联账户仅会填充空白的姓名。'}
                    </p>
                )}

                <div className="admin-tickets-template-field">
                        <span style={fieldHeaderStyle}>
                            <span>{isEnglish ? 'Name (English)' : '姓名（英文）'}</span>
                            {revertButton(
                                nameEdited,
                                () => revertField({name: saved.name}),
                                'Revert the English name to the saved value',
                                '将英文姓名还原为已保存的值',
                            )}
                        </span>
                    <input
                        className="admin-input"
                        value={formData.name}
                        onChange={e => setFormData(prev => ({...prev, name: e.target.value}))}
                        placeholder={isEnglish ? 'Full name in English' : '英文全名'}
                    />
                </div>

                <div className="admin-tickets-template-field">
                        <span style={fieldHeaderStyle}>
                            <span>{isEnglish ? 'Name (Chinese) (optional)' : '姓名（中文）（可选）'}</span>
                            {revertButton(
                                nameCnEdited,
                                () => revertField({nameCn: saved.nameCn}),
                                'Revert the Chinese name to the saved value',
                                '将中文姓名还原为已保存的值',
                            )}
                        </span>
                    <input
                        className="admin-input"
                        value={formData.nameCn}
                        onChange={e => setFormData(prev => ({...prev, nameCn: e.target.value}))}
                        placeholder={isEnglish ? 'Full name in Chinese' : '中文全名'}
                    />
                </div>

                <div className="admin-tickets-template-field">
                        <span style={fieldHeaderStyle}>
                            <span>{isEnglish ? 'Role (English)' : '角色（英文）'}</span>
                            <span style={{display: 'flex', alignItems: 'center', gap: '10px'}}>
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
                                {/* One toggle governs both languages, so the pair reverts together. */}
                                {revertButton(
                                    roleEdited,
                                    revertRole,
                                    'Revert the role, in both English and Chinese, to the saved value',
                                    '将角色的中英文均还原为已保存的值',
                                )}
                            </span>
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

                {/* The revert button sits outside the label so clicking it cannot toggle the box. */}
                <div style={fieldHeaderStyle}>
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
                    {revertButton(
                        honoraryEdited,
                        () => revertField({isHonorary: saved.isHonorary}),
                        'Revert honorary member to the saved value',
                        '将名誉成员还原为已保存的值',
                    )}
                </div>

                {/* The avatar owns a labelled header like every other field; the checkbox
                        says only where the photo comes from, so it drops "for avatar". */}
                <div className="admin-tickets-template-field" style={{marginTop: '8px'}}>
                        <span style={fieldHeaderStyle}>
                            <span>{isEnglish ? 'Member Avatar' : '成员头像'}</span>
                            <span style={{display: 'flex', alignItems: 'center', gap: '10px'}}>
                                {accountLinked && (
                                    <label style={fromAccountToggleStyle}>
                                        <input
                                            type="checkbox"
                                            checked={photoFromAccount}
                                            onChange={e => setFormData(prev => ({
                                                ...prev,
                                                useAccountPhoto: e.target.checked,
                                                imageUrl: e.target.checked ? (account?.photoURL || prev.imageUrl) : prev.imageUrl,
                                            }))}
                                        />
                                        {isEnglish ? 'Use account photo' : '使用账户照片'}
                                    </label>
                                )}
                                {revertButton(
                                    photoEdited,
                                    revertPhoto,
                                    'Revert the avatar to the saved value',
                                    '将头像还原为已保存的值',
                                )}
                            </span>
                        </span>
                    {photoFromAccount ? (
                        <div className="admin-avatar-field">
                            <img
                                className={`admin-avatar-preview${accountPhoto ? '' : ' admin-avatar-preview-default'}`}
                                src={accountPhoto || '/mika.webp'}
                                alt=""
                                referrerPolicy="no-referrer"
                            />
                            <div className="admin-avatar-actions">
                                {/* Mirrors what accountPhoto actually resolves to: the account's
                                        photo, else the member's stored image, else the site default. */}
                                <p className="admin-helper-text admin-avatar-helper">
                                    {account?.photoURL
                                        ? (isEnglish
                                            ? 'Updates automatically when they change their account photo.'
                                            : '当其更换账户照片时会自动更新。')
                                        : formData.imageUrl
                                            ? (isEnglish
                                                ? 'This account has no photo, so the uploaded image is shown instead.'
                                                : '该账户没有照片，因此显示已上传的图片。')
                                            : (isEnglish
                                                ? 'This account has no photo yet, so the default avatar is shown.'
                                                : '该账户尚无照片，因此显示默认头像。')}
                                </p>
                            </div>
                        </div>
                    ) : (
                        <ImageUploadField
                            variant="avatar"
                            preview={formData.imageUrl || null}
                            placeholderSrc="/mika.webp"
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
        </ModalShell>
    );
};
