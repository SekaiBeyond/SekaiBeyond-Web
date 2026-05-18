import { useState } from 'react';
import { useLanguage } from '~/components/LanguageContextProvider';
import { QrGeneratorTool } from './tools/QrGeneratorTool';
import { SendEmailTool } from './tools/SendEmailTool';

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
        description: 'Send a one-off email. Shares the daily ticket-email cap.',
        descriptionCn: '发送一次性邮件，与门票邮件共享每日上限。',
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
