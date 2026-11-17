import { Link } from 'react-router';
import { useConContent } from '~/lib/conContent';
import { useSiteConfig } from '~/lib/siteConfig';
import { useT } from '~/pages/convention/i18n';
import { SectionHeader } from '~/pages/convention/SectionHeader';

const POLICY_WORD = {en: 'Policy', zh: '政策'};

const linkPolicy = (text: string, word: string) =>
    text.split(word).flatMap((part, i) => i === 0 ? [part] : [
        <Link key={i} className="sbc-faq-policy-link" to="/policy">{word}</Link>,
        part,
    ]);

export const Faq = () => {
    const t = useT();
    const {content} = useConContent();
    const {config} = useSiteConfig();

    return (
        <section id="faq" className="sbc-section">
            <SectionHeader title={{en: 'FAQ', zh: '常见问题'}}/>

            <div className="sbc-faq-list">
                {content.faq.map((entry, i) => (
                    <details key={i} className="sbc-faq-item">
                        <summary className="sbc-faq-question">
                            <span>{t(entry.q)}</span>
                            <span className="sbc-faq-marker" aria-hidden="true">+</span>
                        </summary>
                        <p className="sbc-faq-answer">{linkPolicy(t(entry.a), t(POLICY_WORD))}</p>
                    </details>
                ))}
            </div>

            {(config.contactEmail || config.socialLinks.discord) && (
                <div className="sbc-callout">
                    <div>
                        <h3 className="sbc-callout-title">
                            {t({en: 'Something else on your mind?', zh: '还有其他问题？'})}
                        </h3>
                        <p className="sbc-callout-body">
                            {t({
                                en: 'Reach us by email or drop into the Discord — we answer both. For harassment or safety concerns, see ',
                                zh: '可以发邮件或加入我们的 Discord——两边都有人回复。如遇骚扰或安全问题，请查看',
                            })}
                            <Link className="sbc-faq-policy-link" to="/support">
                                {t({en: 'Harassment & Safety Support', zh: '反骚扰与安全求助'})}
                            </Link>
                            {t({en: '.', zh: '。'})}
                        </p>
                    </div>
                    <div className="sbc-callout-actions">
                        {config.contactEmail && (
                            <a className="btn btn-secondary" href={`mailto:${config.contactEmail}`}>
                                <span>{t({en: 'Email us', zh: '发邮件'})}</span>
                            </a>
                        )}
                        {config.socialLinks.discord && (
                            <a
                                className="btn btn-secondary"
                                href={config.socialLinks.discord}
                                target="_blank"
                                rel="noopener noreferrer"
                            >
                                <span>Discord</span>
                            </a>
                        )}
                    </div>
                </div>
            )}
        </section>
    );
};
