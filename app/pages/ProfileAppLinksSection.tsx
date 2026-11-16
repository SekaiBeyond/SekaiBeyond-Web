import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { QRCodeSVG } from 'qrcode.react';
import { useAuth } from '~/components/AuthProvider';
import { useLanguage } from '~/components/LanguageContextProvider';
import { accountErrorMessage, linkRefusalMessage } from '~/lib/accountErrors';
import { linkSharedFields } from '~/lib/appLinks';
import { toDate } from '~/lib/collectionCache';
import {
    callCancelAppLink,
    callConfirmAppLink,
    callGetAppLinks,
    callRemoveAppLink,
    callStartAppLink,
    errorCode,
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
    /**
     * How far the server's clock is ahead of this device's, as of starting it:
     * the request's times are the server's, and a device's clock can be off by
     * more than the minutes a request lasts.
     */
    clockOffset: number;
}

/** Why the app's last claim was refused, kept on a request still waiting for another. */
interface Refusal {
    code: string;
    side?: string;
    until?: string;
}

/** The request as it stands, watched in Firestore for the app's claim. `failed`: it can't be watched. */
interface Watched {
    status: 'waiting' | 'claimed' | 'linked' | 'cancelled' | 'failed';
    appUserName: string;
    expiresAt: number;
    refusal: Refusal | null;
}

const readRefusal = (raw: unknown): Refusal | null => {
    if (!raw || typeof raw !== 'object') return null;
    const {code, side, until} = raw as Record<string, unknown>;
    if (typeof code !== 'string') return null;
    return {
        code,
        ...(typeof side === 'string' ? {side} : {}),
        ...(typeof until === 'string' ? {until} : {}),
    };
};

const STATUSES = ['waiting', 'claimed', 'linked', 'cancelled'] as const;

/** The four digits the app shows its user once it has claimed the request. */
const CONFIRM_CODE_RE = /^\d{4}$/;

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
                refusal: readRefusal(data.refusal),
            });
        }, () => setWatched({status: 'failed', appUserName: '', expiresAt: 0, refusal: null}));
    }, [requestId]);
    return watched;
}

/** The server's time now, as best this device can tell (`offset`), a second at a time while `on`. */
function useServerNow(on: boolean, offset: number): number {
    const [now, setNow] = useState(() => Date.now() + offset);
    useEffect(() => {
        if (!on) return;
        setNow(Date.now() + offset);
        const timer = setInterval(() => setNow(Date.now() + offset), 1000);
        return () => clearInterval(timer);
    }, [on, offset]);
    return now;
}

const formatLeft = (ms: number) => {
    const seconds = Math.max(0, Math.ceil(ms / 1000));
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
};

