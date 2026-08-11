import { CON, VENUE_NOTES } from '~/pages/con/content';
import { useT } from '~/pages/con/i18n';
import { SectionHeader } from '~/pages/con/SectionHeader';

export const Venue = () => {
    const t = useT();

    return (
        <section id="venue" className="sbc-section">
            <SectionHeader
                eyebrow={{en: 'Getting there', zh: '如何前往'}}
                title={{en: 'Venue', zh: '活动场地'}}
                subtitle={{
                    en: 'On the University of Washington Seattle campus, a short walk from light rail.',
                    zh: '位于华盛顿大学西雅图校区，距轻轨站仅数分钟步行。',
                }}
            />

            <div className="sbc-venue-layout">
                <div className="sbc-venue-address-card">
                    <span className="sbc-venue-pin" aria-hidden="true">📍</span>
                    <h3 className="sbc-venue-name">{t(CON.venue.name)}</h3>
                    <p className="sbc-venue-room">{t(CON.venue.room)}</p>
                    <address className="sbc-venue-address">{CON.venue.address}</address>
                    <p className="sbc-venue-doors">{t(CON.doorsOpen)}</p>
                    <a
                        className="btn btn-secondary"
                        href={CON.venue.mapUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                    >
                        <span>{t({en: 'Open in Maps', zh: '在地图中打开'})}</span>
                        <span aria-hidden="true">🗺️</span>
                    </a>
                </div>

                <div className="sbc-venue-notes">
                    {VENUE_NOTES.map(note => (
                        <article key={note.label.en} className="sbc-venue-note">
                            <span className="sbc-venue-note-icon" aria-hidden="true">{note.icon}</span>
                            <div>
                                <h4 className="sbc-venue-note-label">{t(note.label)}</h4>
                                <p className="sbc-venue-note-body">{t(note.body)}</p>
                            </div>
                        </article>
                    ))}
                </div>
            </div>
        </section>
    );
};
