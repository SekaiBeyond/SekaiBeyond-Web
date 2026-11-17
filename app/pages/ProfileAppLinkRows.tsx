import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { QRCodeSVG } from 'qrcode.react';
import { useAuth } from '~/components/AuthProvider';
import { useLanguage } from '~/components/LanguageContextProvider';
import { accountErrorMessage, linkRefusalMessage } from '~/lib/accountErrors';
import { APP_PLATFORM_NAMES, appNameIn, linkSharedFields } from '~/lib/appLinks';
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
import { appBrand, ConnectionRow, type ConnectionStatus } from '~/pages/ProfileConnectionRow';

interface Started {
    appId: string;
    requestId: string;
    code: string;
    qr: string;
    clockOffset: number;
}

interface Refusal {
    code: string;
    side?: string;
    until?: string;
}

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

const CONFIRM_CODE_RE = /^\d{4}$/;

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

const LinkPanel = ({app, started, onLinked, onClose, showToast}: {
    app: LinkableApp;
    started: Started;
    onLinked: () => void;
    onClose: () => void;
    showToast: ShowToast;
}) => {
    const {isEnglish} = useLanguage();
    const language = isEnglish ? 'en' : 'zh';
    const appName = appNameIn(app, app.appId, isEnglish);
    const watched = useLinkRequest(started.requestId);
    const open = watched?.status === 'waiting' || watched?.status === 'claimed';
    const now = useServerNow(!!open, started.clockOffset);
    const [busy, setBusy] = useState(false);
    const [confirmCode, setConfirmCode] = useState('');

    const expired = !!watched && open && watched.expiresAt <= now;

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
            showToast(isEnglish ? `${appName} linked.` : `已绑定${appName}。`, 'success');
            onLinked();
        } catch (err) {
            if (errorCode(err) === 'wrong-link-code') setConfirmCode('');
            showToast(accountErrorMessage(err, isEnglish), 'error');
        } finally {
            setBusy(false);
        }
    };

    const cancel = () => {
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
                        ? <>Linking <strong>{who}</strong> in {appName}. {appName} now shows its user four digits:
                            enter them here to link that account to this one. Anyone can use a name, so only go on if
                            the code is on your own screen.</>
                        : <>正在绑定{appName}账号 <strong>{who}</strong>。{appName}现在会向该用户显示 4
                            位数字：在此输入即可把该账号绑定到本账号。任何人都可以使用相同的名称，所以只有数字显示在您自己的屏幕上时才继续。</>}
                </span>
                <span className="settings-row-help">
                    {isEnglish
                        ? `${appName} will see your ${linkSharedFields(true)}, until either side unlinks.`
                        : `在任一方解绑前，${appName}可以看到您的${linkSharedFields(false)}。`}
                </span>
                <input
                    className="admin-input auth-input settings-link-confirm"
                    value={confirmCode}
                    onChange={e => setConfirmCode(e.target.value.replace(/\D/g, '').slice(0, 4))}
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    placeholder={isEnglish ? '4-digit code' : '4 位数字'}
                    aria-label={isEnglish ? `Code ${appName} shows` : `${appName}显示的数字`}
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

    const wechat = app.platform === 'wechat-mini-program';
    return (
        <div className="settings-link-panel settings-link-panel--waiting">
            <div className="settings-link-scan">
                <div className="settings-link-qr">
                    <QRCodeSVG value={started.qr} size={176} level="M" marginSize={2}/>
                </div>
                <span className="settings-link-code" aria-label={isEnglish ? 'Code' : '数字码'}>
                    {started.code.slice(0, 3)} {started.code.slice(3)}
                </span>
            </div>
            <div className="settings-link-guide">
                {wechat ? (
                    <ol className="settings-link-steps">
                        <li>
                            {isEnglish
                                ? <>In WeChat, open {appName} and go to <strong>Me → Edit profile → Sekai Beyond
                                    website account</strong>.</>
                                : <>在微信中打开{appName}，进入<strong>「我的 → 编辑资料 → 彼世界网站账号」</strong>。</>}
                        </li>
                        <li>
                            {isEnglish
                                ? <>Tap <strong>Scan to link</strong> and scan this code, or tap <strong>Enter 6
                                    digits</strong> and type the six digits under it.</>
                                : <>点<strong>「扫码绑定」</strong>扫描此二维码，或点<strong>「输入 6
                                    位数字」</strong>输入下方的数字。</>}
                        </li>
                        <li>
                            {isEnglish
                                ? <>Check it’s your account and tap <strong>That’s my account, continue</strong>. The
                                    mini program then shows four digits: enter them here.</>
                                : <>确认是您的账号后点<strong>「是我的账号，继续」</strong>，再在此输入小程序显示的 4
                                    位数字。</>}
                        </li>
                    </ol>
                ) : (
                    <ol className="settings-link-steps">
                        <li>{isEnglish ? `Open ${appName}.` : `打开${appName}。`}</li>
                        <li>
                            {isEnglish
                                ? 'Scan this code there, or enter the six digits under it.'
                                : '在应用中扫描此二维码，或输入下方的 6 位数字。'}
                        </li>
                        <li>
                            {isEnglish
                                ? `${appName} then shows you four digits. Enter them here.`
                                : `随后${appName}会显示 4 位数字，请回到此页输入。`}
                        </li>
                    </ol>
                )}
                <span className="settings-row-help">
                    {isEnglish
                        ? 'On the same phone? Enter the six digits instead of scanning.'
                        : '在同一部手机上操作？请直接输入 6 位数字，无需扫码。'}
                </span>
                {watched.refusal && (
                    <span className="settings-link-refusal" role="alert">
                        {isEnglish ? `${appName} couldn’t link: ` : `${appName}未能绑定：`}
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
        </div>
    );
};

export const AppLinkRows = ({showToast}: {showToast: ShowToast}) => {
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
        const appName = appNameIn(app, app.appId, isEnglish);
        const confirmed = window.confirm(isEnglish
            ? `Unlink ${appName}? It stops seeing your account at once. Either side can only link someone else after 30 days.`
            : `确定要解绑${appName}吗？解绑后它将立即无法查看您的账号信息。30 天内双方都无法绑定其他账号。`);
        if (!confirmed) return;
        setBusyApp(app.appId);
        try {
            await callRemoveAppLink({appId: app.appId, language});
            await load();
            showToast(isEnglish ? `${appName} unlinked.` : `已解绑${appName}。`, 'success');
        } catch (err) {
            showToast(accountErrorMessage(err, isEnglish), 'error');
        } finally {
            setBusyApp(null);
        }
    };

    if (!apps && loadFailed) {
        return (
            <ConnectionRow
                brand="app"
                title={isEnglish ? 'Linked apps' : '已绑定的应用'}
                help={isEnglish ? 'Couldn’t load your linked apps just now.' : '暂时无法加载已绑定的应用。'}
                action={(
                    <button type="button" className="profile-action" disabled={loading} onClick={() => void load()}>
                        {isEnglish ? 'Try again' : '重试'}
                    </button>
                )}
            />
        );
    }

    if (!apps) {
        return (
            <div className="settings-row">
                <div className="spinner spinner-centered"/>
            </div>
        );
    }

    const dateFormat = {year: 'numeric', month: 'long', day: 'numeric'} as const;

    return apps.map(app => {
        const appName = appNameIn(app, app.appId, isEnglish);
        const linkedAt = app.link?.linkedAt
            ? new Date(app.link.linkedAt).toLocaleDateString(isEnglish ? 'en-US' : 'zh-CN', dateFormat)
            : null;
        const linking = started?.appId === app.appId;
        const platform = app.platform ? APP_PLATFORM_NAMES[app.platform] : null;
        const status: ConnectionStatus = !app.link ? 'off' : app.accountLinking ? 'on' : 'paused';
        return (
            <ConnectionRow
                key={app.appId}
                brand={appBrand(app.platform)}
                iconUrl={app.iconUrl}
                title={appName}
                kind={platform ? (isEnglish ? platform.en : platform.zh) : (isEnglish ? 'App' : '应用')}
                status={{
                    value: status,
                    label: {
                        on: isEnglish ? 'Linked' : '已绑定',
                        off: isEnglish ? 'Not linked' : '未绑定',
                        paused: isEnglish ? 'Paused' : '已暂停',
                    }[status],
                }}
                help={app.link
                    ? (isEnglish
                        ? <>Linked
                            to <strong>{app.link.appUserName || 'an account'}</strong>{linkedAt ? ` since ${linkedAt}` : ''}.</>
                        : <>已绑定{app.link.appUserName ?
                            <strong>“{app.link.appUserName}”</strong> : '一个账号'}{linkedAt ? `，绑定于 ${linkedAt}` : ''}。</>)
                    : (isEnglish
                        ? `Link your account there to show your membership and event staff roles in ${appName}.`
                        : `绑定您在${appName}中的账号后，即可在其中显示您的会员和活动工作人员身份。`)}
                state={app.link && !app.accountLinking
                    ? (isEnglish
                        ? 'Linking is paused for this app, so it can’t see your account for now.'
                        : '此应用的绑定功能已暂停，目前无法查看您的账号信息。')
                    : undefined}
                details={!linking && (
                    <details className="settings-connection-shares">
                        <summary>{isEnglish ? `What ${appName} can see` : `${appName}可以看到什么`}</summary>
                        <p>
                            {isEnglish
                                ? `Once linked, your ${linkSharedFields(true)}, until either side unlinks. It never sees your password, and it can’t sign in here as you.`
                                : `绑定后，在任一方解绑前，可以看到您的${linkSharedFields(false)}。它不会获得您的密码，也无法以您的身份登录本站。`}
                        </p>
                    </details>
                )}
                action={app.link ? (
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
            >
                {linking && started && (
                    <LinkPanel
                        app={app}
                        started={started}
                        showToast={showToast}
                        onClose={() => setStarted(null)}
                        onLinked={linked}
                    />
                )}
            </ConnectionRow>
        );
    });
};
