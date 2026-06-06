import { useEffect, useRef, useState } from 'react';
import { useAuth } from '~/components/AuthProvider';
import { useLanguage } from '~/components/LanguageContextProvider';
import { RichTextEditor } from '~/components/RichTextEditor';
import { sanitizeEmailHtml } from '~/lib/emailSanitize';
import { callGetTicketEmailQuota, callSendCustomEmail } from '~/lib/firebase';
import { useModalEffects } from '~/lib/useModalEffects';

interface SendEmailToolProps {
    onBack: () => void;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Mirrors the server's bodyHtml length cap (functions validateStr in
// sendCustomEmail). Block at the client so a long paste fails locally with
// a clear message instead of bouncing off a generic backend error.
const BODY_MAX_LEN = 20000;

// Splits comma/semicolon/whitespace-separated email lists pasted into a single
// input. Lowercases and de-duplicates to match the server's validateEmailList,
// so the displayed recipient count matches what actually gets sent. Empty
// entries are dropped; full validation happens at submit so the field can hold
// a mid-typing value.
const parseEmailList = (raw: string): string[] => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const part of raw.split(/[,;\s]+/)) {
        const normalized = part.trim().toLowerCase();
        if (!normalized || seen.has(normalized)) continue;
        seen.add(normalized);
        out.push(normalized);
    }
    return out;
};

