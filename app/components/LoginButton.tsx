import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { hasPermission, useAuth } from '~/components/AuthProvider';
import { useLanguage } from '~/components/LanguageContextProvider';
import { openRedeemModal } from '~/components/RedeemModal';

/** The least space kept between the dropdown and the right edge of the screen. */
const DROPDOWN_EDGE_GAP = 12;

export const LoginButton = () => {
    const {user, profile, authReady, cachedPhotoURL, signIn, signOut} = useAuth();
    const {isEnglish} = useLanguage();
    const [isOpen, setIsOpen] = useState(false);
    const dropdownRef = useRef<HTMLDivElement>(null);
    const menuRef = useRef<HTMLDivElement>(null);

    // The dropdown is centred under the avatar, but shifted left as far as it
    // needs to be so it doesn't run off the right edge of the screen.
    useLayoutEffect(() => {
        if (!isOpen) return;
        const place = () => {
            const wrapper = dropdownRef.current;
            const menu = menuRef.current;
            if (!wrapper || !menu) return;
            const {left, width} = wrapper.getBoundingClientRect();
            const overflow = left + width / 2 + menu.offsetWidth / 2
                - (document.documentElement.clientWidth - DROPDOWN_EDGE_GAP);
            menu.style.setProperty('--user-dropdown-shift', `${Math.min(0, -overflow)}px`);
        };
        place();
        window.addEventListener('resize', place);
        return () => window.removeEventListener('resize', place);
    }, [isOpen]);

    useEffect(() => {
        if (!isOpen) return;
        const handleClickOutside = (event: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [isOpen]);

    if (!authReady) return null;

    const closeDropdown = () => setIsOpen(false);

    const handleMouseEnter = () => {
        if (window.matchMedia('(hover: hover)').matches) {
            setIsOpen(true);
        }
    };

    const handleMouseLeave = () => {
        if (window.matchMedia('(hover: hover)').matches) {
            setIsOpen(false);
        }
    };

    if (user) {
        return (
            <div
                className={`user-dropdown-wrapper ${isOpen ? 'active' : ''}`}
                ref={dropdownRef}
                onMouseEnter={handleMouseEnter}
                onMouseLeave={handleMouseLeave}
            >
                <img
                    src={(profile ? profile.photoURL : cachedPhotoURL) || '/mika.webp'}
                    alt={isEnglish ? 'Profile' : '个人主页'}
                    className="login-avatar"
                    referrerPolicy="no-referrer"
                    onClick={() => setIsOpen(!isOpen)}
                />
                <div className="user-dropdown" ref={menuRef}>
                    <div className="user-dropdown-header">
                        <span className="user-dropdown-name">{profile?.displayName}</span>
                        <span className="user-dropdown-email">{profile?.email}</span>
                    </div>
                    <div className="user-dropdown-divider"/>
                    <Link to="/" className="user-dropdown-item" onClick={closeDropdown}>
                        {isEnglish ? 'Home' : '首页'}
                    </Link>
                    <Link to="/profile" className="user-dropdown-item" onClick={closeDropdown}>
                        {isEnglish ? 'My Profile' : '我的主页'}
                    </Link>
                    <button
                        className="user-dropdown-item"
                        onClick={() => {
                            closeDropdown();
                            openRedeemModal();
                        }}
                    >
                        {isEnglish ? 'Redeem Code' : '兑换激活码'}
                    </button>
                    {profile && (hasPermission(profile.group, 'staff') || profile.eventStaffEvents.length > 0) && (
                        <Link to="/admin" className="user-dropdown-item" onClick={closeDropdown}>
                            {isEnglish ? 'Admin Panel' : '管理面板'}
                        </Link>
                    )}
                    <div className="user-dropdown-divider"/>
                    <button className="user-dropdown-item user-dropdown-signout" onClick={() => {
                        closeDropdown();
                        void signOut();
                    }}>
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
