import { useMemo } from 'react';
import { Link } from 'react-router';
import { LuArrowUpRight, LuCalendar, LuClock, LuMapPin, LuSquareParking } from 'react-icons/lu';
import { useLanguage } from '~/components/LanguageContextProvider';
import { CON_NAME, useConContent, useConListing, useConVenue } from '~/lib/conContent';
import { useT } from '~/pages/con/i18n';
import { useMediaQuery } from '~/pages/con/hooks';
import { formatEventDate, formatTimeRange, formatWeekday, scrollToSection } from '~/pages/con/utils';
import { Countdown } from '~/pages/con/Countdown';

/**
 * The venue name's link: HUB on Google Maps. Fixed here, not taken from the
 * picked venue, so change it if the con moves.
 */
const VENUE_MAP_URL = 'https://maps.app.goo.gl/wVdWeZfELBYUEckx9';

const generateSparkStyles = () =>
    Array.from({length: 7}, () => ({
        width: `${Math.random() * 18 + 8}rem`,
        height: `${Math.random() * 18 + 8}rem`,
        left: `${Math.random() * 100}%`,
        top: `${Math.random() * 100}%`,
        animationDelay: `${Math.random() * 6}s`,
    }));

export const Hero = () => {
    const t = useT();
    const {currentLanguage} = useLanguage();
    const {content} = useConContent();
    const {listing} = useConListing();
    const venue = useConVenue();
    const {event, heroVideo} = content;
    const sparks = useMemo(generateSparkStyles, []);

    const allowsMotion = useMediaQuery('(prefers-reduced-motion: no-preference)');
    const showClip = Boolean(heroVideo.webm) && allowsMotion;

    return (
        <section id="con-home" className="sbc-hero">
            <div className="sbc-hero-media" aria-hidden="true">
                {/* Under the clip, so a slow or failed load ends on this gradient;
                    it's the whole backdrop with no clip or for reduced motion. Both
                    layers are unstacked absolutes, so they paint in source order. */}
                <div className="sbc-hero-backdrop"/>

                {showClip && (
                    // Keyed on the source so a new clip remounts it; changing a
                    // <source> does nothing without .load(). Muted and playsInline
                    // so phones autoplay it.
                    <video
                        key={heroVideo.webm}
                        className="sbc-hero-clip"
                        autoPlay
                        muted
                        loop
                        playsInline
                        preload="auto"
                        tabIndex={-1}
                    >
                        <source src={heroVideo.webm} type="video/webm"/>
                    </video>
                )}
            </div>

            <div className="sbc-hero-scrim" aria-hidden="true"/>

            <div className="sbc-hero-sparks" aria-hidden="true">
                {sparks.map((style, i) => (
                    <span key={i} className="sbc-hero-spark" style={style}/>
                ))}
            </div>

            <div className="sbc-hero-content">
                <span className="sbc-hero-badge">
                    {event.edition} · {t({en: 'University of Washington', zh: '华盛顿大学'})}
                </span>

                <h1 className="sbc-hero-title">{t(CON_NAME)}</h1>
                <p className="sbc-hero-tagline">{t(event.tagline)}</p>

                <ul className="sbc-hero-meta">
                    <li>
                        <LuCalendar className="sbc-hero-meta-icon" aria-hidden="true"/>
                        {listing.date ? (
                            <span>
                                {formatEventDate(listing.date, currentLanguage)}
                                <span
                                    className="sbc-hero-meta-dim"> · {formatWeekday(listing.date, currentLanguage)}</span>
                            </span>
                        ) : (
                            <span>{t({en: 'Date TBA', zh: '日期待定'})}</span>
                        )}
                    </li>
                    {listing.date && (
                        <li>
                            <LuClock className="sbc-hero-meta-icon" aria-hidden="true"/>
                            <span>{formatTimeRange(listing.date, listing.endTime, currentLanguage)}</span>
                        </li>
                    )}
                    <li>
                        {venue ? (
                            <a
                                className="sbc-hero-meta-link"
                                href={VENUE_MAP_URL}
                                target="_blank"
                                rel="noopener noreferrer"
                            >
                                <LuMapPin className="sbc-hero-meta-icon" aria-hidden="true"/>
                                <span className="sbc-hero-meta-link-text">{t(venue.name)}</span>
                                <span className="sbc-sr-only">
                                    {t({en: ' (opens Google Maps)', zh: '（在 Google 地图中打开）'})}
                                </span>
                                <LuArrowUpRight className="sbc-hero-meta-link-arrow" aria-hidden="true"/>
                            </a>
                        ) : (
                            <>
                                <LuMapPin className="sbc-hero-meta-icon" aria-hidden="true"/>
                                <span>{t({en: 'Venue TBA', zh: '场地待定'})}</span>
                            </>
                        )}
                    </li>
                </ul>

                <Countdown/>

                <div className="sbc-hero-buttons">
                    {listing.ticketUrl && (
                        <a
                            className="btn btn-primary"
                            href={listing.ticketUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                        >
                            <span>{t({en: 'Get Tickets', zh: '获取门票'})}</span>
                            <LuArrowUpRight aria-hidden="true"/>
                        </a>
                    )}
                    {venue && (
                        <Link className="btn sbc-btn-ghost" to={venue.parkingUrl}>
                            <span>{t({en: 'Parking Guide', zh: '停车指南'})}</span>
                            <LuSquareParking aria-hidden="true"/>
                        </Link>
                    )}
                </div>
            </div>

            <a
                className="sbc-hero-scroll-cue"
                href="#tickets"
                onClick={scrollToSection('tickets')}
                aria-label={t({en: 'Scroll to tickets', zh: '滚动到门票'})}
            >
                <span aria-hidden="true">↓</span>
            </a>
        </section>
    );
};
