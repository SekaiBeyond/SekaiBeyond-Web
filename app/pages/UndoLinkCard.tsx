import { type FormEvent, type ReactNode, useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { useAuth } from '~/components/AuthProvider';
import { useLanguage } from '~/components/LanguageContextProvider';
import { PageNav } from '~/components/PageNav';
import { accountErrorMessage } from '~/lib/accountErrors';
import { functionsErrorCode } from '~/lib/firebase';

interface UndoLinkCardProps<T> {
    path: string;
    title: string;
    description: string;
    badLinkText: string;
    doneTitle: string;
    undo: (token: string, password: string) => Promise<T>;
    renderDone: (result: T) => ReactNode;
}

export function UndoLinkCard<T>({
                                    path,
                                    title,
                                    description,
                                    badLinkText,
                                    doneTitle,
                                    undo,
                                    renderDone
                                }: UndoLinkCardProps<T>) {
    const {isEnglish} = useLanguage();
    const {signIn} = useAuth();
    const navigate = useNavigate();
    const [token, setToken] = useState<string | null>(null);
    const [password, setPassword] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [done, setDone] = useState<{result: T} | null>(null);

    useEffect(() => {
        const found = new URLSearchParams(window.location.hash.slice(1)).get('token');
        setToken(previous => found ?? previous ?? '');
        if (found) navigate(path, {replace: true});
    }, [navigate, path]);

    const submit = async (e: FormEvent) => {
        e.preventDefault();
        if (!token) return;
        setBusy(true);
        setError('');
        try {
            setDone({result: await undo(token, password)});
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
                    {done ? (
                        <>
                            <h2>{doneTitle}</h2>
                            {renderDone(done.result)}
                            <button onClick={signIn} className="profile-sign-in-btn">
                                {isEnglish ? 'Sign In' : '登录'}
                            </button>
                        </>
                    ) : token === '' ? (
                        <>
                            <h2>{isEnglish ? 'This Link Doesn’t Work' : '此链接无效'}</h2>
                            <p>{badLinkText}</p>
                        </>
                    ) : token && (
                        <>
                            <h2>{title}</h2>
                            <p>{description}</p>
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
}
