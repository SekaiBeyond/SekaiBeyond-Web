import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router';
import { doc, getDoc } from 'firebase/firestore';
import { LanguageSwitcher } from '~/components/LanguageSwitcher';
import { CON_NAME, useConContent } from '~/lib/conContent';
import { getFirebaseDb } from '~/lib/firebase';
import { parseSiteTime, siteDay, toDatetimeLocal } from '~/lib/siteTime';
import { useUwParking } from '~/lib/uwParking';
import { PARKING_INFO_URL, resolveVenueById, useVenues, type Venue } from '~/lib/venues';
import { LotDetail } from './LotDetail';
import { LotList } from './LotList';
import {
    eventWindow,
    firstSuggestion,
    type GuideEvent,
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

const Notice = ({icon, title, desc, inline}: {icon: string; title: string; desc: string; inline?: boolean}) => (
    <div className={`parking-error${inline ? ' parking-error--inline' : ''}`}>
        <div className="parking-error-icon">{icon}</div>
        <h2 className="parking-error-title">{title}</h2>
        <p className="parking-error-desc">{desc}</p>
    </div>
);

type EventLoad = {state: 'loading'} | {state: 'missing'} | {state: 'ready'; event: GuideEvent | null};

// How often the "right now" statuses move on.
const NOW_TICK_MS = 60_000;

export const ParkingGuide = () => {
    const {eventId} = useParams<{eventId: string}>();
    // The con page knows its venue but is not an upcoming event, so it links here
    // by venue instead; with no event to look up, that venue is the default.
    const [searchParams] = useSearchParams();
    const venueParam = eventId ? '' : searchParams.get('venue') ?? '';
    const tx = useParkingText();
    const {venues, loading: venuesLoading} = useVenues();
    const {parking, loading: parkingLoading} = useUwParking();
    const {content: con, loading: conLoading} = useConContent();

    const [upcoming, setUpcoming] = useState<EventLoad>(eventId ? {state: 'loading'} : {state: 'ready', event: null});
    useEffect(() => {
        if (!eventId) {
            setUpcoming({state: 'ready', event: null});
            return;
        }
        let cancelled = false;
        (async () => {
            try {
                const snap = await getDoc(doc(getFirebaseDb(), 'upcomingEvents', eventId));
                const data = snap.data();
                if (cancelled) return;
                if (!data) {
                    setUpcoming({state: 'missing'});
                    return;
                }
                const startAt = data.startAt?.toDate?.() ?? null, endAt = data.endAt?.toDate?.() ?? null;
                setUpcoming({
                    state: 'ready',
                    event: startAt ? {
                        title: {en: data.title ?? '', zh: data.titleCn ?? ''},
                        venueId: data.venueId ?? '',
                        start: toDatetimeLocal(startAt),
                        end: toDatetimeLocal(endAt),
                    } : null,
                });
            } catch (err) {
                console.error('[ParkingGuide] fetch error:', err);
                if (!cancelled) setUpcoming({state: 'missing'});
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [eventId]);

    // A venue link to the con's own venue plans around the con, until the con is over.
    const conEvent = useMemo((): GuideEvent | null => {
        const {date, endTime, venueId} = con.event;
        if (!venueParam || venueParam !== venueId || !date) return null;
        const start = toDatetimeLocal(parseSiteTime(date));
        const end = endTime ? toDatetimeLocal(parseSiteTime(endTime)) : '';
        if (!start || (end || start).slice(0, 10) < siteDay(new Date())) return null;
        return {title: CON_NAME, venueId, start, end};
    }, [con.event, venueParam]);
    const event = upcoming.state === 'ready' ? upcoming.event ?? conEvent : null;
    const eventVenueId = event?.venueId ?? '';

    // Which venue's parking guide is displayed. Defaults to the event's own venue (or
    // the one a `?venue=` link names) once it's known; the switcher can change it.
    const [selectedVenueId, setSelectedVenueId] = useState('');
    const defaultVenueId = eventVenueId || venueParam;
    useEffect(() => setSelectedVenueId(defaultVenueId), [defaultVenueId]);
    const venue = resolveVenueById(selectedVenueId, venues);
    const eventVenue = resolveVenueById(eventVenueId, venues);

    // Each lot also shows how it is right now, so the clock moves the guide on.
    // Without an event, statuses are for this minute.
    const [now, setNow] = useState(() => new Date());
    useEffect(() => {
        const id = setInterval(() => setNow(new Date()), NOW_TICK_MS);
        return () => clearInterval(id);
    }, []);
    const thisMinute = useMemo(() => nowWindow(now), [now]);
    const parkingWindow = useMemo(() => (event && eventWindow(event)) || thisMinute, [event, thisMinute]);

    const views = useMemo(
        () => venue ? lotViews(parking, venue, parkingWindow, thisMinute) : [],
        [parking, venue, parkingWindow, thisMinute],
    );
    const [query, setQuery] = useState('');
    const [filters, setFilters] = useState<ReadonlySet<LotFilter>>(new Set());
    const visibleViews = useMemo(() => views.filter(v => matchesFilters(v, query, filters)), [views, query, filters]);
    const visibleCodes = useMemo(() => new Set(visibleViews.map(v => v.lot.code)), [visibleViews]);
    const listedCodes = useMemo(() => new Set(parking.lots.map(l => l.code)), [parking.lots]);

    const [selectedCode, setSelectedCode] = useState<string | null>(null);
    const [hover, setHover] = useState<HoverTarget | null>(null);
    const [hotCode, setHotCode] = useState<string | null>(null);
    const mapApi = useRef<ParkingMapApi>(null);
    const panelRef = useRef<HTMLElement>(null);
    // Where the list was scrolled to, so closing a lot returns there.
    const listScroll = useRef(0);

    const selectVenue = (id: string) => {
        setSelectedVenueId(id);
        setSelectedCode(null);
        setHover(null);
        setHotCode(null);
        if (panelRef.current) panelRef.current.scrollTop = 0;
    };

    const openLot = (code: string) => {
        const panel = panelRef.current;
        if (panel && !selectedCode) listScroll.current = panel.scrollTop;
        setSelectedCode(code);
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

    const closeLot = () => setSelectedCode(null);
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

    const loading = upcoming.state === 'loading' || venuesLoading || parkingLoading || (!!venueParam && conLoading);
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

    if (upcoming.state === 'missing') {
        return (
            <div className="parking-page">
                <TopBar tx={tx}/>
                <Notice icon="🅿️" title={tx.t('notFoundTitle')} desc={tx.t('notFoundDesc')}/>
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

            {venue ? (
                <div className="parking-content">
                    <section className="parking-map-container" aria-label={tx.t('mapLabel')}>
                        <ParkingMap
                            ref={mapApi}
                            views={views}
                            visibleCodes={visibleCodes}
                            venues={venues}
                            venue={venue}
                            outline={parking.outlines[venue.id] ?? null}
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
                                venueName={venueName(venue)}
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
            ) : (
                <>
                    {/* No venue selected (e.g. event has no linked venue) — prompt to pick one. */}
                    <Notice icon="🅿️" title={tx.t('chooseTitle')} desc={tx.t('chooseDesc')} inline/>
                    <Footer generatedAt="" tx={tx}/>
                </>
            )}
        </div>
    );
};
