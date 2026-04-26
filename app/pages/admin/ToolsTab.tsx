import { useRef, useState } from 'react';
import { QRCodeCanvas } from 'qrcode.react';
import { useLanguage } from '~/components/LanguageContextProvider';
import { isValidHttpUrl } from '~/lib/urls';

type ToolId = 'qr-generator';

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
];

export const ToolsTab = () => {
    const {isEnglish} = useLanguage();
    const [activeTool, setActiveTool] = useState<ToolId | null>(null);

    if (activeTool === 'qr-generator') {
        return <QrGeneratorTool onBack={() => setActiveTool(null)}/>;
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

const QrGeneratorTool = ({onBack}: QrGeneratorToolProps) => {
    const {isEnglish} = useLanguage();
    const [url, setUrl] = useState('');
    const qrWrapRef = useRef<HTMLDivElement>(null);

    const trimmed = url.trim();
    const valid = isValidHttpUrl(trimmed);

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
        navigator.clipboard.writeText(trimmed).catch(() => {
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
            </div>
            {!valid ? (
                <p className="admin-no-results">
                    {isEnglish
                        ? 'Enter a valid http(s) URL above to generate a QR code.'
                        : '请输入有效的 http(s) 链接以生成二维码。'}
                </p>
            ) : (
                <div className="admin-single-code">
                    <div ref={qrWrapRef} className="admin-single-code-qr">
                        <QRCodeCanvas
                            value={trimmed}
                            size={QR_SIZE}
                            level="M"
                            marginSize={2}
                        />
                    </div>
                    <div className="admin-code-url">
                        <input
                            readOnly
                            value={trimmed}
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
