import { Link } from 'react-router';
import { LINKS } from '~/constants';
import { useConContent } from '~/lib/conContent';
import { useSiteConfig } from '~/lib/siteConfig';
import { useT } from '~/pages/con/i18n';
import { SectionHeader } from '~/pages/con/SectionHeader';

const POLICY_WORD = {en: 'Policy', zh: '政策'};

/**
 * Links each mention of the Policy page in an answer, so the plain text written
 * in the admin panel can point there. Case-sensitive: a lowercase "policy" in
 * passing stays plain.
 */
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
                {/* Keyed by position: two entries may share an English question,
                    and a collision would cross-link their open/closed state. */}
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

            <div className="sbc-callout">
                <div>
                    <h3 className="sbc-callout-title">
                        {t({en: 'Something else on your mind?', zh: '还有其他问题？'})}
                    </h3>
                    <p className="sbc-callout-body">
                        {t({
                            en: 'Reach us by email or drop into the Discord — we answer both.',
                            zh: '可以发邮件或加入我们的 Discord——两边都有人回复。',
                        })}
                    </p>
                </div>
                <div className="sbc-callout-actions">
                    {config.contactEmail && (
                        <a className="btn btn-secondary" href={`mailto:${config.contactEmail}`}>
                            <span>{t({en: 'Email us', zh: '发邮件'})}</span>
                        </a>
                    )}
                    <a
                        className="btn btn-secondary"
                        href={LINKS.discord}
                        target="_blank"
                        rel="noopener noreferrer"
                    >
                        <span>Discord</span>
                    </a>
                </div>
            </div>
        </section>
    );
};
