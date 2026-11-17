import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router';
import { LanguageSwitcher } from '~/components/LanguageSwitcher';
import { prefersReducedMotion } from '~/lib/maplibre';
import { useUpcomingEvents } from '~/lib/upcomingEvents';
import { useUwParking } from '~/lib/uwParking';
import { localizedVenueName, PARKING_INFO_URL, resolveVenueById, useVenues, type Venue } from '~/lib/venues';
import { LotDetail } from './LotDetail';
import { LotList } from './LotList';
import {
    eventDays,
    fromUpcoming,
    type GuideEvent,
    type LotFilter,
    lotViews,
    matchesFilters,
    nearestSuggestion,
    nowWindow,
    offeredFilters,
} from './model';
import { type HoverTarget, narrowScreen, ParkingMap, type ParkingMapApi } from './ParkingMap';
import { Footer } from './parts';
import { type ParkingText, useParkingText } from './text';
import { VenueSwitcher } from './VenueSwitcher';

export type ParkingGuideState = {from?: 'con'};

const TopBar = ({tx, fromCon}: {tx: ParkingText; fromCon: boolean}) => (
    <div className="parking-topbar">
        <a href={fromCon ? '/con' : '/'} className="parking-back-btn">
            <span className="parking-back-arrow">←</span>
            {tx.t(fromCon ? 'backCon' : 'back')}
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

const NOW_TICK_MS = 60_000;

export const ParkingGuide = () => {
    const [kind = '', id = '', sub = '', subId = ''] = (useParams()['*'] ?? '').split('/');
    const urlVenueId = kind === 'venue' ? id : '';
    const urlEventId = kind === 'event' ? id : '';
    const urlCode = (kind === 'lot' ? id : urlEventId && sub === 'lot' ? subId : '').toUpperCase();
    const {state} = useLocation();
    const fromCon = (state as ParkingGuideState | null)?.from === 'con';
    const navigate = useNavigate();
    const goTo = (path: string) => navigate(path, {replace: true, preventScrollReset: true, state});
    const venuePath = (venueId: string) => venueId ? `/parking/venue/${encodeURIComponent(venueId)}` : '/parking';
    const eventPath = `/parking/event/${encodeURIComponent(urlEventId)}`;
    const tx = useParkingText();
    const {venues, loading: venuesLoading} = useVenues();
    const {parking, loading: parkingLoading} = useUwParking();
    const {upcomingEvents, loading: eventsLoading} = useUpcomingEvents();

    const [now, setNow] = useState(() => new Date());
    useEffect(() => {
        const id = setInterval(() => setNow(new Date()), NOW_TICK_MS);
        return () => clearInterval(id);
    }, []);
    const thisMinute = useMemo(() => nowWindow(now), [now]);

    const urlEvent = useMemo((): GuideEvent | null => {
        const upcoming = urlEventId ? upcomingEvents.find(e => e.id === urlEventId) : undefined;
        return upcoming ? fromUpcoming(upcoming) : null;
    }, [urlEventId, upcomingEvents]);
    const days = useMemo(() => urlEvent ? eventDays(urlEvent, thisMinute.date) : [], [urlEvent, thisMinute.date]);
    const event = days.length > 0 ? urlEvent : null;
    const [dayKey, setDayKey] = useState<string | null>(null);
    const shownDay = days.find(d => d.key === dayKey) ?? days[0] ?? null;
    const parkingWindow = shownDay?.window ?? thisMinute;
    const eventVenueId = event?.venueId ?? '';

    const [pickedVenueId, setPickedVenueId] = useState<string | null>(urlVenueId || null);
    const selectedVenueId = pickedVenueId ?? urlEvent?.venueId ?? '';
    const venue = resolveVenueById(selectedVenueId, venues);
    const eventVenue = resolveVenueById(eventVenueId, venues);

    const views = useMemo(
        () => lotViews(parking, venue, parkingWindow),
        [parking, venue, parkingWindow],
    );
    const [query, setQuery] = useState('');
    const [chosenFilters, setFilters] = useState<ReadonlySet<LotFilter>>(new Set());
    const offered = useMemo(() => offeredFilters(views), [views]);
    const filters = useMemo(
        () => new Set([...chosenFilters].filter(f => offered.includes(f))),
        [chosenFilters, offered],
    );
    const visibleViews = useMemo(() => views.filter(v => matchesFilters(v, query, filters)), [views, query, filters]);
    const visibleCodes = useMemo(() => new Set(visibleViews.map(v => v.lot.code)), [visibleViews]);
    const listedCodes = useMemo(() => new Set(parking.lots.map(l => l.code)), [parking.lots]);

    const selectedCode = listedCodes.has(urlCode) ? urlCode : null;
    const [hover, setHover] = useState<HoverTarget | null>(null);
    const [hotCode, setHotCode] = useState<string | null>(null);
    const mapApi = useRef<ParkingMapApi>(null);
    const panelRef = useRef<HTMLElement>(null);
    const listScroll = useRef(0);

    const selectVenue = (id: string) => {
        setPickedVenueId(id);
        goTo(event ? eventPath : venuePath(id));
        setHover(null);
        setHotCode(null);
        if (panelRef.current) panelRef.current.scrollTop = 0;
    };

    const openLot = (code: string) => {
        const panel = panelRef.current;
        if (panel && !selectedCode) listScroll.current = panel.scrollTop;
        if (code !== selectedCode) goTo(`${event ? eventPath : '/parking'}/lot/${encodeURIComponent(code)}`);
        setHover(null);
        setHotCode(null);
        mapApi.current?.focusLot(code);
        if (!panel) return;
        panel.scrollTop = 0;
        if (narrowScreen()) {
            panel.scrollIntoView({behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'start'});
        }
    };

    const closeLot = () => goTo(event ? eventPath : venuePath(venue?.id ?? ''));
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

    const loading = venuesLoading || parkingLoading || (!!urlEventId && eventsLoading);
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

    if (venues.length === 0) {
        return (
            <div className="parking-page">
                <TopBar tx={tx} fromCon={fromCon}/>
                <Notice icon="📍" title={tx.t('noVenuesTitle')} desc={tx.t('noVenuesDesc')}/>
            </div>
        );
    }

    const selectedView = selectedCode ? views.find(v => v.lot.code === selectedCode) ?? null : null;

    return (
        <div className="parking-page">
            <div className="parking-deco-blob parking-deco-blob--1"/>
            <div className="parking-deco-blob parking-deco-blob--2"/>

            <TopBar tx={tx} fromCon={fromCon}/>

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
                        suggestionFor={v => nearestSuggestion(parking, v)}
                        onSelect={selectVenue}
                        tx={tx}
                    />
                </div>
            </header>

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
                        parkingWindow={parkingWindow}
                        onOpenLot={openLot}
                        onSelectVenue={selectVenue}
                        tx={tx}
                    />
                </section>

                <aside className="parking-info-panel" ref={panelRef} aria-label={tx.t('panelLabel')}>
                    {parking.lots.length === 0 ? (
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
                    ) : selectedView ? (
                        <LotDetail
                            view={selectedView}
                            parkingWindow={parkingWindow}
                            venueName={venue ? venueName(venue) : ''}
                            listedCodes={listedCodes}
                            onBack={closeLot}
                            onOpenLot={openLot}
                            tx={tx}
                        />
                    ) : (
                        <LotList
                            event={event}
                            parkingWindow={parkingWindow}
                            days={days}
                            shownDay={shownDay}
                            onShowDay={day => setDayKey(day.key)}
                            venue={venue}
                            eventVenue={eventVenue}
                            venueName={venueName}
                            eventPricing={parking.eventPricing}
                            views={views}
                            visibleViews={visibleViews}
                            query={query}
                            onQuery={setQuery}
                            offeredFilters={offered}
                            filters={filters}
                            onToggleFilter={toggleFilter}
                            hotCode={hotCode}
                            onHot={hotLot}
                            onOpenLot={openLot}
                            onSelectVenue={selectVenue}
                            tx={tx}
                        />
                    )}
                </aside>
            </div>

            {parking.lots.length > 0 && <Footer generatedAt={parking.lotsGeneratedAt} tx={tx}/>}
        </div>
    );
};
