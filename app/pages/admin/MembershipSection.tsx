import { useState } from 'react';
import { useLanguage } from '~/components/LanguageContextProvider';
import { callSetMembership } from '~/lib/firebase';
import type { UserRecord } from './types';
import type { ShowToast } from './utils';

interface MembershipSectionProps {
    user: UserRecord;
    /** Core-staff+ acting on someone below them. Read-only staff never see the controls. */
    canManage: boolean;
    onUpdated: (updated: UserRecord) => void;
    showToast: ShowToast;
}

const QUICK_EXTENSIONS = [30, 90, 365];

const toDateInputValue = (date: Date) => {
    const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
    return local.toISOString().slice(0, 10);
};

const daysUntil = (date: Date) => Math.ceil((date.getTime() - Date.now()) / 86_400_000);

/**
 * Membership is a time-boxed attribute, not a group — editing it here never
 * touches the user's role, so a president can hold one just like anyone else.
 */
export function MembershipSection({user, canManage, onUpdated, showToast}: MembershipSectionProps) {
    const {isEnglish} = useLanguage();
    const [editing, setEditing] = useState(false);
    const [dateInput, setDateInput] = useState('');
    const [busy, setBusy] = useState(false);

    const expiresAt = user.membershipExpiresAt;
    const isActive = !!expiresAt && expiresAt.getTime() > Date.now();

    const statusText = () => {
        if (!expiresAt) return isEnglish ? 'Not a member' : '非会员';
        const formatted = expiresAt.toLocaleDateString(isEnglish ? 'en-US' : 'zh-CN', {
            year: 'numeric', month: 'long', day: 'numeric',
        });
        if (!isActive) {
            return isEnglish ? `Lapsed on ${formatted}` : `已于 ${formatted} 过期`;
        }
        const remaining = daysUntil(expiresAt);
        return isEnglish
            ? `Member until ${formatted} (${remaining} days left)`
            : `会员有效期至 ${formatted}（剩余 ${remaining} 天）`;
    };

    const apply = async (
        payload: {expiresAt: string | null} | {extendDays: number},
        successMessage: string,
    ) => {
        setBusy(true);
        try {
            const result = await callSetMembership({targetUid: user.uid, ...payload});
            const iso = result.data.membershipExpiresAt;
            onUpdated({...user, membershipExpiresAt: iso ? new Date(iso) : null});
            setEditing(false);
            showToast(successMessage, 'success');
        } catch {
            showToast(
                isEnglish
                    ? 'Failed to update membership. You may not have permission for this action.'
                    : '更新会员资格失败。你可能没有权限执行此操作。',
                'error',
            );
        } finally {
            setBusy(false);
        }
    };

    const saveDate = () => {
        if (!dateInput) return;
        // Membership runs to the end of the chosen day rather than to midnight at
        // its start, so "expires on the 5th" means the 5th is still covered.
        const iso = new Date(`${dateInput}T23:59:59`).toISOString();
        void apply({expiresAt: iso}, isEnglish ? 'Membership updated.' : '会员资格已更新。');
    };

    const revoke = () => {
        const confirmed = window.confirm(isEnglish
            ? `End ${user.displayName}'s membership immediately? Their role is not affected.`
            : `立即终止 ${user.displayName} 的会员资格？其用户组不受影响。`);
        if (!confirmed) return;
        void apply({expiresAt: null}, isEnglish ? 'Membership revoked.' : '会员资格已撤销。');
    };

    return (
        <div className="admin-group-section">
            <h4 className="admin-badges-title">
                {isEnglish ? 'Membership' : '会员资格'}
            </h4>
            <div className="admin-group-current">
                <span className="admin-group-label">
                    {isEnglish ? 'Status: ' : '状态：'}
                </span>
                <span className={`admin-membership-status${isActive ? ' admin-membership-status--active' : ''}`}>
                    {statusText()}
                </span>
                {canManage && !editing && (
                    <button
                        className="admin-detail-name-pencil"
                        onClick={() => {
                            setDateInput(expiresAt ? toDateInputValue(expiresAt) : '');
                            setEditing(true);
                        }}
                        type="button"
                        title={isEnglish ? 'Edit membership' : '编辑会员资格'}
                        aria-label={isEnglish ? 'Edit membership' : '编辑会员资格'}
                    >
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
                             strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/>
                        </svg>
                    </button>
                )}
            </div>

            {canManage && editing && (
                <>
                    <div className="admin-group-actions">
                        {QUICK_EXTENSIONS.map(days => (
                            <button
                                key={days}
                                className="admin-btn admin-btn--chip"
                                disabled={busy}
                                onClick={() => void apply(
                                    {extendDays: days},
                                    isEnglish ? `Extended by ${days} days.` : `已延长 ${days} 天。`,
                                )}
                            >
                                {isEnglish ? `+${days} days` : `+${days} 天`}
                            </button>
                        ))}
                    </div>
                    <div className="admin-title-input-row">
                        <input
                            type="date"
                            className="admin-input admin-input--sm"
                            value={dateInput}
                            onChange={(e) => setDateInput(e.target.value)}
                            disabled={busy}
                        />
                        <button
                            className="admin-btn admin-btn--cta"
                            onClick={saveDate}
                            disabled={busy || !dateInput}
                        >
                            {busy
                                ? (isEnglish ? 'Saving...' : '保存中...')
                                : (isEnglish ? 'Set expiry' : '设置到期日')}
                        </button>
                        {expiresAt && (
                            <button
                                className="admin-deletion-request-btn"
                                onClick={revoke}
                                disabled={busy}
                            >
                                {isEnglish ? 'Revoke' : '撤销'}
                            </button>
                        )}
                        <button
                            className="admin-btn admin-btn--outline"
                            onClick={() => setEditing(false)}
                            disabled={busy}
                        >
                            {isEnglish ? 'Cancel' : '取消'}
                        </button>
                    </div>
                    <p className="admin-title-hint">
                        {isEnglish
                            ? 'Extensions stack: adding days to an active membership extends its tail, while adding to a lapsed one starts from today. Changing membership never changes the user\'s role.'
                            : '延长会累加：为有效会员延长会在原到期日基础上顺延，为已过期会员延长则从今天开始计算。修改会员资格不会改变用户组。'}
                    </p>
                </>
            )}
        </div>
    );
}
