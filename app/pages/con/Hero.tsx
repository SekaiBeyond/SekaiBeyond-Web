import { useMemo } from 'react';
import { useLanguage } from '~/components/LanguageContextProvider';
import { useConContent } from '~/lib/conContent';
import { HERO_VIDEO } from '~/pages/con/content';
import { useT } from '~/pages/con/i18n';
import { useMediaQuery } from '~/pages/con/hooks';
import { formatEventDate, formatTimeRange, formatWeekday, scrollToSection } from '~/pages/con/utils';
import { Countdown } from '~/pages/con/Countdown';

/**
 * Bilibili's embed player only autoplays when it is muted, ignores autoplay
 * entirely on mobile browsers, and has no loop parameter — it plays once and
 * stops. A self-hosted clip (`HERO_VIDEO.loopMp4`) is preferred for exactly
 * those reasons; this is the fallback when none is configured.
 */
const buildPlayerUrl = () => {
    const params = new URLSearchParams({
        isOutside: 'true',
        aid: HERO_VIDEO.aid,
        bvid: HERO_VIDEO.bvid,
        cid: HERO_VIDEO.cid,
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
    const {content} = useConContent();
    const {event} = content;
    const sparks = useMemo(generateSparkStyles, []);

    const isWide = useMediaQuery('(min-width: 769px)');
    const allowsMotion = useMediaQuery('(prefers-reduced-motion: no-preference)');

    // A local clip is muted + playsinline, so phones autoplay it happily; the
    // Bilibili iframe they refuse outright, hence the width gate on that path.
    const hasClip = Boolean(HERO_VIDEO.loopMp4 || HERO_VIDEO.loopWebm);
    const showClip = hasClip && allowsMotion;
    const showEmbed = !hasClip && isWide && allowsMotion;

    const posterStyle = HERO_VIDEO.poster
        ? {backgroundImage: `url('${HERO_VIDEO.poster}')`}
        : undefined;

    return (
        <section id="con-home" className="sbc-hero">
            <div className="sbc-hero-media" aria-hidden="true">
                {showClip && (
                    <video
                        className="sbc-hero-clip"
                        autoPlay
                        muted
                        loop
                        playsInline
                        preload="auto"
                        poster={HERO_VIDEO.poster || undefined}
                        tabIndex={-1}
                    >
                        {HERO_VIDEO.loopWebm && <source src={HERO_VIDEO.loopWebm} type="video/webm"/>}
                        {HERO_VIDEO.loopMp4 && <source src={HERO_VIDEO.loopMp4} type="video/mp4"/>}
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

                {!showClip && !showEmbed && <div className="sbc-hero-poster" style={posterStyle}/>}
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

                <h1 className="sbc-hero-title">{t(event.name)}</h1>
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
                        <span>{t(event.venue.room)}, {t(event.venue.name)}</span>
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
