import { useRef, useState } from 'react';
import { QRCodeCanvas } from 'qrcode.react';
import { useLanguage } from '~/components/LanguageContextProvider';
import { isValidHttpUrl } from '~/lib/urls';

const QR_SIZE = 280;

/**
 * The original throwaway generator: bakes a URL straight into a QR with no
 * saved record and no scan tracking. Anything needing a date window or scan
 * counts should be a tracked code instead.
 */
export const QuickQrGenerator = () => {
    const {isEnglish} = useLanguage();
    const [url, setUrl] = useState('');
    const qrWrapRef = useRef<HTMLDivElement>(null);

    const trimmed = url.trim();
    const valid = isValidHttpUrl(trimmed);
    const qrValue = trimmed;

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
                        className="admin-input"
                        placeholder="https://example.com"
                        autoFocus
                    />
                </label>
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
                        <button className="admin-btn admin-btn--purple" onClick={copyUrl} type="button">
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
