import { Link } from 'react-router';
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
                    src={profile?.photoURL ?? user.photoURL ?? '/images/mika.png'}
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
                    <Link to="/" className="user-dropdown-item">
                        {isEnglish ? 'Home' : '首页'}
                    </Link>
                    <Link to="/profile" className="user-dropdown-item">
                        {isEnglish ? 'My Profile' : '我的主页'}
                    </Link>
                    <button
                        className="user-dropdown-item"
                        onClick={() => {
                            window.dispatchEvent(new CustomEvent('open-redeem-modal'));
                        }}
                    >
                        {isEnglish ? 'Redeem Code' : '兑换激活码'}
                    </button>
                    {profile && (hasPermission(profile.group, 'core-staff') || profile.eventStaffEvents.length > 0) && (
                        <Link to="/admin" className="user-dropdown-item">
                            {isEnglish ? 'Admin Panel' : '管理面板'}
                        </Link>
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
