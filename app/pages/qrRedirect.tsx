import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { Navigation } from '~/components/main/Navigation';
import { useLanguage } from '~/components/LanguageContextProvider';
import { useUpcomingEventsByIds } from '~/lib/upcomingEvents';
import { callRecordQrScan, functionsErrorCode } from '~/lib/firebase';
import { MdEventBusy } from 'react-icons/md';

export const QrRedirectPage = () => {
    const [searchParams] = useSearchParams();
    const id = searchParams.get('id');

    // Managed codes (saved + tracked) use a short, stable `id`; legacy printed
    // codes still carry the full url/event/expires in the query string.
    if (id) return <ManagedQrRedirect id={id}/>;
    return <LegacyQrRedirect/>;
};

// ---------------- Managed (tracked) codes ----------------

type ManagedStatus = 'loading' | 'redirecting' | 'expired' | 'error';

const ManagedQrRedirect = ({id}: {id: string}) => {
    const {isEnglish} = useLanguage();
    const [status, setStatus] = useState<ManagedStatus>('loading');

    useEffect(() => {
        let cancelled = false;
        callRecordQrScan({id})
            .then(res => {
                if (cancelled) return;
                const {active, targetUrl} = res.data;
                if (active && targetUrl) {
                    setStatus('redirecting');
                    window.location.href = targetUrl;
                } else {
                    setStatus('expired');
                }
            })
            .catch(err => {
                if (cancelled) return;
                setStatus(functionsErrorCode(err) === 'not-found' ? 'expired' : 'error');
            });
        return () => {
            cancelled = true;
        };
    }, [id]);

    if (status === 'loading' || status === 'redirecting') {
        return (
            <div className="qr-redirect-page">
                <main className="qr-redirect-main">
                    <div className="qr-redirect-blob"></div>
                    <div className="qr-redirect-card">
                        <div className="profile-spinner admin-spinner-center"/>
                        <p className="qr-redirect-message">
                            {isEnglish ? 'Taking you there…' : '正在跳转…'}
                        </p>
                    </div>
                </main>
            </div>
        );
    }

    return <ExpiredCard isError={status === 'error'}/>;
};

// ---------------- Legacy (inline url/event/expires) codes ----------------

const LegacyQrRedirect = () => {
    const [searchParams] = useSearchParams();

    const targetUrl = searchParams.get('url');
    const eventId = searchParams.get('event');
    const expiresParam = searchParams.get('expires');

    const {upcomingEvents: requestedEvents, loading: loadingEvent} = useUpcomingEventsByIds(eventId ? [eventId] : []);

    const expiresAt = (() => {
        if (!expiresParam) return null;
        const d = new Date(expiresParam);
        return isNaN(d.getTime()) ? null : d;
    })();

    const now = new Date();
    const eventActive = !loadingEvent && requestedEvents[0] ? requestedEvents[0].endAt > now : false;
    const dateActive = expiresAt ? expiresAt > now : false;
    // If neither an event nor an expires param is present, there's nothing to gate on — pass through.
    const noGating = !eventId && !expiresParam;
    const isActive = noGating || eventActive || dateActive;

    useEffect(() => {
        if (eventId && loadingEvent) return;
        if (isActive && targetUrl) {
            window.location.href = targetUrl;
        }
    }, [eventId, targetUrl, isActive, loadingEvent]);

    const stillResolving = eventId && loadingEvent;
    const isMissingOrInvalid = !targetUrl || (!stillResolving && !isActive);

    if (!isMissingOrInvalid) {
        return null;
    }

    return <ExpiredCard isError={false}/>;
};

// ---------------- Shared expired / invalid card ----------------

const ExpiredCard = ({isError}: {isError: boolean}) => {
    const {isEnglish} = useLanguage();
    return (
        <div className="qr-redirect-page">
            <Navigation/>
            <main className="qr-redirect-main">
                <div className="qr-redirect-blob"></div>
                <div className="qr-redirect-card">
                    <div className="qr-redirect-icon">
                        <MdEventBusy className="qr-redirect-icon-svg"/>
                    </div>
                    <h1 className="qr-redirect-title">
                        {isError
                            ? (isEnglish ? 'Something Went Wrong' : '出错了')
                            : (isEnglish ? 'QR Code Expired or Invalid' : '二维码已过期或无效')}
                    </h1>
                    <p className="qr-redirect-message">
                        {isError
                            ? (isEnglish
                                ? 'We couldn’t open this QR code. Please try again.'
                                : '无法打开此二维码，请重试。')
                            : (isEnglish
                                ? 'The QR code you scanned has expired or the link is invalid.'
                                : '您扫描的二维码已过期或链接无效。')}
                    </p>
                    <Link to="/#events" className="btn btn-primary qr-redirect-cta">
                        <span>{isEnglish ? 'Explore Events' : '探索活动'}</span>
                        <span>✨</span>
                    </Link>
                </div>
            </main>
        </div>
    );
};
