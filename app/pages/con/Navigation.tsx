import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { FiArrowLeft, FiMenu, FiX } from 'react-icons/fi';
import { LanguageSwitcher } from '~/components/LanguageSwitcher';
import { CON, NAV_LINKS } from '~/pages/con/content';
import { useT } from '~/pages/con/i18n';
import { useActiveSection, useScrolledPast } from '~/pages/con/hooks';
import { scrollToSection } from '~/pages/con/utils';

export const Navigation = () => {
    const t = useT();
    const [menuOpen, setMenuOpen] = useState(false);

    const solid = useScrolledPast(80);
    const sectionIds = useMemo(() => NAV_LINKS.map(link => link.id), []);
    const activeSection = useActiveSection(sectionIds);

    // Keep the page from scrolling behind the full-screen mobile menu.
    useEffect(() => {
        document.body.style.overflow = menuOpen ? 'hidden' : '';
        return () => {
            document.body.style.overflow = '';
        };
    }, [menuOpen]);

    useEffect(() => {
        if (!menuOpen) return;
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') setMenuOpen(false);
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [menuOpen]);

    // The open mobile drawer is white, so the bar has to leave its transparent
    // hero styling behind at the same time or the logo turns white-on-white.
    const opaque = solid || menuOpen;

    return (
        <nav className={`sbc-navbar${opaque ? ' sbc-navbar--solid' : ''}`}>
            <div className="sbc-nav-container">
                <div className="sbc-nav-brand">
                    <Link className="sbc-nav-back" to="/"
                          aria-label={t({en: 'Back to Sekai Beyond', zh: '返回彼世界主站'})}>
                        <FiArrowLeft/>
                        <span>Sekai Beyond</span>
                    </Link>
                    <a
                        className="sbc-logo"
                        href="#con-home"
                        onClick={scrollToSection('con-home', () => setMenuOpen(false))}
                    >
                        <span className="sbc-logo-mark" aria-hidden="true">✦</span>
                        <span className="sbc-logo-text">{t(CON.name)}</span>
                    </a>
                </div>

                <ul className={`sbc-nav-links${menuOpen ? ' sbc-nav-links--open' : ''}`}>
                    {NAV_LINKS.map(link => (
                        <li key={link.id}>
                            <a
                                className={`sbc-nav-link${activeSection === link.id ? ' sbc-nav-link--active' : ''}`}
                                href={`#${link.id}`}
                                onClick={scrollToSection(link.id, () => setMenuOpen(false))}
                            >
                                {t(link.label)}
                            </a>
                        </li>
                    ))}
                    <li className="sbc-nav-links-cta">
                        <a
                            className="btn btn-primary sbc-btn-compact"
                            href={CON.ticketUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                        >
                            {t({en: 'Tickets', zh: '门票'})}
                        </a>
                    </li>
                    <li className="sbc-nav-links-home">
                        <Link className="sbc-nav-link" to="/" onClick={() => setMenuOpen(false)}>
                            ← {t({en: 'Sekai Beyond home', zh: '返回彼世界主站'})}
                        </Link>
                    </li>
                </ul>

                <div className="sbc-nav-actions">
                    <div className="sbc-lang-slot">
                        <LanguageSwitcher/>
                    </div>
                    <a
                        className="btn btn-primary sbc-btn-compact sbc-nav-ticket-btn"
                        href={CON.ticketUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                    >
                        {t({en: 'Tickets', zh: '门票'})}
                    </a>
                    <button
                        type="button"
                        className="sbc-nav-toggle"
                        onClick={() => setMenuOpen(open => !open)}
                        aria-expanded={menuOpen}
                        aria-label={
                            menuOpen
                                ? t({en: 'Close menu', zh: '关闭菜单'})
                                : t({en: 'Open menu', zh: '打开菜单'})
                        }
                    >
                        {menuOpen ? <FiX/> : <FiMenu/>}
                    </button>
                </div>
            </div>
        </nav>
    );
};
