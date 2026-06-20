import { Fragment } from "react";
import { FOOTER_LINKS, type NavLink } from "~/constants";
import { useLanguage } from "~/components/LanguageContextProvider";
import { useUpcomingEvents } from "~/lib/upcomingEvents";

export const Footer = () => {
    const {isEnglish} = useLanguage();
    const {hasActive, activeEvents} = useUpcomingEvents();
    const singleUpcoming = activeEvents.length === 1;

    const labelFor = (link: NavLink) =>
        link.id === 'upcoming' && singleUpcoming && isEnglish
            ? 'Upcoming Event'
            : (isEnglish ? link.labelEn : link.labelCn);

    return (
        <footer>
            <div className="footer-logo">{isEnglish ? "SEKAI BEYOND" : "彼世界动漫社"}</div>
            <div className="footer-links">
                {FOOTER_LINKS.map((link: NavLink) => link.disabled || (link.id === 'upcoming' && !hasActive) ? null : (
                    <Fragment key={link.id}>
                        {link.href.startsWith("#") ? (
                            <a href={link.href} className="footer-link" onClick={(e) => {
                                e.preventDefault();
                                document.querySelector(link.href)?.scrollIntoView({behavior: "smooth"});
                            }}>
                                {labelFor(link)}
                            </a>
                        ) : link.href.startsWith("/") ? (
                            <a href={link.href} className="footer-link">
                                {labelFor(link)}
                            </a>
                        ) : (
                            <a href={link.href} className="footer-link" target="_blank"
                               rel="noopener noreferrer">
                                {labelFor(link)}
                            </a>
                        )}
                        {link.id === 'huskylink' && hasActive && (
                            <a href={`/parking/${activeEvents[0].id}`} className="footer-link">
                                {isEnglish ? 'Parking Guide' : '停车指南'}
                            </a>
                        )}
                    </Fragment>
                ))}
            </div>
            <p className="footer-text">
                © {new Date().getFullYear()} {isEnglish ? "Sekai Beyond" : "彼世界动漫社"}<br/>
                {isEnglish ? "A Registered Student Organization at University of Washington" : "华盛顿大学注册学生组织"}
            </p>
        </footer>
    )
}