export const SendEmailTool = ({onBack}: SendEmailToolProps) => {
    const {isEnglish} = useLanguage();
    const {user, profile} = useAuth();
    const adminEmail = profile?.email || user?.email || '';

    const [toRaw, setToRaw] = useState('');
    const [ccRaw, setCcRaw] = useState('');
    const [bccRaw, setBccRaw] = useState('');
    const [replyTo, setReplyTo] = useState('');
    const [subject, setSubject] = useState('');
    const [bodyHtml, setBodyHtml] = useState('');
    const [sending, setSending] = useState(false);
    const [showPreview, setShowPreview] = useState(false);
    const [showOptional, setShowOptional] = useState(false);
    const [message, setMessage] = useState<{type: 'success' | 'error'; text: string} | null>(null);
    const [quota, setQuota] = useState<{
        sentToday: number;
        dailyCap: number;
        queuedCount: number;
        queueCap: number;
    } | null>(null);
    const [quotaLoading, setQuotaLoading] = useState(true);

    const previewOverlayRef = useRef<HTMLDivElement>(null);
    useModalEffects(showPreview, previewOverlayRef);

    useEffect(() => {
        let cancelled = false;
        const load = async () => {
            try {
                const res = await callGetTicketEmailQuota();
                if (!cancelled) setQuota({
                    sentToday: res.data.sentToday,
                    dailyCap: res.data.dailyCap,
                    queuedCount: res.data.queuedCount,
                    queueCap: res.data.queueCap,
                });
            } catch {
                /* leave quota null — the send still works, just no preflight hint */
            } finally {
                if (!cancelled) setQuotaLoading(false);
            }
        };
        void load();
        return () => {
            cancelled = true;
        };
    }, []);

    useEffect(() => {
        if (!showPreview) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') setShowPreview(false);
        };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, [showPreview]);

    const toList = parseEmailList(toRaw);
    const ccList = parseEmailList(ccRaw);
    const bccList = parseEmailList(bccRaw);

    const invalidEmails = [...toList, ...ccList, ...bccList].filter(e => !EMAIL_RE.test(e));
    const replyToInvalid = replyTo.trim().length > 0 && !EMAIL_RE.test(replyTo.trim());
    const totalRecipients = toList.length + ccList.length + bccList.length;

    const hasBodyContent = bodyHtml.trim().length > 0;
    const bodyTooLong = bodyHtml.length > BODY_MAX_LEN;

    const canSend = !sending
        && toList.length > 0
        && invalidEmails.length === 0
        && !replyToInvalid
        && subject.trim().length > 0
        && hasBodyContent
        && !bodyTooLong
        && totalRecipients <= 25;

    const sanitizedPreview = sanitizeEmailHtml(bodyHtml);

    const send = async () => {
        if (!canSend) return;
        setSending(true);
        setMessage(null);
        try {
            const res = await callSendCustomEmail({
                to: toList,
                cc: ccList.length > 0 ? ccList : undefined,
                bcc: bccList.length > 0 ? bccList : undefined,
                replyTo: replyTo.trim() || undefined,
                subject: subject.trim(),
                bodyHtml,
            });
            setMessage({
                type: 'success',
                text: res.data.queued
                    ? (isEnglish
                        ? `Daily cap reached — email queued for ${res.data.recipientCount} recipient${res.data.recipientCount === 1 ? '' : 's'} and will send after midnight (America/Los_Angeles).`
                        : `已达每日上限，邮件已排队（${res.data.recipientCount} 位收件人），将于太平洋时区午夜后发送。`)
                    : (isEnglish
                        ? `Email queued for ${res.data.recipientCount} recipient${res.data.recipientCount === 1 ? '' : 's'}.`
                        : `邮件已排队发送给 ${res.data.recipientCount} 位收件人。`),
            });
            setToRaw('');
            setCcRaw('');
            setBccRaw('');
            setSubject('');
            setBodyHtml('');
            try {
                const refreshed = await callGetTicketEmailQuota();
                setQuota({
                    sentToday: refreshed.data.sentToday,
                    dailyCap: refreshed.data.dailyCap,
                    queuedCount: refreshed.data.queuedCount,
                    queueCap: refreshed.data.queueCap,
                });
            } catch {
                /* ignore */
            }
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            setMessage({
                type: 'error',
                text: isEnglish ? `Failed to send: ${msg}` : `发送失败：${msg}`,
            });
        } finally {
            setSending(false);
        }
    };

    return (
        <div className="admin-section">
            <div className="admin-tools-header">
                <button className="admin-back-btn" onClick={onBack} type="button">
                    {isEnglish ? '← Back to Tools' : '← 返回工具'}
                </button>
                <h3 className="admin-tools-title">
                    {isEnglish ? 'Send Email' : '发送邮件'}
                </h3>
            </div>

            {quotaLoading ? (
                <p className="admin-helper-text">{isEnglish ? 'Checking quota…' : '正在检查发送额度…'}</p>
            ) : quota && (
                <p className="admin-helper-text">
                    {isEnglish
                        ? `Today's outgoing emails: ${quota.sentToday} / ${quota.dailyCap} (shared with ticket emails). Overflow queue: ${quota.queuedCount} / ${quota.queueCap} waiting for tomorrow.`
                        : `今日已发邮件：${quota.sentToday} / ${quota.dailyCap}（与门票邮件共享）。明日待发队列：${quota.queuedCount} / ${quota.queueCap} 封。`}
                </p>
            )}

            <div className="admin-form-grid">
                <label className="admin-form-grid-full">
                    <span>{isEnglish ? 'To (one or more, comma-separated)' : '收件人（可填多个，用逗号分隔）'}</span>
                    <input
                        type="text"
                        value={toRaw}
                        onChange={e => setToRaw(e.target.value)}
                        className="admin-search-input"
                        placeholder="someone@example.com"
                        autoFocus
                    />
                </label>

                <label className="admin-form-grid-full">
                    <span>{isEnglish ? 'Subject' : '邮件主题'}</span>
                    <input
                        type="text"
                        value={subject}
                        onChange={e => setSubject(e.target.value)}
                        className="admin-search-input"
                        maxLength={500}
                    />
                </label>

                <label className="admin-form-grid-full">
                    <span>{isEnglish ? 'Body' : '正文'}</span>
                    <RichTextEditor
                        value={bodyHtml}
                        onChange={setBodyHtml}
                        isEnglish={isEnglish}
                        placeholder={isEnglish
                            ? 'Write your message…'
                            : '在此输入正文……'}
                    />
                </label>

                <div className="admin-form-grid-full">
                    <button
                        type="button"
                        className="admin-back-btn"
                        onClick={() => setShowOptional(v => !v)}
                    >
                        {showOptional
                            ? (isEnglish ? '− Hide CC / BCC / Reply-To' : '− 收起 抄送 / 密送 / 回复地址')
                            : (isEnglish ? '+ Show CC / BCC / Reply-To' : '+ 展开 抄送 / 密送 / 回复地址')}
                    </button>
                </div>

                {showOptional && (
                    <>
                        <label className="admin-form-grid-full">
                            <span>{isEnglish ? 'CC' : '抄送 (CC)'}</span>
                            <input
                                type="text"
                                value={ccRaw}
                                onChange={e => setCcRaw(e.target.value)}
                                className="admin-search-input"
                                placeholder={isEnglish ? 'comma-separated' : '多个用逗号分隔'}
                            />
                        </label>
                        <label className="admin-form-grid-full">
                            <span>{isEnglish ? 'BCC' : '密送 (BCC)'}</span>
                            <input
                                type="text"
                                value={bccRaw}
                                onChange={e => setBccRaw(e.target.value)}
                                className="admin-search-input"
                                placeholder={isEnglish ? 'comma-separated' : '多个用逗号分隔'}
                            />
                        </label>
                        <label className="admin-form-grid-full">
                            <span>{isEnglish ? 'Reply-To (optional)' : '回复地址 (Reply-To，可选)'}</span>
                            <input
                                type="email"
                                value={replyTo}
                                onChange={e => setReplyTo(e.target.value)}
                                className="admin-search-input"
                                placeholder={adminEmail
                                    ? (isEnglish ? `defaults to ${adminEmail}` : `默认为 ${adminEmail}`)
                                    : 'someone@example.com'}
                            />
                        </label>
                    </>
                )}
            </div>

            {invalidEmails.length > 0 && (
                <p className="admin-no-results">
                    {isEnglish
                        ? `Invalid email${invalidEmails.length === 1 ? '' : 's'}: ${invalidEmails.join(', ')}`
                        : `邮箱格式无效：${invalidEmails.join('、')}`}
                </p>
            )}
            {replyToInvalid && (
                <p className="admin-no-results">
                    {isEnglish ? 'Reply-To is not a valid email.' : '回复地址格式无效。'}
                </p>
            )}
            {totalRecipients > 25 && (
                <p className="admin-no-results">
                    {isEnglish
                        ? `Too many recipients (${totalRecipients}/25). Reduce to/cc/bcc.`
                        : `收件人过多（${totalRecipients}/25），请减少 收件/抄送/密送 数量。`}
                </p>
            )}
            {bodyTooLong && (
                <p className="admin-no-results">
                    {isEnglish
                        ? `Body is too long (${bodyHtml.length.toLocaleString()} / ${BODY_MAX_LEN.toLocaleString()} chars). Trim before sending.`
                        : `正文过长（${bodyHtml.length.toLocaleString()} / ${BODY_MAX_LEN.toLocaleString()} 字符），请精简后发送。`}
                </p>
            )}

            <div className="admin-btn-row">
                <button
                    className="admin-toggle-btn admin-toggle-save"
                    onClick={send}
                    disabled={!canSend}
                    type="button"
                >
                    {sending
                        ? (isEnglish ? 'Sending…' : '发送中…')
                        : (isEnglish ? 'Send Email' : '发送邮件')}
                </button>
                <button
                    className="admin-toggle-btn admin-toggle-edit"
                    onClick={() => setShowPreview(true)}
                    disabled={!hasBodyContent}
                    type="button"
                >
                    {isEnglish ? 'Preview' : '预览'}
                </button>
            </div>

            {message && (
                <p
                    className="admin-helper-text"
                    style={{color: message.type === 'error' ? '#c0392b' : '#1abc9c'}}
                >
                    {message.text}
                </p>
            )}

            {showPreview && (
                <div
                    ref={previewOverlayRef}
                    className="admin-tickets-preview-modal"
                    onClick={() => setShowPreview(false)}
                >
                    <div
                        className="admin-tickets-preview-content"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="admin-tickets-preview-header">
                            <strong>{isEnglish ? 'Preview' : '预览'}</strong>
                            <button
                                className="admin-tickets-preview-close"
                                onClick={() => setShowPreview(false)}
                                type="button"
                            >
                                ×
                            </button>
                        </div>
                        <div className="admin-tickets-preview-subject">
                            <strong>{isEnglish ? 'Subject: ' : '主题：'}</strong>
                            {subject || (isEnglish ? '(empty)' : '（空）')}
                        </div>
                        <div
                            className="admin-tickets-preview-body"
                            dangerouslySetInnerHTML={{__html: sanitizedPreview}}
                        />
                    </div>
                </div>
            )}
        </div>
    );
};
