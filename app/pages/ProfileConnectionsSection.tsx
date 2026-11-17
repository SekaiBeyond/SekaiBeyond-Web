import { useState } from 'react';
import { useAuth } from '~/components/AuthProvider';
import { GoogleButton } from '~/components/GoogleButton';
import { useLanguage } from '~/components/LanguageContextProvider';
import { accountErrorMessage } from '~/lib/accountErrors';
import { callBindGoogle, callUnbindGoogle } from '~/lib/firebase';
import type { ShowToast } from '~/lib/useToasts';
import type { SignInState } from '~/pages/ProfileAccountSection';
import { AppLinkRows } from '~/pages/ProfileAppLinkRows';
import { ConnectionRow } from '~/pages/ProfileConnectionRow';

const GoogleRow = ({signIn, showToast}: {signIn: SignInState; showToast: ShowToast}) => {
    const {isEnglish} = useLanguage();
    const language = isEnglish ? 'en' : 'zh';
    const {refreshProfile} = useAuth();
    const {methods, failed, reload} = signIn;
    const [binding, setBinding] = useState(false);
    const [busy, setBusy] = useState(false);

    const bind = async (idToken: string) => {
        setBusy(true);
        try {
            await callBindGoogle({idToken, language});
            setBinding(false);
            await Promise.all([reload(), refreshProfile().catch(() => {
            })]);
            showToast(isEnglish ? 'Google account bound.' : '已绑定 Google 账号。', 'success');
        } catch (err) {
            showToast(accountErrorMessage(err, isEnglish), 'error');
        } finally {
            setBusy(false);
        }
    };

    const unbind = async () => {
        const confirmed = window.confirm(
            isEnglish
                ? 'Unbind this Google account? You’ll sign in with your email and password instead.'
                : '确定要解绑此 Google 账号吗？之后需使用邮箱和密码登录。',
        );
        if (!confirmed) return;
        setBusy(true);
        try {
            await callUnbindGoogle({language});
            await Promise.all([reload(), refreshProfile().catch(() => {
            })]);
            showToast(isEnglish ? 'Google account unbound.' : '已解绑 Google 账号。', 'success');
        } catch (err) {
            showToast(accountErrorMessage(err, isEnglish), 'error');
        } finally {
            setBusy(false);
        }
    };

    const kind = isEnglish ? 'Sign-in method' : '登录方式';

    if (!methods) {
        return (
            <ConnectionRow
                brand="google"
                title="Google"
                kind={kind}
                help={failed
                    ? (isEnglish ? 'Couldn’t load this just now. Try reloading the page.' : '暂时无法加载，请刷新页面重试。')
                    : (isEnglish ? 'Loading…' : '加载中…')}
            />
        );
    }

    const bound = !!methods.googleEmail;
    const canUnbind = methods.hasPassword;

    return (
        <ConnectionRow
            brand="google"
            title="Google"
            kind={kind}
            status={bound
                ? {value: 'on', label: isEnglish ? 'Connected' : '已绑定'}
                : {value: 'off', label: isEnglish ? 'Not connected' : '未绑定'}}
            help={methods.googleEmail
                ?? (isEnglish ? 'Bind your Google account to sign in here with it.' : '绑定 Google 账号后，即可用它登录本站。')}
            state={bound && !canUnbind
                ? (isEnglish ? 'Set a password before unbinding, or you’d have no way to sign in.' : '解绑前请先设置密码，否则将无法登录。')
                : undefined}
            action={bound ? (
                <button
                    type="button"
                    className="profile-action"
                    disabled={busy || !canUnbind}
                    onClick={() => void unbind()}
                >
                    {isEnglish ? 'Unbind' : '解绑'}
                </button>
            ) : !binding && (
                <button type="button" className="profile-action" onClick={() => setBinding(true)}>
                    {isEnglish ? 'Bind' : '绑定'}
                </button>
            )}
        >
            {!bound && binding && (
                <div className="settings-google-bind">
                    <GoogleButton onToken={idToken => void bind(idToken)}/>
                    <div className="settings-account-actions">
                        <button type="button" className="admin-btn admin-btn--dashed" disabled={busy}
                                onClick={() => setBinding(false)}>
                            {isEnglish ? 'Cancel' : '取消'}
                        </button>
                    </div>
                </div>
            )}
        </ConnectionRow>
    );
};

export const ProfileConnectionsSection = ({signIn, showToast}: {signIn: SignInState; showToast: ShowToast}) => {
    const {isEnglish} = useLanguage();
    const {profile} = useAuth();
    if (!profile) return null;

    return (
        <section className="settings-section">
            <h2 className="settings-section-title">{isEnglish ? 'Connected Accounts' : '关联账号'}</h2>
            <p className="settings-section-note">
                {isEnglish
                    ? 'Google is another way to sign in here. Linking your account in one of our apps, like the WeChat mini program, lets that app recognise you and show your membership and event staff roles there. You can use each without connecting it.'
                    : 'Google 是登录本站的另一种方式。把您在我们应用（例如微信小程序）中的账号与本站账号绑定后，应用就能识别您，并显示您的会员和活动工作人员身份。不绑定也可以分别使用。'}
            </p>
            <div className="settings-rows">
                <GoogleRow signIn={signIn} showToast={showToast}/>
                <AppLinkRows showToast={showToast}/>
            </div>
        </section>
    );
};
