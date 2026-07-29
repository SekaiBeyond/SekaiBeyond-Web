import { useCallback, useEffect, useState } from 'react';
import { useLanguage } from '~/components/LanguageContextProvider';
import { callGetEmailQuotaStatus } from '~/lib/firebase';
import type { ShowToast } from '../utils';

interface EmailQuotaToolProps {
    onBack: () => void;
    showToast: ShowToast;
}

interface QuotaStatus {
    sentToday: number;
    dailyCap: number;
    confirmed: number;
    reserved: number;
    observedAt: string | null;
    queuedCount: number;
    oldestQueuedAt: string | null;
    queueCap: number;
    drainIntervalMinutes: number;
    fromAddress: string;
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

    const remainingToday = status ? Math.max(0, status.dailyCap - status.sentToday) : 0;
    const remainingQueue = status ? Math.max(0, status.queueCap - status.queuedCount) : 0;
    const atCap = status !== null && remainingToday === 0;
    const lowHeadroom = status !== null && remainingToday > 0 && remainingToday <= LOW_HEADROOM;
    const queueFull = status !== null && remainingQueue === 0 && status.queuedCount > 0;

    // Meter segments as percentages of the cap. `confirmed` is mail Resend has
    // acknowledged; `reserved` is pre-charged and still in flight. Both are
    // clamped so a cache that briefly overshoots the cap can't overflow the bar.
    const confirmedPct = status
        ? Math.min(100, (status.confirmed / Math.max(1, status.dailyCap)) * 100)
        : 0;
    const reservedPct = status
        ? Math.min(100 - confirmedPct, (status.reserved / Math.max(1, status.dailyCap)) * 100)
        : 0;

    const observedAge = status && formatAge(status.observedAt, status.serverNow, isEnglish);
    const oldestQueuedAge = status
        && formatAge(status.oldestQueuedAt, status.serverNow, isEnglish);

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
                    ? 'Outbound email runs through Resend, whose free plan allows a fixed number of emails per rolling 24 hours. Every to/cc/bcc address counts as one. Sends past the limit are queued and shipped automatically as headroom reopens.'
                    : '所有外发邮件通过 Resend 发送，免费方案在滚动 24 小时内有固定发送上限。每个收件人（含抄送、密送）各计一封。超出上限的邮件会进入队列，待额度恢复后自动发送。'}
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
                        atCap && queueFull ? 'admin-tickets-send-banner-error'
                            : (atCap || lowHeadroom || queueFull) ? 'admin-tickets-send-banner-warning'
                                : 'admin-tickets-send-banner-info'}`}>
                        <span>
                            {atCap && queueFull
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
                                                ? `${remainingToday} of ${status.dailyCap} emails still available in the current window.`
                                                : `当前窗口内还有 ${remainingToday} / ${status.dailyCap} 封可发送。`)}
                        </span>
                    </div>

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
                                {isEnglish ? 'Sent' : '已发送'} ({status.confirmed})
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

                    <div className="admin-stats-tiles admin-section-mb">
                        <div className="admin-stats-tile">
                            <div className="admin-stats-tile-label">
                                {isEnglish ? 'Used (24h)' : '已用（24 小时）'}
                            </div>
                            <div className="admin-stats-tile-value">
                                {status.sentToday} / {status.dailyCap}
                            </div>
                            <div className="admin-stats-tile-sub">
                                {isEnglish
                                    ? `${status.confirmed} sent, ${status.reserved} in flight`
                                    : `已发送 ${status.confirmed} 封，发送中 ${status.reserved} 封`}
                            </div>
                        </div>
                        <div className="admin-stats-tile">
                            <div className="admin-stats-tile-label">
                                {isEnglish ? 'Available' : '可用额度'}
                            </div>
                            <div className="admin-stats-tile-value">{remainingToday}</div>
                            <div className="admin-stats-tile-sub">
                                {isEnglish ? 'before sends queue' : '超出后进入队列'}
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
                        <div className="admin-stats-tile">
                            <div className="admin-stats-tile-label">
                                {isEnglish ? 'Counter updated' : '计数更新于'}
                            </div>
                            <div className="admin-stats-tile-value admin-stats-tile-value--sm">
                                {observedAge ?? (isEnglish ? 'No sends yet' : '暂无发送记录')}
                            </div>
                            <div className="admin-stats-tile-sub">
                                {isEnglish
                                    ? 'refreshed by each send'
                                    : '每次发送后更新'}
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
                                    ? `The queue drains automatically every ${status.drainIntervalMinutes} minutes, sending as much as the remaining limit allows.`
                                    : `队列每 ${status.drainIntervalMinutes} 分钟自动清空一次，按剩余额度尽可能发送。`}
                            </li>
                            <li>
                                {isEnglish
                                    ? 'Resend counts a rolling 24-hour window, not a calendar day — capacity returns gradually as older sends age out, not all at once.'
                                    : 'Resend 按滚动 24 小时窗口计算，而非自然日 — 额度随着早前邮件超过 24 小时逐步恢复，而非一次性重置。'}
                            </li>
                            <li>
                                {isEnglish
                                    ? '"In flight" covers sends already charged against the limit but still awaiting Resend\'s response; it clears on its own.'
                                    : '"发送中"指已占用额度但尚未收到 Resend 响应的邮件，会自动结算。'}
                            </li>
                            <li>
                                {isEnglish
                                    ? `Sender address: ${status.fromAddress}`
                                    : `发件地址：${status.fromAddress}`}
                            </li>
                        </ul>
                    </div>
                </>
            )}
        </div>
    );
};
