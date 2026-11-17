import { useLanguage } from '~/components/LanguageContextProvider';
import { callUndoEmailChange } from '~/lib/firebase';
import { UndoLinkCard } from './UndoLinkCard';

export const UndoEmailPage = () => {
    const {isEnglish} = useLanguage();
    return (
        <UndoLinkCard
            path="/undo-email"
            title={isEnglish ? 'Undo Email Change' : '撤销邮箱更改'}
            description={isEnglish
                ? 'This puts your account back on the address this link was sent to, signs out every device, removes any bound Google account and replaces your password. Choose a new one to finish.'
                : '此操作会将账号恢复到收到此链接的邮箱，退出所有设备，移除已绑定的 Google 账号并替换密码。请设置新密码以完成操作。'}
            badLinkText={isEnglish
                ? 'It may have expired or already been used, or the account may have changed since. If someone else has your account, please contact us.'
                : '链接可能已过期或已被使用，或账号已发生其他变化。如果您的账号被他人占用，请联系我们。'}
            doneTitle={isEnglish ? 'Your Account Is Back' : '账号已恢复'}
            undo={async (token, password) =>
                (await callUndoEmailChange({token, password, language: isEnglish ? 'en' : 'zh'})).data.email}
            renderDone={restoredEmail => (
                <p>
                    {isEnglish
                        ? <>Your account’s email is <strong>{restoredEmail}</strong> again, and every device
                            has been signed out. Sign in with your new password. You can bind Google again
                            in Settings.</>
                        : <>您的账号邮箱已恢复为 <strong>{restoredEmail}</strong>，所有设备均已退出登录。请使用新密码登录，之后可在设置中重新绑定
                            Google。</>}
                </p>
            )}
        />
    );
};
