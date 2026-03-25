import { hasPermission, useAuth } from '~/components/AuthProvider';
import { useLanguage } from '~/components/LanguageContextProvider';

export const LoginButton = () => {
    const {user, profile, loading, signIn, signOut} = useAuth();
    const {isEnglish} = useLanguage();

    if (loading) return null;

    if (user) {
        return (
            <div className="user-dropdown-wrapper">
                <img
                    src={profile?.photoURL ?? user.photoURL ?? ''}
                    alt={isEnglish ? 'Profile' : '个人主页'}
                    className="login-avatar"
                    referrerPolicy="no-referrer"
                />
                <div className="user-dropdown">
                    <div className="user-dropdown-header">
                        <span className="user-dropdown-name">{profile?.displayName ?? user.displayName}</span>
                        <span className="user-dropdown-email">{user.email}</span>
                    </div>
                    <div className="user-dropdown-divider"/>
                    <a href="/" className="user-dropdown-item">
                        {isEnglish ? 'Home' : '首页'}
                    </a>
                    <a href="/profile" className="user-dropdown-item">
                        {isEnglish ? 'My Profile' : '我的主页'}
                    </a>
                    {profile && hasPermission(profile.group, 'core-staff') && (
                        <a href="/admin" className="user-dropdown-item">
                            {isEnglish ? 'Admin Panel' : '管理面板'}
                        </a>
                    )}
                    <div className="user-dropdown-divider"/>
                    <button className="user-dropdown-item user-dropdown-signout" onClick={signOut}>
                        {isEnglish ? 'Sign Out' : '退出登录'}
                    </button>
                </div>
            </div>
        );
    }

    return (
        <button onClick={signIn} className="login-btn">
            {isEnglish ? 'Sign In' : '登录'}
        </button>
    );
};
