import { useLanguage } from '~/components/LanguageContextProvider';
import { useConContent } from '~/lib/conContent';
import { useNowAcross } from '~/pages/con/hooks';
import { useT } from '~/pages/con/i18n';
import { SectionHeader } from '~/pages/con/SectionHeader';
import { activeEarlyBird, formatDeadline, formatPrice } from '~/pages/con/utils';

export const Tickets = () => {
    const t = useT();
    const {currentLanguage} = useLanguage();
    const {content} = useConContent();
    const now = useNowAcross(content.tickets.flatMap(tier => tier.earlyBird ? [tier.earlyBird.endsAt] : []));

    return (
        <section id="tickets" className="sbc-section">
            <SectionHeader
                eyebrow={{en: 'Admission', zh: '入场'}}
                title={{en: 'Tickets', zh: '门票'}}
                subtitle={{
                    en: 'Every tier gets you the full day. Supporter tickets are what pay for the stage.',
                    zh: '所有票种均可全天入场。支持者票的收入用于支撑舞台开销。',
                }}
            />

            <div className="sbc-ticket-grid">
                {/* Keyed by position, not by content or id: tier ids are generated
                    and perk text is free-form, so neither is guaranteed unique. */}
                {content.tickets.map((tier, i) => {
                    const earlyBird = activeEarlyBird(tier, now);

                    return (
                        <article
                            key={i}
                            className={`sbc-ticket-card${tier.featured ? ' sbc-ticket-card--featured' : ''}`}
                        >
                            {tier.featured && (
                                <span className="sbc-ticket-flag">
                                    {t({en: 'Most popular', zh: '最受欢迎'})}
                                </span>
                            )}

                            <h3 className="sbc-ticket-name">{t(tier.name)}</h3>

                            {earlyBird ? (
                                <>
                                    <span className="sbc-ticket-earlybird-tag">
                                        {t({en: 'Early bird', zh: '早鸟价'})}
                                    </span>
                                    <p className="sbc-ticket-price">{formatPrice(earlyBird.price, currentLanguage)}</p>
                                    <p className="sbc-ticket-earlybird">
                                        {t({en: 'Ends', zh: '截止于'})}{' '}
                                        <time
                                            dateTime={earlyBird.endsAt}>{formatDeadline(earlyBird.endsAt, currentLanguage)}</time>
                                        {t({en: ' — then ', zh: '，之后为 '})}
                                        <strong>{formatPrice(tier.price, currentLanguage)}</strong>
                                    </p>
                                </>
                            ) : (
                                <p className="sbc-ticket-price">{formatPrice(tier.price, currentLanguage)}</p>
                            )}

                            <p className="sbc-ticket-note">{t(tier.note)}</p>

                            <ul className="sbc-ticket-perks">
                                {tier.perks.map((perk, perkIndex) => (
                                    <li key={perkIndex}>
                                        <span className="sbc-ticket-check" aria-hidden="true">✓</span>
                                        {t(perk)}
                                    </li>
                                ))}
                            </ul>

                            <a
                                className={`btn ${tier.featured ? 'btn-primary' : 'btn-secondary'} sbc-ticket-cta`}
                                href={content.event.ticketUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                            >
                                {t({en: 'Reserve', zh: '预订'})}
                            </a>
                        </article>
                    );
                })}
            </div>

            <p className="sbc-ticket-footnote">
                {t({
                    en: 'Tickets are per person and cover the whole day. Bring your Husky Card if you are claiming the student rate.',
                    zh: '门票按人计算，涵盖全天活动。如需享受学生票价，请携带 Husky Card。',
                })}
            </p>
        </section>
    );
};
