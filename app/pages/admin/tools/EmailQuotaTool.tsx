import { useCallback, useEffect, useState } from 'react';
import { useLanguage } from '~/components/LanguageContextProvider';
import { callGetEmailQuotaStatus } from '~/lib/firebase';
import type { ShowToast } from '../utils';

interface EmailQuotaToolProps {
    onBack: () => void;
    showToast: ShowToast;
}

interface QuotaStatus {
    provider: {
        id: string;
        name: string;
        windowKind: 'rolling24h' | 'calendarDay';
        fromAddress: string;
    };
    providerReported: number | null;
    readingSource: 'live' | 'cached' | 'unavailable';
    sentToday: number;
    dailyCap: number;
    confirmed: number;
    reserved: number;
    observedAt: string | null;
    queuedCount: number;
    oldestQueuedAt: string | null;
    queueCap: number;
    drainIntervalMinutes: number;
    serverNow: string;
}

// Remaining headroom at or below this is called out as "running low" so an
// admin sees it before starting a send that would spill into the queue.
const LOW_HEADROOM = 10;

// Age of `iso` measured against the server's clock rather than the browser's,
// so a skewed local clock can't render a fresh counter as hours old. Returns
// null when the timestamp is absent (counter never written / empty queue).
const formatAge = (
    iso: string | null,
    serverNow: string,
    isEnglish: boolean,
): string | null => {
    if (!iso) return null;
    const then = Date.parse(iso);
    const now = Date.parse(serverNow);
    if (Number.isNaN(then) || Number.isNaN(now)) return null;
    const minutes = Math.max(0, Math.round((now - then) / 60_000));
    if (minutes < 1) return isEnglish ? 'just now' : '刚刚';
    if (minutes < 60) {
        return isEnglish ? `${minutes} min ago` : `${minutes} 分钟前`;
    }
    const hours = Math.floor(minutes / 60);
    if (hours < 24) {
        const rem = minutes % 60;
        return isEnglish
            ? `${hours}h ${rem}m ago`
            : `${hours} 小时 ${rem} 分钟前`;
    }
    const days = Math.floor(hours / 24);
    return isEnglish ? `${days}d ${hours % 24}h ago` : `${days} 天 ${hours % 24} 小时前`;
};

