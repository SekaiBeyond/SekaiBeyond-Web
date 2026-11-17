import { type ReactNode, useEffect, useState } from 'react';
import { useLanguage } from '~/components/LanguageContextProvider';
import type { ShowToast } from './utils';

interface Localized {
    en: string;
    zh: string;
}

export function ToolHeader({title, back, onBack, children}: {
    title: string;
    back?: string;
    onBack?: () => void;
    children?: ReactNode;
}) {
    return (
        <div className="admin-tools-header">
            {onBack && (
                <button className="admin-btn admin-btn--link" onClick={onBack} type="button">
                    ← {back}
                </button>
            )}
            <h3 className="admin-tools-title">{title}</h3>
            {children}
        </div>
    );
}

export function RefreshButton({onClick, busy, className = 'admin-toggle-btn admin-toggle-edit'}: {
    onClick: () => unknown;
    busy?: boolean;
    className?: string;
}) {
    const {isEnglish} = useLanguage();
    const [running, setRunning] = useState(false);
    const loading = busy ?? running;
    const click = async () => {
        setRunning(true);
        try {
            await onClick();
        } finally {
            setRunning(false);
        }
    };
    return (
        <button className={className} onClick={() => void click()} disabled={loading} type="button">
            {loading ? (isEnglish ? 'Loading...' : '加载中...') : (isEnglish ? 'Refresh' : '刷新')}
        </button>
    );
}

export function useToolLoader<T>(
    fetch: () => Promise<{data: T}>,
    onData: (data: T) => void,
    messages: {refreshed: Localized; failed: Localized},
    showToast: ShowToast,
) {
    const {isEnglish} = useLanguage();
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(false);
    const say = (text: Localized) => isEnglish ? text.en : text.zh;

    const load = async (notify: boolean) => {
        setLoading(true);
        try {
            onData((await fetch()).data);
            setError(false);
            if (notify) showToast(say(messages.refreshed), 'success');
        } catch (err) {
            console.error(err);
            setError(true);
            if (notify) showToast(say(messages.failed), 'error');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        void load(false);
    }, []);

    return {loading, error, load};
}
