import { useLanguage } from '~/components/LanguageContextProvider';

export const NoticeCard = ({title, text, onSignIn}: {title: string; text?: string; onSignIn?: () => void}) => {
    const {isEnglish} = useLanguage();
    return (
        <div className="profile-login-prompt">
            <div className="profile-login-card">
                <h2>{title}</h2>
                {text && <p>{text}</p>}
                {onSignIn && (
                    <button onClick={onSignIn} className="profile-sign-in-btn">
                        {isEnglish ? 'Sign In' : '登录'}
                    </button>
                )}
                <a href="/" className="profile-back-link">
                    {isEnglish ? 'Back to Home' : '返回首页'}
                </a>
            </div>
        </div>
    );
};
