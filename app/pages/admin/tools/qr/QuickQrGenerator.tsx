import { useRef, useState } from 'react';
import { QRCodeCanvas } from 'qrcode.react';
import { useLanguage } from '~/components/LanguageContextProvider';
import { isValidHttpUrl } from '~/lib/urls';
import type { UpcomingEvent } from '~/lib/upcomingEvents';

const QR_SIZE = 280;

type ExpirationMode = 'none' | 'event' | 'date';

/**
 * The original throwaway generator: bakes a URL straight into a QR (optionally
 * routed through `/qr` for event/date gating) with no saved record and no scan
 * tracking. Kept for quick one-off codes that don't need a dashboard entry.
 */
export const QuickQrGenerator = ({events}: {events: UpcomingEvent[]}) => {
    const {isEnglish} = useLanguage();
    const [url, setUrl] = useState('');
    const [expirationMode, setExpirationMode] = useState<ExpirationMode>('none');
    const [selectedEventId, setSelectedEventId] = useState('');
    const [expiresLocal, setExpiresLocal] = useState('');
    const qrWrapRef = useRef<HTMLDivElement>(null);

    const trimmed = url.trim();
    const valid = isValidHttpUrl(trimmed);

    const expiresIso = (() => {
        if (expirationMode !== 'date' || !expiresLocal) return '';
        const d = new Date(expiresLocal);
        return isNaN(d.getTime()) ? '' : d.toISOString();
    })();

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
        navigator.clipboard.writeText(qrValue).catch(() => { /* clipboard may be unavailable */
        });
    };

    return (
        <>
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
                        >
                            <option value="">{isEnglish ? '-- Select Event --' : '-- 选择活动 --'}</option>
                            {events.map(ev => (
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
                        <QRCodeCanvas value={qrValue} size={QR_SIZE} level="M" marginSize={2}/>
                    </div>
                    <div className="admin-code-url">
                        <input
                            readOnly
                            value={qrValue}
                            onClick={e => (e.target as HTMLInputElement).select()}
                            className="admin-code-input"
                        />
                        <button className="admin-copy-btn" onClick={copyUrl} type="button">
                            {isEnglish ? 'Copy' : '复制'}
                        </button>
                    </div>
                    <div className="admin-single-code-actions">
                        <button className="admin-toggle-btn admin-toggle-save" onClick={downloadPng} type="button">
                            {isEnglish ? 'Download PNG' : '下载 PNG'}
                        </button>
                    </div>
                </div>
            )}
        </>
    );
};
