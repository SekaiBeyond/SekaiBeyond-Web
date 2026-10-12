import { Fragment } from "react";
import { Link } from "react-router";
import { FOOTER_LINKS, type NavLink, resolveNavHref } from "~/components/main/navLinks";
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

    // The email and GitHub links go wherever site config says, and are hidden
    // while it says nowhere.
    const hrefFor = (link: NavLink): string => {
        if (link.id === 'email') return config.contactEmail && `mailto:${config.contactEmail}`;
        if (link.id === 'github') return config.socialLinks.github;
        return resolveNavHref(link, conPublished);
    };

    const labelFor = (link: NavLink) =>
        link.id === 'upcoming' && singleUpcoming && isEnglish
            ? 'Upcoming Event'
            : (isEnglish ? link.labelEn : link.labelCn);

    return (
        <footer>
            <div className="footer-logo">{isEnglish ? "SEKAI BEYOND" : "彼世界动漫社"}</div>
            <div className="footer-links">
                {FOOTER_LINKS.map((link: NavLink) => {
                    const href = hrefFor(link);
                    if (!href || (link.id === 'upcoming' && !hasActive)) return null;
                    return (
                        <Fragment key={link.id}>
                            {href.startsWith("#") ? (
                                <a href={href} className="footer-link" onClick={(e) => {
                                    e.preventDefault();
                                    document.querySelector(href)?.scrollIntoView({behavior: "smooth"});
                                }}>
                                    {labelFor(link)}
                                </a>
                            ) : href.startsWith("/") ? (
                                <Link to={href} className="footer-link">
                                    {labelFor(link)}
                                </Link>
                            ) : (
                                <a href={href} className="footer-link" target="_blank"
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
                    );
                })}
            </div>
            <p className="footer-text">
                © {new Date().getFullYear()} {isEnglish ? "Sekai Beyond" : "彼世界动漫社"}<br/>
                {isEnglish ? "A Registered Student Organization at University of Washington" : "华盛顿大学注册学生组织"}
            </p>
        </footer>
    )
}