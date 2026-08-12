import { useLanguage } from '~/components/LanguageContextProvider';
import { useConContent } from '~/lib/conContent';
import { ABOUT_PARAGRAPHS, HIGHLIGHTS } from '~/pages/con/content';
import { useT } from '~/pages/con/i18n';
import { formatEventDate, formatTimeRange } from '~/pages/con/utils';
import { SectionHeader } from '~/pages/con/SectionHeader';

export const About = () => {
    const t = useT();
    const {currentLanguage} = useLanguage();
    const {event} = useConContent().content;

    const facts = [
        {
            icon: '📅',
            label: {en: 'When', zh: '时间'},
            value: `${formatEventDate(event.date, currentLanguage)} · ${formatTimeRange(event.date, event.endTime, currentLanguage)}`,
        },
        {
            icon: '📍',
            label: {en: 'Where', zh: '地点'},
            value: `${t(event.venue.room)}, ${t(event.venue.name)}`,
        },
        {
            icon: '🎟️',
            label: {en: 'Admission', zh: '入场'},
            value: t({
                en: 'Free for UW students · $10 general',
                zh: 'UW 在校生免费 · 普通票 $10',
            }),
        },
        {
            icon: '💬',
            label: {en: 'Languages', zh: '语言'},
            value: t({en: 'English & 中文', zh: '中文与英文'}),
        },
    ];

    return (
        <section id="about" className="sbc-section">
            <SectionHeader
                eyebrow={{en: 'About the con', zh: '关于漫展'}}
                title={{en: 'A day built by the community', zh: '由社区共同搭建的一天'}}
                subtitle={{
                    en: 'Student-run, open to everyone, and shaped by whoever shows up to help.',
                    zh: '学生自办，向所有人开放，由每一位参与者共同塑造。',
                }}
            />

            <div className="sbc-about-card">
                <div className="sbc-about-grid">
                    <div className="sbc-about-text">
                        {ABOUT_PARAGRAPHS.map((paragraph, i) => (
                            <p key={i}>{t(paragraph)}</p>
                        ))}
                    </div>

                    <aside className="sbc-facts-card">
                        <h3 className="sbc-facts-title">
                            {t({en: 'Quick facts', zh: '速览'})}
                        </h3>
                        <dl className="sbc-facts-list">
                            {facts.map(fact => (
                                <div key={fact.label.en} className="sbc-fact-row">
                                    <dt>
                                        <span className="sbc-fact-icon" aria-hidden="true">{fact.icon}</span>
                                        {t(fact.label)}
                                    </dt>
                                    <dd>{fact.value}</dd>
                                </div>
                            ))}
                        </dl>
                    </aside>
                </div>

                <div className="sbc-highlight-grid">
                    {HIGHLIGHTS.map(highlight => (
                        <article key={highlight.label.en} className="sbc-highlight-card">
                            <span className="sbc-highlight-icon" aria-hidden="true">{highlight.icon}</span>
                            <h3 className="sbc-highlight-label">{t(highlight.label)}</h3>
                            <p className="sbc-highlight-blurb">{t(highlight.blurb)}</p>
                        </article>
                    ))}
                </div>
            </div>
        </section>
    );
};
