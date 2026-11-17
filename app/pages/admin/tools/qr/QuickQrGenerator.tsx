import { useState } from 'react';
import { useLanguage } from '~/components/LanguageContextProvider';
import { fileStamp } from '~/lib/csv';
import { isValidHttpUrl } from '~/lib/urls';
import { CopyField } from '../../CopyField';
import { QrPreview, useQrDownload } from './qrExport';

const QR_SIZE = 280;

export const QuickQrGenerator = () => {
    const {isEnglish} = useLanguage();
    const [url, setUrl] = useState('');
    const {request: requestDownload, node: downloadNode} = useQrDownload();

    const trimmed = url.trim();
    const valid = isValidHttpUrl(trimmed);

    const downloadPng = () => requestDownload(trimmed, `qr-code-${fileStamp()}`);

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
                    <div className="admin-single-code-qr">
                        <QrPreview value={trimmed} size={QR_SIZE}/>
                    </div>
                    <CopyField value={trimmed}/>
                    <div className="admin-single-code-actions">
                        <button className="admin-toggle-btn admin-toggle-save" onClick={downloadPng} type="button">
                            {isEnglish ? 'Download PNG' : '下载 PNG'}
                        </button>
                    </div>
                </div>
            )}
            {downloadNode}
        </>
    );
};
