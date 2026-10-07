import { useMemo } from 'react';
import { Link } from 'react-router';
import { LuArrowUpRight, LuCalendar, LuClock, LuMapPin, LuSquareParking } from 'react-icons/lu';
import { useLanguage } from '~/components/LanguageContextProvider';
import { useConContent, useConVenue } from '~/lib/conContent';
import { CON_NAME, VENUE_MAP_URL, VENUE_TBA } from '~/pages/con/content';
import { useT } from '~/pages/con/i18n';
import { useMediaQuery } from '~/pages/con/hooks';
import { formatEventDate, formatTimeRange, formatWeekday, scrollToSection } from '~/pages/con/utils';
import { Countdown } from '~/pages/con/Countdown';

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
    const venue = useConVenue();
    const {event, heroVideo} = content;
    const sparks = useMemo(generateSparkStyles, []);

    const allowsMotion = useMediaQuery('(prefers-reduced-motion: no-preference)');

    // Muted + playsinline, so phones autoplay it too.
    const showClip = Boolean(heroVideo.webm) && allowsMotion;

    return (
        <section id="con-home" className="sbc-hero">
            <div className="sbc-hero-media" aria-hidden="true">
                {/*
                 * The floor the clip is laid on: whatever it fails to do — a
                 * request that never answers, the seconds before the first frame —
                 * ends on this gradient instead of on nothing. It is also the whole
                 * backdrop when no clip is uploaded, and for reduced-motion visitors.
                 *
                 * Both layers are inset-0 absolutes with no z-index, so the order
                 * they are written in is the order they paint.
                 */}
                <div className="sbc-hero-backdrop"/>

                {showClip && (
                    // Keyed on the source so swapping the clip in the admin panel
                    // remounts the element; React alone would leave <video> playing
                    // the file it already loaded, since changing a <source> child
                    // does nothing without a .load() call.
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

                {/* Carries the `venue` id the old venue section had, so links to
                    /con#venue still land on where the con is. */}
                <ul id="venue" className="sbc-hero-meta">
                    <li>
                        <LuCalendar className="sbc-hero-meta-icon" aria-hidden="true"/>
                        <span>
                            {formatEventDate(event.date, currentLanguage)}
                            <span className="sbc-hero-meta-dim"> · {formatWeekday(event.date, currentLanguage)}</span>
                        </span>
                    </li>
                    <li>
                        <LuClock className="sbc-hero-meta-icon" aria-hidden="true"/>
                        <span>{formatTimeRange(event.date, event.endTime, currentLanguage)}</span>
                    </li>
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
                                <span>{t(VENUE_TBA)}</span>
                            </>
                        )}
                    </li>
                </ul>

                <Countdown/>

                <div className="sbc-hero-buttons">
                    <a
                        className="btn btn-primary"
                        href={event.ticketUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                    >
                        <span>{t({en: 'Get Tickets', zh: '获取门票'})}</span>
                        <LuArrowUpRight aria-hidden="true"/>
                    </a>
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
