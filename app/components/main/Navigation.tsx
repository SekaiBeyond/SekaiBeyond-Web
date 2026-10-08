import { type MouseEvent, useState } from "react";
import { Link } from "react-router";
import { FaBars, FaTimes } from "react-icons/fa";
import { LanguageSwitcher } from "~/components/LanguageSwitcher";
import { LoginButton } from "~/components/LoginButton";
import { useLanguage } from "~/components/LanguageContextProvider";
import { NAVIGATION_LINKS, type NavLink, resolveNavHref } from "~/constants";
import { useConContent } from "~/lib/conContent";
import { useUpcomingEvents } from "~/lib/upcomingEvents";

export const Navigation = () => {
    const {isEnglish} = useLanguage();
    const {hasActive, activeEvents} = useUpcomingEvents();
    const {content: conContent} = useConContent();
    const conPublished = conContent.settings.published;
    const [mobileOpen, setMobileOpen] = useState(false);
    const singleUpcoming = activeEvents.length === 1;

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
                    {NAVIGATION_LINKS.map((link: NavLink) => {
                        if (link.disabled || (link.id === 'upcoming' && !hasActive)) return null;
                        const href = resolveNavHref(link, conPublished);
                        const label = link.id === 'upcoming' && singleUpcoming && isEnglish
                            ? 'Upcoming Event'
                            : (isEnglish ? link.labelEn : link.labelCn);
                        return (
                            <li key={link.id}>
                                {href.startsWith("/") ? (
                                    <Link to={href} className="nav-link" onClick={() => setMobileOpen(false)}>
                                        {label}
                                    </Link>
                                ) : (
                                    <a href={href} className="nav-link"
                                       onClick={(e) => handleNavClick(e, href)}>
                                        {label}
                                    </a>
                                )}
                            </li>
                        );
                    })}
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
