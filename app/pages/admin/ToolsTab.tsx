import { useEffect, useRef, useState } from 'react';
import { QRCodeCanvas } from 'qrcode.react';
import { useAuth } from '~/components/AuthProvider';
import { useLanguage } from '~/components/LanguageContextProvider';
import { RichTextEditor } from '~/components/RichTextEditor';
import { sanitizeEmailHtml } from '~/lib/emailSanitize';
import { callGetTicketEmailQuota, callSendCustomEmail } from '~/lib/firebase';
import { isValidHttpUrl } from '~/lib/urls';
import { useAllUpcomingEvents } from '~/lib/upcomingEvents';
import { useModalEffects } from '~/lib/useModalEffects';

type ToolId = 'qr-generator' | 'send-email';

interface ToolDef {
    id: ToolId;
    title: string;
    titleCn: string;
    description: string;
    descriptionCn: string;
}

const TOOLS: ToolDef[] = [
    {
        id: 'qr-generator',
        title: 'QR Generator',
        titleCn: '二维码生成器',
        description: 'Generate a QR code from any URL and download it as a PNG.',
        descriptionCn: '为任意链接生成二维码，并下载为 PNG 图片。',
    },
    {
        id: 'send-email',
        title: 'Send Email',
        titleCn: '发送邮件',
        description: 'Send a one-off email through Resend. Shares the daily ticket-email cap.',
        descriptionCn: '通过 Resend 发送一次性邮件，与门票邮件共享每日上限。',
    },
];

export const ToolsTab = () => {
    const {isEnglish} = useLanguage();
    const [activeTool, setActiveTool] = useState<ToolId | null>(null);

    if (activeTool === 'qr-generator') {
        return <QrGeneratorTool onBack={() => setActiveTool(null)}/>;
    }
    if (activeTool === 'send-email') {
        return <SendEmailTool onBack={() => setActiveTool(null)}/>;
    }

    return (
        <div className="admin-section">
            <div className="admin-tools-grid">
                {TOOLS.map(tool => (
                    <button
                        key={tool.id}
                        className="admin-tools-card"
                        onClick={() => setActiveTool(tool.id)}
                    >
                        <div className="admin-tools-card-title">
                            {isEnglish ? tool.title : tool.titleCn}
                        </div>
                        <div className="admin-tools-card-desc">
                            {isEnglish ? tool.description : tool.descriptionCn}
                        </div>
                    </button>
                ))}
            </div>
        </div>
    );
};

interface QrGeneratorToolProps {
    onBack: () => void;
}

const QR_SIZE = 280;

type ExpirationMode = 'none' | 'event' | 'date';

