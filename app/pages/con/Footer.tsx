import { Link } from 'react-router';
import { SiBilibili, SiDiscord, SiInstagram, SiXiaohongshu } from 'react-icons/si';
import { CON_NAME, CON_NAV_LINKS } from '~/lib/conContent';
import { SOCIAL_LINK_NAMES, useSiteConfig } from '~/lib/siteConfig';
import { useT } from '~/pages/con/i18n';
import { scrollToSection } from '~/pages/con/utils';

const SOCIALS = [
    {key: 'discord', Icon: SiDiscord},
    {key: 'instagram', Icon: SiInstagram},
    {key: 'bilibili', Icon: SiBilibili},
    {key: 'xiaohongshu', Icon: SiXiaohongshu},
] as const;

export const Footer = () => {
    const t = useT();
    const {config} = useSiteConfig();

    return (
        <footer className="sbc-footer">
            <div className="sbc-footer-inner">
                <span className="sbc-footer-logo">{t(CON_NAME)}</span>
                <p className="sbc-footer-org">
                    {t({
                        en: 'Hosted by Sekai Beyond, a registered student organization at the University of Washington.',
                        zh: '由华盛顿大学注册学生社团 Sekai Beyond 主办。',
                    })}
                </p>

                <nav className="sbc-footer-nav" aria-label={t({en: 'Footer', zh: '页脚导航'})}>
                    {CON_NAV_LINKS.map(link => (
                        <a
                            key={link.id}
                            className="sbc-footer-link"
                            href={`#${link.id}`}
                            onClick={scrollToSection(link.id)}
                        >
                            {t(link.label)}
                        </a>
                    ))}
                    <Link className="sbc-footer-link" to="/">
                        {t({en: 'Sekai Beyond home', zh: '彼世界主站'})}
                    </Link>
                    <Link className="sbc-footer-link" to="/policy">
                        {t({en: 'Policy', zh: '政策'})}
                    </Link>
                    {config.contactEmail && (
                        <a className="sbc-footer-link" href={`mailto:${config.contactEmail}`}>
                            {t({en: 'Contact', zh: '联系我们'})}
                        </a>
                    )}
                </nav>

                <div className="sbc-footer-socials">
                    {SOCIALS.filter(({key}) => config.socialLinks[key]).map(({key, Icon}) => (
                        <a
                            key={key}
                            className="sbc-footer-social"
                            href={config.socialLinks[key]}
                            target="_blank"
                            rel="noopener noreferrer"
                            aria-label={t(SOCIAL_LINK_NAMES[key])}
                        >
                            <Icon/>
                        </a>
                    ))}
                </div>
            </div>

            <p className="sbc-footer-text">
                © {new Date().getFullYear()} Sekai Beyond ·{' '}
                {t({en: 'Made by students, for students.', zh: '由学生打造，为学生而生。'})}
            </p>
        </footer>
    );
};
