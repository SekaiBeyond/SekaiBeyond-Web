import { type FormEvent, useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { useAuth } from '~/components/AuthProvider';
import { useLanguage } from '~/components/LanguageContextProvider';
import { PageNav } from '~/components/PageNav';
import { accountErrorMessage } from '~/lib/accountErrors';
import { callUndoEmailChange, functionsErrorCode } from '~/lib/firebase';

/**
 * Where the "This wasn't me" link in an email-changed notice lands. Opening it
 * does nothing, as mail scanners open links; the form is what undoes the change.
 * Every other way into the account is gone after it, so it sets a new password.
 */
export const UndoEmailPage = () => {
    const {isEnglish} = useLanguage();
    const {signIn} = useAuth();
    const navigate = useNavigate();
    // Null until read from the URL, "" when the URL has none.
    const [token, setToken] = useState<string | null>(null);
    const [password, setPassword] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [restoredEmail, setRestoredEmail] = useState('');

    // Taken off the URL so it isn't left in the browser's history. Kept from the
    // first run: a second finds the URL already clean.
    useEffect(() => {
        const found = new URLSearchParams(window.location.hash.slice(1)).get('token');
        setToken(previous => found ?? previous ?? '');
        if (found) navigate('/undo-email', {replace: true});
    }, [navigate]);

    const submit = async (e: FormEvent) => {
        e.preventDefault();
        if (!token) return;
        setBusy(true);
        setError('');
        try {
            const {data} = await callUndoEmailChange({token, password, language: isEnglish ? 'en' : 'zh'});
            setRestoredEmail(data.email);
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
                    {restoredEmail ? (
                        <>
                            <h2>{isEnglish ? 'Your Account Is Back' : '账号已恢复'}</h2>
                            <p>
                                {isEnglish
                                    ? <>Your account’s email is <strong>{restoredEmail}</strong> again, and every device
                                        has been signed out. Sign in with your new password. You can bind Google again
                                        in Settings.</>
                                    : <>您的账号邮箱已恢复为 <strong>{restoredEmail}</strong>，所有设备均已退出登录。请使用新密码登录，之后可在设置中重新绑定
                                        Google。</>}
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
                                    ? 'It may have expired or already been used, or the account may have changed since. If someone else has your account, please contact us.'
                                    : '链接可能已过期或已被使用，或账号已发生其他变化。如果您的账号被他人占用，请联系我们。'}
                            </p>
                        </>
                    ) : token && (
                        <>
                            <h2>{isEnglish ? 'Undo Email Change' : '撤销邮箱更改'}</h2>
                            <p>
                                {isEnglish
                                    ? 'This puts your account back on the address this link was sent to, signs out every device, removes any bound Google account and replaces your password. Choose a new one to finish.'
                                    : '此操作会将账号恢复到收到此链接的邮箱，退出所有设备，移除已绑定的 Google 账号并替换密码。请设置新密码以完成操作。'}
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
