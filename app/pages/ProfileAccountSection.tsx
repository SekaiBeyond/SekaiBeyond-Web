import { type FormEvent, type ReactNode, useCallback, useEffect, useState } from 'react';
import { useAuth } from '~/components/AuthProvider';
import { GoogleButton } from '~/components/GoogleButton';
import { useLanguage } from '~/components/LanguageContextProvider';
import { accountErrorMessage } from '~/lib/accountErrors';
import {
    callBindGoogle,
    callChangeEmail,
    callChangePassword,
    callGetSignInMethods,
    callSendEmailCode,
    callUnbindGoogle,
    type SignInMethods,
} from '~/lib/firebase';
import type { ShowToast } from '~/lib/useToasts';

const CODE_FIELD = {
    type: 'text',
    inputMode: 'numeric',
    autoComplete: 'one-time-code',
    maxLength: 6,
    required: true,
    className: 'admin-input auth-input auth-code-input',
} as const;

/** The busy flag and error line every form here shares. */
function useFormAction() {
    const {isEnglish} = useLanguage();
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');

    const run = async (action: () => Promise<void>) => {
        setBusy(true);
        setError('');
        try {
            await action();
        } catch (err) {
            setError(accountErrorMessage(err, isEnglish));
        } finally {
            setBusy(false);
        }
    };
    return {busy, error, run};
}

const FormActions = ({busy, submitLabel, onCancel}: {busy: boolean; submitLabel: string; onCancel: () => void}) => {
    const {isEnglish} = useLanguage();
    return (
        <div className="settings-account-actions">
            <button type="submit" className="admin-btn admin-btn--cta" disabled={busy}>{submitLabel}</button>
            <button type="button" className="admin-btn admin-btn--dashed" disabled={busy} onClick={onCancel}>
                {isEnglish ? 'Cancel' : '取消'}
            </button>
        </div>
    );
};

/** A code to the new address, then the code back: proof it's theirs before the account moves onto it. */
const EmailForm = ({onDone, onCancel, showToast}: {onDone: () => void; onCancel: () => void; showToast: ShowToast}) => {
    const {isEnglish} = useLanguage();
    const language = isEnglish ? 'en' : 'zh';
    const {refreshProfile} = useAuth();
    const {busy, error, run} = useFormAction();
    const [email, setEmail] = useState('');
    const [code, setCode] = useState('');
    const [sent, setSent] = useState(false);

    const submit = (e: FormEvent) => {
        e.preventDefault();
        void run(async () => {
            if (!sent) {
                await callSendEmailCode({purpose: 'email-change', email, language});
                setSent(true);
                return;
            }
            await callChangeEmail({email, code, language});
            await refreshProfile().catch(() => {
            });
            showToast(isEnglish ? 'Email changed.' : '邮箱已更改。', 'success');
            onDone();
        });
    };

    return (
        <form className="settings-account-form" onSubmit={submit}>
            <input
                type="email"
                autoComplete="email"
                required
                disabled={sent}
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder={isEnglish ? 'New email' : '新邮箱'}
                className="admin-input auth-input"
            />
            {sent && (
                <>
                    <span className="settings-row-help">
                        {isEnglish
                            ? 'We sent a code to that address. If it already has an account, we’ve told you there instead.'
                            : '验证码已发送至该邮箱。如果此邮箱已有账号，您会收到相关提醒。'}
                    </span>
                    <input
                        {...CODE_FIELD}
                        value={code}
                        onChange={e => setCode(e.target.value.replace(/\D/g, ''))}
                        placeholder={isEnglish ? '6-digit code' : '6 位验证码'}
                    />
                </>
            )}
            {error && <p className="redeem-error-text">{error}</p>}
            <FormActions
                busy={busy}
                submitLabel={sent ? (isEnglish ? 'Change Email' : '更改邮箱') : (isEnglish ? 'Send Code' : '发送验证码')}
                onCancel={onCancel}
            />
        </form>
    );
};

