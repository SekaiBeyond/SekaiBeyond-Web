import { Link } from 'react-router';
import { LuArrowUpRight, LuMapPin, LuSquareParking } from 'react-icons/lu';
import { useConVenue } from '~/lib/conContent';
import { VENUE_TBA } from '~/pages/con/content';
import { useT } from '~/pages/con/i18n';

/**
 * The "Getting there" block at the foot of the About card. It keeps the `venue`
 * id the standalone section had, so links to /con#venue still land on it.
 */
export const Venue = () => {
    const t = useT();
    const venue = useConVenue();

    return (
        <div id="venue" className="sbc-about-venue">
            <h3 className="sbc-about-venue-title">{t({en: 'Getting there', zh: '如何前往'})}</h3>
            <p className="sbc-about-venue-subtitle">
                {t({
                    en: 'On the University of Washington Seattle campus, a short walk from light rail.',
                    zh: '位于华盛顿大学西雅图校区，距轻轨站仅数分钟步行。',
                })}
            </p>

            <div className="sbc-venue-address-card">
                <span className="sbc-venue-pin" aria-hidden="true"><LuMapPin/></span>
                <h4 className="sbc-venue-name">{t(venue?.name ?? VENUE_TBA)}</h4>
                {venue && (
                    <div className="sbc-venue-actions">
                        {venue.mapUrl && (
                            <a
                                className="btn btn-secondary"
                                href={venue.mapUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                            >
                                <span>{t({en: 'Open in Maps', zh: '在地图中打开'})}</span>
                                <LuArrowUpRight aria-hidden="true"/>
                            </a>
                        )}
                        <Link className="btn sbc-btn-ghost" to={venue.parkingUrl}>
                            <span>{t({en: 'Parking Guide', zh: '停车指南'})}</span>
                            <LuSquareParking aria-hidden="true"/>
                        </Link>
                    </div>
                )}
            </div>
        </div>
    );
};
