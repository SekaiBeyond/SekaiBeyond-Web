import { useMemo } from 'react';
import { useLanguage } from '~/components/LanguageContextProvider';
import { useConContent, useConVenue } from '~/lib/conContent';
import { CON_NAME, HERO_EMBED, VENUE_TBA } from '~/pages/con/content';
import { useT } from '~/pages/con/i18n';
import { useMediaQuery } from '~/pages/con/hooks';
import { formatEventDate, formatTimeRange, formatWeekday, scrollToSection } from '~/pages/con/utils';
import { Countdown } from '~/pages/con/Countdown';

/**
 * Bilibili's embed player only autoplays when it is muted, ignores autoplay
 * entirely on mobile browsers, and has no loop parameter — it plays once and
 * stops. A clip uploaded in Admin → Con Content → Hero Video is preferred for
 * exactly those reasons; this is the fallback when none is configured.
 */
const buildPlayerUrl = () => {
    const params = new URLSearchParams({
        isOutside: 'true',
        aid: HERO_EMBED.aid,
        bvid: HERO_EMBED.bvid,
        cid: HERO_EMBED.cid,
        p: '1',
        autoplay: '1',
        muted: '1',
        danmaku: '0',
        hideCoverInfo: '1',
        noEndPanel: '1',
        high_quality: '1',
    });
    return `https://player.bilibili.com/player.html?${params.toString()}`;
};

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
    const {content, loading} = useConContent();
    const venue = useConVenue();
    const {event, heroVideo} = content;
    const sparks = useMemo(generateSparkStyles, []);

    const isWide = useMediaQuery('(min-width: 769px)');
    const allowsMotion = useMediaQuery('(prefers-reduced-motion: no-preference)');

    // A local clip is muted + playsinline, so phones autoplay it happily; the
    // Bilibili iframe they refuse outright, hence the width gate on that path.
    const hasClip = Boolean(heroVideo.webm);
    const showClip = hasClip && allowsMotion;
    // Which clip is configured is not known until the content lands, so the embed
    // waits for it. Starting the iframe on the defaults would fetch a player we
    // then tear down a moment later, and the swap is visible.
    const showEmbed = !hasClip && !loading && isWide && allowsMotion;

    const posterStyle = heroVideo.poster
        ? {backgroundImage: `url('${heroVideo.poster}')`}
        : undefined;

    return (
        <section id="con-home" className="sbc-hero">
            <div className="sbc-hero-media" aria-hidden="true">
                {/*
                 * The floor every other layer is laid on, rather than the branch
                 * taken when there is nothing to lay: whatever the clip or the
                 * embed above fails to do — a codec the browser will not decode,
                 * a request that never answers, the seconds before the first frame
                 * — ends on the poster instead of on nothing. The clip is a WebM
                 * and nothing else, so this is not a rare path: Safari, iPhone and
                 * iPad skip a `<source>` whose `type` they cannot decode, without
                 * fetching it, and stay on this image for good.
                 *
                 * Both layers are inset-0 absolutes with no z-index, so the order
                 * they are written in is the order they paint.
                 */}
                <div className="sbc-hero-poster" style={posterStyle}/>

                {showClip && (
                    // Keyed on the source so swapping the clip in the admin panel
                    // remounts the element; React alone would leave <video> playing
                    // the file it already loaded, since changing a <source> child
                    // does nothing without a .load() call.
                    //
                    // No `poster` of its own: the layer underneath is that image
                    // already, and an empty one there would leave a clip that is
                    // still buffering painting over the gradient with nothing.
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

                {showEmbed && (
                    <iframe
                        className="sbc-hero-frame"
                        src={buildPlayerUrl()}
                        title=""
                        tabIndex={-1}
                        loading="eager"
                        referrerPolicy="no-referrer"
                        sandbox="allow-scripts allow-same-origin allow-presentation"
                    />
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
                        <span aria-hidden="true">📅</span>
                        <span>
                            {formatEventDate(event.date, currentLanguage)}
                            <span className="sbc-hero-meta-dim"> · {formatWeekday(event.date, currentLanguage)}</span>
                        </span>
                    </li>
                    <li>
                        <span aria-hidden="true">⏰</span>
                        <span>{formatTimeRange(event.date, event.endTime, currentLanguage)}</span>
                    </li>
                    <li>
                        <span aria-hidden="true">📍</span>
                        <span>{t(venue?.name ?? VENUE_TBA)}</span>
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
                        <span aria-hidden="true">🎟️</span>
                    </a>
                    <a
                        className="btn sbc-btn-ghost"
                        href="#schedule"
                        onClick={scrollToSection('schedule')}
                    >
                        <span>{t({en: 'See the Schedule', zh: '查看日程'})}</span>
                        <span aria-hidden="true">✨</span>
                    </a>
                </div>
            </div>

            <a
                className="sbc-hero-scroll-cue"
                href="#about"
                onClick={scrollToSection('about')}
                aria-label={t({en: 'Scroll to about section', zh: '滚动到关于漫展'})}
            >
                <span aria-hidden="true">↓</span>
            </a>
        </section>
    );
};
