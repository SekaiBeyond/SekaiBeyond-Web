import { type FormEvent, type ReactNode, useCallback, useEffect, useState } from 'react';
import { useAuth } from '~/components/AuthProvider';
import { useLanguage } from '~/components/LanguageContextProvider';
import { accountErrorMessage } from '~/lib/accountErrors';
import {
    callCancelAccountDeletion,
    callChangeEmail,
    callChangePassword,
    callGetSignInMethods,
    callRequestAccountDeletion,
    callSendEmailCode,
    EMAIL_CODE_LENGTH,
    type SignInMethods,
} from '~/lib/firebase';
import type { ShowToast } from '~/lib/useToasts';

const CODE_FIELD = {
    type: 'text',
    inputMode: 'numeric',
    autoComplete: 'one-time-code',
    maxLength: EMAIL_CODE_LENGTH,
    required: true,
    className: 'admin-input auth-input auth-code-input',
} as const;

const codePlaceholder = (isEnglish: boolean) =>
    isEnglish ? `${EMAIL_CODE_LENGTH}-digit code` : `${EMAIL_CODE_LENGTH} 位验证码`;

export interface SignInState {
    methods: SignInMethods | null;
    failed: boolean;
    reload: () => Promise<void>;
}

export function useSignInMethods(): SignInState {
    const {user} = useAuth();
    const [methods, setMethods] = useState<SignInMethods | null>(null);
    const [failed, setFailed] = useState(false);

    const reload = useCallback(async () => {
        try {
            setMethods((await callGetSignInMethods()).data);
            setFailed(false);
        } catch {
            setFailed(true);
        }
    }, []);

    const uid = user?.uid;
    useEffect(() => {
        if (uid) void reload();
    }, [uid, reload]);

    return {methods, failed, reload};
}

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

const FormActions = ({busy, danger = false, submitLabel, onCancel}: {
    busy: boolean;
    danger?: boolean;
    submitLabel: string;
    onCancel: () => void;
}) => {
    const {isEnglish} = useLanguage();
    return (
        <div className="settings-account-actions">
            <button type="submit" className={`admin-btn ${danger ? 'admin-btn--danger' : 'admin-btn--cta'}`}
                    disabled={busy}>
                {submitLabel}
            </button>
            <button type="button" className="admin-btn admin-btn--dashed" disabled={busy} onClick={onCancel}>
                {isEnglish ? 'Cancel' : '取消'}
            </button>
        </div>
    );
};

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
                        placeholder={codePlaceholder(isEnglish)}
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
                        placeholder={codePlaceholder(isEnglish)}
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

const DeletionRow = ({deleteAt, ownRequest, showToast}: {
    deleteAt: Date;
    ownRequest: boolean;
    showToast: ShowToast;
}) => {
    const {isEnglish} = useLanguage();
    const {refreshProfile} = useAuth();
    const [busy, setBusy] = useState(false);
    const when = deleteAt.toLocaleString(isEnglish ? 'en-US' : 'zh-CN', {dateStyle: 'long', timeStyle: 'short'});

    const cancel = async () => {
        setBusy(true);
        try {
            await callCancelAccountDeletion();
            await refreshProfile().catch(() => {
            });
            showToast(
                isEnglish
                    ? 'Deletion cancelled. If you didn’t ask for it, change your password now.'
                    : '已取消删除。如果不是您本人申请的，请立即更改密码。',
                'success',
            );
        } catch (err) {
            showToast(accountErrorMessage(err, isEnglish), 'error');
        } finally {
            setBusy(false);
        }
    };

    return (
        <Row
            title={isEnglish ? 'Due to be deleted' : '即将删除'}
            help={isEnglish
                ? `From ${when}, your account and everything in it will be gone for good.`
                : `自 ${when} 起，您的账号及其中的所有内容将被永久删除。`}
            state={ownRequest ? undefined : (isEnglish
                ? 'Staff scheduled this. Contact us if you think it’s a mistake.'
                : '此删除由工作人员安排。如认为有误，请联系我们。')}
            action={ownRequest && (
                <button type="button" className="profile-action" disabled={busy} onClick={() => void cancel()}>
                    {isEnglish ? 'Cancel Deletion' : '取消删除'}
                </button>
            )}
        />
    );
};

