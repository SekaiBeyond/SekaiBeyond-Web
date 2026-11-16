import { type FormEvent, useEffect, useState } from 'react';
import { useLanguage } from '~/components/LanguageContextProvider';
import { accountErrorMessage } from '~/lib/accountErrors';
import { callAdminChangeEmail, callGetSignInMethods, type SignInMethods } from '~/lib/firebase';
import type { UserRecord } from './types';
import type { ShowToast } from './utils';

/** How an account signs in, as the Sign-in and Connected Accounts sections both show it. */
export interface UserSignIn {
    /** Null until loaded. */
    methods: SignInMethods | null;
    failed: boolean;
}

/** How the account `uid` signs in, loaded once for its page. */
export function useUserSignInMethods(uid: string): UserSignIn {
    const [methods, setMethods] = useState<SignInMethods | null>(null);
    const [failed, setFailed] = useState(false);

    useEffect(() => {
        let stale = false;
        setMethods(null);
        setFailed(false);
        callGetSignInMethods({uid})
            .then(result => !stale && setMethods(result.data))
            .catch(() => !stale && setFailed(true));
        return () => {
            stale = true;
        };
    }, [uid]);

    return {methods, failed};
}

/**
 * Whether an account has a password, and the way to give it a new address when
 * its owner has lost the mailbox and can't get a code. That skips the month
 * between changes, says so on the Records tab, and tells both addresses.
 * Google is the Connected Accounts section's (UserConnectionsSection).
 */
export const UserSignInSection = ({user, signIn, canManage, onUpdated, showToast}: {
    user: UserRecord;
    signIn: UserSignIn;
    canManage: boolean;
    onUpdated: (uid: string, changes: Partial<UserRecord>) => void;
    showToast: ShowToast;
}) => {
    const {isEnglish} = useLanguage();
    const {methods, failed} = signIn;
    const [editing, setEditing] = useState(false);
    const [email, setEmail] = useState('');
    const [busy, setBusy] = useState(false);

    useEffect(() => {
        setEditing(false);
    }, [user.uid]);

    const save = async (e: FormEvent) => {
        e.preventDefault();
        const confirmed = window.confirm(
            isEnglish
                ? `Change ${user.displayName}'s email to ${email}? Whoever holds that mailbox can then take over the account, so be sure it's theirs.`
                : `确定将 ${user.displayName} 的邮箱更改为 ${email} 吗？该邮箱的持有者将可以接管此账号，请确认其归本人所有。`,
        );
        if (!confirmed) return;
        setBusy(true);
        try {
            const {data} = await callAdminChangeEmail({
                targetUid: user.uid,
                email,
                language: isEnglish ? 'en' : 'zh',
            });
            onUpdated(user.uid, {email: data.email});
            setEditing(false);
            setEmail('');
            showToast(isEnglish ? 'Email changed.' : '邮箱已更改。', 'success');
        } catch (err) {
            showToast(accountErrorMessage(err, isEnglish), 'error');
        } finally {
            setBusy(false);
        }
    };

    const passwordHelp = failed
        ? (isEnglish ? 'Couldn’t load this.' : '加载失败。')
        : !methods
            ? (isEnglish ? 'Loading…' : '加载中…')
            : methods.hasPassword
                ? (isEnglish ? 'Set. They can sign in with their email and password.' : '已设置，可使用邮箱和密码登录。')
                : methods.googleEmail
                    ? (isEnglish ? 'Not set, so they sign in with Google.' : '未设置，目前使用 Google 登录。')
                    : (isEnglish
                        ? 'Not set, and no Google account: they’d set one with a code sent to their email.'
                        : '未设置，也未绑定 Google：需通过发送到邮箱的验证码设置密码。');

    // The rows of the account's own Account card in Settings, as staff see them.
    return (
        <div className="admin-group-section">
            <h4 className="admin-badges-title">{isEnglish ? 'Sign-in' : '登录方式'}</h4>
            <div className="settings-rows">
                <div className="settings-row settings-row--account">
                    <div className="settings-row-text">
                        <span className="settings-row-title">{isEnglish ? 'Email' : '邮箱'}</span>
                        <span className="settings-row-help">{user.email || (isEnglish ? 'None' : '无')}</span>
                    </div>
                    {canManage && !editing && (
                        <button type="button" className="profile-action" onClick={() => setEditing(true)}>
                            {isEnglish ? 'Change' : '更改'}
                        </button>
                    )}
                    {canManage && editing && (
                        <form className="settings-account-form" onSubmit={e => void save(e)}>
                            <span className="settings-row-help">
                                {isEnglish
                                    ? 'For someone who has lost this mailbox and can’t get a code. It skips the month between changes, goes on the Records tab, and tells both addresses.'
                                    : '适用于无法再访问此邮箱、收不到验证码的用户。此操作不受每月一次的更改限制，会记录在“记录”中，并通知新旧两个邮箱。'}
                            </span>
                            <input
                                type="email"
                                required
                                value={email}
                                onChange={e => setEmail(e.target.value)}
                                placeholder={isEnglish ? 'New email' : '新邮箱'}
                                className="admin-input auth-input"
                            />
                            <div className="settings-account-actions">
                                <button type="submit" className="admin-btn admin-btn--cta" disabled={busy}>
                                    {isEnglish ? 'Change Email' : '更改邮箱'}
                                </button>
                                <button
                                    type="button"
                                    className="admin-btn admin-btn--dashed"
                                    disabled={busy}
                                    onClick={() => setEditing(false)}
                                >
                                    {isEnglish ? 'Cancel' : '取消'}
                                </button>
                            </div>
                        </form>
                    )}
                </div>

                <div className="settings-row settings-row--account">
                    <div className="settings-row-text">
                        <span className="settings-row-title">{isEnglish ? 'Password' : '密码'}</span>
                        <span className="settings-row-help">{passwordHelp}</span>
                    </div>
                </div>
            </div>
        </div>
    );
};
