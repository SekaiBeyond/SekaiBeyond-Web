import type { ReactNode } from 'react';
import { useLanguage } from '~/components/LanguageContextProvider';
import { Banner } from '../Banner';
import { RefreshButton, ToolHeader } from '../ToolHeader';

export function QuotaPage({title, intro, failed, onBack, loading, error, load, children}: {
    title: string;
    intro: string;
    failed: string;
    onBack: () => void;
    loading: boolean;
    error: boolean;
    load: (notify: boolean) => Promise<void>;
    children: ReactNode;
}) {
    const {isEnglish} = useLanguage();
    return (
        <div className="admin-section">
            <ToolHeader title={title} back={isEnglish ? 'Back to Tools' : '返回工具'} onBack={onBack}>
                <RefreshButton className="admin-toggle-btn admin-toggle-edit admin-quota-refresh"
                               onClick={() => load(true)} busy={loading}/>
            </ToolHeader>
            <p className="admin-helper-text admin-section-mb">{intro}</p>
            {children ?? (
                <>
                    {error && <Banner tone="error"><span>{failed}</span></Banner>}
                    {loading && <div className="spinner spinner-centered"/>}
                </>
            )}
        </div>
    );
}

export function QuotaMeter({parts}: {
    parts: {kind: 'confirmed' | 'reserved' | 'free'; label: ReactNode; pct?: number}[];
}) {
    return (
        <div className="admin-quota-meter">
            <div className="admin-quota-meter-track">
                {parts.filter(part => part.pct !== undefined).map(part => (
                    <div
                        key={part.kind}
                        className={`admin-quota-meter-fill admin-quota-meter-fill--${part.kind}`}
                        style={{width: `${part.pct}%`}}
                    />
                ))}
            </div>
            <div className="admin-quota-meter-legend">
                {parts.map(part => (
                    <span key={part.kind} className="admin-quota-legend-item">
                        <i className={`admin-quota-swatch admin-quota-swatch--${part.kind}`}/>
                        {part.label}
                    </span>
                ))}
            </div>
        </div>
    );
}

export function QuotaNotes({children}: {children: ReactNode}) {
    const {isEnglish} = useLanguage();
    return (
        <div className="admin-stats-card">
            <div className="admin-stats-card-title">{isEnglish ? 'How this works' : '说明'}</div>
            <ul className="admin-quota-notes">{children}</ul>
        </div>
    );
}
