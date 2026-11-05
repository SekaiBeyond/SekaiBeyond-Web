import { useLanguage } from '~/components/LanguageContextProvider';
import { LanguageSwitcher } from '~/components/LanguageSwitcher';
import { LoginButton } from '~/components/LoginButton';

/**
 * The bar across the top of the pages off the landing page: a link home, the
 * page's title if it has one, the account menu unless `account` is off, and the
 * language switch.
 */
export const PageNav = ({title, account = true}: {title?: string; account?: boolean}) => {
    const {isEnglish} = useLanguage();
    return (
        <nav className="profile-nav">
            <a href="/" className="profile-nav-home">
                {isEnglish ? 'SEKAI BEYOND' : '彼世界动漫社'}
            </a>
            {title && <span className="admin-nav-title">{title}</span>}
            <div className="nav-actions">
                {account && <LoginButton/>}
                <LanguageSwitcher/>
            </div>
        </nav>
    );
};
