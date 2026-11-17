import { useState } from 'react';
import { useLanguage } from '~/components/LanguageContextProvider';
import { callGetEmailQuotaStatus, type EmailQuotaStatus } from '~/lib/firebase';
import type { ShowToast } from '../utils';
import { Banner } from '../Banner';
import { StatTile } from '../StatTile';
import { useToolLoader } from '../ToolHeader';
import { QuotaMeter, QuotaNotes, QuotaPage } from './QuotaParts';

interface EmailQuotaToolProps {
    onBack: () => void;
    showToast: ShowToast;
}

const LOW_HEADROOM = 10;

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
    const [status, setStatus] = useState<EmailQuotaStatus | null>(null);

    const {loading, error, load} = useToolLoader(callGetEmailQuotaStatus, setStatus,
        {
            refreshed: {en: 'Quota refreshed.', zh: '额度已刷新。'},
            failed: {en: 'Could not load email quota.', zh: '无法加载邮件额度。'}
        }, showToast);

    const providerName = status?.provider.name ?? '';
    const unavailable = status?.readingSource === 'unavailable';

    const remainingToday = status ? Math.max(0, status.dailyCap - status.sentToday) : 0;
    const remainingQueue = status ? Math.max(0, status.queueCap - status.queuedCount) : 0;
    const atCap = status !== null && !unavailable && remainingToday === 0;
    const lowHeadroom = status !== null && !unavailable
        && remainingToday > 0 && remainingToday <= LOW_HEADROOM;
    const queueFull = status !== null && remainingQueue === 0 && status.queuedCount > 0;

    const confirmedPct = status
        ? Math.min(100, (status.confirmed / Math.max(1, status.dailyCap)) * 100)
        : 0;
    const reservedPct = status
        ? Math.min(100 - confirmedPct, (status.reserved / Math.max(1, status.dailyCap)) * 100)
        : 0;

    const observedAge = status && formatAge(status.observedAt, status.serverNow, isEnglish);
    const oldestQueuedAge = status
        && formatAge(status.oldestQueuedAt, status.serverNow, isEnglish);

    const readingLabel = !status ? '' : status.readingSource === 'live'
        ? (isEnglish ? `live from ${providerName}` : `来自 ${providerName} 实时数据`)
        : status.readingSource === 'cached'
            ? (isEnglish
                ? `last reading ${observedAge ?? 'unknown'}`
                : `上次读数${observedAge ?? '未知'}`)
            : (isEnglish ? 'unavailable' : '无法读取');

    return (
        <QuotaPage
            title={isEnglish ? 'Email Quota' : '邮件额度'}
            intro={isEnglish
                ? `Outbound email runs through ${providerName || 'the configured email provider'}, which allows a limited number of emails per day. Every to/cc/bcc address counts as one. Sends past the limit are queued and shipped automatically as headroom reopens.`
                : `所有外发邮件通过 ${providerName || '已配置的邮件服务'} 发送，每日发送量有限。每个收件人（含抄送、密送）各计一封。超出上限的邮件会进入队列，待额度恢复后自动发送。`}
            failed={isEnglish ? 'Could not load email quota. Try refreshing.' : '无法加载邮件额度，请尝试刷新。'}
            onBack={onBack}
            loading={loading}
            error={error}
            load={load}
        >
            {status && (
                <>
                    <Banner tone={unavailable ? 'warning'
                        : atCap && queueFull ? 'error'
                            : (atCap || lowHeadroom || queueFull) ? 'warning'
                                : 'info'}>
                        <span>
                            {unavailable
                                ? (isEnglish
                                    ? `Couldn't read recent sends from ${providerName}, so usage can't be shown here — check the ${providerName} dashboard. Usually the API key lacks permission to list emails, or ${providerName} was unreachable.`
                                    : `无法从 ${providerName} 读取近期发送记录，因此此处无法显示用量，请前往 ${providerName} 控制台查看。通常是 API 密钥缺少读取邮件列表的权限，或 ${providerName} 暂时无法访问。`)
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
                    </Banner>

                    {!unavailable && (
                        <QuotaMeter parts={[
                            {
                                kind: 'confirmed',
                                pct: confirmedPct,
                                label: `${isEnglish ? 'Counted by' : '已计入'} ${providerName} (${status.confirmed})`,
                            },
                            {
                                kind: 'reserved',
                                pct: reservedPct,
                                label: `${isEnglish ? 'In flight' : '发送中'} (${status.reserved})`,
                            },
                            {kind: 'free', label: `${isEnglish ? 'Available' : '可用'} (${remainingToday})`},
                        ]}/>
                    )}

                    <div className="admin-stats-tiles admin-section-mb">
                        <StatTile
                            label={isEnglish ? `Used per ${providerName}` : `${providerName} 记录用量`}
                            value={status.providerReported === null
                                ? (isEnglish ? 'Unavailable' : '无法读取')
                                : `${status.usageTruncated ? '≥' : ''}${status.providerReported} / ${status.dailyCap}`}
                            sub={readingLabel}
                        />
                        <StatTile
                            label={isEnglish ? 'Available' : '可用额度'}
                            value={unavailable ? '—' : remainingToday}
                            sub={isEnglish ? 'before sends queue' : '超出后进入队列'}
                        />
                        <StatTile
                            label={isEnglish ? 'In flight' : '发送中'}
                            value={status.reserved}
                            sub={isEnglish ? `not yet counted by ${providerName}` : `${providerName} 尚未计入`}
                        />
                        <StatTile
                            label={isEnglish ? 'Queued' : '排队中'}
                            value={`${status.queuedCount} / ${status.queueCap}`}
                            sub={status.queuedCount === 0
                                ? (isEnglish ? 'queue empty' : '队列为空')
                                : oldestQueuedAge
                                    ? (isEnglish ? `oldest queued ${oldestQueuedAge}` : `最早入队于${oldestQueuedAge}`)
                                    : (isEnglish ? 'waiting to send' : '等待发送')}
                        />
                    </div>

                    <QuotaNotes>
                        <li>
                            {isEnglish
                                ? `"Used per ${providerName}" is counted from ${providerName}'s own record of sent mail each time this page loads, so it should match their dashboard. It covers the whole account, including mail sent outside this admin panel.`
                                : `"${providerName} 记录用量"在每次打开本页时，根据 ${providerName} 自身的发送记录统计，因此应与其控制台一致。该数字涵盖整个账号，包括在本管理面板之外发送的邮件。`}
                        </li>
                        {status.usageTruncated && (
                            <li>
                                {isEnglish
                                    ? 'Sent volume in this window exceeded what this page counts in one pass, so the used figure is a lower bound.'
                                    : '本窗口内的发送量超出本页单次统计上限，因此显示的用量为下限值。'}
                            </li>
                        )}
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
                    </QuotaNotes>
                </>
            )}
        </QuotaPage>
    );
};
