import { useCallback, useEffect, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { QRCodeSVG } from 'qrcode.react';
import { useAuth } from '~/components/AuthProvider';
import { useLanguage } from '~/components/LanguageContextProvider';
import { accountErrorMessage } from '~/lib/accountErrors';
import { toDate } from '~/lib/collectionCache';
import {
    callCancelAppLink,
    callConfirmAppLink,
    callGetAppLinks,
    callStartAppLink,
    callUnlinkApp,
    getFirebaseDb,
    type LinkableApp,
} from '~/lib/firebase';
import type { ShowToast } from '~/lib/useToasts';

/** A request this tab started, as startAppLink gave it. */
interface Started {
    appId: string;
    requestId: string;
    code: string;
    qr: string;
}

/** The request as it stands, watched in Firestore for the app's claim. `failed`: it can't be watched. */
interface Watched {
    status: 'waiting' | 'claimed' | 'linked' | 'cancelled' | 'failed';
    appUserName: string;
    expiresAt: number;
}

const STATUSES = ['waiting', 'claimed', 'linked', 'cancelled'] as const;

/**
 * The request `requestId` names, kept up to date as the app claims it, or
 * null until it's first read. The server pushes its time on when it's
 * claimed, so the countdown starts over for confirming.
 */
function useLinkRequest(requestId: string | null): Watched | null {
    const [watched, setWatched] = useState<Watched | null>(null);
    useEffect(() => {
        setWatched(null);
        if (!requestId) return;
        return onSnapshot(doc(getFirebaseDb(), 'appLinkRequests', requestId), snap => {
            const data = snap.data();
            if (!data) return;
            setWatched({
                status: STATUSES.includes(data.status) ? data.status : 'cancelled',
                appUserName: typeof data.appUserName === 'string' ? data.appUserName : '',
                expiresAt: toDate(data.expiresAt)?.getTime() ?? 0,
            });
        }, () => setWatched({status: 'failed', appUserName: '', expiresAt: 0}));
    }, [requestId]);
    return watched;
}

/** Now, a second at a time while `on`. */
function useNow(on: boolean): number {
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        if (!on) return;
        setNow(Date.now());
        const timer = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(timer);
    }, [on]);
    return now;
}

const formatLeft = (ms: number) => {
    const seconds = Math.max(0, Math.ceil(ms / 1000));
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
};

/**
 * A request in progress: the code to scan or type in the app, then, once the
 * app's user has claimed it there, who they are and the button that links
 * them. It's only linked once both sides have said yes.
 */
