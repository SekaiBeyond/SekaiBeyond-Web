import { useLanguage } from '~/components/LanguageContextProvider';

/**
 * A page's whole content when it has nothing to show: why, a sign-in button
 * when signing in would help, and the way home.
 */
export const NoticeCard = ({title, text, onSignIn}: {title: string; text?: string; onSignIn?: () => void}) => {
    const {isEnglish} = useLanguage();
    return (
        <div className="profile-login-prompt">
            <div className="profile-login-card">
                <h2>{title}</h2>
                {text && <p>{text}</p>}
                {onSignIn && (
                    <button onClick={onSignIn} className="profile-sign-in-btn">
                        {isEnglish ? 'Sign in with Google' : '使用 Google 登录'}
                    </button>
                )}
                <a href="/" className="profile-back-link">
                    {isEnglish ? 'Back to Home' : '返回首页'}
                </a>
            </div>
        </div>
    );
};
