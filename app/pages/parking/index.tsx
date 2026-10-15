import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { LanguageSwitcher } from '~/components/LanguageSwitcher';
import { CON_NAME, useConContent } from '~/lib/conContent';
import { parseSiteTime, siteDay, toDatetimeLocal } from '~/lib/siteTime';
import { useUpcomingEvents } from '~/lib/upcomingEvents';
import { useUwParking } from '~/lib/uwParking';
import { PARKING_INFO_URL, resolveVenueById, useVenues, type Venue } from '~/lib/venues';
import { LotDetail } from './LotDetail';
import { LotList } from './LotList';
import {
    type EventDay,
    eventDays,
    firstSuggestion,
    fromUpcoming,
    type GuideEvent,
    guideEvents,
    localizedVenueName,
    type LotFilter,
    lotViews,
    matchesFilters,
    nowWindow,
} from './model';
import { type HoverTarget, ParkingMap, type ParkingMapApi } from './ParkingMap';
import { Footer } from './parts';
import { type ParkingText, useParkingText } from './text';
import { VenueSwitcher } from './VenueSwitcher';

const TopBar = ({tx}: {tx: ParkingText}) => (
    <div className="parking-topbar">
        <a href="/" className="parking-back-btn">
            <span className="parking-back-arrow">←</span>
            {tx.t('back')}
        </a>
        <LanguageSwitcher/>
    </div>
);

const Notice = ({icon, title, desc}: {icon: string; title: string; desc: string}) => (
    <div className="parking-error">
        <div className="parking-error-icon">{icon}</div>
        <h2 className="parking-error-title">{title}</h2>
        <p className="parking-error-desc">{desc}</p>
    </div>
);

// How often the "right now" statuses move on.
const NOW_TICK_MS = 60_000;

