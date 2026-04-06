import React, { useMemo } from "react";
import { LanguageSwitcher } from "~/components/LanguageSwitcher";
import { LoginButton } from "~/components/LoginButton";
import { useLanguage } from "~/components/LanguageContextProvider";
import { NAVIGATION_LINKS, type NavLink } from "~/constants";
import { useUpcomingEvents } from "~/lib/upcomingEvents";


export const Navigation = () => {
    const {isEnglish} = useLanguage();
    const {upcomingEvents} = useUpcomingEvents();
    const hasUpcoming = useMemo(() => upcomingEvents.some(e => e.endAt > new Date()), [upcomingEvents]);

    return (
        <nav className="navbar">
            <div className="nav-container">
                <a href="#home" className="logo" onClick={(e) => {
                    e.preventDefault();
                    document.getElementById("home")?.scrollIntoView({behavior: "smooth"});
                }}>{isEnglish ? "SEKAI BEYOND" : "彼世界动漫社"}</a>
                <ul className="nav-links">
                    {NAVIGATION_LINKS.map((link: NavLink) => link.disabled || (link.id === 'upcoming' && !hasUpcoming) ? null : (
                        <li key={link.id}>
                            <a href={link.href} className="nav-link" onClick={(e) => {
                                e.preventDefault();
                                document.querySelector(link.href)?.scrollIntoView({behavior: "smooth"});
                            }}>
                                {isEnglish ? link.labelEn : link.labelCn}
                            </a>
                        </li>
                    ))}
                </ul>
                <div className="nav-actions">
                    <LanguageSwitcher/>
                    <LoginButton/>
                </div>
            </div>
        </nav>
    )
}