import { LINKS } from '~/constants';
import { useConContent } from '~/lib/conContent';
import { useT } from '~/pages/con/i18n';
import { SectionHeader } from '~/pages/con/SectionHeader';

export const Faq = () => {
    const t = useT();
    const {content} = useConContent();

    return (
        <section id="faq" className="sbc-section">
            <SectionHeader
                eyebrow={{en: 'Good to know', zh: '出行须知'}}
                title={{en: 'FAQ', zh: '常见问题'}}
                subtitle={{
                    en: 'Still stuck? Email us and a real person will answer.',
                    zh: '还有疑问？发邮件给我们，会有真人回复。',
                }}
            />

            <div className="sbc-faq-list">
                {/* Keyed by position: two entries may share an English question,
                    and a collision would cross-link their open/closed state. */}
                {content.faq.map((entry, i) => (
                    <details key={i} className="sbc-faq-item">
                        <summary className="sbc-faq-question">
                            <span>{t(entry.q)}</span>
                            <span className="sbc-faq-marker" aria-hidden="true">+</span>
                        </summary>
                        <p className="sbc-faq-answer">{t(entry.a)}</p>
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
                    <a className="btn btn-secondary" href={LINKS.email}>
                        <span>{t({en: 'Email us', zh: '发邮件'})}</span>
                    </a>
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
