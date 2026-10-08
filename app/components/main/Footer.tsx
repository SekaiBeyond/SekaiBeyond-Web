import { Fragment } from "react";
import { Link } from "react-router";
import { FOOTER_LINKS, type NavLink, resolveNavHref } from "~/constants";
import { useLanguage } from "~/components/LanguageContextProvider";
import { useUpcomingEvents } from "~/lib/upcomingEvents";
import { useSiteConfig } from "~/lib/siteConfig";
import { useConContent } from "~/lib/conContent";

export const Footer = () => {
    const {isEnglish} = useLanguage();
    const {hasActive, activeEvents} = useUpcomingEvents();
    const singleUpcoming = activeEvents.length === 1;
    const {config} = useSiteConfig();
    const conPublished = useConContent().content.settings.published;

    const hrefFor = (link: NavLink) =>
        link.id === 'email' ? link.href + config.contactEmail : link.href;

    const labelFor = (link: NavLink) =>
        link.id === 'upcoming' && singleUpcoming && isEnglish
            ? 'Upcoming Event'
            : (isEnglish ? link.labelEn : link.labelCn);

    return (
        <footer>
            <div className="footer-logo">{isEnglish ? "SEKAI BEYOND" : "彼世界动漫社"}</div>
            <div className="footer-links">
                {FOOTER_LINKS.map((link: NavLink) => link.disabled || (link.id === 'upcoming' && !hasActive)
                || (link.id === 'email' && !config.contactEmail) ? null : (
                    <Fragment key={link.id}>
                        {resolveNavHref(link, conPublished).startsWith("#") ? (
                            <a href={link.href} className="footer-link" onClick={(e) => {
                                e.preventDefault();
                                document.querySelector(link.href)?.scrollIntoView({behavior: "smooth"});
                            }}>
                                {labelFor(link)}
                            </a>
                        ) : resolveNavHref(link, conPublished).startsWith("/") ? (
                            <Link to={resolveNavHref(link, conPublished)} className="footer-link">
                                {labelFor(link)}
                            </Link>
                        ) : (
                            <a href={hrefFor(link)} className="footer-link" target="_blank"
                               rel="noopener noreferrer">
                                {labelFor(link)}
                            </a>
                        )}
                        {link.id === 'team' && hasActive && (
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