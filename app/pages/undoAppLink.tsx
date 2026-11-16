import { type FormEvent, useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { useAuth } from '~/components/AuthProvider';
import { useLanguage } from '~/components/LanguageContextProvider';
import { PageNav } from '~/components/PageNav';
import { accountErrorMessage } from '~/lib/accountErrors';
import { callUndoAppLink, functionsErrorCode } from '~/lib/firebase';

/**
 * Where the "This wasn't me" link in an app-linked notice lands. Opening it
 * does nothing, as mail scanners open links; the form is what undoes the link.
 * Whoever made it could sign in, so it also sets a new password.
 */
export const UndoAppLinkPage = () => {
    const {isEnglish} = useLanguage();
    const {signIn} = useAuth();
    const navigate = useNavigate();
    // Null until read from the URL, "" when the URL has none.
    const [token, setToken] = useState<string | null>(null);
    const [password, setPassword] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [undoneApp, setUndoneApp] = useState('');

    // Taken off the URL so it isn't left in the browser's history. Kept from the
    // first run: a second finds the URL already clean.
    useEffect(() => {
        const found = new URLSearchParams(window.location.hash.slice(1)).get('token');
        setToken(previous => found ?? previous ?? '');
        if (found) navigate('/undo-app-link', {replace: true});
    }, [navigate]);

    const submit = async (e: FormEvent) => {
        e.preventDefault();
        if (!token) return;
        setBusy(true);
        setError('');
        try {
            const {data} = await callUndoAppLink({token, password});
            setUndoneApp(data.appName);
        } catch (err) {
            if (functionsErrorCode(err) === 'bad-undo-link') setToken('');
            else setError(accountErrorMessage(err, isEnglish));
        } finally {
            setBusy(false);
        }
    };

    return (
        <>
            <PageNav account={false}/>
            <div className="profile-login-prompt">
                <div className="profile-login-card">
                    {undoneApp ? (
                        <>
                            <h2>{isEnglish ? 'Link Undone' : '绑定已撤销'}</h2>
                            <p>
                                {isEnglish
                                    ? <>Your account is no longer linked in <strong>{undoneApp}</strong>, and every
                                        device has been signed out. Sign in with your new password. You can link your
                                        own {undoneApp} account in Settings straight away.</>
                                    : <>您的账号已解除与<strong>{undoneApp}</strong>的绑定，所有设备均已退出登录。请使用新密码登录，之后可在设置中立即绑定您自己的{undoneApp}账号。</>}
                            </p>
                            <button onClick={signIn} className="profile-sign-in-btn">
                                {isEnglish ? 'Sign In' : '登录'}
                            </button>
                        </>
                    ) : token === '' ? (
                        <>
                            <h2>{isEnglish ? 'This Link Doesn’t Work' : '此链接无效'}</h2>
                            <p>
                                {isEnglish
                                    ? 'It may have expired or already been used, or the account’s email may have changed since. If someone else has your account, please contact us.'
                                    : '链接可能已过期或已被使用，或账号邮箱已更改。如果您的账号被他人占用，请联系我们。'}
                            </p>
                        </>
                    ) : token && (
                        <>
                            <h2>{isEnglish ? 'Undo App Link' : '撤销应用绑定'}</h2>
                            <p>
                                {isEnglish
                                    ? 'This unlinks the app account that was just linked to yours, signs out every device and replaces your password. You can link your own account in that app straight after. Choose a new password to finish.'
                                    : '此操作会解除刚刚绑定到您账号的应用账号，退出所有设备并替换密码。之后您可以立即绑定您自己在该应用的账号。请设置新密码以完成操作。'}
                            </p>
                            <form className="auth-form" onSubmit={e => void submit(e)}>
                                <input
                                    type="password"
                                    autoComplete="new-password"
                                    required
                                    value={password}
                                    onChange={e => setPassword(e.target.value)}
                                    placeholder={isEnglish ? 'New password (8+ characters)' : '新密码（至少 8 个字符）'}
                                    className="admin-input auth-input"
                                />
                                {error && <p className="redeem-error-text">{error}</p>}
                                <button type="submit" className="admin-btn admin-btn--cta auth-submit" disabled={busy}>
                                    {isEnglish ? 'Undo and Secure Account' : '撤销并保护账号'}
                                </button>
                            </form>
                        </>
                    )}
                    <a href="/" className="profile-back-link">{isEnglish ? 'Back to Home' : '返回首页'}</a>
                </div>
            </div>
        </>
    );
};
