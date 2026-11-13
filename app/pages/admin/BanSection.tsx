import { useState } from 'react';
import { useLanguage } from '~/components/LanguageContextProvider';
import { callBanUser, callUnbanUser } from '~/lib/firebase';
import { formatSiteTime, parseSiteTime, siteDay } from '~/lib/siteTime';
import { isBanActive, type UserRecord } from './types';
import type { ShowToast } from './utils';

interface BanSectionProps {
    user: UserRecord;
    /** Core-staff+ acting on someone below them, not themselves. Everyone else sees the status only. */
    canManage: boolean;
    onUpdated: (uid: string, changes: Partial<UserRecord>) => void;
    showToast: ShowToast;
}

/** How long a ban lasts: a number of days from now, to the end of a chosen day, or until lifted. */
type BanTerm = {kind: 'days'; days: number} | {kind: 'date'} | {kind: 'lifted'};

const QUICK_TERMS = [1, 7, 30];

const DAY_MS = 86_400_000;

/**
 * A ban keeps an account from signing in, to the site or any app, and signs
 * it out everywhere at once. Kept apart from the group, which it never changes.
 */
export function BanSection({user, canManage, onUpdated, showToast}: BanSectionProps) {
    const {isEnglish} = useLanguage();
    const [editing, setEditing] = useState(false);
    const [term, setTerm] = useState<BanTerm>({kind: 'lifted'});
    const [dateInput, setDateInput] = useState('');
    const [reasonInput, setReasonInput] = useState('');
    const [busy, setBusy] = useState(false);

    const ban = user.ban;
    const active = isBanActive(ban);
    const fmt = (date: Date) => formatSiteTime(date, isEnglish, {
        year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit',
    });

    const statusText = () => {
        if (!ban) return isEnglish ? 'Not banned' : '未封禁';
        if (!active) return isEnglish ? `Ban ran out on ${fmt(ban.until!)}` : `封禁已于 ${fmt(ban.until!)} 到期`;
        if (!ban.until) return isEnglish ? 'Banned until lifted' : '已封禁，直至解除';
        return isEnglish ? `Banned until ${fmt(ban.until)}` : `已封禁，至 ${fmt(ban.until)}`;
    };

    const startEditing = () => {
        // Changing a ban in force starts from its terms.
        if (ban && active && ban.until) {
            setTerm({kind: 'date'});
            setDateInput(siteDay(ban.until));
        } else {
            setTerm({kind: 'lifted'});
            setDateInput('');
        }
        setReasonInput(ban && active ? ban.reason : '');
        setEditing(true);
    };

    /** The ban's end as the server takes it, null for until lifted, or undefined while a date is still to pick. */
    const untilFor = (): Date | null | undefined => {
        if (term.kind === 'lifted') return null;
        if (term.kind === 'days') return new Date(Date.now() + term.days * DAY_MS);
        // To the end of the chosen day on the Pacific calendar, as membership is.
        return dateInput ? parseSiteTime(`${dateInput}T23:59:59`) : undefined;
    };
    const until = untilFor();
    const untilInPast = !!until && until.getTime() <= Date.now();

    const submit = async () => {
        if (until === undefined || untilInPast) return;
        const termText = until
            ? (isEnglish ? `until ${fmt(until)}` : `至 ${fmt(until)}`)
            : (isEnglish ? 'until lifted' : '直至解除');
        if (!window.confirm(isEnglish
            ? `Ban ${user.displayName} ${termText}? They're signed out everywhere at once, and can't sign in to the site or any app while it lasts.`
            : `封禁 ${user.displayName}，${termText}？其所有设备将立即退出登录，封禁期间无法登录本站或任何应用。`)) return;

        setBusy(true);
        try {
            const result = await callBanUser({
                targetUid: user.uid,
                until: until ? until.toISOString() : null,
                reason: reasonInput.trim(),
            });
            const saved = result.data.ban;
            onUpdated(user.uid, {
                ban: {
                    at: new Date(saved.at),
                    until: saved.until ? new Date(saved.until) : null,
                    reason: saved.reason,
                    byName: saved.byName,
                },
            });
            setEditing(false);
            showToast(isEnglish ? 'Account banned.' : '已封禁该账号。', 'warning');
        } catch {
            showToast(
                isEnglish
                    ? 'Failed to ban this account. You may not have permission for this action.'
                    : '封禁失败。你可能没有权限执行此操作。',
                'error',
            );
        } finally {
            setBusy(false);
        }
    };

    const lift = async () => {
        if (!window.confirm(isEnglish
            ? `Lift ${user.displayName}'s ban? They can sign in again straight away.`
            : `解除 ${user.displayName} 的封禁？其可立即重新登录。`)) return;
        setBusy(true);
        try {
            await callUnbanUser({targetUid: user.uid});
            onUpdated(user.uid, {ban: null});
            setEditing(false);
            showToast(isEnglish ? 'Ban lifted.' : '已解除封禁。', 'success');
        } catch {
            showToast(
                isEnglish
                    ? 'Failed to lift the ban. You may not have permission for this action.'
                    : '解除封禁失败。你可能没有权限执行此操作。',
                'error',
            );
        } finally {
            setBusy(false);
        }
    };

    const chip = (key: string, selected: boolean, label: string, onClick: () => void) => (
        <button
            key={key}
            className={`admin-btn admin-btn--chip${selected ? ' admin-btn--chip-active' : ''}`}
            onClick={onClick}
            disabled={busy}
            aria-pressed={selected}
        >
            {label}
        </button>
    );

    return (
        <div className="admin-group-section">
            <h4 className="admin-badges-title">
                {isEnglish ? 'Ban' : '封禁'}
            </h4>
            <div className="admin-group-current">
                <span className="admin-group-label">
                    {isEnglish ? 'Status: ' : '状态：'}
                </span>
                <span className={`admin-ban-status${active ? ' admin-ban-status--active' : ''}`}>
                    {statusText()}
                </span>
            </div>
            {ban && (
                <p className="admin-ban-detail">
                    {isEnglish
                        ? `Banned on ${fmt(ban.at)}${ban.byName ? ` by ${ban.byName}` : ''}.`
                        : `${ban.byName ? `由 ${ban.byName} ` : ''}于 ${fmt(ban.at)} 封禁。`}
                    {ban.reason && (
                        <>
                            <br/>
                            {isEnglish ? 'Reason: ' : '原因：'}{ban.reason}
                        </>
                    )}
                </p>
            )}

            {canManage && !editing && (
                <div className="admin-title-input-row admin-ban-actions">
                    <button className="admin-deletion-request-btn" onClick={startEditing} disabled={busy}>
                        {active
                            ? (isEnglish ? 'Change ban' : '修改封禁')
                            : (isEnglish ? 'Ban account' : '封禁账号')}
                    </button>
                    {active && (
                        <button className="admin-btn admin-btn--outline" onClick={lift} disabled={busy}>
                            {isEnglish ? 'Lift ban' : '解除封禁'}
                        </button>
                    )}
                </div>
            )}

            {canManage && editing && (
                <div className="admin-ban-form">
                    <div className="admin-group-actions">
                        {QUICK_TERMS.map(days => chip(
                            String(days),
                            term.kind === 'days' && term.days === days,
                            isEnglish ? `${days} day${days === 1 ? '' : 's'}` : `${days} 天`,
                            () => setTerm({kind: 'days', days}),
                        ))}
                        {chip('date', term.kind === 'date', isEnglish ? 'Until a date' : '至指定日期', () => setTerm({kind: 'date'}))}
                        {chip('lifted', term.kind === 'lifted', isEnglish ? 'Until lifted' : '直至解除', () => setTerm({kind: 'lifted'}))}
                    </div>
                    {term.kind === 'date' && (
                        <input
                            type="date"
                            className="admin-input admin-input--sm admin-ban-date"
                            value={dateInput}
                            min={siteDay(new Date())}
                            onChange={(e) => setDateInput(e.target.value)}
                            disabled={busy}
                            aria-label={isEnglish ? 'Last day of the ban' : '封禁最后一天'}
                        />
                    )}
                    <label className="admin-title-field">
                        <span className="admin-title-field-label">
                            {isEnglish ? 'Reason (seen by staff only)' : '原因（仅工作人员可见）'}
                        </span>
                        <textarea
                            className="admin-input admin-input--sm admin-textarea"
                            value={reasonInput}
                            onChange={(e) => setReasonInput(e.target.value)}
                            maxLength={500}
                            disabled={busy}
                            placeholder={isEnglish ? 'What happened, for whoever looks at this later' : '发生了什么，供日后查看'}
                        />
                    </label>
                    <div className="admin-title-input-row">
                        <button
                            className="admin-deletion-cancel-btn"
                            onClick={submit}
                            disabled={busy || until === undefined || untilInPast}
                        >
                            {busy
                                ? (isEnglish ? 'Saving...' : '保存中...')
                                : active
                                    ? (isEnglish ? 'Save ban' : '保存封禁')
                                    : (isEnglish ? 'Ban' : '封禁')}
                        </button>
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
                            ? 'A ban signs them out on every device and of every app at once, and they can\'t sign in again until it ends. A chosen date runs to the end of that day, Pacific time. Their group, membership and profile stay as they are.'
                            : '封禁会立即让其在所有设备和所有应用中退出登录，封禁结束前无法再次登录。指定日期截至当天结束（太平洋时间）。其用户组、会员资格和个人主页保持不变。'}
                    </p>
                </div>
            )}
        </div>
    );
}