/** A code to the account's address, in place of an old password it may not have. */
const PasswordForm = ({email, onDone, onCancel, showToast}: {
    email: string;
    onDone: () => void;
    onCancel: () => void;
    showToast: ShowToast;
}) => {
    const {isEnglish} = useLanguage();
    const language = isEnglish ? 'en' : 'zh';
    const {replaceSession} = useAuth();
    const {busy, error, run} = useFormAction();
    const [code, setCode] = useState('');
    const [password, setPassword] = useState('');
    const [sent, setSent] = useState(false);

    const submit = (e: FormEvent) => {
        e.preventDefault();
        void run(async () => {
            if (!sent) {
                await callSendEmailCode({purpose: 'password', email, language});
                setSent(true);
                return;
            }
            const {data} = await callChangePassword({code, password, language});
            await replaceSession(data.token);
            showToast(
                isEnglish ? 'Password saved. Your other devices have been signed out.' : '密码已保存，其他设备已退出登录。',
                'success',
            );
            onDone();
        });
    };

    return (
        <form className="settings-account-form" onSubmit={submit}>
            {sent ? (
                <>
                    <span className="settings-row-help">
                        {isEnglish ? `We sent a code to ${email}.` : `验证码已发送至 ${email}。`}
                    </span>
                    <input
                        {...CODE_FIELD}
                        value={code}
                        onChange={e => setCode(e.target.value.replace(/\D/g, ''))}
                        placeholder={isEnglish ? '6-digit code' : '6 位验证码'}
                    />
                    <input
                        type="password"
                        autoComplete="new-password"
                        required
                        value={password}
                        onChange={e => setPassword(e.target.value)}
                        placeholder={isEnglish ? 'New password (at least 8 characters)' : '新密码（至少 8 个字符）'}
                        className="admin-input auth-input"
                    />
                </>
            ) : (
                <span className="settings-row-help">
                    {isEnglish
                        ? 'We’ll email you a code to confirm it’s you. Saving a new password signs out your other devices.'
                        : '我们会发送验证码以确认是您本人。保存新密码后，其他设备将退出登录。'}
                </span>
            )}
            {error && <p className="redeem-error-text">{error}</p>}
            <FormActions
                busy={busy}
                submitLabel={sent ? (isEnglish ? 'Save Password' : '保存密码') : (isEnglish ? 'Send Code' : '发送验证码')}
                onCancel={onCancel}
            />
        </form>
    );
};

const Row = ({title, help, state, action, children}: {
    title: string;
    help: string;
    state?: string;
    action?: ReactNode;
    children?: ReactNode;
}) => (
    <div className="settings-row settings-row--account">
        <div className="settings-row-text">
            <span className="settings-row-title">{title}</span>
            <span className="settings-row-help">{help}</span>
            {state && <span className="settings-row-state">{state}</span>}
        </div>
        {action}
        {children}
    </div>
);

/**
 * /profile's Settings tab: the account's address and how it signs in. Everything
 * here is enforced server-side, the month between email changes included; the
 * buttons only spare someone a refused call.
 */
