import { type MouseEvent, useState } from "react";
import { FaBars, FaTimes } from "react-icons/fa";
import { LanguageSwitcher } from "~/components/LanguageSwitcher";
import { LoginButton } from "~/components/LoginButton";
import { useLanguage } from "~/components/LanguageContextProvider";
import { NAVIGATION_LINKS, type NavLink } from "~/constants";
import { useUpcomingEvents } from "~/lib/upcomingEvents";

export const Navigation = () => {
    const {isEnglish} = useLanguage();
    const {hasActive} = useUpcomingEvents();
    const [mobileOpen, setMobileOpen] = useState(false);

    const handleNavClick = (e: MouseEvent, href: string) => {
        e.preventDefault();
        setMobileOpen(false);
        document.querySelector(href)?.scrollIntoView({behavior: "smooth"});
    };

    return (
        <nav className="navbar">
            <div className="nav-container">
                <a href="#home" className="logo" onClick={(e) => handleNavClick(e, "#home")}>
                    {isEnglish ? "SEKAI BEYOND" : "彼世界动漫社"}
                </a>
                <ul className={`nav-links${mobileOpen ? ' active' : ''}`}>
                    {NAVIGATION_LINKS.map((link: NavLink) =>
                        link.disabled || (link.id === 'upcoming' && !hasActive) ? null : (
                            <li key={link.id}>
                                <a href={link.href} className="nav-link"
                                   onClick={(e) => handleNavClick(e, link.href)}>
                                    {isEnglish ? link.labelEn : link.labelCn}
                                </a>
                            </li>
                        )
                    )}
                </ul>
                <div className="nav-actions">
                    <LanguageSwitcher/>
                    <LoginButton/>
                    <button
                        type="button"
                        className="nav-toggle"
                        onClick={() => setMobileOpen(v => !v)}
                        aria-label={mobileOpen
                            ? (isEnglish ? "Close menu" : "关闭菜单")
                            : (isEnglish ? "Open menu" : "打开菜单")}
                        aria-expanded={mobileOpen}
                    >
                        {mobileOpen ? <FaTimes/> : <FaBars/>}
                    </button>
                </div>
            </div>
        </nav>
    )
}
