import { useState } from 'react';
import { useLanguage } from '~/components/LanguageContextProvider';
import { QrGeneratorTool } from './tools/QrGeneratorTool';

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
        title: 'QR Codes',
        titleCn: '二维码',
        description: 'Generate trackable QR codes, pin them to a map spot, and see how often each one is scanned.',
        descriptionCn: '生成可追踪二维码，关联地图位置，并查看每个二维码的扫描次数。',
    },
];

interface ToolsTabProps {
    showToast: (message: string, type: 'success' | 'warning' | 'error') => void;
    readOnly?: boolean;
}

export const ToolsTab = ({showToast, readOnly = false}: ToolsTabProps) => {
    const {isEnglish} = useLanguage();
    const [activeTool, setActiveTool] = useState<ToolId | null>(null);

    if (activeTool === 'qr-generator') {
        return <QrGeneratorTool onBack={() => setActiveTool(null)} showToast={showToast} readOnly={readOnly}/>;
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