export const ProfileAccountSection = ({showToast}: {showToast: ShowToast}) => {
    const {isEnglish} = useLanguage();
    const language = isEnglish ? 'en' : 'zh';
    const {user, profile} = useAuth();
    const [methods, setMethods] = useState<SignInMethods | null>(null);
    const [failed, setFailed] = useState(false);
    const [editing, setEditing] = useState<'email' | 'password' | null>(null);
    const [bindingGoogle, setBindingGoogle] = useState(false);
    const [googleBusy, setGoogleBusy] = useState(false);

    const load = useCallback(async () => {
        try {
            setMethods((await callGetSignInMethods()).data);
            setFailed(false);
        } catch {
            setFailed(true);
        }
    }, []);

    const uid = user?.uid;
    useEffect(() => {
        if (uid) void load();
    }, [uid, load]);

    const closeForm = () => {
        setEditing(null);
        void load();
    };

    const bind = async (idToken: string) => {
        setGoogleBusy(true);
        try {
            await callBindGoogle({idToken, language});
            setBindingGoogle(false);
            await load();
            showToast(isEnglish ? 'Google account bound.' : '已绑定 Google 账号。', 'success');
        } catch (err) {
            showToast(accountErrorMessage(err, isEnglish), 'error');
        } finally {
            setGoogleBusy(false);
        }
    };

    const unbind = async () => {
        const confirmed = window.confirm(
            isEnglish
                ? 'Unbind this Google account? You’ll sign in with your email and password instead.'
                : '确定要解绑此 Google 账号吗？之后需使用邮箱和密码登录。',
        );
        if (!confirmed) return;
        setGoogleBusy(true);
        try {
            await callUnbindGoogle({language});
            await load();
            showToast(isEnglish ? 'Google account unbound.' : '已解绑 Google 账号。', 'success');
        } catch (err) {
            showToast(accountErrorMessage(err, isEnglish), 'error');
        } finally {
            setGoogleBusy(false);
        }
    };

    if (!profile) return null;

    const dateFormat = {year: 'numeric', month: 'long', day: 'numeric'} as const;
    const lockedUntil = methods?.emailChangeAllowedAt
        ? new Date(methods.emailChangeAllowedAt).toLocaleDateString(isEnglish ? 'en-US' : 'zh-CN', dateFormat)
        : null;
    const canUnbind = !!methods?.hasPassword;

    return (
        <section className="settings-section">
            <h2 className="settings-section-title">{isEnglish ? 'Account' : '账号'}</h2>
            <p className="settings-section-note">
                {isEnglish
                    ? 'Your email is how you sign in and how your tickets find you. Tickets bought under an old address stay yours.'
                    : '邮箱用于登录，也用于匹配您的门票。用旧邮箱购买的门票仍归您所有。'}
            </p>

            {failed ? (
                <p className="settings-row-help">
                    {isEnglish
                        ? 'Couldn’t load your account details just now. Try reloading the page.'
                        : '暂时无法加载您的账号信息，请刷新页面重试。'}
                </p>
            ) : !methods ? (
                <div className="spinner spinner-centered"/>
            ) : (
                <div className="settings-rows">
                    <Row
                        title={isEnglish ? 'Email' : '邮箱'}
                        help={profile.email}
                        state={lockedUntil
                            ? (isEnglish ? `You can change it again on ${lockedUntil}.` : `您可在 ${lockedUntil} 后再次更改。`)
                            : undefined}
                        action={editing !== 'email' && (
                            <button
                                type="button"
                                className="profile-action"
                                disabled={!!lockedUntil}
                                onClick={() => setEditing('email')}
                            >
                                {isEnglish ? 'Change' : '更改'}
                            </button>
                        )}
                    >
                        {editing === 'email' && (
                            <EmailForm onDone={closeForm} onCancel={() => setEditing(null)} showToast={showToast}/>
                        )}
                    </Row>

                    <Row
                        title={isEnglish ? 'Password' : '密码'}
                        help={methods.hasPassword
                            ? (isEnglish ? 'You can sign in with your email and password.' : '您可使用邮箱和密码登录。')
                            : (isEnglish ? 'No password yet, so you sign in with Google.' : '尚未设置密码，您目前使用 Google 登录。')}
                        action={editing !== 'password' && (
                            <button type="button" className="profile-action" onClick={() => setEditing('password')}>
                                {methods.hasPassword ? (isEnglish ? 'Change' : '更改') : (isEnglish ? 'Set Password' : '设置密码')}
                            </button>
                        )}
                    >
                        {editing === 'password' && (
                            <PasswordForm
                                email={profile.email}
                                onDone={closeForm}
                                onCancel={() => setEditing(null)}
                                showToast={showToast}
                            />
                        )}
                    </Row>

                    <Row
                        title="Google"
                        help={methods.googleEmail
                            ?? (isEnglish ? 'Not bound. Bind one to sign in with Google.' : '未绑定。绑定后可使用 Google 登录。')}
                        state={methods.googleEmail && !canUnbind
                            ? (isEnglish ? 'Set a password before unbinding, or you’d have no way to sign in.' : '解绑前请先设置密码，否则将无法登录。')
                            : undefined}
                        action={methods.googleEmail ? (
                            <button
                                type="button"
                                className="profile-action"
                                disabled={googleBusy || !canUnbind}
                                onClick={() => void unbind()}
                            >
                                {isEnglish ? 'Unbind' : '解绑'}
                            </button>
                        ) : !bindingGoogle && (
                            <button type="button" className="profile-action" onClick={() => setBindingGoogle(true)}>
                                {isEnglish ? 'Bind' : '绑定'}
                            </button>
                        )}
                    >
                        {!methods.googleEmail && bindingGoogle && (
                            <div className="settings-google-bind">
                                <GoogleButton onToken={idToken => void bind(idToken)}/>
                            </div>
                        )}
                    </Row>
                </div>
            )}
        </section>
    );
};
