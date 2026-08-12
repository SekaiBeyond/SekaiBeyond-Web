import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { Navigation } from '~/components/main/Navigation';
import { useLanguage } from '~/components/LanguageContextProvider';
import { callRecordQrScan, functionsErrorCode } from '~/lib/firebase';
import { MdEventBusy } from 'react-icons/md';

export const QrRedirectPage = () => {
    const [searchParams] = useSearchParams();
    const id = searchParams.get('id');

    // Managed codes (saved + tracked) use a short, stable `id`; social codes add
    // `p` so the scan tallies under that platform. Legacy inline-url codes are no
    // longer supported — anything without an `id` resolves to expired/invalid.
    if (id) return <ManagedQrRedirect id={id} platform={searchParams.get('p') ?? ''}/>;
    return <ExpiredCard isError={false}/>;
};

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
                        <div className="spinner spinner-centered"/>
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

export const ExpiredCard = ({isError}: {isError: boolean}) => {
    const {isEnglish} = useLanguage();
    const title = isError
        ? (isEnglish ? 'Something Went Wrong' : '出错了')
        : (isEnglish ? 'QR Code Expired or Invalid' : '二维码已过期或无效');
    const message = isError
        ? (isEnglish
            ? 'We couldn’t open this QR code. Please try again.'
            : '无法打开此二维码，请重试。')
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