const LinkPanel = ({app, started, onLinked, onClose, showToast}: {
    app: LinkableApp;
    started: Started;
    onLinked: () => void;
    onClose: () => void;
    showToast: ShowToast;
}) => {
    const {isEnglish} = useLanguage();
    const language = isEnglish ? 'en' : 'zh';
    const watched = useLinkRequest(started.requestId);
    const open = watched?.status === 'waiting' || watched?.status === 'claimed';
    const now = useNow(!!open);
    const [busy, setBusy] = useState(false);

    const expired = !!watched && open && watched.expiresAt <= now;

    // Confirmed from another tab.
    const linkedElsewhere = watched?.status === 'linked';
    useEffect(() => {
        if (linkedElsewhere) onLinked();
    }, [linkedElsewhere, onLinked]);

    const confirm = async () => {
        setBusy(true);
        try {
            await callConfirmAppLink({requestId: started.requestId, language});
            showToast(isEnglish ? `${app.name} linked.` : `已绑定${app.name}。`, 'success');
            onLinked();
        } catch (err) {
            showToast(accountErrorMessage(err, isEnglish), 'error');
        } finally {
            setBusy(false);
        }
    };

    const cancel = () => {
        // Nothing to wait for: an unconfirmed request links nothing, and runs out anyway.
        void callCancelAppLink({requestId: started.requestId}).catch(() => {
        });
        onClose();
    };

    if (!watched || linkedElsewhere) {
        return <div className="settings-link-panel"><div className="spinner spinner-centered"/></div>;
    }

    if (expired || watched.status === 'cancelled' || watched.status === 'failed') {
        return (
            <div className="settings-link-panel">
                <span className="settings-row-help">
                    {watched.status === 'failed'
                        ? (isEnglish ? 'Couldn’t follow this request just now. Close it and try again.' : '暂时无法获取此请求的状态，请关闭后重试。')
                        : (isEnglish ? 'This code has run out. Start again for a new one.' : '此二维码已过期，请重新开始获取新的二维码。')}
                </span>
                <div className="settings-account-actions">
                    <button type="button" className="admin-btn admin-btn--dashed" onClick={onClose}>
                        {isEnglish ? 'Close' : '关闭'}
                    </button>
                </div>
            </div>
        );
    }

    if (watched.status === 'claimed') {
        const who = watched.appUserName || (isEnglish ? 'An account' : '一个账号');
        return (
            <div className="settings-link-panel">
                <span className="settings-row-help">
                    {isEnglish
                        ? <>Link <strong>{who}</strong> in {app.name} to this account? Only say yes if that’s you.</>
                        : <>要把{app.name}账号 <strong>{who}</strong> 绑定到此账号吗？只有确认是您本人时才继续。</>}
                </span>
                <span className="settings-row-help">
                    {isEnglish
                        ? `${app.name} will see your name, photo, masked email, group, membership and event staff roles, until either side unlinks.`
                        : `在任一方解绑前，${app.name}可以看到您的名称、头像、打码的邮箱、组别、会员状态和活动工作人员身份。`}
                </span>
                <span className="settings-row-state">
                    {isEnglish ? `${formatLeft(watched.expiresAt - now)} left` : `剩余 ${formatLeft(watched.expiresAt - now)}`}
                </span>
                <div className="settings-account-actions">
                    <button type="button" className="admin-btn admin-btn--cta" disabled={busy}
                            onClick={() => void confirm()}>
                        {isEnglish ? 'Link' : '绑定'}
                    </button>
                    <button type="button" className="admin-btn admin-btn--dashed" disabled={busy} onClick={cancel}>
                        {isEnglish ? 'This isn’t me' : '不是我'}
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className="settings-link-panel">
            <span className="settings-row-help">
                {isEnglish
                    ? `Open ${app.name} and scan this code, or enter the six digits under it. You’ll confirm here once it’s scanned.`
                    : `请打开${app.name}扫描此二维码，或输入下方的 6 位数字。扫描后需回到此页确认。`}
            </span>
            <div className="settings-link-qr">
                <QRCodeSVG value={started.qr} size={176} level="M" marginSize={2}/>
            </div>
            <span className="settings-link-code" aria-label={isEnglish ? 'Code' : '数字码'}>
                {started.code.slice(0, 3)} {started.code.slice(3)}
            </span>
            <span className="settings-row-state">
                {isEnglish ? `${formatLeft(watched.expiresAt - now)} left` : `剩余 ${formatLeft(watched.expiresAt - now)}`}
            </span>
            <div className="settings-account-actions">
                <button type="button" className="admin-btn admin-btn--dashed" onClick={cancel}>
                    {isEnglish ? 'Cancel' : '取消'}
                </button>
            </div>
        </div>
    );
};

/**
 * /profile's Settings tab: the apps this account may link to its account in
 * them, such as the mini program, and its links there. Hidden when no app
 * links accounts. Everything is enforced server-side (functions/appLinks.ts).
 */
export const ProfileAppLinksSection = ({showToast}: {showToast: ShowToast}) => {
    const {isEnglish} = useLanguage();
    const language = isEnglish ? 'en' : 'zh';
    const {user} = useAuth();
    const [apps, setApps] = useState<LinkableApp[] | null>(null);
    const [started, setStarted] = useState<Started | null>(null);
    const [busyApp, setBusyApp] = useState<string | null>(null);

    const load = useCallback(async () => {
        try {
            setApps((await callGetAppLinks()).data.apps);
        } catch {
            setApps(prev => prev ?? []);
        }
    }, []);

    const uid = user?.uid;
    useEffect(() => {
        if (uid) void load();
    }, [uid, load]);

    const linked = useCallback(() => {
        setStarted(null);
        void load();
    }, [load]);

    const start = async (app: LinkableApp) => {
        setBusyApp(app.appId);
        try {
            const {data} = await callStartAppLink({appId: app.appId});
            setStarted({appId: app.appId, ...data});
        } catch (err) {
            showToast(accountErrorMessage(err, isEnglish), 'error');
        } finally {
            setBusyApp(null);
        }
    };

    const unlink = async (app: LinkableApp) => {
        const confirmed = window.confirm(isEnglish
            ? `Unlink ${app.name}? It stops seeing your account at once. Either side can only link someone else after 30 days.`
            : `确定要解绑${app.name}吗？解绑后它将立即无法查看您的账号信息。30 天内双方都无法绑定其他账号。`);
        if (!confirmed) return;
        setBusyApp(app.appId);
        try {
            await callUnlinkApp({appId: app.appId, language});
            await load();
            showToast(isEnglish ? `${app.name} unlinked.` : `已解绑${app.name}。`, 'success');
        } catch (err) {
            showToast(accountErrorMessage(err, isEnglish), 'error');
        } finally {
            setBusyApp(null);
        }
    };

    if (!apps || apps.length === 0) return null;

    const dateFormat = {year: 'numeric', month: 'long', day: 'numeric'} as const;

    return (
        <section className="settings-section">
            <h2 className="settings-section-title">{isEnglish ? 'Linked Apps' : '已绑定的应用'}</h2>
            <p className="settings-section-note">
                {isEnglish
                    ? 'Link your account in one of our apps to this one, so it can show your membership and event staff roles there. You can use each without linking.'
                    : '把您在我们应用中的账号与本站账号绑定后，应用中就能显示您的会员和活动工作人员身份。不绑定也可以分别使用。'}
            </p>
            <div className="settings-rows">
                {apps.map(app => {
                    const linkedAt = app.link?.linkedAt
                        ? new Date(app.link.linkedAt).toLocaleDateString(isEnglish ? 'en-US' : 'zh-CN', dateFormat)
                        : null;
                    const linking = started?.appId === app.appId;
                    return (
                        <div key={app.appId} className="settings-row settings-row--account">
                            <div className="settings-row-text">
                                <span className="settings-row-title">{app.name}</span>
                                <span className="settings-row-help">
                                    {app.link
                                        ? (isEnglish
                                            ? `Linked to ${app.link.appUserName || 'an account'}${linkedAt ? ` since ${linkedAt}` : ''}.`
                                            : `已绑定${app.link.appUserName ? `“${app.link.appUserName}”` : '一个账号'}${linkedAt ? `，绑定于 ${linkedAt}` : ''}。`)
                                        : (isEnglish ? 'Not linked.' : '未绑定。')}
                                </span>
                                {app.link && !app.accountLinking && (
                                    <span className="settings-row-state">
                                        {isEnglish
                                            ? 'Linking is paused for this app, so it can’t see your account for now.'
                                            : '此应用的绑定功能已暂停，目前无法查看您的账号信息。'}
                                    </span>
                                )}
                            </div>
                            {app.link ? (
                                <button type="button" className="profile-action" disabled={busyApp === app.appId}
                                        onClick={() => void unlink(app)}>
                                    {isEnglish ? 'Unlink' : '解绑'}
                                </button>
                            ) : app.accountLinking && !linking && (
                                <button type="button" className="profile-action" disabled={busyApp === app.appId}
                                        onClick={() => void start(app)}>
                                    {isEnglish ? 'Link' : '绑定'}
                                </button>
                            )}
                            {linking && started && (
                                <LinkPanel
                                    app={app}
                                    started={started}
                                    showToast={showToast}
                                    onClose={() => setStarted(null)}
                                    onLinked={linked}
                                />
                            )}
                        </div>
                    );
                })}
            </div>
        </section>
    );
};
