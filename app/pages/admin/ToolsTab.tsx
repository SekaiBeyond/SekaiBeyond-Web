import { useState } from 'react';
import { useLanguage } from '~/components/LanguageContextProvider';
import { QrCodesTool } from './tools/QrCodesTool';
import { EmailQuotaTool } from './tools/EmailQuotaTool';

type ToolId = 'qr-codes' | 'email-quota';

interface ToolDef {
    id: ToolId;
    title: string;
    titleCn: string;
    description: string;
    descriptionCn: string;
    // Hidden from read-only (staff) viewers. Use for tools whose callable is
    // gated to core-staff+, which would otherwise fail with permission-denied.
    adminOnly?: boolean;
}

const TOOLS: ToolDef[] = [
    {
        id: 'qr-codes',
        title: 'QR Codes',
        titleCn: '二维码',
        description: 'Generate trackable QR codes, pin them to a map spot, and see how often each one is scanned. Or scan any QR code to see what it holds before opening it.',
        descriptionCn: '生成可追踪二维码，关联地图位置，并查看每个二维码的扫描次数；也可扫描任意二维码，在打开前查看其中内容。',
    },
    {
        id: 'email-quota',
        title: 'Email Quota',
        titleCn: '邮件额度',
        description: 'Check how much outbound email capacity is left before sends start queueing, and how deep the queue is.',
        descriptionCn: '查看外发邮件的剩余额度（超出后邮件将进入队列），以及当前排队数量。',
        adminOnly: true,
    },
];

interface ToolsTabProps {
    showToast: (message: string, type: 'success' | 'warning' | 'error') => void;
    readOnly?: boolean;
}

export const ToolsTab = ({showToast, readOnly = false}: ToolsTabProps) => {
    const {isEnglish} = useLanguage();
    const [activeTool, setActiveTool] = useState<ToolId | null>(null);

    if (activeTool === 'qr-codes') {
        return <QrCodesTool onBack={() => setActiveTool(null)} showToast={showToast} readOnly={readOnly}/>;
    }

    if (activeTool === 'email-quota') {
        return <EmailQuotaTool onBack={() => setActiveTool(null)} showToast={showToast}/>;
    }

    return (
        <div className="admin-section">
            <div className="admin-tools-grid">
                {TOOLS.filter(tool => !tool.adminOnly || !readOnly).map(tool => (
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
