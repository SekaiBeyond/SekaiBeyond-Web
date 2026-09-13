import { useState } from 'react';
import { useAuth } from '~/components/AuthProvider';
import { useLanguage } from '~/components/LanguageContextProvider';
import { callSetPassportPrivacy, callSetProfileVisibility } from '~/lib/firebase';
import { PRIVACY_ROWS, type PrivacyKey, privacyRow, privacyStateLabel, readVisibility, } from '~/lib/privacy';
import type { ShowToast } from '~/lib/useToasts';

/**
 * Every privacy switch, read from the signed-in profile and saved one at a
 * time. Saving one switch leaves the others alone, so a second browser tab left
 * open on this page can't undo a change made here.
 *
 * A refresh that fails is swallowed, as it is everywhere else: the write landed,
 * and reporting failure would be a lie the user would act on. The saved value is
 * held locally so the switch stays where the user put it either way.
 */
function usePrivacySettings(showToast: ShowToast): {
    values: Record<PrivacyKey, boolean>;
    /** The key mid-save, so only that row goes busy. */
    saving: PrivacyKey | null;
    setVisible: (key: PrivacyKey, visible: boolean) => Promise<void>;
} {
    const {isEnglish} = useLanguage();
    const {profile, refreshProfile} = useAuth();
    const [saving, setSaving] = useState<PrivacyKey | null>(null);
    const [saved, setSaved] = useState<Partial<Record<PrivacyKey, boolean>>>({});

    const values: Record<PrivacyKey, boolean> = {
        passportPage: !profile?.hidePassportPage,
        ...readVisibility(profile?.profileVisibility),
        ...saved,
    };

    const setVisible = async (key: PrivacyKey, visible: boolean) => {
        setSaving(key);
        try {
            if (key === 'passportPage') {
                await callSetPassportPrivacy({hide: !visible});
            } else {
                await callSetProfileVisibility({sections: {[key]: visible}});
            }
            setSaved(prev => ({...prev, [key]: visible}));
            await refreshProfile().catch(() => {
            });
            const row = privacyRow(key);
            showToast(
                `${isEnglish ? row.title.en : row.title.zh} · ${privacyStateLabel(row, visible, isEnglish)}`,
                'success',
            );
        } catch {
            showToast(isEnglish ? 'Failed to save. Please try again.' : '保存失败，请重试。', 'error');
        } finally {
            setSaving(null);
        }
    };

    return {values, saving, setVisible};
}

/** An on/off switch that saves as soon as it is flipped. */
const PrivacySwitch = ({checked, busy, label, onChange}: {
    checked: boolean;
    busy: boolean;
    label: string;
    onChange: (next: boolean) => void;
}) => (
    <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        className={`settings-switch${checked ? ' settings-switch--on' : ''}`}
        disabled={busy}
        onClick={() => onChange(!checked)}
    >
        <span className="settings-switch-knob"/>
    </button>
);

/**
 * The Settings tab of /profile — what other people are shown.
 *
 * Every switch here is enforced server-side: a hidden section is left out of
 * getPublicProfile entirely, rather than fetched and not drawn, and a private
 * passport page is refused by getPassportPublicProfile. The passport page switch
 * is also an icon on the owner's own passport page, which saves through the same
 * call and refreshes the profile this tab reads.
 *
 * Rendered inside the profile page, which owns the nav, the sign-in wall and the
 * toasts — so this is only the card.
 */
export const ProfileSettingsTab = ({showToast}: {showToast: ShowToast}) => {
    const {isEnglish} = useLanguage();
    const {values, saving, setVisible} = usePrivacySettings(showToast);

    return (
        <section className="settings-section">
            <h2 className="settings-section-title">{isEnglish ? 'Privacy' : '隐私'}</h2>
            <p className="settings-section-note">
                {isEnglish
                    ? 'What other people see when they open your profile or scan one of your passports. Your name and photo are always shown — a passport page has to say whose passport it is.'
                    : '其他人打开您的主页或扫描您的通行证时能看到的内容。您的名称和头像始终显示 — 通行证页面需要标明持有者。'}
            </p>
            <p className="settings-section-note">
                {isEnglish
                    ? 'A section you hide still appears here on your own profile, and club staff can still see it in the admin panel.'
                    : '被隐藏的内容仍会显示在您自己的主页上，社团工作人员也仍可在管理面板中查看。'}
            </p>

            <div className="settings-rows">
                {PRIVACY_ROWS.map(row => {
                    const visible = values[row.key];
                    const title = isEnglish ? row.title.en : row.title.zh;
                    return (
                        <div key={row.key} className="settings-row">
                            <div className="settings-row-text">
                                <span className="settings-row-title">{title}</span>
                                <span className="settings-row-help">
                                    {isEnglish ? row.help.en : row.help.zh}
                                </span>
                                <span className="settings-row-state">
                                    {privacyStateLabel(row, visible, isEnglish)}
                                </span>
                            </div>
                            <PrivacySwitch
                                checked={visible}
                                busy={saving === row.key}
                                label={title}
                                onChange={next => void setVisible(row.key, next)}
                            />
                        </div>
                    );
                })}
            </div>
        </section>
    );
};
