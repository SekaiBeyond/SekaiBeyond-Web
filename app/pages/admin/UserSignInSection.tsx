import { type FormEvent, useEffect, useState } from 'react';
import { useLanguage } from '~/components/LanguageContextProvider';
import { accountErrorMessage } from '~/lib/accountErrors';
import { callAdminChangeEmail, callGetSignInMethods, type SignInMethods } from '~/lib/firebase';
import type { UserRecord } from './types';
import type { ShowToast } from './utils';

/**
 * How an account signs in, and the way to give it a new address when its owner
 * has lost the mailbox and can't get a code. That skips the month between
 * changes, says so on the Records tab, and tells both addresses.
 */
export const UserSignInSection = ({user, canManage, onUpdated, showToast}: {
    user: UserRecord;
    canManage: boolean;
    onUpdated: (uid: string, changes: Partial<UserRecord>) => void;
    showToast: ShowToast;
}) => {
    const {isEnglish} = useLanguage();
    const [methods, setMethods] = useState<SignInMethods | null>(null);
    const [failed, setFailed] = useState(false);
    const [editing, setEditing] = useState(false);
    const [email, setEmail] = useState('');
    const [busy, setBusy] = useState(false);

    useEffect(() => {
        let stale = false;
        setMethods(null);
        setFailed(false);
        setEditing(false);
        callGetSignInMethods({uid: user.uid})
            .then(result => !stale && setMethods(result.data))
            .catch(() => !stale && setFailed(true));
        return () => {
            stale = true;
        };
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

    return (
        <div className="admin-group-section">
            <h4 className="admin-badges-title">{isEnglish ? 'Sign-in' : '登录方式'}</h4>
            {failed ? (
                <p>{isEnglish ? 'Couldn’t load this.' : '加载失败。'}</p>
            ) : !methods ? (
                <div className="spinner spinner-centered"/>
            ) : (
                <>
                    <p>
                        {isEnglish ? 'Password: ' : '密码：'}
                        {methods.hasPassword ? (isEnglish ? 'set' : '已设置') : (isEnglish ? 'not set' : '未设置')}
                    </p>
                    <p>
                        Google{isEnglish ? ': ' : '：'}
                        {methods.googleEmail ?? (isEnglish ? 'not bound' : '未绑定')}
                    </p>
                    {canManage && !editing && (
                        <button type="button" className="admin-btn admin-btn--dashed" onClick={() => setEditing(true)}>
                            {isEnglish ? 'Change Email' : '更改邮箱'}
                        </button>
                    )}
                    {canManage && editing && (
                        <form className="settings-account-form" onSubmit={e => void save(e)}>
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
                                    {isEnglish ? 'Save' : '保存'}
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
                </>
            )}
        </div>
    );
};
