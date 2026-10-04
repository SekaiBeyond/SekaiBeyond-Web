import { ABOUT_PARAGRAPHS, HIGHLIGHTS } from '~/pages/con/content';
import { useT } from '~/pages/con/i18n';
import { SectionHeader } from '~/pages/con/SectionHeader';

export const About = () => {
    const t = useT();

    return (
        <section id="about" className="sbc-section">
            <SectionHeader
                title={{en: 'About the con', zh: '关于漫展'}}
                subtitle={{
                    en: 'Student-run, open to everyone, and shaped by whoever shows up to help.',
                    zh: '学生自办，向所有人开放，由每一位参与者共同塑造。',
                }}
            />

            <div className="sbc-about-text">
                {ABOUT_PARAGRAPHS.map((paragraph, i) => (
                    <p key={i}>{t(paragraph)}</p>
                ))}
            </div>

            <div className="sbc-highlight-grid">
                {HIGHLIGHTS.map(highlight => (
                    <article key={highlight.label.en} className="sbc-highlight">
                        <h3 className="sbc-highlight-label">
                            <span className="sbc-highlight-icon" aria-hidden="true">{highlight.icon}</span>
                            {t(highlight.label)}
                        </h3>
                        <p className="sbc-highlight-blurb">{t(highlight.blurb)}</p>
                    </article>
                ))}
            </div>
        </section>
    );
};
