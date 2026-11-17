import { useLanguage } from '~/components/LanguageContextProvider';
import { appNameIn } from '~/lib/appLinks';
import { callUndoAppLink } from '~/lib/firebase';
import { formatSiteTime } from '~/lib/siteTime';
import { UndoLinkCard } from './UndoLinkCard';

export const UndoAppLinkPage = () => {
    const {isEnglish} = useLanguage();
    return (
        <UndoLinkCard
            path="/undo-app-link"
            title={isEnglish ? 'Undo App Link' : '撤销应用绑定'}
            description={isEnglish
                ? 'This unlinks the app account that was just linked to yours, signs out every device, removes any bound Google account and replaces your password. You can then link your own account in that app straight away, once in 30 days. Choose a new password to finish.'
                : '此操作会解除刚刚绑定到您账号的应用账号，退出所有设备，移除已绑定的 Google 账号并替换密码。之后您可以立即绑定您自己在该应用的账号（每 30 天限一次）。请设置新密码以完成操作。'}
            badLinkText={isEnglish
                ? 'It may have expired or already been used, or the account’s email may have changed since. If someone else has your account, please contact us.'
                : '链接可能已过期或已被使用，或账号邮箱已更改。如果您的账号被他人占用，请联系我们。'}
            doneTitle={isEnglish ? 'Link Undone' : '绑定已撤销'}
            undo={async (token, password) => (await callUndoAppLink({token, password})).data}
            renderDone={app => {
                const appName = appNameIn(app, app.appId, isEnglish);
                const heldUntil = app.heldUntil ? new Date(app.heldUntil) : null;
                const date = (english: boolean) =>
                    heldUntil && formatSiteTime(heldUntil, english, {year: 'numeric', month: 'long', day: 'numeric'});
                return (
                    <>
                        <p>
                            {isEnglish
                                ? <>Your account is no longer linked in <strong>{appName}</strong>, and
                                    every device has been signed out. Sign in with your new password. You can bind
                                    Google again in Settings.</>
                                : <>您的账号已解除与<strong>{appName}</strong>的绑定，所有设备均已退出登录。请使用新密码登录，之后可在设置中重新绑定
                                    Google。</>}
                        </p>
                        <p>
                            {heldUntil
                                ? (isEnglish
                                    ? `This is the second link you’ve undone in ${appName} within 30 days, so your account can only link another account there from ${date(true)}. If you need to sooner, please contact us.`
                                    : `这是您 30 天内在${appName}第二次撤销绑定，因此需等到 ${date(false)} 后才能绑定其他账号。如需提前，请联系我们。`)
                                : (isEnglish
                                    ? `You can link your own ${appName} account in Settings straight away.`
                                    : `您可以在设置中立即绑定您自己的${appName}账号。`)}
                        </p>
                    </>
                );
            }}
        />
    );
};
