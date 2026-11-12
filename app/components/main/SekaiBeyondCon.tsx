import { type KeyboardEvent, type TouchEvent, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router";
import { useLanguage } from "~/components/LanguageContextProvider";
import { EventImageModal } from "~/components/EventImageModal";
import { useConContent } from "~/lib/conContent";
import { eitherLanguage, localized } from "~/lib/localized";
import { usePastEvents } from "~/lib/pastEvents";
import { formatSiteTime, siteDay } from "~/lib/siteTime";
import { useUpcomingEvents } from "~/lib/upcomingEvents";
import { isValidHttpUrl } from "~/lib/urls";
import { eventLocationDisplay, useVenues } from "~/lib/venues";

type Status = 'upcoming' | 'live' | 'past';

/** One year of the Con, from the event marked as it. */
interface Edition {
    /** The event's id. */
    id: string;
    year: number;
    status: Status;
    /** Its first day, `YYYY-MM-DD` in site time, which the countdown runs to. */
    startDay: string;
    /** Its day, or first and last day, in the reader's language. */
    when: (isEnglish: boolean) => string;
    location: string;
    locationCn: string;
    venueId: string;
    roomIds: string[];
    description: string;
    descriptionCn: string;
    image: string;
    recapLink: string;
    recapLinkCn: string;
}

/** A `YYYY-MM-DD` day, which reads as UTC midnight, so it's formatted in UTC. */
const formatDay = (day: string, isEnglish: boolean) =>
    new Date(day).toLocaleDateString(isEnglish ? 'en-US' : 'zh-CN', {
        year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC',
    });

const tabId = (year: number) => `con-year-${year}`;

const DAY_FORMAT: Intl.DateTimeFormatOptions = {year: 'numeric', month: 'long', day: 'numeric'};

/** Whole days from today, in site time, to a `YYYY-MM-DD` day. */
const daysUntil = (day: string) =>
    Math.round((Date.parse(day) - Date.parse(siteDay(new Date()))) / 86_400_000);

export const SekaiBeyondCon = () => {
    const {isEnglish} = useLanguage();
    const {content: conContent, loading: conLoading} = useConContent();
    const {upcomingEvents, loading: upcomingLoading} = useUpcomingEvents();
    const {pastEvents, loading: pastLoading} = usePastEvents();
    const {venues} = useVenues();
    const [selectedYear, setSelectedYear] = useState<number | null>(null);
    // Which way the last switch went, so the banner slides in from that side.
    const [direction, setDirection] = useState<'older' | 'newer' | null>(null);
    const [selectedImage, setSelectedImage] = useState<string | null>(null);
    const yearsRef = useRef<HTMLDivElement>(null);
    const touchStart = useRef<{x: number; y: number} | null>(null);

    // One per year, newest first. Only published events, as everywhere public;
    // the server allows one Con a year, and the unarchived one wins a tie.
    const editions = useMemo(() => {
        const now = Date.now();
        const byYear = new Map<number, Edition>();
        for (const event of upcomingEvents) {
            if (!event.con || byYear.has(event.con.year)) continue;
            const start = event.startAt;
            const end = event.endAt;
            byYear.set(event.con.year, {
                id: event.id,
                year: event.con.year,
                status: now < start.getTime() ? 'upcoming' : now < end.getTime() ? 'live' : 'past',
                startDay: siteDay(start),
                when: isEnglish => {
                    const first = formatSiteTime(start, isEnglish, DAY_FORMAT);
                    return siteDay(start) === siteDay(end)
                        ? first
                        : `${first} – ${formatSiteTime(end, isEnglish, DAY_FORMAT)}`;
                },
                location: event.location,
                locationCn: event.locationCn,
                venueId: event.venueId,
                roomIds: event.roomIds,
                description: event.description,
                descriptionCn: event.descriptionCn,
                image: event.poster,
                recapLink: '',
                recapLinkCn: '',
            });
        }
        for (const event of pastEvents) {
            if (!event.con || !event.published || byYear.has(event.con.year)) continue;
            byYear.set(event.con.year, {
                id: event.id,
                year: event.con.year,
                status: 'past',
                startDay: event.date,
                when: isEnglish => formatDay(event.date, isEnglish),
                location: event.location,
                locationCn: event.locationCn,
                venueId: event.venueId,
                roomIds: event.roomIds,
                description: event.description,
                descriptionCn: event.descriptionCn,
                image: event.icon,
                recapLink: event.recapLink,
                recapLinkCn: event.recapLinkCn,
            });
        }
        return [...byYear.values()].sort((a, b) => b.year - a.year);
    }, [upcomingEvents, pastEvents]);

    const loading = conLoading || upcomingLoading || pastLoading;
    // Newest first, as the badges hang left to right.
    const shown = loading ? [] : editions;

    // Opens on the Con that's on or ahead, else the latest year.
    const opening = shown.find(e => e.status === 'live')
        ?? shown.findLast(e => e.status === 'upcoming')
        ?? shown[0];
    const edition = shown.find(e => e.year === selectedYear) ?? opening;

    // Keeps the chosen badge in view on a narrow screen, scrolling only the
    // row of years, never the page.
    useEffect(() => {
        const years = yearsRef.current;
        const badge = edition && years?.querySelector<HTMLElement>(`#${tabId(edition.year)}`);
        if (!years || !badge) return;
        const yearsBox = years.getBoundingClientRect();
        const badgeBox = badge.getBoundingClientRect();
        if (badgeBox.left < yearsBox.left || badgeBox.right > yearsBox.right) {
            years.scrollLeft += badgeBox.left - yearsBox.left - (yearsBox.width - badgeBox.width) / 2;
        }
    }, [edition?.year]);

    if (!edition) return null;

    // The /con page is about the event it links. Without a link to one of these,
    // it's the Con still to come.
    const linkedId = conContent.event.upcomingEventId;
    const linksAnEdition = shown.some(e => e.id === linkedId);
    const showConPage = conContent.settings.published && (linksAnEdition
        ? edition.id === linkedId
        : edition.status !== 'past');

    // Either language's recap stands in for a missing one, as in Past Events.
    const recapHref = eitherLanguage(isEnglish, edition.recapLink, edition.recapLinkCn);
    const showRecap = edition.status === 'past' && isValidHttpUrl(recapHref);
    const location = eventLocationDisplay(edition, venues, isEnglish);
    const description = localized(isEnglish, edition.description, edition.descriptionCn);
    const conName = isEnglish ? "Sekai Beyond Con" : "彼世界动漫游戏展";

    // The year is the title's, so the label says only that the Con is on or how
    // far off it is. A past one has none.
    const daysLeft = daysUntil(edition.startDay);
    const label = edition.status === 'past' ? null
        : edition.status === 'live'
            ? (isEnglish ? "Happening Now" : "进行中")
            : daysLeft <= 0
                ? (isEnglish ? "Starts Today" : "今天开幕")
                : daysLeft === 1
                    ? (isEnglish ? "Starts Tomorrow" : "明天开幕")
                    : (isEnglish ? `${daysLeft} Days to Go` : `还有 ${daysLeft} 天`);
    const facts = [
        {icon: '📅', label: isEnglish ? "Date" : "日期", value: edition.when(isEnglish)},
        ...(location ? [{icon: '📍', label: isEnglish ? "Location" : "地点", value: location}] : []),
    ];
    const statusNote = (status: Status) => status === 'live'
        ? (isEnglish ? "Now" : "进行中")
        : (isEnglish ? "Upcoming" : "即将到来");

    const select = (year: number) => {
        if (year === edition.year) return;
        setDirection(year > edition.year ? 'newer' : 'older');
        setSelectedYear(year);
    };
    // Left to right: +1 is a year older. Stops at either end.
    const step = (offset: number) => {
        const next = shown[shown.indexOf(edition) + offset];
        if (next) select(next.year);
        return next;
    };
    const onTabKeyDown = (event: KeyboardEvent) => {
        const target = event.key === 'ArrowRight' ? step(1)
            : event.key === 'ArrowLeft' ? step(-1)
                : event.key === 'Home' ? shown[0]
                    : event.key === 'End' ? shown[shown.length - 1]
                        : undefined;
        if (!target) return;
        event.preventDefault();
        select(target.year);
        document.getElementById(tabId(target.year))?.focus();
    };
    // A sideways swipe on the banner turns to the next or previous year.
    const onTouchStart = (event: TouchEvent) => {
        const touch = event.touches[0];
        touchStart.current = {x: touch.clientX, y: touch.clientY};
    };
    const onTouchEnd = (event: TouchEvent) => {
        const start = touchStart.current;
        touchStart.current = null;
        if (!start) return;
        const touch = event.changedTouches[0];
        const dx = touch.clientX - start.x;
        const dy = touch.clientY - start.y;
        if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) step(dx < 0 ? 1 : -1);
    };

    return (
        <section id="con" className="section">
            {/* The years' badges hang from the subtitle. */}
            <div className="section-header con-header--badges">
                <h2 className="section-title">Sekai Beyond Con</h2>
                <p className="section-subtitle">
                    {isEnglish
                        ? "Our annual convention celebrating anime, comics, games, and novels"
                        : "我们一年一度的动漫、漫画、游戏与小说盛会"}
                </p>
            </div>

            <div className="con-editions">
                {/* Each year a convention badge strung from the subtitle above;
                    the chosen one drops down and swings straight. */}
                <div className="con-years" ref={yearsRef}>
                    <div className="con-years-track">
                        <div
                            className="con-badges"
                            role="tablist"
                            aria-label={isEnglish ? "Convention year" : "漫展年份"}
                            onKeyDown={onTabKeyDown}
                        >
                            {shown.map(e => {
                                const selected = e === edition;
                                return (
                                    <button
                                        key={e.year}
                                        id={tabId(e.year)}
                                        type="button"
                                        role="tab"
                                        className="con-badge"
                                        data-status={e.status}
                                        aria-selected={selected}
                                        aria-controls="con-edition-panel"
                                        tabIndex={selected ? 0 : -1}
                                        onClick={() => select(e.year)}
                                    >
                                        <span className="con-badge-string" aria-hidden="true"/>
                                        <span className="con-badge-clip" aria-hidden="true"/>
                                        <span className="con-badge-card">
                                            <span className="con-badge-slot" aria-hidden="true"/>
                                            <span className="con-badge-art" aria-hidden="true">
                                                {e.image ? <img src={e.image} alt=""/> : '🌸'}
                                            </span>
                                            <span className="con-badge-year">{e.year}</span>
                                            {e.status !== 'past' && (
                                                <span className="con-badge-sticker">{statusNote(e.status)}</span>
                                            )}
                                        </span>
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                </div>

                <div
                    id="con-edition-panel"
                    className="convention-banner con-edition-panel"
                    role="tabpanel"
                    aria-labelledby={tabId(edition.year)}
                    onTouchStart={onTouchStart}
                    onTouchEnd={onTouchEnd}
                >
                    <div className="con-decorations">
                        <span className="con-deco">🌸</span>
                        <span className="con-deco">🎨</span>
                        <span className="con-deco">🎤</span>
                        <span className="con-deco">🎸</span>
                    </div>

                    {/* Keyed, so each switch replays the slide, from the side the new
                        year sits on. The poster, taped up like a flyer, sits beside
                        the year's details; without one, the details stand alone. */}
                    <div
                        key={edition.year}
                        className={`con-banner-inner con-edition con-edition-enter${edition.image ? '' : ' con-edition--solo'}${direction ? ` con-edition-enter--${direction}` : ''}`}
                    >
                        {edition.image && (
                            <div className="con-edition-poster">
                                <button
                                    type="button"
                                    className="event-image-btn"
                                    onClick={() => setSelectedImage(edition.image)}
                                    aria-label={isEnglish
                                        ? `View Sekai Beyond Con ${edition.year} poster`
                                        : `查看${edition.year}年彼世界动漫游戏展海报`}
                                >
                                    <img src={edition.image} alt={`${conName} ${edition.year}`}/>
                                </button>
                            </div>
                        )}

                        <div className="con-edition-info">
                            {label && (
                                <span
                                    className={`convention-label${edition.status === 'live' ? ' convention-label--progress' : ''}`}>
                                    {label}
                                </span>
                            )}

                            <h3 className="con-edition-title">
                                <span className="con-edition-name">{conName}</span>
                                {' '}
                                <span className="con-edition-year">{edition.year}</span>
                            </h3>

                            <ul className="con-edition-facts">
                                {facts.map(fact => (
                                    <li key={fact.icon} className="con-edition-fact">
                                        <span className="con-edition-fact-icon" aria-hidden="true">{fact.icon}</span>
                                        <span className="con-edition-fact-text">
                                            <span className="con-edition-fact-label">{fact.label}</span>
                                            <span className="con-edition-fact-value">{fact.value}</span>
                                        </span>
                                    </li>
                                ))}
                            </ul>

                            {description && <p className="con-description">{description}</p>}

                            {(showConPage || showRecap) && (
                                <div className="con-edition-actions">
                                    {showConPage && (
                                        <Link className="btn btn-primary" to="/con">
                                            <span>{isEnglish ? "Explore the Con" : "了解漫展详情"}</span>
                                        </Link>
                                    )}
                                    {showRecap && (
                                        <a className="btn btn-secondary" href={recapHref} target="_blank"
                                           rel="noopener noreferrer">
                                            {isEnglish ? "View Recap" : "查看回顾"}
                                        </a>
                                    )}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>

            {selectedImage && (
                <EventImageModal
                    imageUrl={selectedImage}
                    onClose={() => setSelectedImage(null)}
                    altText={isEnglish ? "Convention poster" : "漫展海报"}
                />
            )}
        </section>
    );
};
