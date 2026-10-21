import { useCallback, useEffect, useRef, useState } from 'react';
import { useLanguage } from '~/components/LanguageContextProvider';
import { callGetTicketEmailQuota, callSendTicketEmails, functionsErrorCode, } from '~/lib/firebase';
import type { ShowToast } from '../utils';
import type { AttendeeTotals } from './types';

// Only for the confirm text before quota loads; the server's quota.chunkSize is
// what counts.
const FALLBACK_CHUNK_SIZE = 100;

interface SendSectionProps {
    eventId: string;
    totals: AttendeeTotals;
    readOnly: boolean;
    showToast: ShowToast;
    onSent: () => void;
    templateUnsaved: boolean;
}

interface SendProgress {
    mode: 'unsent' | 'all';
    sent: number;
    queued: number;
    target: number;
}

interface QuotaState {
    sentToday: number;
    dailyCap: number;
    chunkSize: number;
    queuedCount: number;
    queueCap: number;
}

export function SendSection({
                                eventId, totals, readOnly, showToast, onSent, templateUnsaved,
                            }: SendSectionProps) {
    const {isEnglish} = useLanguage();
    const [sending, setSending] = useState(false);
    const [progress, setProgress] = useState<SendProgress | null>(null);
    const [quota, setQuota] = useState<QuotaState | null>(null);
    const [quotaError, setQuotaError] = useState(false);
    const cancelRef = useRef(false);
    const [cancelling, setCancelling] = useState(false);

    const loadQuota = useCallback(async () => {
        try {
            const res = await callGetTicketEmailQuota();
            setQuota(res.data);
            setQuotaError(false);
        } catch (err) {
            console.error('[SendSection] quota load', err);
            setQuotaError(true);
        }
    }, []);

    useEffect(() => {
        void loadQuota();
    }, [loadQuota]);

    const remainingToday = quota
        ? Math.max(0, quota.dailyCap - quota.sentToday)
        : null;
    const remainingQueue = quota
        ? Math.max(0, quota.queueCap - quota.queuedCount)
        : null;
    const quotaNearCap = remainingToday !== null && remainingToday <= 10;
    const quotaAtCap = remainingToday === 0;
    // Blocked only when both the cap and the queue are full; otherwise overflow
    // queues in /scheduledMail and drains as the window reopens.
    const fullyBlocked = quotaAtCap && remainingQueue === 0;
    const chunkSize = quota?.chunkSize ?? FALLBACK_CHUNK_SIZE;

    const send = async (mode: 'unsent' | 'all') => {
        if (readOnly || sending || templateUnsaved) return;
        const target = mode === 'unsent' ? totals.unsentSendable : totals.sendable;
        if (target === 0) {
            showToast(isEnglish ? 'No sendable recipients.' : '没有可发送的收件人。', 'warning');
            return;
        }
        if (fullyBlocked) {
            showToast(
                isEnglish
                    ? 'Daily cap reached and the overflow queue is full. Wait for the queue to drain.'
                    : '已达到每日发送上限，且排队已满，请等待队列清空。',
                'warning',
            );
            return;
        }
        const willQueueAny = remainingToday !== null && target > remainingToday;
        const ok = window.confirm([
            mode === 'unsent'
                ? (isEnglish
                    ? `Send ticket emails to ${target} attendee(s) who have active tickets and haven't been sent yet?`
                    : `向 ${target} 位持有有效门票且尚未收到邮件的参加者发送门票邮件？`)
                : (isEnglish
                    ? `Resend ticket emails to ALL ${target} attendee(s) with active tickets? (Already-sent will receive a duplicate.)`
                    : `向全部 ${target} 位持有有效门票的参加者重新发送门票邮件？（已发送的会收到重复邮件。）`),
            willQueueAny
                ? (isEnglish
                    ? `\n\nNote: ${target} exceeds the ${remainingToday} left in the current Resend window. The overflow (up to ${remainingQueue} more) will be queued and sent automatically as capacity frees up.`
                    : `\n\n注意：${target} 超过当前 Resend 窗口剩余的 ${remainingToday} 封。超出部分（至多 ${remainingQueue} 封）将排队，待额度恢复后自动发送。`)
                : '',
            target > chunkSize
                ? (isEnglish
                    ? `\n\nThis will send in chunks of ${chunkSize}. You can cancel between chunks.`
                    : `\n\n将以 ${chunkSize} 封为一批发送，可在批次间取消。`)
                : '',
        ].join(''));
        if (!ok) return;

        cancelRef.current = false;
        setSending(true);
        setProgress({mode, sent: 0, queued: 0, target});

        let totalSent = 0;
        let totalQueued = 0;
        let cursor: string | undefined;
        try {
            while (!cancelRef.current && totalSent + totalQueued < target) {
                const result = await callSendTicketEmails({
                    eventId,
                    mode,
                    ...(cursor ? {cursor} : {}),
                });
                const {sentCount, queuedCount, hasMore, nextCursor} = result.data;
                totalSent += sentCount;
                totalQueued += queuedCount;
                setProgress({mode, sent: totalSent, queued: totalQueued, target});
                if (!hasMore) break;
                cursor = nextCursor;
                if (!cursor && mode === 'all') break;
            }
            if (cancelRef.current) {
                showToast(
                    isEnglish
                        ? `Stopped — sent ${totalSent}, queued ${totalQueued} of ${target}.`
                        : `已停止 — 已发送 ${totalSent}，已排队 ${totalQueued} / ${target}。`,
                    'warning',
                );
            } else {
                let toastText: string;
                if (totalSent > 0 && totalQueued > 0) {
                    toastText = isEnglish
                        ? `Queued ${totalSent} email${totalSent === 1 ? '' : 's'} for immediate send, plus ${totalQueued} to go out as capacity frees up.`
                        : `已排队 ${totalSent} 封邮件立即发送，另有 ${totalQueued} 封将在额度恢复后发送。`;
                } else if (totalSent > 0) {
                    toastText = isEnglish
                        ? `Queued ${totalSent} email${totalSent === 1 ? '' : 's'} for immediate send.`
                        : `已排队 ${totalSent} 封邮件立即发送。`;
                } else if (totalQueued > 0) {
                    toastText = isEnglish
                        ? `Daily cap reached — queued ${totalQueued} email${totalQueued === 1 ? '' : 's'} to go out as capacity frees up.`
                        : `已达每日上限，已排队 ${totalQueued} 封邮件，待额度恢复后发送。`;
                } else {
                    toastText = isEnglish ? 'No emails queued.' : '未排队任何邮件。';
                }
                showToast(
                    toastText,
                    (totalSent + totalQueued) > 0 ? 'success' : 'warning',
                );
            }
            onSent();
        } catch (err) {
            const code = functionsErrorCode(err);
            if (code === 'no-template') {
                showToast(
                    isEnglish
                        ? 'Save the email template before sending.'
                        : '请先保存邮件模板再发送。',
                    'warning',
                );
            } else if (code === 'no-contact-email') {
                showToast(
                    isEnglish
                        ? 'The template uses {{ contactEmail }}. Set a Contact Email in Site Config before sending.'
                        : '模板使用了 {{ contactEmail }}，请先在网站设置中填写联系邮箱再发送。',
                    'warning',
                );
            } else if (code === 'quota-exceeded') {
                showToast(
                    isEnglish
                        ? 'Daily cap reached and the overflow queue is full.'
                        : '已达到每日上限，且排队已满。',
                    'warning',
                );
            } else {
                showToast(
                    isEnglish
                        ? `Send failed${code ? ` (${code})` : ''}.`
                        : `发送失败${code ? `（${code}）` : ''}。`,
                    'error',
                );
            }
        } finally {
            setSending(false);
            setProgress(null);
            cancelRef.current = false;
            setCancelling(false);
            void loadQuota();
        }
    };

    const cancel = () => {
        cancelRef.current = true;
        setCancelling(true);
    };

    return (
        <div className="admin-tickets-send">
            <h3>{isEnglish ? 'Send ticket emails' : '发送门票邮件'}</h3>
            <p className="admin-helper-text">
                {isEnglish
                    ? 'Sends ticket QRs through Resend. Each email contains one QR per ticket for that attendee.'
                    : '通过 Resend 发送门票二维码。每封邮件为对应参加者的每张门票包含一个二维码。'}
            </p>

            {templateUnsaved && (
                <div className="admin-tickets-send-banner admin-tickets-send-banner-warning">
                    <strong>
                        {isEnglish ? 'Email template not saved.' : '邮件模板尚未保存。'}
                    </strong>
                    <p>
                        {isEnglish
                            ? 'Save the template below before sending. Emails go out with the saved version.'
                            : '发送前请先保存下方的模板。邮件将按已保存的版本发送。'}
                    </p>
                </div>
            )}

            <div className={`admin-tickets-send-banner ${
                quotaError ? 'admin-tickets-send-banner-warning'
                    : fullyBlocked ? 'admin-tickets-send-banner-error'
                        : (quotaAtCap || quotaNearCap) ? 'admin-tickets-send-banner-warning'
                            : 'admin-tickets-send-banner-info'}`}>
                {quotaError ? (
                    <span>
                        {isEnglish
                            ? 'Could not load Resend quota. Sending still works.'
                            : '无法加载 Resend 额度。发送功能仍可使用。'}
                    </span>
                ) : quota ? (
                    <span>
                        {isEnglish
                            ? `Resend free tier: ${quota.sentToday} / ${quota.dailyCap} emails used in the last 24h (${remainingToday} remaining). Overflow queue: ${quota.queuedCount} / ${quota.queueCap} waiting to send. Capacity returns gradually as older sends age out of the rolling 24-hour window.`
                            : `Resend 免费额度：过去 24 小时已使用 ${quota.sentToday} / ${quota.dailyCap} 封（剩余 ${remainingToday} 封）。待发队列：${quota.queuedCount} / ${quota.queueCap} 封。额度随早前邮件超出 24 小时滚动窗口而逐步恢复。`}
                    </span>
                ) : (
                    <span>
                        {isEnglish ? 'Loading quota...' : '加载额度中...'}
                    </span>
                )}
            </div>

            <div className="admin-tickets-send-stats">
                <p>
                    {isEnglish ? (
                        <>
                            <strong>{totals.sendable}</strong> of {totals.attendees} attendees get their tickets by
                            email from here; <strong>{totals.unsentSendable}</strong> not sent yet.
                        </>
                    ) : (
                        <>
                            {totals.attendees} 位参加者中有 <strong>{totals.sendable}</strong> 位通过此处接收门票邮件，其中{' '}
                            <strong>{totals.unsentSendable}</strong> 位尚未发送。
                        </>
                    )}
                </p>
                <p className="admin-helper-text">
                    {isEnglish
                        ? 'HomeTown buyers get theirs from HomeTown, and walk-ins without an email can\'t be sent any. Send Unsent also passes by walk-ins already checked in at the door.'
                        : 'HomeTown 购票者的门票由 HomeTown 发送，未填写邮箱的现场登记者无法接收邮件。"发送未发送"也会跳过已在现场签到的现场登记者。'}
                </p>
            </div>

            {progress && (
                <div className="admin-tickets-send-progress">
                    <div className="admin-tickets-send-progress-label">
                        {isEnglish
                            ? `Sending ${progress.sent} / ${progress.target}${progress.queued > 0 ? ` (+${progress.queued} queued)` : ''}...`
                            : `发送中 ${progress.sent} / ${progress.target}${progress.queued > 0 ? `（另有 ${progress.queued} 封已排队）` : ''}...`}
                        {cancelling && (
                            <span> {isEnglish ? '(cancelling after current chunk)' : '（将在本批后停止）'}</span>
                        )}
                    </div>
                    <div className="admin-tickets-send-progress-track">
                        <div
                            className="admin-tickets-send-progress-fill"
                            style={{width: `${Math.min(100, ((progress.sent + progress.queued) / Math.max(1, progress.target)) * 100)}%`}}
                        />
                    </div>
                </div>
            )}

            <div className="admin-btn-row">
                <button
                    className="admin-toggle-btn admin-toggle-save"
                    onClick={() => send('unsent')}
                    disabled={readOnly || sending || templateUnsaved || totals.unsentSendable === 0 || fullyBlocked}
                >
                    {sending && progress?.mode === 'unsent'
                        ? (isEnglish ? 'Sending...' : '发送中...')
                        : (isEnglish ? `Send Unsent (${totals.unsentSendable})` : `发送未发送（${totals.unsentSendable}）`)}
                </button>
                <button
                    className="admin-toggle-btn admin-toggle-revoke"
                    onClick={() => send('all')}
                    disabled={readOnly || sending || templateUnsaved || totals.sendable === 0 || fullyBlocked}
                >
                    {sending && progress?.mode === 'all'
                        ? (isEnglish ? 'Sending...' : '发送中...')
                        : (isEnglish ? `Resend All (${totals.sendable})` : `全部重发（${totals.sendable}）`)}
                </button>
                {sending && (
                    <button
                        className="admin-toggle-btn admin-toggle-cancel"
                        onClick={cancel}
                        disabled={cancelling}
                    >
                        {isEnglish ? 'Cancel' : '取消'}
                    </button>
                )}
            </div>
        </div>
    );
}