/**
 * A request in progress: the code to scan or type in the app, then, once the
 * app's user has claimed it there, who they are and a box for the four digits
 * the app now shows them. Only someone who can see the app can type those in,
 * so a name copied from yours can't link you to someone else's app account.
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
    const now = useServerNow(!!open, started.clockOffset);
    const [busy, setBusy] = useState(false);
    const [confirmCode, setConfirmCode] = useState('');

    const expired = !!watched && open && watched.expiresAt <= now;

    // Confirmed from another tab.
    const linkedElsewhere = watched?.status === 'linked';
    useEffect(() => {
        if (linkedElsewhere) onLinked();
    }, [linkedElsewhere, onLinked]);

    const confirm = async (e: FormEvent) => {
        e.preventDefault();
        if (!CONFIRM_CODE_RE.test(confirmCode)) return;
        setBusy(true);
        try {
            await callConfirmAppLink({requestId: started.requestId, code: confirmCode, language});
            showToast(isEnglish ? `${app.name} linked.` : `已绑定${app.name}。`, 'success');
            onLinked();
        } catch (err) {
            if (errorCode(err) === 'wrong-link-code') setConfirmCode('');
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
        return (
            <div className="settings-link-panel">
                <div className="spinner spinner-centered"/>
            </div>
        );
    }

    if (expired || watched.status === 'cancelled' || watched.status === 'failed') {
        return (
            <div className="settings-link-panel">
                <span className="settings-row-help">
                    {watched.status === 'failed'
                        ? (isEnglish ? 'Couldn’t follow this request just now. Close it and try again.' : '暂时无法获取此请求的状态，请关闭后重试。')
                        : (isEnglish ? 'This request has ended. Start again for a new code.' : '此请求已结束，请重新开始获取新的二维码。')}
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
            <form className="settings-link-panel" onSubmit={e => void confirm(e)}>
                <span className="settings-row-help">
                    {isEnglish
                        ? <>Linking <strong>{who}</strong> in {app.name}. {app.name} now shows its user four digits:
                            enter them here to link that account to this one. Anyone can use a name, so only go on if
                            the code is on your own screen.</>
                        : <>正在绑定{app.name}账号 <strong>{who}</strong>。{app.name}现在会向该用户显示 4
                            位数字：在此输入即可把该账号绑定到本账号。任何人都可以使用相同的名称，所以只有数字显示在您自己的屏幕上时才继续。</>}
                </span>
                <span className="settings-row-help">
                    {isEnglish
                        ? `${app.name} will see your ${linkSharedFields(true)}, until either side unlinks.`
                        : `在任一方解绑前，${app.name}可以看到您的${linkSharedFields(false)}。`}
                </span>
                <input
                    className="admin-input auth-input settings-link-confirm"
                    value={confirmCode}
                    onChange={e => setConfirmCode(e.target.value.replace(/\D/g, '').slice(0, 4))}
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    placeholder={isEnglish ? '4-digit code' : '4 位数字'}
                    aria-label={isEnglish ? `Code ${app.name} shows` : `${app.name}显示的数字`}
                    disabled={busy}
                />
                <span className="settings-row-state">
                    {isEnglish ? `${formatLeft(watched.expiresAt - now)} left` : `剩余 ${formatLeft(watched.expiresAt - now)}`}
                </span>
                <div className="settings-account-actions">
                    <button type="submit" className="admin-btn admin-btn--cta"
                            disabled={busy || !CONFIRM_CODE_RE.test(confirmCode)}>
                        {isEnglish ? 'Link' : '绑定'}
                    </button>
                    <button type="button" className="admin-btn admin-btn--dashed" disabled={busy} onClick={cancel}>
                        {isEnglish ? 'This isn’t me' : '不是我'}
                    </button>
                </div>
            </form>
        );
    }

    return (
        <div className="settings-link-panel">
            <span className="settings-row-help">
                {isEnglish
                    ? `Open ${app.name} and scan this code, or enter the six digits under it. ${app.name} then shows you four digits to enter here.`
                    : `请打开${app.name}扫描此二维码，或输入下方的 6 位数字。随后${app.name}会显示 4 位数字，请回到此页输入。`}
            </span>
            <div className="settings-link-qr">
                <QRCodeSVG value={started.qr} size={176} level="M" marginSize={2}/>
            </div>
            <span className="settings-link-code" aria-label={isEnglish ? 'Code' : '数字码'}>
                {started.code.slice(0, 3)} {started.code.slice(3)}
            </span>
            {watched.refusal && (
                // The app tried and was refused: say why, as the app tells its user.
                <span className="settings-link-refusal" role="alert">
                    {isEnglish ? `${app.name} couldn’t link: ` : `${app.name}未能绑定：`}
                    {linkRefusalMessage(watched.refusal, isEnglish)}
                </span>
            )}
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
 * links accounts. Shown with a way to try again when it can't be loaded, since
 * a link already made can only be removed from here. Everything is enforced
 * server-side (functions/appLinks.ts).
 */
export const ProfileAppLinksSection = ({showToast}: {showToast: ShowToast}) => {
    const {isEnglish} = useLanguage();
    const language = isEnglish ? 'en' : 'zh';
    const {user} = useAuth();
    const [apps, setApps] = useState<LinkableApp[] | null>(null);
    const [loadFailed, setLoadFailed] = useState(false);
    const [loading, setLoading] = useState(false);
    const [started, setStarted] = useState<Started | null>(null);
    const [busyApp, setBusyApp] = useState<string | null>(null);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            setApps((await callGetAppLinks()).data.apps);
            setLoadFailed(false);
        } catch {
            // What was shown before stays; with nothing shown yet, say so.
            setLoadFailed(true);
        } finally {
            setLoading(false);
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
            const serverTime = Date.parse(data.serverTime);
            setStarted({
                appId: app.appId,
                requestId: data.requestId,
                code: data.code,
                qr: data.qr,
                clockOffset: Number.isNaN(serverTime) ? 0 : serverTime - Date.now(),
            });
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
            await callRemoveAppLink({appId: app.appId, language});
            await load();
            showToast(isEnglish ? `${app.name} unlinked.` : `已解绑${app.name}。`, 'success');
        } catch (err) {
            showToast(accountErrorMessage(err, isEnglish), 'error');
        } finally {
            setBusyApp(null);
        }
    };

    const title = <h2 className="settings-section-title">{isEnglish ? 'Linked Apps' : '已绑定的应用'}</h2>;

    if (!apps && loadFailed) {
        return (
            <section className="settings-section">
                {title}
                <p className="settings-section-note">
                    {isEnglish ? 'Couldn’t load your linked apps just now.' : '暂时无法加载已绑定的应用。'}
                </p>
                <div className="settings-account-actions">
                    <button type="button" className="admin-btn admin-btn--dashed" disabled={loading}
                            onClick={() => void load()}>
                        {isEnglish ? 'Try again' : '重试'}
                    </button>
                </div>
            </section>
        );
    }

    if (!apps || apps.length === 0) return null;

    const dateFormat = {year: 'numeric', month: 'long', day: 'numeric'} as const;

    return (
        <section className="settings-section">
            {title}
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
