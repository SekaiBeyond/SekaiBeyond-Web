import React, { useMemo } from "react";
import { FOOTER_LINKS, type NavLink } from "~/constants";
import { useLanguage } from "~/components/LanguageContextProvider";
import { useUpcomingEvents } from "~/lib/upcomingEvents";

export const Footer = () => {
    const {isEnglish} = useLanguage();
    const {upcomingEvents} = useUpcomingEvents();
    const hasUpcoming = useMemo(() => upcomingEvents.some(e => e.endAt > new Date()), [upcomingEvents]);

    return (
        <footer>
            <div className="footer-logo">{isEnglish ? "SEKAI BEYOND" : "彼世界动漫社"}</div>
            <div className="footer-links">
                {FOOTER_LINKS.map((link: NavLink) => link.disabled || (link.id === 'upcoming' && !hasUpcoming) ? null : (
                    link.href.startsWith("#") ? (
                        <a key={link.id} href={link.href} className="footer-link" onClick={(e) => {
                            e.preventDefault();
                            document.querySelector(link.href)?.scrollIntoView({behavior: "smooth"});
                        }}>
                            {isEnglish ? link.labelEn : link.labelCn}
                        </a>
                    ) : (
                        <a key={link.id} href={link.href} className="footer-link" target="_blank" rel="noopener noreferrer">
                            {isEnglish ? link.labelEn : link.labelCn}
                        </a>
                    )
                ))}
            </div>
            <p className="footer-text">
                © {new Date().getFullYear()} {isEnglish ? "Sekai Beyond" : "彼世界动漫社"}<br/>
                {isEnglish ? "A Registered Student Organization at University of Washington" : "华盛顿大学注册学生组织"}
            </p>
        </footer>
    )
}