export const ParkingGuide = () => {
    // `/parking/venue/<venue id>` opens on a venue, and `/parking/lot/<lot code>` on a lot.
    const {kind, id} = useParams<{kind: string; id: string}>();
    const urlVenueId = kind === 'venue' ? id ?? '' : '';
    const urlCode = kind === 'lot' ? id?.toUpperCase() ?? '' : '';
    // The address names the lot open, or else the venue picked, so either can be linked to.
    const navigate = useNavigate();
    const goTo = (path: string) => navigate(path, {replace: true, preventScrollReset: true});
    const venuePath = (venueId: string) => venueId ? `/parking/venue/${encodeURIComponent(venueId)}` : '/parking';
    const tx = useParkingText();
    const {venues, loading: venuesLoading} = useVenues();
    const {parking, loading: parkingLoading} = useUwParking();
    const {content: con, loading: conLoading} = useConContent();
    const {activeEvents, loading: eventsLoading} = useUpcomingEvents();

    // The con, until it's over.
    const conEvent = useMemo((): GuideEvent | null => {
        const {date, endTime, venueId} = con.event;
        if (!date) return null;
        const start = toDatetimeLocal(parseSiteTime(date));
        const end = endTime ? toDatetimeLocal(parseSiteTime(endTime)) : '';
        if (!start || (end || start).slice(0, 10) < siteDay(new Date())) return null;
        return {id: 'con', title: CON_NAME, venueId, start, end};
    }, [con.event]);

    // The guide shows parking right now, which the clock moves on, unless the
    // visitor switches it to a day of one of the events.
    const [now, setNow] = useState(() => new Date());
    useEffect(() => {
        const id = setInterval(() => setNow(new Date()), NOW_TICK_MS);
        return () => clearInterval(id);
    }, []);
    const thisMinute = useMemo(() => nowWindow(now), [now]);
    // Every event with a venue the guide can plan around, so any of them can be switched to.
    const events = useMemo(() => guideEvents([...activeEvents.map(fromUpcoming), ...(conEvent ? [conEvent] : [])]
        .filter(e => resolveVenueById(e.venueId, venues))), [activeEvents, conEvent, venues]);
    const days = useMemo(() => events.flatMap(e => eventDays(e, thisMinute.date)), [events, thisMinute.date]);
    const [shownKey, setShownKey] = useState<string | null>(null);
    // The event last switched to stays the guide's event after switching back to right now.
    const [eventKey, setEventKey] = useState<string | null>(null);
    const shownDay = days.find(d => d.key === shownKey) ?? null;
    const parkingWindow = shownDay?.window ?? thisMinute;
    const event = events.find(e => e.id === eventKey) ?? null;
    const eventVenueId = event?.venueId ?? '';

    // Which venue's parking guide is displayed: the one the address names, or none, the
    // whole campus. A switch to another event's day moves it to the event's venue, and
    // the switcher can change it.
    const [selectedVenueId, setSelectedVenueId] = useState(urlVenueId);
    const showDay = (day: EventDay | null) => {
        setShownKey(day?.key ?? null);
        if (!day) return;
        setEventKey(day.event.id);
        // Switching to an event with no venue keeps the one picked.
        if (day.event.venueId && day.event.venueId !== eventVenueId) {
            setSelectedVenueId(day.event.venueId);
            goTo(venuePath(day.event.venueId));
        }
    };
    const venue = resolveVenueById(selectedVenueId, venues);
    const eventVenue = resolveVenueById(eventVenueId, venues);

    const views = useMemo(
        () => lotViews(parking, venue, parkingWindow),
        [parking, venue, parkingWindow],
    );
    const [query, setQuery] = useState('');
    const [filters, setFilters] = useState<ReadonlySet<LotFilter>>(new Set());
    const visibleViews = useMemo(() => views.filter(v => matchesFilters(v, query, filters)), [views, query, filters]);
    const visibleCodes = useMemo(() => new Set(visibleViews.map(v => v.lot.code)), [visibleViews]);
    const listedCodes = useMemo(() => new Set(parking.lots.map(l => l.code)), [parking.lots]);

    // The lot open in the panel is the one the address names.
    const selectedCode = listedCodes.has(urlCode) ? urlCode : null;
    const [hover, setHover] = useState<HoverTarget | null>(null);
    const [hotCode, setHotCode] = useState<string | null>(null);
    const mapApi = useRef<ParkingMapApi>(null);
    const panelRef = useRef<HTMLElement>(null);
    // Where the list was scrolled to, so closing a lot returns there.
    const listScroll = useRef(0);

    const selectVenue = (id: string) => {
        setSelectedVenueId(id);
        goTo(venuePath(id));
        setHover(null);
        setHotCode(null);
        if (panelRef.current) panelRef.current.scrollTop = 0;
    };

    const openLot = (code: string) => {
        const panel = panelRef.current;
        if (panel && !selectedCode) listScroll.current = panel.scrollTop;
        if (code !== selectedCode) goTo(`/parking/lot/${encodeURIComponent(code)}`);
        setHover(null);
        setHotCode(null);
        mapApi.current?.focusLot(code);
        if (!panel) return;
        panel.scrollTop = 0;
        // Stacked under the map on narrow screens, the details would open out of sight.
        if (window.matchMedia('(max-width: 1024px)').matches) {
            const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
            panel.scrollIntoView({behavior: reduce ? 'auto' : 'smooth', block: 'start'});
        }
    };

    const closeLot = () => goTo(venuePath(venue?.id ?? ''));
    useEffect(() => {
        if (!selectedCode && panelRef.current) panelRef.current.scrollTop = listScroll.current;
    }, [selectedCode]);

    const hotLot = (code: string | null) => {
        setHotCode(code);
        setHover(h => code ? {kind: 'lot', code, pinned: false} : h?.kind === 'lot' && h.pinned ? h : null);
    };

    const toggleFilter = (filter: LotFilter) => setFilters(current => {
        const next = new Set(current);
        if (!next.delete(filter)) next.add(filter);
        return next;
    });

    const venueName = (v: Venue) => localizedVenueName(v, tx.isEnglish);

    const loading = venuesLoading || parkingLoading || conLoading || eventsLoading;
    if (loading) {
        return (
            <div className="parking-page">
                <div className="parking-loading">
                    <div className="loader"></div>
                    <span className="parking-loading-text">{tx.t('loading')}</span>
                </div>
            </div>
        );
    }

    // No venues exist at all — there's nothing to show or switch between.
    if (venues.length === 0) {
        return (
            <div className="parking-page">
                <TopBar tx={tx}/>
                <Notice icon="📍" title={tx.t('noVenuesTitle')} desc={tx.t('noVenuesDesc')}/>
            </div>
        );
    }

    const selectedView = selectedCode ? views.find(v => v.lot.code === selectedCode) ?? null : null;

    return (
        <div className="parking-page">
            <div className="parking-deco-blob parking-deco-blob--1"/>
            <div className="parking-deco-blob parking-deco-blob--2"/>

            <TopBar tx={tx}/>

            <header className="parking-header">
                <span className="parking-header-sparkle">✦</span>
                <span className="parking-header-sparkle">✦</span>
                <h1 className="parking-title">{tx.t('title')}</h1>
                <div className="parking-venue-row">
                    <span className="parking-venue-label">{tx.t('viewingFor')}</span>
                    <VenueSwitcher
                        venues={venues}
                        selectedId={selectedVenueId}
                        eventVenueId={eventVenueId}
                        suggestionFor={v => firstSuggestion(parking, v)}
                        onSelect={selectVenue}
                        tx={tx}
                    />
                </div>
            </header>

            {/* Without a venue, the whole campus: every lot, none suggested or measured. */}
            <div className="parking-content">
                <section className="parking-map-container" aria-label={tx.t('mapLabel')}>
                    <ParkingMap
                        ref={mapApi}
                        views={views}
                        visibleCodes={visibleCodes}
                        venues={venues}
                        venue={venue}
                        outline={venue ? parking.outlines[venue.id] ?? null : null}
                        eventVenueId={eventVenueId}
                        selectedCode={selectedCode}
                        hotCode={hotCode}
                        hover={hover}
                        setHover={setHover}
                        isNow={parkingWindow.isNow}
                        onOpenLot={openLot}
                        onSelectVenue={selectVenue}
                        tx={tx}
                    />
                </section>

                <aside className="parking-info-panel" ref={panelRef} aria-label={tx.t('panelLabel')}>
                    {parking.lots.length === 0 ? (
                        <>
                            <div className="parking-info-card">
                                <div className="parking-info-icon parking-info-icon--info">🅿️</div>
                                <div className="parking-info-text parking-info-stack">
                                    <span className="parking-lot-name">{tx.t('noDataTitle')}</span>
                                    <span>{tx.t('noDataDesc')}</span>
                                    <a href={PARKING_INFO_URL} target="_blank" rel="noopener noreferrer">
                                        {PARKING_INFO_URL} ↗
                                    </a>
                                </div>
                            </div>
                            <Footer generatedAt="" tx={tx}/>
                        </>
                    ) : selectedView ? (
                        <LotDetail
                            view={selectedView}
                            parkingWindow={parkingWindow}
                            venueName={venue ? venueName(venue) : ''}
                            listedCodes={listedCodes}
                            generatedAt={parking.lotsGeneratedAt}
                            onBack={closeLot}
                            onOpenLot={openLot}
                            tx={tx}
                        />
                    ) : (
                        <>
                            <LotList
                                event={event}
                                parkingWindow={parkingWindow}
                                days={days}
                                shownDay={shownDay}
                                onShowDay={showDay}
                                venue={venue}
                                eventVenue={eventVenue}
                                venueName={venueName}
                                eventPricing={parking.eventPricing}
                                views={views}
                                visibleViews={visibleViews}
                                query={query}
                                onQuery={setQuery}
                                filters={filters}
                                onToggleFilter={toggleFilter}
                                hotCode={hotCode}
                                onHot={hotLot}
                                onOpenLot={openLot}
                                onSelectVenue={selectVenue}
                                tx={tx}
                            />
                            <Footer generatedAt={parking.lotsGeneratedAt} tx={tx}/>
                        </>
                    )}
                </aside>
            </div>
        </div>
    );
};
