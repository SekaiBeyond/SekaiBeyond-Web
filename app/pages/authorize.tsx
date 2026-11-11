import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { useAuth } from '~/components/AuthProvider';
import { useLanguage } from '~/components/LanguageContextProvider';
import { PageNav } from '~/components/PageNav';
import {
    APP_ID_RE,
    type AppScope,
    callGetAppSignInInfo,
    callIssueAppToken,
    errorSuffix,
    functionsErrorCode,
} from '~/lib/firebase';

/** The random value an app sends, to tell the sign-in it gets back is the one it asked for. */
const STATE_RE = /^[A-Za-z0-9_-]{16,128}$/;

/** What each scope lets an app see, as the person signing in is told it. */
const SCOPE_TEXT: Record<AppScope, {en: string; zh: string}> = {
    'events:read': {en: 'The events you can see here', zh: '您在本站可以查看的活动'},
    'team:read': {en: 'The team list, if you’re staff', zh: '团队名单（如果您是工作人员）'},
    'event-staff:read': {en: 'The staff of events you can see the staff of', zh: '您有权查看的活动工作人员名单'},
};

type Info = {name: string; ownerName: string; scopes: AppScope[]};

/**
 * Sign in with Sekai Beyond: where a registered app (see
 * functions/src/utils/apps.ts) sends people, as
 * /authorize?app=…&state=…[&redirect_uri=…]. It says which app it is and what
 * it will see, and Continue hands a sign-in for the app back to it, with the
 * same state, at one of the places registered for it. Nothing happens until
 * Continue, so a link alone can't sign anyone in to an app.
 */
export const AuthorizePage = () => {
    const {isEnglish} = useLanguage();
    const {user, profile, loading, signIn, signOut} = useAuth();
    const [searchParams] = useSearchParams();
    const appId = searchParams.get('app') ?? '';
    const rawState = searchParams.get('state') ?? '';
    const redirectUri = searchParams.get('redirect_uri') || undefined;
    const linkOk = APP_ID_RE.test(appId) && STATE_RE.test(rawState);

    // Null while loading; 'bad-link' when the app or the place to hand back to isn't registered.
    const [info, setInfo] = useState<Info | 'bad-link' | 'error' | null>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');

    useEffect(() => {
        if (!linkOk) return;
        let stale = false;
        callGetAppSignInInfo({appId, redirectUri})
            .then(({data}) => {
                if (!stale) setInfo(data);
            })
            .catch(err => {
                if (stale) return;
                const code = functionsErrorCode(err);
                setInfo(code === 'unknown-app' || code === 'bad-redirect' ? 'bad-link' : 'error');
            });
        return () => {
            stale = true;
        };
    }, [linkOk, appId, redirectUri]);

    const proceed = async () => {
        setBusy(true);
        setError('');
        try {
            const {data} = await callIssueAppToken({appId, redirectUri});
            // In the fragment, which never reaches a server. Replaced, so Back
            // doesn't return here.
            window.location.replace(`${data.redirectUri}#${new URLSearchParams({token: data.token, state: rawState})}`);
        } catch (err) {
            setError((isEnglish ? 'Couldn’t sign you in. Please try again.' : '登录失败，请重试。') + errorSuffix(err, isEnglish));
            setBusy(false);
        }
    };

    const appName = info && typeof info === 'object' ? info.name : '';

    return (
        <>
            <PageNav/>
            <div className="profile-login-prompt">
                <div className="profile-login-card">
                    {!linkOk || info === 'bad-link' ? (
                        <>
                            <h2>{isEnglish ? 'This Link Doesn’t Work' : '此链接无效'}</h2>
                            <p>
                                {isEnglish
                                    ? 'Go back to the app you came from and choose Sign in with Sekai Beyond again. If it keeps happening, let the app’s owner know.'
                                    : '请返回您来自的应用，重新选择「使用彼世界账号登录」。如果问题持续出现，请联系该应用的负责人。'}
                            </p>
                        </>
                    ) : info === 'error' ? (
                        <>
                            <h2>{isEnglish ? 'Something Went Wrong' : '出错了'}</h2>
                            <p>{isEnglish ? 'Couldn’t load this sign-in. Please reload the page.' : '无法加载登录信息，请刷新页面。'}</p>
                        </>
                    ) : !info || loading ? (
                        <div className="spinner spinner-centered"/>
                    ) : !user || !profile ? (
                        <>
                            <h2>{isEnglish ? `Sign In to Continue to ${appName}` : `登录以继续使用 ${appName}`}</h2>
                            <p>
                                {isEnglish
                                    ? `${appName} uses your Sekai Beyond account to know who you are.`
                                    : `${appName} 使用您的彼世界账号确认您的身份。`}
                            </p>
                            <button onClick={signIn} className="profile-sign-in-btn">
                                {isEnglish ? 'Sign In' : '登录'}
                            </button>
                        </>
                    ) : (
                        <>
                            <h2>{isEnglish ? `Continue to ${appName}` : `继续使用 ${appName}`}</h2>
                            <p>
                                {isEnglish
                                    ? <>You’ll be signed in to {appName}{info.ownerName && <> (looked after
                                        by {info.ownerName})</>} as <strong>{profile.displayName}</strong>. It will see:</>
                                    : <>您将以 <strong>{profile.displayName}</strong> 的身份登录 {appName}
                                        {info.ownerName && <>（由 {info.ownerName} 负责）</>}。它可以看到：</>}
                            </p>
                            <ul className="authorize-scopes">
                                <li>{isEnglish ? 'Your name, photo and role here' : '您在本站的名称、头像和角色'}</li>
                                {info.scopes.map(scope => (
                                    <li key={scope}>{isEnglish ? SCOPE_TEXT[scope].en : SCOPE_TEXT[scope].zh}</li>
                                ))}
                            </ul>
                            <p className="admin-helper-text">
                                {isEnglish
                                    ? `Never your email or password. What you can do in ${appName} is up to ${appName}.`
                                    : `它看不到您的邮箱或密码。您在 ${appName} 中能做什么由 ${appName} 决定。`}
                            </p>
                            {error && <p className="redeem-error-text">{error}</p>}
                            <button onClick={() => void proceed()} className="profile-sign-in-btn" disabled={busy}>
                                {isEnglish ? 'Continue' : '继续'}
                            </button>
                            <button onClick={() => void signOut()} className="authorize-switch" disabled={busy}
                                    type="button">
                                {isEnglish ? 'Use another account' : '使用其他账号'}
                            </button>
                        </>
                    )}
                    <a href="/" className="profile-back-link">{isEnglish ? 'Back to Home' : '返回首页'}</a>
                </div>
            </div>
        </>
    );
};