export const EmailQuotaTool = ({onBack, showToast}: EmailQuotaToolProps) => {
    const {isEnglish} = useLanguage();
    const [status, setStatus] = useState<QuotaStatus | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(false);

    const load = useCallback(async (notify: boolean) => {
        setLoading(true);
        try {
            const res = await callGetEmailQuotaStatus();
            setStatus(res.data);
            setError(false);
            if (notify) {
                showToast(isEnglish ? 'Quota refreshed.' : '额度已刷新。', 'success');
            }
        } catch (err) {
            console.error('[EmailQuotaTool] load', err);
            setError(true);
            if (notify) {
                showToast(
                    isEnglish ? 'Could not load email quota.' : '无法加载邮件额度。',
                    'error',
                );
            }
        } finally {
            setLoading(false);
        }
    }, [isEnglish, showToast]);

    useEffect(() => {
        // Mount fetch only — refreshing is manual, so the panel doesn't poll a
        // callable in the background while the tool sits open. Deliberately not
        // keyed on `load`: a language toggle shouldn't trigger a refetch.
        void load(false);
    }, []);

    const providerName = status?.provider.name ?? '';
    const unavailable = status?.readingSource === 'unavailable';

    // Send decisions are gated on the local counter (provider count + in-flight
    // reservations), so headroom is derived from that rather than from the
    // provider's own number — otherwise the panel would promise capacity that
    // a concurrent send has already spoken for.
    const remainingToday = status ? Math.max(0, status.dailyCap - status.sentToday) : 0;
    const remainingQueue = status ? Math.max(0, status.queueCap - status.queuedCount) : 0;
    const atCap = status !== null && !unavailable && remainingToday === 0;
    const lowHeadroom = status !== null && !unavailable
        && remainingToday > 0 && remainingToday <= LOW_HEADROOM;
    const queueFull = status !== null && remainingQueue === 0 && status.queuedCount > 0;

    // Meter segments as percentages of the cap. `confirmed` is what the provider
    // has counted; `reserved` is pre-charged and still in flight. Both are
    // clamped so a counter that briefly overshoots the cap can't overflow the bar.
    const confirmedPct = status
        ? Math.min(100, (status.confirmed / Math.max(1, status.dailyCap)) * 100)
        : 0;
    const reservedPct = status
        ? Math.min(100 - confirmedPct, (status.reserved / Math.max(1, status.dailyCap)) * 100)
        : 0;

    const observedAge = status && formatAge(status.observedAt, status.serverNow, isEnglish);
    const oldestQueuedAge = status
        && formatAge(status.oldestQueuedAt, status.serverNow, isEnglish);

    // How current the headline number is. A live probe means it should match
    // the provider's dashboard right now; "cached" is a leftover reading from
    // the last send and is only as good as its age.
    const readingLabel = !status ? '' : status.readingSource === 'live'
        ? (isEnglish ? `live from ${providerName}` : `来自 ${providerName} 实时数据`)
        : status.readingSource === 'cached'
            ? (isEnglish
                ? `last reading ${observedAge ?? 'unknown'}`
                : `上次读数${observedAge ?? '未知'}`)
            : (isEnglish ? 'not reported' : '未提供');

    return (
        <div className="admin-section">
            <div className="admin-tools-header">
                <button className="admin-btn admin-btn--link" onClick={onBack} type="button">
                    {isEnglish ? '← Back to Tools' : '← 返回工具'}
                </button>
                <h3 className="admin-tools-title">
                    {isEnglish ? 'Email Quota' : '邮件额度'}
                </h3>
                <button
                    className="admin-toggle-btn admin-toggle-edit admin-quota-refresh"
                    onClick={() => void load(true)}
                    disabled={loading}
                    type="button"
                >
                    {loading
                        ? (isEnglish ? 'Loading...' : '加载中...')
                        : (isEnglish ? 'Refresh' : '刷新')}
                </button>
            </div>

            <p className="admin-helper-text admin-section-mb">
                {isEnglish
                    ? `Outbound email runs through ${providerName || 'the configured email provider'}, which allows a limited number of emails per day. Every to/cc/bcc address counts as one. Sends past the limit are queued and shipped automatically as headroom reopens.`
                    : `所有外发邮件通过 ${providerName || '已配置的邮件服务'} 发送，每日发送量有限。每个收件人（含抄送、密送）各计一封。超出上限的邮件会进入队列，待额度恢复后自动发送。`}
            </p>

            {error && !status && (
                <div className="admin-tickets-send-banner admin-tickets-send-banner-error">
                    <span>
                        {isEnglish
                            ? 'Could not load email quota. Try refreshing.'
                            : '无法加载邮件额度，请尝试刷新。'}
                    </span>
                </div>
            )}

            {!status && loading && (
                <div className="profile-spinner admin-spinner-center"/>
            )}

            {status && (
                <>
                    <div className={`admin-tickets-send-banner ${
                        unavailable ? 'admin-tickets-send-banner-warning'
                            : atCap && queueFull ? 'admin-tickets-send-banner-error'
                                : (atCap || lowHeadroom || queueFull) ? 'admin-tickets-send-banner-warning'
                                    : 'admin-tickets-send-banner-info'}`}>
                        <span>
                            {unavailable
                                ? (isEnglish
                                    ? `${providerName} is not reporting a daily quota for this account, so usage can't be shown here — check the ${providerName} dashboard. This usually means the account is on a paid plan where the daily limit no longer applies.`
                                    : `${providerName} 未针对此账号提供每日额度数据，因此此处无法显示用量，请前往 ${providerName} 控制台查看。这通常表示账号已升级为付费方案，每日上限不再适用。`)
                                : atCap && queueFull
                                    ? (isEnglish
                                        ? 'Daily limit reached and the overflow queue is full — new sends will be rejected until the queue drains.'
                                        : '已达每日上限且排队已满 — 在队列清空前将无法发送新邮件。')
                                    : atCap
                                        ? (isEnglish
                                            ? `Daily limit reached. New sends will be queued (${remainingQueue} slots left) and go out as headroom reopens.`
                                            : `已达每日上限。新邮件将进入队列（剩余 ${remainingQueue} 个名额），待额度恢复后发送。`)
                                        : lowHeadroom
                                            ? (isEnglish
                                                ? `Only ${remainingToday} email${remainingToday === 1 ? '' : 's'} left before sends start queueing.`
                                                : `仅剩 ${remainingToday} 封额度，超出后邮件将进入队列。`)
                                            : queueFull
                                                ? (isEnglish
                                                    ? 'The overflow queue is full. Headroom is available, so it should drain on the next run.'
                                                    : '排队已满。当前仍有可用额度，下次运行时应会开始清空。')
                                                : (isEnglish
                                                    ? `${remainingToday} of ${status.dailyCap} emails still available.`
                                                    : `还有 ${remainingToday} / ${status.dailyCap} 封可发送。`)}
                        </span>
                    </div>

                    {!unavailable && (
                        <div className="admin-quota-meter">
                            <div className="admin-quota-meter-track">
                                <div
                                    className="admin-quota-meter-fill admin-quota-meter-fill--confirmed"
                                    style={{width: `${confirmedPct}%`}}
                                />
                                <div
                                    className="admin-quota-meter-fill admin-quota-meter-fill--reserved"
                                    style={{width: `${reservedPct}%`}}
                                />
                            </div>
                            <div className="admin-quota-meter-legend">
                                <span className="admin-quota-legend-item">
                                    <i className="admin-quota-swatch admin-quota-swatch--confirmed"/>
                                    {isEnglish ? 'Counted by' : '已计入'} {providerName} ({status.confirmed})
                                </span>
                                <span className="admin-quota-legend-item">
                                    <i className="admin-quota-swatch admin-quota-swatch--reserved"/>
                                    {isEnglish ? 'In flight' : '发送中'} ({status.reserved})
                                </span>
                                <span className="admin-quota-legend-item">
                                    <i className="admin-quota-swatch admin-quota-swatch--free"/>
                                    {isEnglish ? 'Available' : '可用'} ({remainingToday})
                                </span>
                            </div>
                        </div>
                    )}

                    <div className="admin-stats-tiles admin-section-mb">
                        <div className="admin-stats-tile">
                            <div className="admin-stats-tile-label">
                                {isEnglish ? `Used per ${providerName}` : `${providerName} 记录用量`}
                            </div>
                            <div className={`admin-stats-tile-value${
                                status.providerReported === null ? ' admin-stats-tile-value--sm' : ''}`}>
                                {status.providerReported === null
                                    ? (isEnglish ? 'Not reported' : '未提供')
                                    : `${status.providerReported} / ${status.dailyCap}`}
                            </div>
                            <div className="admin-stats-tile-sub">{readingLabel}</div>
                        </div>
                        <div className="admin-stats-tile">
                            <div className="admin-stats-tile-label">
                                {isEnglish ? 'Available' : '可用额度'}
                            </div>
                            <div className="admin-stats-tile-value">
                                {unavailable ? '—' : remainingToday}
                            </div>
                            <div className="admin-stats-tile-sub">
                                {isEnglish ? 'before sends queue' : '超出后进入队列'}
                            </div>
                        </div>
                        <div className="admin-stats-tile">
                            <div className="admin-stats-tile-label">
                                {isEnglish ? 'In flight' : '发送中'}
                            </div>
                            <div className="admin-stats-tile-value">{status.reserved}</div>
                            <div className="admin-stats-tile-sub">
                                {isEnglish
                                    ? `not yet counted by ${providerName}`
                                    : `${providerName} 尚未计入`}
                            </div>
                        </div>
                        <div className="admin-stats-tile">
                            <div className="admin-stats-tile-label">
                                {isEnglish ? 'Queued' : '排队中'}
                            </div>
                            <div className="admin-stats-tile-value">
                                {status.queuedCount} / {status.queueCap}
                            </div>
                            <div className="admin-stats-tile-sub">
                                {status.queuedCount === 0
                                    ? (isEnglish ? 'queue empty' : '队列为空')
                                    : oldestQueuedAge
                                        ? (isEnglish
                                            ? `oldest queued ${oldestQueuedAge}`
                                            : `最早入队于${oldestQueuedAge}`)
                                        : (isEnglish ? 'waiting to send' : '等待发送')}
                            </div>
                        </div>
                    </div>

                    <div className="admin-stats-card">
                        <div className="admin-stats-card-title">
                            {isEnglish ? 'How this works' : '说明'}
                        </div>
                        <ul className="admin-quota-notes">
                            <li>
                                {isEnglish
                                    ? `"Used per ${providerName}" is read from ${providerName} each time this page loads, so it should match their dashboard.`
                                    : `"${providerName} 记录用量"在每次打开本页时从 ${providerName} 读取，因此应与其控制台一致。`}
                            </li>
                            <li>
                                {isEnglish
                                    ? `"In flight" covers sends already charged against the limit but not yet counted by ${providerName}. Sends are gated on used + in flight, so "Available" can be lower than ${providerName}'s number implies; it clears on its own.`
                                    : `"发送中"指已占用额度但 ${providerName} 尚未计入的邮件。发送判断基于"已用 + 发送中"，因此"可用额度"可能低于 ${providerName} 数字所示，该部分会自动结算。`}
                            </li>
                            <li>
                                {status.provider.windowKind === 'rolling24h'
                                    ? (isEnglish
                                        ? `${providerName} counts a rolling 24-hour window, not a calendar day — capacity returns gradually as older sends age out, not all at once.`
                                        : `${providerName} 按滚动 24 小时窗口计算，而非自然日 — 额度随着早前邮件超过 24 小时逐步恢复，而非一次性重置。`)
                                    : (isEnglish
                                        ? `${providerName} resets the allowance on a calendar-day boundary.`
                                        : `${providerName} 的额度按自然日重置。`)}
                            </li>
                            <li>
                                {isEnglish
                                    ? `The queue drains automatically every ${status.drainIntervalMinutes} minutes, sending as much as the remaining limit allows.`
                                    : `队列每 ${status.drainIntervalMinutes} 分钟自动清空一次，按剩余额度尽可能发送。`}
                            </li>
                            <li>
                                {isEnglish
                                    ? `Sender address: ${status.provider.fromAddress}`
                                    : `发件地址：${status.provider.fromAddress}`}
                            </li>
                        </ul>
                    </div>
                </>
            )}
        </div>
    );
};
