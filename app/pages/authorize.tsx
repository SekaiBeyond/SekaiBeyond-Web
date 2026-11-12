import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { useAuth } from '~/components/AuthProvider';
import { useLanguage } from '~/components/LanguageContextProvider';
import { PageNav } from '~/components/PageNav';
import { APP_ID_RE, callGetAppSignInInfo, callIssueAppCode, errorSuffix, functionsErrorCode, } from '~/lib/firebase';

/** The random value an app sends, to tell the sign-in it gets back is the one it asked for. */
const STATE_RE = /^[A-Za-z0-9_-]{16,128}$/;

/** The base64url SHA-256 of the code verifier the app keeps (PKCE's S256, the one method taken). */
const CODE_CHALLENGE_RE = /^[A-Za-z0-9_-]{43}$/;

type Info = {name: string; maintainerNames: string[]};

/**
 * Sign in with Sekai Beyond: where a registered app (see
 * functions/src/utils/apps.ts) sends people, as
 * /authorize?app=…&state=…&code_challenge=…&code_challenge_method=S256[&redirect_uri=…].
 * It says which app it is and what it will see of them, and Continue hands the
 * app a one-time code, with the same state, at one of the places registered
 * for it. The app trades the code for the sign-in at /api/v1/token, with the
 * verifier only it holds, so what's in the address bar can't sign anyone in.
 * Nothing happens until Continue, so a link alone can't sign anyone in to an
 * app.
 */
export const AuthorizePage = () => {
    const {isEnglish} = useLanguage();
    const {user, profile, loading, signIn, signOut} = useAuth();
    const [searchParams] = useSearchParams();
    const appId = searchParams.get('app') ?? '';
    const rawState = searchParams.get('state') ?? '';
    const codeChallenge = searchParams.get('code_challenge') ?? '';
    const redirectUri = searchParams.get('redirect_uri') || undefined;
    const linkOk = APP_ID_RE.test(appId) && STATE_RE.test(rawState) && CODE_CHALLENGE_RE.test(codeChallenge)
        && searchParams.get('code_challenge_method') === 'S256';

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
            const {data} = await callIssueAppCode({appId, redirectUri, codeChallenge});
            // In the fragment, which never reaches a server. Replaced, so Back
            // doesn't return here.
            window.location.replace(`${data.redirectUri}#${new URLSearchParams({code: data.code, state: rawState})}`);
        } catch (err) {
            setError((isEnglish ? 'Couldn’t sign you in. Please try again.' : '登录失败，请重试。') + errorSuffix(err, isEnglish));
            setBusy(false);
        }
    };

    const appName = info && typeof info === 'object' ? info.name : '';
    // "A, B, and C" / "A、B和C".
    const maintainers = info && typeof info === 'object'
        ? new Intl.ListFormat(isEnglish ? 'en' : 'zh', {type: 'conjunction'}).format(info.maintainerNames)
        : '';

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
                                    ? 'Go back to the app you came from and choose Sign in with Sekai Beyond again. If it keeps happening, let the people who look after the app know.'
                                    : '请返回您来自的应用，重新选择「使用彼世界账号登录」。如果问题持续出现，请联系该应用的维护者。'}
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
                                    ? <>You’ll be signed in to {appName}{maintainers && <> (looked after
                                        by {maintainers})</>} as <strong>{profile.displayName}</strong>. It will
                                        see:</>
                                    : <>您将以 <strong>{profile.displayName}</strong> 的身份登录 {appName}
                                        {maintainers && <>（由 {maintainers} 维护）</>}。它可以看到：</>}
                            </p>
                            <ul className="authorize-scopes">
                                <li>{isEnglish ? 'Your name, photo and role here' : '您在本站的名称、头像和角色'}</li>
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
