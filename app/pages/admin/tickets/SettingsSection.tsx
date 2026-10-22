import { useState } from 'react';
import { useLanguage } from '~/components/LanguageContextProvider';
import { callSetHometownAdmitUnlisted, errorSuffix } from '~/lib/firebase';
import type { ShowToast } from '../utils';

interface SettingsSectionProps {
    eventId: string;
    /** Null while the setting loads. */
    admitUnlisted: boolean | null;
    onAdmitUnlistedChange: (enabled: boolean) => void;
    readOnly: boolean;
    showToast: ShowToast;
}

/**
 * How the event's door runs, kept apart from importing: whether a HomeTown
 * ticket missing from the imported list is let in.
 */
export function SettingsSection({
                                    eventId,
                                    admitUnlisted,
                                    onAdmitUnlistedChange,
                                    readOnly,
                                    showToast,
                                }: SettingsSectionProps) {
    const {isEnglish} = useLanguage();
    const [saving, setSaving] = useState(false);

    const toggleAdmit = async (enabled: boolean) => {
        if (readOnly) return;
        if (enabled) {
            const ok = window.confirm(isEnglish
                ? 'Let in HomeTown tickets that aren\'t on the imported list? Each is recorded so it can\'t be used twice, but a fake ticket gets in the same way.'
                : '放行不在已导入名单中的 HomeTown 门票？每张都会被记录以防重复使用，但假票也会以同样方式入场。');
            if (!ok) return;
        }
        setSaving(true);
        try {
            await callSetHometownAdmitUnlisted({eventId, enabled});
            onAdmitUnlistedChange(enabled);
            showToast(enabled
                    ? (isEnglish ? 'Unlisted HomeTown tickets are now let in.' : '现已放行未列入名单的 HomeTown 门票。')
                    : (isEnglish ? 'HomeTown tickets must now be on the list.' : 'HomeTown 门票现须在名单中。'),
                enabled ? 'warning' : 'success');
        } catch (err) {
            showToast(isEnglish
                    ? `Failed to change the setting${errorSuffix(err, true)}.`
                    : `更改设置失败${errorSuffix(err, false)}。`,
                'error');
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="admin-tickets-settings">
            <h3>{isEnglish ? 'HomeTown tickets at the door' : '入场时的 HomeTown 门票'}</h3>
            <p className="admin-helper-text">
                {isEnglish
                    ? 'A change here reaches every open scanner at once.'
                    : '此处的更改会立即同步到所有打开的扫码页面。'}
            </p>
            <label className="admin-checkbox-label admin-tickets-hometown-admit">
                <input
                    type="checkbox"
                    checked={admitUnlisted === true}
                    onChange={(e) => void toggleAdmit(e.target.checked)}
                    disabled={readOnly || admitUnlisted === null || saving}
                />
                <span>
                    {isEnglish
                        ? 'Let in HomeTown tickets that aren\'t on the imported list'
                        : '放行不在已导入名单中的 HomeTown 门票'}
                </span>
            </label>
            <p className="admin-helper-text">
                {isEnglish
                    ? 'For tickets bought after the last import. The scanner warns, lets them in and records the number, so the same ticket is refused if it\'s scanned again; a later import that lists it fills in the buyer. A fake ticket gets in the same way, so this is off unless turned on.'
                    : '用于上次导入后购买的门票。扫码时会提示并放行，同时记录门票号，同一张票再次扫描将被拒绝；之后的导入若包含此票，会补上购票者信息。假票也会以同样方式入场，因此默认关闭。'}
            </p>
        </div>
    );
}
