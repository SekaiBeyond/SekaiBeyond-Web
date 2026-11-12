import { useState } from 'react';
import { useLanguage } from '~/components/LanguageContextProvider';
import { QrCodesTool } from './tools/QrCodesTool';
import { EmailQuotaTool } from './tools/EmailQuotaTool';
import { WalletPassesTool } from './tools/WalletPassesTool';
import { AppsTool } from './tools/AppsTool';
import type { ShowToast } from './utils';

type ToolId = 'qr-codes' | 'email-quota' | 'wallet-passes' | 'apps';

interface ToolDef {
    id: ToolId;
    title: string;
    titleCn: string;
    description: string;
    descriptionCn: string;
    // Hidden from staff (read-only), for tools whose callable is core-staff+.
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
    },
    {
        id: 'wallet-passes',
        title: 'Wallet Passes',
        titleCn: '电子钱包票券',
        description: 'Check how many Apple and Google Wallet passes the Add to Wallet button in ticket emails can still make this month.',
        descriptionCn: '查看本月门票邮件中的"添加到钱包"按钮还能生成多少张 Apple / Google 钱包票券。',
    },
    {
        id: 'apps',
        title: 'Apps',
        titleCn: '应用',
        description: 'Register apps, like SKBY Manager or a ticket seller, that sign people in with their account here, or read events, the team and event staff and sell tickets with API keys.',
        descriptionCn: '登记应用（例如 SKBY Manager 或售票应用）：让用户用本站账号登录，或使用 API 密钥读取活动、团队和活动工作人员以及售票。',
        adminOnly: true,
    },
];

interface ToolsTabProps {
    showToast: ShowToast;
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

    if (activeTool === 'wallet-passes') {
        return <WalletPassesTool onBack={() => setActiveTool(null)} showToast={showToast}/>;
    }

    if (activeTool === 'apps') {
        return <AppsTool onBack={() => setActiveTool(null)} showToast={showToast}/>;
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
