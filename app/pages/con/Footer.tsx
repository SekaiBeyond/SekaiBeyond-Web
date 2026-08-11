import { Link } from 'react-router';
import { SiBilibili, SiDiscord, SiInstagram, SiXiaohongshu } from 'react-icons/si';
import { LINKS } from '~/constants';
import { CON, NAV_LINKS } from '~/pages/con/content';
import { useT } from '~/pages/con/i18n';
import { scrollToSection } from '~/pages/con/utils';

const SOCIALS = [
    {id: 'discord', label: 'Discord', href: LINKS.discord, Icon: SiDiscord},
    {id: 'instagram', label: 'Instagram', href: LINKS.instagram, Icon: SiInstagram},
    {id: 'bilibili', label: 'Bilibili', href: LINKS.bilibili, Icon: SiBilibili},
    {id: 'xiaohongshu', label: 'Xiaohongshu', href: LINKS.xiaohongshu, Icon: SiXiaohongshu},
];

export const Footer = () => {
    const t = useT();

    return (
        <footer className="sbc-footer">
            <div className="sbc-footer-inner">
                <div className="sbc-footer-brand">
                    <span className="sbc-footer-logo">{t(CON.name)}</span>
                    <p className="sbc-footer-org">
                        {t({
                            en: 'Hosted by Sekai Beyond, a registered student organization at the University of Washington.',
                            zh: '由华盛顿大学注册学生社团 Sekai Beyond 主办。',
                        })}
                    </p>
                    <div className="sbc-footer-socials">
                        {SOCIALS.map(({id, label, href, Icon}) => (
                            <a
                                key={id}
                                className="sbc-footer-social"
                                href={href}
                                target="_blank"
                                rel="noopener noreferrer"
                                aria-label={label}
                            >
                                <Icon/>
                            </a>
                        ))}
                    </div>
                </div>

                <nav className="sbc-footer-nav" aria-label={t({en: 'Footer', zh: '页脚导航'})}>
                    {NAV_LINKS.map(link => (
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
                    <a className="sbc-footer-link" href={LINKS.email}>
                        {t({en: 'Contact', zh: '联系我们'})}
                    </a>
                </nav>
            </div>

            <p className="sbc-footer-text">
                © {new Date().getFullYear()} Sekai Beyond ·{' '}
                {t({en: 'Made by students, for students.', zh: '由学生打造，为学生而生。'})}
            </p>
        </footer>
    );
};
