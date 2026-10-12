import { SiBilibili, SiDiscord, SiInstagram, SiXiaohongshu } from "react-icons/si";
import { FaLinkedin } from "react-icons/fa";
import { useLanguage } from "~/components/LanguageContextProvider";
import { SOCIAL_LINK_NAMES, type SocialLinks, useSiteConfig } from "~/lib/siteConfig";

const SOCIALS = [
    {key: 'discord', Icon: SiDiscord},
    {key: 'instagram', Icon: SiInstagram},
    {key: 'bilibili', Icon: SiBilibili},
    {key: 'xiaohongshu', Icon: SiXiaohongshu},
    {key: 'linkedin', Icon: FaLinkedin},
] as const;

/** Whether this section has a link to show, so the nav can drop "Follow Us" when it doesn't. */
export const hasFollowLinks = (links: SocialLinks): boolean => SOCIALS.some(({key}) => links[key]);

export const Contact = () => {
    const {isEnglish} = useLanguage();
    const {config, loading} = useSiteConfig();

    if (!loading && !hasFollowLinks(config.socialLinks)) {
        return null;
    }

    return (<section id="contact" className="contact-section section">
        <div className="section-header">
            <h2 className="section-title">{isEnglish ? "Follow Us" : "关注我们"}</h2>
            <p className="section-subtitle">
                {isEnglish ? "Follow us on social media for the latest updates and announcements!" : "关注我们的社交媒体，获取最新动态和公告！"}
            </p>
        </div>
        <div className="contact-inner">
            <div className="social-links-grid">
                {SOCIALS.filter(({key}) => config.socialLinks[key]).map(({key, Icon}) => (
                    <a key={key} className="social-card" href={config.socialLinks[key]} target="_blank"
                       rel="noopener noreferrer">
                        <Icon className="social-icon"/>
                        <div className="social-name">
                            {isEnglish ? SOCIAL_LINK_NAMES[key].en : SOCIAL_LINK_NAMES[key].zh}
                        </div>
                    </a>
                ))}
            </div>
        </div>
    </section>)
}
