import { useCallback, useEffect, useState } from 'react';
import { useLanguage } from '~/components/LanguageContextProvider';
import { callGetTicketEmailQuota, type TicketEmailQuota } from '~/lib/firebase';

export function useEmailQuota() {
    const [quota, setQuota] = useState<TicketEmailQuota | null>(null);
    const [error, setError] = useState(false);

    const load = useCallback(async () => {
        try {
            setQuota((await callGetTicketEmailQuota()).data);
            setError(false);
        } catch (err) {
            console.error('[useEmailQuota]', err);
            setError(true);
        }
    }, []);

    useEffect(() => {
        void load();
    }, [load]);

    const remainingToday = quota ? Math.max(0, quota.dailyCap - quota.sentToday) : null;
    const remainingQueue = quota ? Math.max(0, quota.queueCap - quota.queuedCount) : null;
    return {
        quota,
        error,
        load,
        remainingToday,
        remainingQueue,
        fullyBlocked: remainingToday === 0 && remainingQueue === 0,
    };
}

export function EmailQuotaBanner({state, describe}: {
    state: ReturnType<typeof useEmailQuota>;
    describe: (quota: TicketEmailQuota, remainingToday: number) => string;
}) {
    const {isEnglish} = useLanguage();
    const {quota, error, remainingToday, fullyBlocked} = state;
    const tone = error ? 'warning'
        : fullyBlocked ? 'error'
            : remainingToday !== null && remainingToday <= 10 ? 'warning'
                : 'info';
    return (
        <div className={`admin-tickets-send-banner admin-tickets-send-banner-${tone}`}>
            <span>
                {error
                    ? (isEnglish ? 'Could not load the Resend quota. Sending still works.' : '无法加载 Resend 额度。发送功能仍可使用。')
                    : quota
                        ? describe(quota, remainingToday ?? 0)
                        : (isEnglish ? 'Loading quota...' : '加载额度中...')}
            </span>
        </div>
    );
}

export function TemplateUnsavedBanner() {
    const {isEnglish} = useLanguage();
    return (
        <div className="admin-tickets-send-banner admin-tickets-send-banner-warning">
            <strong>{isEnglish ? 'Email template not saved.' : '邮件模板尚未保存。'}</strong>
            <p>
                {isEnglish
                    ? 'Save the template below before sending. Emails go out with the saved version.'
                    : '发送前请先保存下方的模板。邮件将按已保存的版本发送。'}
            </p>
        </div>
    );
}
