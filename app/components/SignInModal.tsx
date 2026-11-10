import { type FormEvent, useEffect, useRef, useState } from 'react';
import { useAuth } from '~/components/AuthProvider';
import { GoogleButton } from '~/components/GoogleButton';
import { useLanguage } from '~/components/LanguageContextProvider';
import { accountErrorMessage } from '~/lib/accountErrors';
import {
    callBindGoogleWithPassword,
    callCreateAccountWithGoogle,
    callResetPassword,
    callSendEmailCode,
    callSignInWithGoogle,
    callSignInWithPassword,
    callSignUpWithEmail,
    type GoogleSignIn,
    signInWithToken,
} from '~/lib/firebase';
import { onOpenSignInModal } from '~/lib/signInModal';
import { useModalEffects } from '~/lib/useModalEffects';

type View =
    | 'sign-in'
    | 'sign-up'
    | 'sign-up-details'
    | 'forgot'
    | 'forgot-code'
    | 'google-account'
    | 'google-bind';

/** A Google sign-in with no account behind it yet, held for the prompt that makes or binds one. */
type PendingGoogle = Extract<GoogleSignIn, {status: 'needs-account'}> & {idToken: string};

/** Every way into an account. Opened by the auth context's signIn, from any page. */
export const SignInModal = () => {
    const {user} = useAuth();
    const {isEnglish} = useLanguage();
    const language = isEnglish ? 'en' : 'zh';

    const [show, setShow] = useState(false);
    const [view, setView] = useState<View>('sign-in');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [code, setCode] = useState('');
    const [displayName, setDisplayName] = useState('');
    const [pendingGoogle, setPendingGoogle] = useState<PendingGoogle | null>(null);
    // Whether a code has gone to the address typed into the prompt.
    const [googleCodeSent, setGoogleCodeSent] = useState(false);
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);
    const overlayRef = useRef<HTMLDivElement>(null);
    const busyRef = useRef(false);

    const close = () => {
        if (!busyRef.current) setShow(false);
    };
    useModalEffects(show, overlayRef, close);

    useEffect(() => onOpenSignInModal(() => {
        setView('sign-in');
        setPassword('');
        setCode('');
        setError('');
        setPendingGoogle(null);
        setShow(true);
    }), []);

    useEffect(() => {
        if (user) setShow(false);
    }, [user]);

    const goTo = (next: View) => {
        setView(next);
        setPassword('');
        setCode('');
        setError('');
    };

    const run = async (action: () => Promise<void>) => {
        if (busyRef.current) return;
        busyRef.current = true;
        setBusy(true);
        setError('');
        try {
            await action();
        } catch (err) {
            setError(accountErrorMessage(err, isEnglish));
        } finally {
            busyRef.current = false;
            setBusy(false);
        }
    };

    const submit = (action: () => Promise<void>) => (e: FormEvent) => {
        e.preventDefault();
        void run(action);
    };

    const signIn = submit(async () => {
        const {data} = await callSignInWithPassword({email, password});
        await signInWithToken(data.token);
    });

    const continueWithGoogle = (idToken: string) => run(async () => {
        const {data} = await callSignInWithGoogle({idToken});
        if (data.status === 'signed-in') {
            await signInWithToken(data.token);
            return;
        }
        setPendingGoogle({...data, idToken});
        setDisplayName(data.name);
        setEmail(data.email);
        setGoogleCodeSent(false);
        // Its address already has an account, so making another isn't an option.
        goTo(data.emailTaken ? 'google-bind' : 'google-account');
    });

    // Google has proven its own address. Any other needs a code, like signing up.
    const googleNeedsCode = !!pendingGoogle
        && (email.trim().toLowerCase() !== pendingGoogle.email || !pendingGoogle.emailVerified);

    const createWithGoogle = submit(async () => {
        if (!pendingGoogle) return;
        if (googleNeedsCode && !googleCodeSent) {
            await callSendEmailCode({purpose: 'signup', email, language});
            setCode('');
            setGoogleCodeSent(true);
            return;
        }
        const {data} = await callCreateAccountWithGoogle({
            idToken: pendingGoogle.idToken,
            displayName,
            email,
            ...(googleNeedsCode ? {code} : {}),
            ...(password ? {password} : {}),
        });
        await signInWithToken(data.token);
    });

    const bindGoogle = submit(async () => {
        if (!pendingGoogle) return;
        const {data} = await callBindGoogleWithPassword({idToken: pendingGoogle.idToken, email, password, language});
        await signInWithToken(data.token);
    });

    const sendCode = (purpose: 'signup' | 'password') => run(async () => {
        await callSendEmailCode({purpose, email, language});
        setCode('');
    });

    const signUp = submit(async () => {
        const {data} = await callSignUpWithEmail({email, code, displayName, password});
        await signInWithToken(data.token);
    });

    const resetPassword = submit(async () => {
        const {data} = await callResetPassword({email, code, password, language});
        await signInWithToken(data.token);
    });

    if (!show) return null;

    const emailField = (
        <input
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={e => setEmail(e.target.value)}
            placeholder={isEnglish ? 'Email' : '邮箱'}
            className="admin-input auth-input"
        />
    );

    const passwordField = (placeholder: string, autoComplete: string) => (
        <input
            type="password"
            autoComplete={autoComplete}
            required
            value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder={placeholder}
            className="admin-input auth-input"
        />
    );

    const codeField = (
        <input
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            required
            value={code}
            onChange={e => setCode(e.target.value.replace(/\D/g, ''))}
            placeholder={isEnglish ? '6-digit code' : '6 位验证码'}
            className="admin-input auth-input auth-code-input"
        />
    );

    const newPasswordLabel = isEnglish ? 'New password (at least 8 characters)' : '新密码（至少 8 个字符）';
    const errorLine = error && <p className="redeem-error-text">{error}</p>;

    const backToSignIn = (
        <button type="button" className="auth-link" onClick={() => goTo('sign-in')}>
            {isEnglish ? 'Back to sign in' : '返回登录'}
        </button>
    );

    const resendLink = (purpose: 'signup' | 'password') => (
        <button type="button" className="auth-link" disabled={busy} onClick={() => void sendCode(purpose)}>
            {isEnglish ? 'Send a new code' : '重新发送验证码'}
        </button>
    );

    const submitButton = (label: string) => (
        <button type="submit" className="admin-btn admin-btn--cta auth-submit" disabled={busy}>{label}</button>
    );

    return (
        <div ref={overlayRef} className="modal-overlay" onClick={e => e.target === e.currentTarget && close()}>
            <div className="modal-content auth-modal">
                {view === 'sign-in' && (
                    <>
                        <h2 className="redeem-heading">{isEnglish ? 'Sign In' : '登录'}</h2>
                        <form className="auth-form" onSubmit={signIn}>
                            {emailField}
                            {passwordField(isEnglish ? 'Password' : '密码', 'current-password')}
                            {errorLine}
                            {submitButton(isEnglish ? 'Sign In' : '登录')}
                        </form>
                        <div className="auth-divider">{isEnglish ? 'or' : '或'}</div>
                        <GoogleButton onToken={idToken => void continueWithGoogle(idToken)}/>
                        <div className="auth-links">
                            <button type="button" className="auth-link" onClick={() => goTo('sign-up')}>
                                {isEnglish ? 'New here? Create an account' : '还没有账号？立即注册'}
                            </button>
                            <button type="button" className="auth-link" onClick={() => goTo('forgot')}>
                                {isEnglish ? 'Forgot password?' : '忘记密码？'}
                            </button>
                        </div>
                    </>
                )}

                {view === 'sign-up' && (
                    <>
                        <h2 className="redeem-heading">{isEnglish ? 'Create Account' : '创建账号'}</h2>
                        <p className="redeem-subtitle">
                            {isEnglish ? 'We’ll email you a code to check your address.' : '我们会向您的邮箱发送验证码。'}
                        </p>
                        <form className="auth-form" onSubmit={submit(async () => {
                            await callSendEmailCode({purpose: 'signup', email, language});
                            goTo('sign-up-details');
                        })}>
                            {emailField}
                            {errorLine}
                            {submitButton(isEnglish ? 'Send Code' : '发送验证码')}
                        </form>
                        <div className="auth-links">{backToSignIn}</div>
                    </>
                )}

                {view === 'sign-up-details' && (
                    <>
                        <h2 className="redeem-heading">{isEnglish ? 'Create Account' : '创建账号'}</h2>
                        <p className="redeem-subtitle">
                            {isEnglish
                                ? <>We sent a code to <strong>{email}</strong>. If that address already has an account,
                                    we’ve told you there instead.</>
                                : <>验证码已发送至 <strong>{email}</strong>。如果此邮箱已有账号，您会收到相关提醒。</>}
                        </p>
                        <form className="auth-form" onSubmit={signUp}>
                            {codeField}
                            <input
                                type="text"
                                autoComplete="name"
                                required
                                maxLength={50}
                                value={displayName}
                                onChange={e => setDisplayName(e.target.value)}
                                placeholder={isEnglish ? 'Your name' : '您的名称'}
                                className="admin-input auth-input"
                            />
                            {passwordField(isEnglish ? 'Password (at least 8 characters)' : '密码（至少 8 个字符）', 'new-password')}
                            {errorLine}
                            {submitButton(isEnglish ? 'Create Account' : '创建账号')}
                        </form>
                        <div className="auth-links">
                            {resendLink('signup')}
                            {backToSignIn}
                        </div>
                    </>
                )}

                {view === 'forgot' && (
                    <>
                        <h2 className="redeem-heading">{isEnglish ? 'Reset Password' : '重置密码'}</h2>
                        <p className="redeem-subtitle">
                            {isEnglish
                                ? 'Enter your account’s email and we’ll send you a code. This also adds a password to an account that has only used Google.'
                                : '输入账号邮箱，我们会发送验证码。仅使用过 Google 登录的账号也可借此添加密码。'}
                        </p>
                        <form className="auth-form" onSubmit={submit(async () => {
                            await callSendEmailCode({purpose: 'password', email, language});
                            goTo('forgot-code');
                        })}>
                            {emailField}
                            {errorLine}
                            {submitButton(isEnglish ? 'Send Code' : '发送验证码')}
                        </form>
                        <div className="auth-links">{backToSignIn}</div>
                    </>
                )}

                {view === 'forgot-code' && (
                    <>
                        <h2 className="redeem-heading">{isEnglish ? 'Reset Password' : '重置密码'}</h2>
                        <p className="redeem-subtitle">
                            {isEnglish
                                ? <>If <strong>{email}</strong> has an account, we’ve sent it a code.</>
                                : <>如果 <strong>{email}</strong> 已注册账号，验证码已发送至该邮箱。</>}
                        </p>
                        <form className="auth-form" onSubmit={resetPassword}>
                            {codeField}
                            {passwordField(newPasswordLabel, 'new-password')}
                            {errorLine}
                            {submitButton(isEnglish ? 'Set Password and Sign In' : '设置密码并登录')}
                        </form>
                        <div className="auth-links">
                            {resendLink('password')}
                            {backToSignIn}
                        </div>
                    </>
                )}

                {view === 'google-account' && pendingGoogle && (
                    <>
                        <h2 className="redeem-heading">{isEnglish ? 'Create Your Account' : '创建您的账号'}</h2>
                        <p className="redeem-subtitle">
                            {isEnglish
                                ? 'This Google account isn’t on Sekai Beyond yet. Check your details to finish.'
                                : '此 Google 账号尚未注册 Sekai Beyond。请确认您的信息以完成注册。'}
                        </p>
                        <form className="auth-form" onSubmit={createWithGoogle}>
                            <input
                                type="text"
                                autoComplete="name"
                                required
                                maxLength={50}
                                value={displayName}
                                onChange={e => setDisplayName(e.target.value)}
                                placeholder={isEnglish ? 'Your name' : '您的名称'}
                                className="admin-input auth-input"
                            />
                            <input
                                type="email"
                                autoComplete="email"
                                required
                                value={email}
                                onChange={e => {
                                    setEmail(e.target.value);
                                    setGoogleCodeSent(false);
                                    setCode('');
                                }}
                                placeholder={isEnglish ? 'Email' : '邮箱'}
                                className="admin-input auth-input"
                            />
                            {googleNeedsCode && googleCodeSent && (
                                <>
                                    <p className="auth-note">
                                        {isEnglish
                                            ? <>We sent a code to <strong>{email}</strong>. If that address already has
                                                an account, we’ve told you there instead.</>
                                            : <>验证码已发送至 <strong>{email}</strong>。如果此邮箱已有账号，您会收到相关提醒。</>}
                                    </p>
                                    {codeField}
                                </>
                            )}
                            <input
                                type="password"
                                autoComplete="new-password"
                                value={password}
                                onChange={e => setPassword(e.target.value)}
                                placeholder={isEnglish ? 'Password (optional, at least 8 characters)' : '密码（选填，至少 8 个字符）'}
                                className="admin-input auth-input"
                            />
                            <p className="auth-note">
                                {isEnglish
                                    ? 'Without a password you’ll sign in with Google. You can add one later in Settings.'
                                    : '不设置密码也可使用 Google 登录，之后可在设置中添加。'}
                            </p>
                            {errorLine}
                            {submitButton(googleNeedsCode && !googleCodeSent
                                ? (isEnglish ? 'Send Code' : '发送验证码')
                                : (isEnglish ? 'Create Account' : '创建账号'))}
                        </form>
                        <div className="auth-links">
                            <button
                                type="button"
                                className="auth-link"
                                onClick={() => {
                                    setEmail('');
                                    goTo('google-bind');
                                }}
                            >
                                {isEnglish ? 'I already have an account' : '我已有账号'}
                            </button>
                        </div>
                    </>
                )}

                {view === 'google-bind' && pendingGoogle && (
                    <>
                        <h2 className="redeem-heading">{isEnglish ? 'Bind Google to Your Account' : '将 Google 绑定到您的账号'}</h2>
                        <p className="redeem-subtitle">
                            {pendingGoogle.emailTaken
                                ? (isEnglish
                                    ? <>An account already uses <strong>{pendingGoogle.email}</strong>. Sign in to bind
                                        this Google account to it.</>
                                    : <>已有账号使用 <strong>{pendingGoogle.email}</strong>。请登录以绑定此 Google
                                        账号。</>)
                                : (isEnglish
                                    ? 'Sign in to the account you want to sign in to with Google from now on.'
                                    : '请登录您希望今后使用 Google 登录的账号。')}
                        </p>
                        <form className="auth-form" onSubmit={bindGoogle}>
                            {emailField}
                            {passwordField(isEnglish ? 'Password' : '密码', 'current-password')}
                            {errorLine}
                            {submitButton(isEnglish ? 'Sign In and Bind' : '登录并绑定')}
                        </form>
                        <div className="auth-links">
                            {!pendingGoogle.emailTaken && (
                                <button
                                    type="button"
                                    className="auth-link"
                                    onClick={() => {
                                        setEmail(pendingGoogle.email);
                                        goTo('google-account');
                                    }}
                                >
                                    {isEnglish ? 'Create a new account instead' : '改为创建新账号'}
                                </button>
                            )}
                            <button type="button" className="auth-link" onClick={() => goTo('forgot')}>
                                {isEnglish ? 'Forgot password?' : '忘记密码？'}
                            </button>
                        </div>
                    </>
                )}

                {/* Last, so a form's first field takes the focus when the modal opens. */}
                <button className="modal-close" onClick={close} type="button"
                        aria-label={isEnglish ? 'Close' : '关闭'}>×
                </button>
            </div>
        </div>
    );
};
