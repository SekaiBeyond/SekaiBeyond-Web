import { GUESTS } from '~/pages/con/content';
import { useT } from '~/pages/con/i18n';
import { SectionHeader } from '~/pages/con/SectionHeader';

export const Guests = () => {
    const t = useT();

    return (
        <section id="guests" className="sbc-section">
            <SectionHeader
                eyebrow={{en: 'Line-up', zh: '阵容'}}
                title={{en: 'Guests & Performers', zh: '嘉宾与演出者'}}
                subtitle={{
                    en: 'Illustrators, cosplayers, and performers joining us on the day.',
                    zh: '当天与我们同行的绘师、Coser 与表演者。',
                }}
            />

            <div className="sbc-guest-grid">
                {GUESTS.map(guest => (
                    <article key={guest.name} className="sbc-guest-card">
                        {guest.avatar ? (
                            <img className="sbc-guest-avatar" src={guest.avatar} alt={guest.name} loading="lazy"/>
                        ) : (
                            <div className="sbc-guest-avatar sbc-guest-avatar--placeholder" aria-hidden="true">
                                {guest.name.slice(0, 1)}
                            </div>
                        )}

                        <h3 className="sbc-guest-name">{guest.name}</h3>
                        <p className="sbc-guest-role">{t(guest.role)}</p>
                        <p className="sbc-guest-blurb">{t(guest.blurb)}</p>

                        {guest.link && (
                            <a
                                className="sbc-guest-link"
                                href={guest.link}
                                target="_blank"
                                rel="noopener noreferrer"
                            >
                                {t({en: 'See their work', zh: '查看作品'})}
                                <span aria-hidden="true"> →</span>
                            </a>
                        )}
                    </article>
                ))}
            </div>
        </section>
    );
};
