import { useCallback, useEffect, useRef, useState } from 'react';
import { useLanguage } from '~/components/LanguageContextProvider';
import { callGetTicketEmailQuota, callSendTicketEmails, functionsErrorCode, } from '~/lib/firebase';
import type { ShowToast } from '../utils';
import type { AttendeeTotals } from './types';

// Fallback chunk size used only for confirm-dialog copy when quota hasn't
// loaded yet. The server is the source of truth (returned as quota.chunkSize)
// and caps the per-invocation work either way.
const FALLBACK_CHUNK_SIZE = 100;

interface SendSectionProps {
    eventId: string;
    totals: AttendeeTotals;
    readOnly: boolean;
    showToast: ShowToast;
    onSent: () => void;
    onOpenTemplate: () => void;
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
                                eventId, totals, readOnly, showToast, onSent, onOpenTemplate,
                            }: SendSectionProps) {
    const {isEnglish} = useLanguage();
    const [sending, setSending] = useState(false);
    const [progress, setProgress] = useState<SendProgress | null>(null);
    const [noTemplate, setNoTemplate] = useState(false);
    const [quota, setQuota] = useState<QuotaState | null>(null);
    const [quotaError, setQuotaError] = useState(false);
    const cancelRef = useRef(false);

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
    // Sends are disabled only when BOTH today's cap and the overflow queue
    // are full — otherwise overflow goes into /scheduledMail for tomorrow.
    const fullyBlocked = quotaAtCap && remainingQueue === 0;
    const chunkSize = quota?.chunkSize ?? FALLBACK_CHUNK_SIZE;

    const send = async (mode: 'unsent' | 'all') => {
        if (readOnly || sending) return;
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
                    ? `\n\nNote: ${target} > ${remainingToday} remaining in today's Resend cap. The overflow (up to ${remainingQueue} more) will be queued and sent starting after midnight (America/Los_Angeles).`
                    : `\n\n注意：${target} 超过今日 Resend 剩余 ${remainingToday} 封。超出部分（至多 ${remainingQueue} 封）将排队，于太平洋时区午夜后开始发送。`)
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
        setNoTemplate(false);
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
                if (!cursor && mode === 'all') {
                    // Safety: mode='all' with hasMore should always return a cursor.
                    break;
                }
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
                        ? `Queued ${totalSent} email${totalSent === 1 ? '' : 's'} for immediate send, plus ${totalQueued} for tomorrow.`
                        : `已排队 ${totalSent} 封邮件立即发送，另有 ${totalQueued} 封将于明日发送。`;
                } else if (totalSent > 0) {
                    toastText = isEnglish
                        ? `Queued ${totalSent} email${totalSent === 1 ? '' : 's'} for immediate send.`
                        : `已排队 ${totalSent} 封邮件立即发送。`;
                } else if (totalQueued > 0) {
                    toastText = isEnglish
                        ? `Daily cap reached — queued ${totalQueued} email${totalQueued === 1 ? '' : 's'} for tomorrow.`
                        : `已达每日上限，已排队 ${totalQueued} 封邮件明日发送。`;
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
                setNoTemplate(true);
                showToast(
                    isEnglish
                        ? 'Save the email template before sending.'
                        : '请先保存邮件模板再发送。',
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
            void loadQuota();
        }
    };

    const cancel = () => {
        cancelRef.current = true;
    };

    return (
        <div className="admin-tickets-send">
            <p className="admin-helper-text">
                {isEnglish
                    ? 'Sends ticket QRs via the Firebase Trigger Email extension. Each email contains one QR per ticket for that attendee.'
                    : '通过 Firebase Trigger Email 扩展发送门票二维码。每封邮件为对应参加者的每张门票包含一个二维码。'}
            </p>

            {noTemplate && (
                <div className="admin-tickets-send-banner admin-tickets-send-banner-warning">
                    <strong>
                        {isEnglish ? 'Email template not saved.' : '邮件模板尚未保存。'}
                    </strong>
                    <p>
                        {isEnglish
                            ? 'Save the template for this event before sending.'
                            : '发送前请先保存此活动的邮件模板。'}
                    </p>
                    <button
                        className="admin-toggle-btn admin-toggle-edit"
                        onClick={onOpenTemplate}
                    >
                        {isEnglish ? 'Open Template Editor' : '打开模板编辑器'}
                    </button>
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
                            ? `Resend free tier: ${quota.sentToday} / ${quota.dailyCap} emails sent today (${remainingToday} remaining). Overflow queue: ${quota.queuedCount} / ${quota.queueCap} waiting for tomorrow. Resets at midnight America/Los_Angeles.`
                            : `Resend 免费额度：今日已发送 ${quota.sentToday} / ${quota.dailyCap} 封（剩余 ${remainingToday} 封）。明日待发队列：${quota.queuedCount} / ${quota.queueCap} 封。太平洋时区午夜重置。`}
                    </span>
                ) : (
                    <span>
                        {isEnglish ? 'Loading quota...' : '加载额度中...'}
                    </span>
                )}
            </div>

            <div className="admin-tickets-send-stats">
                <p>
                    <strong>{totals.attendees}</strong> {isEnglish ? 'total attendees' : '位参加者'},{' '}
                    <strong>{totals.sendable}</strong> {isEnglish ? 'with active tickets' : '持有有效门票'},{' '}
                    <strong>{totals.unsentSendable}</strong> {isEnglish ? 'not yet sent' : '尚未发送'}.
                </p>
            </div>

            {progress && (
                <div className="admin-tickets-send-progress">
                    <div className="admin-tickets-send-progress-label">
                        {isEnglish
                            ? `Sending ${progress.sent} / ${progress.target}${progress.queued > 0 ? ` (+${progress.queued} queued for tomorrow)` : ''}...`
                            : `发送中 ${progress.sent} / ${progress.target}${progress.queued > 0 ? `（另有 ${progress.queued} 封排队至明日）` : ''}...`}
                        {cancelRef.current && (
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
                    disabled={readOnly || sending || totals.unsentSendable === 0 || fullyBlocked}
                >
                    {sending && progress?.mode === 'unsent'
                        ? (isEnglish ? 'Sending...' : '发送中...')
                        : (isEnglish ? `Send Unsent (${totals.unsentSendable})` : `发送未发送（${totals.unsentSendable}）`)}
                </button>
                <button
                    className="admin-toggle-btn admin-toggle-revoke"
                    onClick={() => send('all')}
                    disabled={readOnly || sending || totals.sendable === 0 || fullyBlocked}
                >
                    {sending && progress?.mode === 'all'
                        ? (isEnglish ? 'Sending...' : '发送中...')
                        : (isEnglish ? `Resend All (${totals.sendable})` : `全部重发（${totals.sendable}）`)}
                </button>
                {sending && (
                    <button
                        className="admin-toggle-btn admin-toggle-cancel"
                        onClick={cancel}
                        disabled={cancelRef.current}
                    >
                        {isEnglish ? 'Cancel' : '取消'}
                    </button>
                )}
            </div>
        </div>
    );
}