export const ProfileAccountSection = ({signIn, showToast}: {signIn: SignInState; showToast: ShowToast}) => {
    const {isEnglish} = useLanguage();
    const {user, profile} = useAuth();
    const {methods, failed, reload} = signIn;
    const [editing, setEditing] = useState<'email' | 'password' | 'delete' | null>(null);

    const closeForm = () => {
        setEditing(null);
        void reload();
    };

    if (!profile) return null;

    const dateFormat = {year: 'numeric', month: 'long', day: 'numeric'} as const;
    const lockedUntil = methods?.emailChangeAllowedAt
        ? new Date(methods.emailChangeAllowedAt).toLocaleDateString(isEnglish ? 'en-US' : 'zh-CN', dateFormat)
        : null;

    return (
        <section className="settings-section">
            <h2 className="settings-section-title">{isEnglish ? 'Account' : '账号'}</h2>
            <p className="settings-section-note">
                {isEnglish
                    ? 'Your email is how you sign in and how your tickets find you. Tickets bought under an old address stay yours.'
                    : '邮箱用于登录，也用于匹配您的门票。用旧邮箱购买的门票仍归您所有。'}
            </p>

            {profile.deleteAt && (
                <div className="settings-rows">
                    <DeletionRow
                        deleteAt={profile.deleteAt}
                        ownRequest={profile.deletionRequestedBy === user?.uid}
                        showToast={showToast}
                    />
                </div>
            )}

            <div className="settings-rows">
                {failed ? (
                    <p className="settings-row-help">
                        {isEnglish
                            ? 'Couldn’t load your account details just now. Try reloading the page.'
                            : '暂时无法加载您的账号信息，请刷新页面重试。'}
                    </p>
                ) : !methods ? (
                    <div className="spinner spinner-centered"/>
                ) : (
                    <>
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
                    </>
                )}

                {!profile.deleteAt && (
                    <Row
                        title={isEnglish ? 'Delete account' : '删除账号'}
                        help={isEnglish
                            ? 'Deletes your account and everything in it for good, 48 hours after you ask.'
                            : '申请 48 小时后，永久删除您的账号及其中的所有内容。'}
                        action={editing !== 'delete' && (
                            <button
                                type="button"
                                className="profile-action profile-action--danger"
                                onClick={() => setEditing('delete')}
                            >
                                {isEnglish ? 'Delete Account' : '删除账号'}
                            </button>
                        )}
                    >
                        {editing === 'delete' && (
                            <DeleteForm onDone={() => setEditing(null)} onCancel={() => setEditing(null)}
                                        showToast={showToast}/>
                        )}
                    </Row>
                )}
            </div>
        </section>
    );
};

const DeleteForm = ({onDone, onCancel, showToast}: {
    onDone: () => void;
    onCancel: () => void;
    showToast: ShowToast
}) => {
    const {isEnglish} = useLanguage();
    const {refreshProfile} = useAuth();
    const {busy, error, run} = useFormAction();

    const submit = (e: FormEvent) => {
        e.preventDefault();
        void run(async () => {
            await callRequestAccountDeletion({language: isEnglish ? 'en' : 'zh'});
            await refreshProfile().catch(() => {
            });
            showToast(isEnglish ? 'Your account is due to be deleted.' : '您的账号已安排删除。', 'warning');
            onDone();
        });
    };

    return (
        <form className="settings-account-form" onSubmit={submit}>
            <span className="settings-row-help">
                {isEnglish
                    ? 'Your profile, badges, event history and membership are deleted with it, and any app you linked is unlinked. It happens in 48 hours, or later if you changed your email recently and that change can still be undone. We’ll email you, and you can cancel here until then.'
                    : '您的个人资料、徽章、活动记录和会员资格将一并删除，已绑定的应用也会解除绑定。删除将在 48 小时后进行；如果您最近更改过邮箱且该更改仍可撤销，则会更晚。我们会发邮件通知您，在此之前您可以在此取消。'}
            </span>
            {error && <p className="redeem-error-text">{error}</p>}
            <FormActions
                busy={busy}
                danger
                submitLabel={isEnglish ? 'Delete My Account' : '删除我的账号'}
                onCancel={onCancel}
            />
        </form>
    );
};
