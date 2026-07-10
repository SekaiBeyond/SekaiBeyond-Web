import { useEffect, useMemo, useState } from 'react';
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
    // codes still carry the full url/event/expires in the query string. Social
    // codes add `p` so the scan tallies under that platform.
    if (id) return <ManagedQrRedirect id={id} platform={searchParams.get('p') ?? ''}/>;
    return <LegacyQrRedirect/>;
};

// ---------------- Managed (tracked) codes ----------------

type ManagedStatus = 'loading' | 'redirecting' | 'expired' | 'error';

const ManagedQrRedirect = ({id, platform}: {id: string; platform: string}) => {
    const {isEnglish} = useLanguage();
    const [status, setStatus] = useState<ManagedStatus>('loading');

    useEffect(() => {
        let cancelled = false;
        callRecordQrScan(platform ? {id, p: platform} : {id})
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
    }, [id, platform]);

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

export const LegacyQrRedirect = () => {
    const [searchParams] = useSearchParams();

    const rawUrl = searchParams.get('url');
    // Only allow http(s) targets — blocks javascript:, data:, and other protocols.
    const targetUrl = useMemo(() => {
        if (!rawUrl) return null;
        try {
            const parsed = new URL(rawUrl);
            return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? rawUrl : null;
        } catch {
            return null;
        }
    }, [rawUrl]);
    const eventId = searchParams.get('event');
    const expiresParam = searchParams.get('expires');
    const startsParam = searchParams.get('starts');

    const {upcomingEvents: requestedEvents, loading: loadingEvent} = useUpcomingEventsByIds(eventId ? [eventId] : []);

    const parseDate = (value: string | null) => {
        if (!value) return null;
        const d = new Date(value);
        return isNaN(d.getTime()) ? null : d;
    };
    const expiresAt = parseDate(expiresParam);
    const startsAt = parseDate(startsParam);

    const now = new Date();
    const eventActive = !loadingEvent && requestedEvents[0] ? requestedEvents[0].endAt > now : false;
    const dateActive = expiresAt ? expiresAt > now : false;
    // A start time gates independently of how the end is gated.
    const started = !startsAt || startsAt <= now;
    // If neither an event nor an expires param is present, there's no end to gate on — pass through.
    const endOk = (!eventId && !expiresParam) || eventActive || dateActive;
    const isActive = started && endOk;

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

    // Only "not yet" when the start gate is the sole blocker — a code that is
    // also past its end (or has no target) is expired/invalid, not early.
    return <ExpiredCard isError={false} notYetActive={Boolean(targetUrl) && !started && endOk}/>;
};

// ---------------- Shared expired / invalid card ----------------

export const ExpiredCard = ({isError, notYetActive = false}: {isError: boolean; notYetActive?: boolean}) => {
    const {isEnglish} = useLanguage();
    const title = isError
        ? (isEnglish ? 'Something Went Wrong' : '出错了')
        : notYetActive
            ? (isEnglish ? 'QR Code Not Active Yet' : '二维码尚未生效')
            : (isEnglish ? 'QR Code Expired or Invalid' : '二维码已过期或无效');
    const message = isError
        ? (isEnglish
            ? 'We couldn’t open this QR code. Please try again.'
            : '无法打开此二维码，请重试。')
        : notYetActive
            ? (isEnglish
                ? 'This QR code isn’t active yet. Please try again later.'
                : '此二维码尚未生效，请稍后再试。')
            : (isEnglish
                ? 'The QR code you scanned has expired or the link is invalid.'
                : '您扫描的二维码已过期或链接无效。');
    return (
        <div className="qr-redirect-page">
            <Navigation/>
            <main className="qr-redirect-main">
                <div className="qr-redirect-blob"></div>
                <div className="qr-redirect-card">
                    <div className="qr-redirect-icon">
                        <MdEventBusy className="qr-redirect-icon-svg"/>
                    </div>
                    <h1 className="qr-redirect-title">{title}</h1>
                    <p className="qr-redirect-message">{message}</p>
                    <Link to="/#events" className="btn btn-primary qr-redirect-cta">
                        <span>{isEnglish ? 'Explore Events' : '探索活动'}</span>
                        <span>✨</span>
                    </Link>
                </div>
            </main>
        </div>
    );
};