const QrGeneratorTool = ({onBack}: QrGeneratorToolProps) => {
    const {isEnglish} = useLanguage();
    const [url, setUrl] = useState('');
    const [expirationMode, setExpirationMode] = useState<ExpirationMode>('none');
    const [selectedEventId, setSelectedEventId] = useState('');
    const [expiresLocal, setExpiresLocal] = useState('');
    const {upcomingEvents, loading: eventsLoading} = useAllUpcomingEvents();
    const qrWrapRef = useRef<HTMLDivElement>(null);

    const trimmed = url.trim();
    const valid = isValidHttpUrl(trimmed);

    // Parse the datetime-local value (treated as the user's local time) into an ISO timestamp.
    const expiresIso = (() => {
        if (expirationMode !== 'date' || !expiresLocal) return '';
        const d = new Date(expiresLocal);
        return isNaN(d.getTime()) ? '' : d.toISOString();
    })();

    // If an event or expiration date is set, redirect via our app so we can intercept it after expiry.
    const qrValue = (() => {
        if (!valid || typeof window === 'undefined') return trimmed;
        const origin = window.location.origin;
        if (expirationMode === 'event' && selectedEventId) {
            return `${origin}/qr?url=${encodeURIComponent(trimmed)}&event=${encodeURIComponent(selectedEventId)}`;
        }
        if (expirationMode === 'date' && expiresIso) {
            return `${origin}/qr?url=${encodeURIComponent(trimmed)}&expires=${encodeURIComponent(expiresIso)}`;
        }
        return trimmed;
    })();

    const downloadPng = () => {
        const canvas = qrWrapRef.current?.querySelector('canvas');
        if (!canvas) return;
        const now = new Date();
        const pad = (n: number) => String(n).padStart(2, '0');
        const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
        const link = document.createElement('a');
        link.download = `qr-code-${stamp}.png`;
        link.href = canvas.toDataURL('image/png');
        link.click();
    };

    const copyUrl = () => {
        if (!valid) return;
        navigator.clipboard.writeText(qrValue).catch(() => {
            /* clipboard may be unavailable */
        });
    };

    return (
        <div className="admin-section">
            <div className="admin-tools-header">
                <button className="admin-back-btn" onClick={onBack} type="button">
                    {isEnglish ? '← Back to Tools' : '← 返回工具'}
                </button>
                <h3 className="admin-tools-title">
                    {isEnglish ? 'QR Generator' : '二维码生成器'}
                </h3>
            </div>
            <div className="admin-form-grid">
                <label className="admin-form-grid-full">
                    <span>{isEnglish ? 'URL' : '链接'}</span>
                    <input
                        value={url}
                        onChange={e => setUrl(e.target.value)}
                        className="admin-search-input"
                        placeholder="https://example.com"
                        autoFocus
                    />
                </label>
                <label className="admin-form-grid-full">
                    <span>{isEnglish ? 'Expiration (Optional)' : '过期方式 (可选)'}</span>
                    <select
                        value={expirationMode}
                        onChange={e => setExpirationMode(e.target.value as ExpirationMode)}
                        className="admin-search-input"
                    >
                        <option value="none">{isEnglish ? 'No Expiration' : '永不过期'}</option>
                        <option value="event">{isEnglish ? 'Link to Event' : '关联活动'}</option>
                        <option value="date">{isEnglish ? 'Custom Date' : '自定义日期'}</option>
                    </select>
                </label>
                {expirationMode === 'event' && (
                    <label className="admin-form-grid-full">
                        <span>{isEnglish ? 'Event' : '活动'}</span>
                        <select
                            value={selectedEventId}
                            onChange={e => setSelectedEventId(e.target.value)}
                            className="admin-search-input"
                            disabled={eventsLoading}
                        >
                            <option value="">{isEnglish ? '-- Select Event --' : '-- 选择活动 --'}</option>
                            {upcomingEvents.map(ev => (
                                <option key={ev.id} value={ev.id}>
                                    {isEnglish ? ev.title : ev.titleCn}
                                </option>
                            ))}
                        </select>
                    </label>
                )}
                {expirationMode === 'date' && (
                    <label className="admin-form-grid-full">
                        <span>{isEnglish ? 'Active Until' : '有效截止'}</span>
                        <input
                            type="datetime-local"
                            value={expiresLocal}
                            onChange={e => setExpiresLocal(e.target.value)}
                            className="admin-search-input"
                        />
                    </label>
                )}
            </div>
            {!valid ? (
                <p className="admin-no-results">
                    {isEnglish
                        ? 'Enter a valid http(s) URL above to generate a QR code.'
                        : '请输入有效的 http(s) 链接以生成二维码。'}
                </p>
            ) : (
                <div className="admin-single-code admin-single-code-narrow">
                    <div ref={qrWrapRef} className="admin-single-code-qr">
                        <QRCodeCanvas
                            value={qrValue}
                            size={QR_SIZE}
                            level="M"
                            marginSize={2}
                        />
                    </div>
                    <div className="admin-code-url">
                        <input
                            readOnly
                            value={qrValue}
                            onClick={(e) => (e.target as HTMLInputElement).select()}
                            className="admin-code-input"
                        />
                        <button
                            className="admin-copy-btn"
                            onClick={copyUrl}
                            type="button"
                        >
                            {isEnglish ? 'Copy' : '复制'}
                        </button>
                    </div>
                    <div className="admin-single-code-actions">
                        <button
                            className="admin-toggle-btn admin-toggle-save"
                            onClick={downloadPng}
                            type="button"
                        >
                            {isEnglish ? 'Download PNG' : '下载 PNG'}
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
};

interface SendEmailToolProps {
    onBack: () => void;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Splits comma/semicolon/whitespace-separated email lists pasted into a single
// input. Empty entries are dropped; validation happens at submit so the field
// can hold a mid-typing value.
const parseEmailList = (raw: string): string[] =>
    raw.split(/[,;\s]+/).map(s => s.trim()).filter(Boolean);

const SendEmailTool = ({onBack}: SendEmailToolProps) => {
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
    const [quota, setQuota] = useState<{sentToday: number; dailyCap: number} | null>(null);
    const [quotaLoading, setQuotaLoading] = useState(true);

    const previewOverlayRef = useRef<HTMLDivElement>(null);
    useModalEffects(showPreview, previewOverlayRef);

    useEffect(() => {
        let cancelled = false;
        const load = async () => {
            try {
                const res = await callGetTicketEmailQuota();
                if (!cancelled) setQuota({sentToday: res.data.sentToday, dailyCap: res.data.dailyCap});
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

    const canSend = !sending
        && toList.length > 0
        && invalidEmails.length === 0
        && !replyToInvalid
        && subject.trim().length > 0
        && hasBodyContent
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
                text: isEnglish
                    ? `Email queued for ${res.data.recipientCount} recipient${res.data.recipientCount === 1 ? '' : 's'}.`
                    : `邮件已排队发送给 ${res.data.recipientCount} 位收件人。`,
            });
            setToRaw('');
            setCcRaw('');
            setBccRaw('');
            setSubject('');
            setBodyHtml('');
            try {
                const refreshed = await callGetTicketEmailQuota();
                setQuota({sentToday: refreshed.data.sentToday, dailyCap: refreshed.data.dailyCap});
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
                        ? `Today's outgoing emails: ${quota.sentToday} / ${quota.dailyCap} (shared with ticket emails)`
                        : `今日已发邮件：${quota.sentToday} / ${quota.dailyCap}（与门票邮件共享）`}
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
