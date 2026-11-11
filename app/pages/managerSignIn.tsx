import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { useAuth } from '~/components/AuthProvider';
import { useLanguage } from '~/components/LanguageContextProvider';
import { PageNav } from '~/components/PageNav';
import { callIssueManagerToken, errorSuffix, functionsErrorCode } from '~/lib/firebase';

/** The random value SKBY Manager sends, to tell the sign-in it gets back is the one it asked for. */
const STATE_RE = /^[A-Za-z0-9_-]{16,128}$/;

/**
 * Where SKBY Manager sends core staff to sign in with their account here, as
 * /manager-sign-in?state=…. Continue hands a sign-in for the manager back to
 * it, with the same state, at the address the server gives, never one from
 * the link. Nothing happens until Continue, so a link alone can't sign anyone
 * in to the manager.
 */
export const ManagerSignInPage = () => {
    const {isEnglish} = useLanguage();
    const {user, profile, loading, signIn} = useAuth();
    const [searchParams] = useSearchParams();
    const rawState = searchParams.get('state') ?? '';
    const state = STATE_RE.test(rawState) ? rawState : '';
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');

    const allowed = profile?.group === 'core-staff' || profile?.group === 'president';

    const proceed = async () => {
        setBusy(true);
        setError('');
        try {
            const {data} = await callIssueManagerToken();
            // In the fragment, which never reaches a server. Replaced, so Back
            // doesn't return here.
            window.location.replace(`${data.returnUrl}#${new URLSearchParams({token: data.token, state})}`);
        } catch (err) {
            const code = functionsErrorCode(err);
            setError(code === 'manager-not-allowed'
                ? (isEnglish ? 'SKBY Manager is for core staff only.' : 'SKBY Manager 仅限核心工作人员使用。')
                : code === 'manager-off'
                    ? (isEnglish ? 'SKBY Manager sign-in isn’t set up on this site.' : '本站尚未开通 SKBY Manager 登录。')
                    : (isEnglish ? 'Couldn’t sign you in. Please try again.' : '登录失败，请重试。') + errorSuffix(err, isEnglish));
            setBusy(false);
        }
    };

    return (
        <>
            <PageNav/>
            <div className="profile-login-prompt">
                <div className="profile-login-card">
                    {!state ? (
                        <>
                            <h2>{isEnglish ? 'Start From SKBY Manager' : '请从 SKBY Manager 开始'}</h2>
                            <p>
                                {isEnglish
                                    ? 'Open SKBY Manager and choose Sign in with Sekai Beyond. This page only works from there.'
                                    : '请打开 SKBY Manager 并选择「使用彼世界账号登录」。此页面只能从那里打开。'}
                            </p>
                        </>
                    ) : loading ? null : !user || !profile ? (
                        <>
                            <h2>{isEnglish ? 'Sign In to Continue' : '登录以继续'}</h2>
                            <p>
                                {isEnglish
                                    ? 'Sign in with your Sekai Beyond account to use SKBY Manager.'
                                    : '请使用彼世界账号登录以使用 SKBY Manager。'}
                            </p>
                            <button onClick={signIn} className="profile-sign-in-btn">
                                {isEnglish ? 'Sign In' : '登录'}
                            </button>
                        </>
                    ) : !allowed ? (
                        <>
                            <h2>{isEnglish ? 'No Access' : '无访问权限'}</h2>
                            <p>
                                {isEnglish
                                    ? <>You’re signed in as <strong>{profile.displayName}</strong>. SKBY Manager is for
                                        core staff only.</>
                                    : <>您当前登录的账号为 <strong>{profile.displayName}</strong>。SKBY Manager 仅限核心工作人员使用。</>}
                            </p>
                        </>
                    ) : (
                        <>
                            <h2>{isEnglish ? 'Sign In to SKBY Manager' : '登录 SKBY Manager'}</h2>
                            <p>
                                {isEnglish
                                    ? <>You’ll be signed in as <strong>{profile.displayName}</strong>. SKBY Manager
                                        sees your name, photo and role here, but not your email.</>
                                    : <>您将以 <strong>{profile.displayName}</strong> 的身份登录。SKBY Manager
                                        可以看到您在本站的名称、头像和角色，但看不到您的邮箱。</>}
                            </p>
                            {error && <p className="redeem-error-text">{error}</p>}
                            <button onClick={() => void proceed()} className="profile-sign-in-btn" disabled={busy}>
                                {isEnglish ? 'Continue' : '继续'}
                            </button>
                        </>
                    )}
                    <a href="/" className="profile-back-link">{isEnglish ? 'Back to Home' : '返回首页'}</a>
                </div>
            </div>
        </>
    );
};
