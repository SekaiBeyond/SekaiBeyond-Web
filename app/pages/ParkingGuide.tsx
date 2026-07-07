import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router';
import { doc, getDoc } from 'firebase/firestore';
import { getFirebaseDb } from '~/lib/firebase';
import {
    formatDistanceEstimate,
    hasCoordinates,
    haversineMiles,
    PARKING_INFO_URL,
    resolveVenueById,
    useVenues,
    type Venue,
} from '~/lib/venues';
import { lotBadgeChar, lotTypeLabel, type ParkingLot, useParkingLots } from '~/lib/parkingLots';
import { NO_RATE_COLOR, type ParkingRate, rateColorById, rateLabel, useParkingRates } from '~/lib/parkingRates';
import type { UpcomingEvent } from '~/lib/upcomingEvents';
import { useLanguage } from '~/components/LanguageContextProvider';
import { LanguageSwitcher } from '~/components/LanguageSwitcher';
import { AdvancedMarker, APIProvider, InfoWindow, Map, useMap } from '@vis.gl/react-google-maps';

/** Sentinel id for the venue marker's popup, kept distinct from any lot document id. */
const VENUE_MARKER_ID = '__venue__';

/**
 * Searchable venue picker shown in the parking-guide header. Defaults to the event's own
 * venue but lets visitors switch to any other venue to view its parking map and lots.
 */
interface VenueSwitcherProps {
    venues: Venue[];
    selectedId: string;
    onSelect: (id: string) => void;
    isEnglish: boolean;
}

const VenueSwitcher = ({venues, selectedId, onSelect, isEnglish}: VenueSwitcherProps) => {
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState('');
    const containerRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    const selected = venues.find(v => v.id === selectedId) ?? null;
    const triggerLabel = selected
        ? (isEnglish ? selected.nameEn : (selected.nameCn || selected.nameEn))
        : (isEnglish ? 'Select a venue' : '选择场地');

    const q = query.trim().toLowerCase();
    const filtered = q
        ? venues.filter(v => v.nameEn.toLowerCase().includes(q) || v.nameCn.toLowerCase().includes(q))
        : venues;

    // While open: close on outside click / Escape and focus the search box.
    useEffect(() => {
        if (!open) {
            setQuery('');
            return;
        }
        const onDown = (e: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
                setOpen(false);
            }
        };
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') setOpen(false);
        };
        document.addEventListener('mousedown', onDown);
        document.addEventListener('keydown', onKey);
        inputRef.current?.focus();
        return () => {
            document.removeEventListener('mousedown', onDown);
            document.removeEventListener('keydown', onKey);
        };
    }, [open]);

    const choose = (id: string) => {
        onSelect(id);
        setOpen(false);
    };

    return (
        <div className="parking-venue-switcher" ref={containerRef}>
            <button
                type="button"
                className="parking-venue-switcher-trigger"
                onClick={() => setOpen(o => !o)}
                aria-haspopup="listbox"
                aria-expanded={open}
            >
                <span className="parking-venue-switcher-name">{triggerLabel}</span>
                <span className="parking-venue-switcher-chevron-badge">
                    <span className={`parking-venue-switcher-chevron${open ? ' is-open' : ''}`}>▾</span>
                </span>
            </button>

            {open && (
                <div className="parking-venue-switcher-panel" role="listbox">
                    <input
                        ref={inputRef}
                        className="parking-venue-switcher-search"
                        type="text"
                        value={query}
                        onChange={e => setQuery(e.target.value)}
                        placeholder={isEnglish ? 'Search venues…' : '搜索场地…'}
                    />
                    <div className="parking-venue-switcher-list">
                        {filtered.length === 0 ? (
                            <div className="parking-venue-switcher-empty">
                                {isEnglish ? 'No venues found' : '未找到场地'}
                            </div>
                        ) : (
                            filtered.map(v => {
                                const name = isEnglish ? v.nameEn : (v.nameCn || v.nameEn);
                                const active = v.id === selectedId;
                                return (
                                    <button
                                        key={v.id}
                                        type="button"
                                        role="option"
                                        aria-selected={active}
                                        className={`parking-venue-switcher-option${active ? ' is-active' : ''}`}
                                        onClick={() => choose(v.id)}
                                    >
                                        <span className="parking-venue-switcher-option-name">{name}</span>
                                        {active && <span className="parking-venue-switcher-check">✓</span>}
                                    </button>
                                );
                            })
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};

/**
 * Searchable parking-lot finder shown in the info panel. Searches every mappable lot (not
 * just the venue's linked ones); picking one focuses it on the map and surfaces its
 * straight-line distance from the selected venue.
 */
interface LotSearchProps {
    lots: ParkingLot[];
    selectedLotId: string | null;
    distanceFor: (lot: ParkingLot) => string | null;
    onSelect: (lot: ParkingLot) => void;
    isEnglish: boolean;
}

const LotSearch = ({lots, selectedLotId, distanceFor, onSelect, isEnglish}: LotSearchProps) => {
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState('');
    const containerRef = useRef<HTMLDivElement>(null);

    // Clear the field when the selection is reset externally (e.g. the venue changed).
    useEffect(() => {
        if (!selectedLotId) setQuery('');
    }, [selectedLotId]);

    // While open: close on outside click / Escape.
    useEffect(() => {
        if (!open) return;
        const onDown = (e: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
                setOpen(false);
            }
        };
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') setOpen(false);
        };
        document.addEventListener('mousedown', onDown);
        document.addEventListener('keydown', onKey);
        return () => {
            document.removeEventListener('mousedown', onDown);
            document.removeEventListener('keydown', onKey);
        };
    }, [open]);

    const q = query.trim().toLowerCase();
    const results = q
        ? lots.filter(l => l.name.toLowerCase().includes(q) || l.nameCn.toLowerCase().includes(q))
        : lots;

    const choose = (lot: ParkingLot) => {
        onSelect(lot);
        setQuery(isEnglish ? lot.name : (lot.nameCn || lot.name));
        setOpen(false);
    };

    return (
        <div className="parking-lot-search" ref={containerRef}>
            <div className="parking-lot-search-field">
                <span className="parking-lot-search-icon">🔍</span>
                <input
                    className="parking-lot-search-input"
                    type="text"
                    value={query}
                    onChange={e => {
                        setQuery(e.target.value);
                        setOpen(true);
                    }}
                    onFocus={() => setOpen(true)}
                    placeholder={isEnglish ? 'Search parking lots…' : '搜索停车场…'}
                />
            </div>

            {open && (
                <div className="parking-lot-search-panel" role="listbox">
                    {results.length === 0 ? (
                        <div className="parking-lot-search-empty">
                            {isEnglish ? 'No parking lots found' : '未找到停车场'}
                        </div>
                    ) : (
                        results.map(lot => {
                            const badge = lotBadgeChar(lot.type);
                            const name = isEnglish ? lot.name : (lot.nameCn || lot.name);
                            const dist = distanceFor(lot);
                            const active = lot.id === selectedLotId;
                            return (
                                <button
                                    key={lot.id}
                                    type="button"
                                    role="option"
                                    aria-selected={active}
                                    className={`parking-lot-search-option${active ? ' is-active' : ''}`}
                                    onClick={() => choose(lot)}
                                >
                                    <span className="parking-lot-search-badge" data-type={lot.type}>{badge}</span>
                                    <span className="parking-lot-search-opt-body">
                                        <span className="parking-lot-search-opt-name">{name}</span>
                                        <span className="parking-lot-search-opt-meta">
                                            {lotTypeLabel(lot.type, isEnglish)}{dist ? ` · ${dist}` : ''}
                                        </span>
                                    </span>
                                </button>
                            );
                        })
                    )}
                </div>
            )}
        </div>
    );
};

/**
 * Headless helper that lives inside the Map and pans it to the given point whenever it
 * changes — used to focus a lot picked from the search.
 */
const MapPanner = ({lat, lng}: {lat: number | null; lng: number | null}) => {
    const map = useMap();
    useEffect(() => {
        if (!map || lat == null || lng == null) return;
        map.panTo({lat, lng});
    }, [map, lat, lng]);
    return null;
};

/** The subset of an upcomingEvents doc the parking guide reads. */
type EventSnapshot = Pick<UpcomingEvent, 'title' | 'titleCn' | 'location' | 'locationCn' | 'venueId'>;

export const ParkingGuide = () => {
    const {eventId} = useParams<{eventId: string}>();
    const {isEnglish} = useLanguage();
    const {venues, loading: venuesLoading} = useVenues();
    const {parkingLots, loading: lotsLoading} = useParkingLots();
    const {parkingRates, loading: ratesLoading} = useParkingRates();

    const [event, setEvent] = useState<EventSnapshot | null>(null);
    const [eventLoading, setEventLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    // Which venue's parking guide is currently displayed. Defaults to the event's own
    // venue (set once the event loads) but the header switcher can change it.
    const [selectedVenueId, setSelectedVenueId] = useState('');

    // Track which marker's popup is currently open
    const [openInfoWindowId, setOpenInfoWindowId] = useState<string | null>(null);
    // A lot picked from the search, focused on the map.
    const [focusedLotId, setFocusedLotId] = useState<string | null>(null);

    // ---- Fetch event ----
    useEffect(() => {
        if (!eventId) {
            setError('No event ID');
            setEventLoading(false);
            return;
        }

        (async () => {
            try {
                const db = getFirebaseDb();
                const snap = await getDoc(doc(db, 'upcomingEvents', eventId));
                if (!snap.exists()) {
                    setError('Event not found');
                    setEventLoading(false);
                    return;
                }
                const data = snap.data() as Record<string, unknown>;
                const ev: EventSnapshot = {
                    title: (data.title as string) ?? '',
                    titleCn: (data.titleCn as string) ?? '',
                    location: (data.location as string) ?? '',
                    locationCn: (data.locationCn as string) ?? '',
                    venueId: (data.venueId as string) ?? '',
                };
                setEvent(ev);
            } catch (err) {
                console.error('[ParkingGuide] fetch error:', err);
                setError('Failed to load event');
            } finally {
                setEventLoading(false);
            }
        })();
    }, [eventId]);

    // Default the displayed venue to the event's own venue once it loads.
    useEffect(() => {
        if (event) setSelectedVenueId(event.venueId);
    }, [event]);

    const selectVenue = (id: string) => {
        setSelectedVenueId(id);
        // Drop any open marker popup / lot focus from the previous venue.
        setOpenInfoWindowId(null);
        setFocusedLotId(null);
    };

    const focusLot = (lot: ParkingLot) => {
        setFocusedLotId(lot.id);
        setOpenInfoWindowId(lot.id);
    };

    const venue: Venue | null = resolveVenueById(selectedVenueId, venues);

    // Resolve a lot's rate tier to its localized label, or null when none is assigned.
    // (A plain object, not a Map — `Map` here is the Google Maps component, not the global.)
    const rateById = useMemo(() => {
        const lookup: Record<string, ParkingRate> = {};
        for (const r of parkingRates) lookup[r.id] = r;
        return lookup;
    }, [parkingRates]);
    const rateLabelFor = useCallback(
        (lot: ParkingLot): string | null => {
            const rate = lot.rateId ? rateById[lot.rateId] : undefined;
            return rate ? rateLabel(rate, isEnglish) : null;
        },
        [rateById, isEnglish],
    );
    // Marker colors encode the price tier (UW parking-map style); grey = no rate assigned.
    const colorById = useMemo(() => rateColorById(parkingRates), [parkingRates]);
    const lotColor = useCallback(
        (lot: ParkingLot): string => (lot.rateId && colorById[lot.rateId]) || NO_RATE_COLOR,
        [colorById],
    );

    // Straight-line distance from the selected venue to each lot, computed once per
    // venue/lots/language change rather than on every render and every call site.
    const distanceByLotId = useMemo(() => {
        const distances: Record<string, string> = {};
        if (!venue || !hasCoordinates(venue.lat, venue.lng)) return distances;
        for (const lot of parkingLots) {
            if (hasCoordinates(lot.lat, lot.lng)) {
                distances[lot.id] = formatDistanceEstimate(
                    haversineMiles(venue.lat, venue.lng, lot.lat, lot.lng), isEnglish);
            }
        }
        return distances;
    }, [venue, parkingLots, isEnglish]);
    const distanceFor = useCallback(
        (lot: ParkingLot): string | null => distanceByLotId[lot.id] ?? null,
        [distanceByLotId],
    );
    // The map shows every lot; this tells us which to highlight as linked to this venue.
    const linkedLotIds = venue ? new Set(venue.parkingLots.map(l => l.lotId)) : new Set<string>();
    const hydratedLots: ParkingLot[] = venue
        ? venue.parkingLots
            .map(link => parkingLots.find(l => l.id === link.lotId) ?? null)
            .filter((l): l is ParkingLot => l !== null)
        : [];
    // Only plot lots with real coordinates (skip 0,0 placeholders).
    const mappableLots = parkingLots.filter(l => hasCoordinates(l.lat, l.lng));
    // Legend rows: only the rate tiers some plotted lot actually uses, in display order.
    const usedRateIds = new Set(mappableLots.map(l => l.rateId).filter(Boolean));
    const legendRates = parkingRates.filter(r => usedRateIds.has(r.id));
    const hasUnratedLot = mappableLots.some(l => !l.rateId || !rateById[l.rateId]);
    const focusedLot = focusedLotId ? (mappableLots.find(l => l.id === focusedLotId) ?? null) : null;

    // Frame the map on the venue and its linked (primary) lots so they're the prominent
    // focus. Every other lot is still rendered, so users see them too and can pan/zoom out
    // to explore; the padding keeps nearby lots in view on load.
    const focusPoints = venue
        ? [{lat: venue.lat, lng: venue.lng}, ...mappableLots.filter(l => linkedLotIds.has(l.id))]
        : [];
    const mapBounds = venue
        ? {
            north: Math.max(...focusPoints.map(p => p.lat)),
            south: Math.min(...focusPoints.map(p => p.lat)),
            east: Math.max(...focusPoints.map(p => p.lng)),
            west: Math.min(...focusPoints.map(p => p.lng)),
        }
        : null;

    const loading = eventLoading || venuesLoading || lotsLoading || ratesLoading;

    if (loading) {
        return (
            <div className="parking-page">
                <div className="parking-loading">
                    <div className="loader"></div>
                    <span className="parking-loading-text">
                        {isEnglish ? 'Loading parking guide…' : '加载停车指南…'}
                    </span>
                </div>
            </div>
        );
    }

    if (error || !event) {
        return (
            <div className="parking-page">
                <div className="parking-topbar">
                    <a href="/" className="parking-back-btn">
                        <span className="parking-back-arrow">←</span>
                        {isEnglish ? 'Back to Home' : '返回首页'}
                    </a>
                    <LanguageSwitcher/>
                </div>
                <div className="parking-error">
                    <div className="parking-error-icon">🅿️</div>
                    <h2 className="parking-error-title">
                        {isEnglish ? 'Event Not Found' : '未找到活动'}
                    </h2>
                    <p className="parking-error-desc">
                        {isEnglish
                            ? 'The event you\'re looking for doesn\'t exist or has been removed.'
                            : '您查找的活动不存在或已被移除。'}
                    </p>
                </div>
            </div>
        );
    }

    // No venues exist at all — there's nothing to show or switch between.
    if (venues.length === 0) {
        return (
            <div className="parking-page">
                <div className="parking-topbar">
                    <a href="/" className="parking-back-btn">
                        <span className="parking-back-arrow">←</span>
                        {isEnglish ? 'Back to Home' : '返回首页'}
                    </a>
                    <LanguageSwitcher/>
                </div>
                <div className="parking-error">
                    <div className="parking-error-icon">📍</div>
                    <h2 className="parking-error-title">
                        {isEnglish ? 'Parking Guide Unavailable' : '停车指南暂不可用'}
                    </h2>
                    <p className="parking-error-desc">
                        {isEnglish
                            ? 'No parking guides are available yet. Check back later or contact the organizers.'
                            : '暂无停车指南。请稍后查看或联系主办方。'}
                    </p>
                </div>
            </div>
        );
    }

    const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY || '';
    const mapId = import.meta.env.VITE_GOOGLE_MAPS_MAP_ID || 'DEMO_MAP_ID';

    return (
        <div className="parking-page">
            {/* Decorative blobs */}
            <div className="parking-deco-blob parking-deco-blob--1"/>
            <div className="parking-deco-blob parking-deco-blob--2"/>

            {/* Top bar: back button + language toggle */}
            <div className="parking-topbar">
                <a href="/" className="parking-back-btn">
                    <span className="parking-back-arrow">←</span>
                    {isEnglish ? 'Back to Home' : '返回首页'}
                </a>
                <LanguageSwitcher/>
            </div>

            {/* Header */}
            <header className="parking-header">
                <span className="parking-header-sparkle">✦</span>
                <span className="parking-header-sparkle">✦</span>
                <h1 className="parking-title">
                    {isEnglish ? 'Parking Guide' : '停车指南'}
                </h1>
                <div className="parking-venue-row">
                    <span className="parking-venue-label">
                        {isEnglish ? 'Viewing parking for' : '查看停车场地'}
                    </span>
                    <VenueSwitcher
                        venues={venues}
                        selectedId={selectedVenueId}
                        onSelect={selectVenue}
                        isEnglish={isEnglish}
                    />
                </div>
            </header>

            {/* Main content */}
            {venue ? (
                <div className="parking-content">
                    {/* Map */}
                    <div className="parking-map-container">
                        <div className="parking-map">
                            <APIProvider apiKey={apiKey}>
                                <Map
                                    key={venue.id}
                                    defaultBounds={{...mapBounds!, padding: 90}}
                                    mapId={mapId}
                                    gestureHandling="greedy"
                                    disableDefaultUI={true}
                                    zoomControl={true}
                                >
                                    <MapPanner
                                        lat={focusedLot?.lat ?? null}
                                        lng={focusedLot?.lng ?? null}
                                    />

                                    {/* Venue Marker */}
                                    <AdvancedMarker
                                        position={{lat: venue.lat, lng: venue.lng}}
                                        onClick={() => setOpenInfoWindowId(VENUE_MARKER_ID)}
                                    >
                                        <div className="parking-marker-venue-inner">⭐</div>
                                    </AdvancedMarker>

                                    {openInfoWindowId === VENUE_MARKER_ID && (
                                        <InfoWindow
                                            position={{lat: venue.lat, lng: venue.lng}}
                                            onCloseClick={() => setOpenInfoWindowId(null)}
                                            pixelOffset={[0, -48]}
                                        >
                                            <div className="parking-popup-content">
                                                <div
                                                    className="parking-popup-title">{isEnglish ? venue.nameEn : venue.nameCn}</div>
                                                <div
                                                    className="parking-popup-type">{isEnglish ? 'Event Venue' : '活动场地'}</div>
                                            </div>
                                        </InfoWindow>
                                    )}

                                    {/* Parking Lot Markers — every lot is shown; lots linked to this venue are highlighted. */}
                                    {mappableLots.map((lot) => {
                                        const linked = linkedLotIds.has(lot.id);
                                        const typeLabel = lotTypeLabel(lot.type, isEnglish);
                                        const dist = distanceFor(lot);
                                        const rateText = rateLabelFor(lot);
                                        return (
                                            <div key={lot.id}>
                                                <AdvancedMarker
                                                    position={{lat: lot.lat, lng: lot.lng}}
                                                    onClick={() => setOpenInfoWindowId(lot.id)}
                                                    zIndex={linked ? 2 : 1}
                                                >
                                                    <div
                                                        className={`parking-marker-lot-inner${linked ? ' is-linked' : ''}`}>
                                                        <div
                                                            className="parking-marker-p"
                                                            style={{background: lotColor(lot)}}
                                                        >{lotBadgeChar(lot.type)}</div>
                                                        {linked && (
                                                            <div
                                                                className="parking-marker-label">{lot.name.split(' ')[0] ?? ''}<span>{typeLabel}</span>
                                                            </div>
                                                        )}
                                                    </div>
                                                </AdvancedMarker>

                                                {openInfoWindowId === lot.id && (
                                                    <InfoWindow
                                                        position={{lat: lot.lat, lng: lot.lng}}
                                                        onCloseClick={() => setOpenInfoWindowId(null)}
                                                        pixelOffset={[0, -52]}
                                                    >
                                                        <div className="parking-popup-content">
                                                            <div
                                                                className="parking-popup-title">{isEnglish ? lot.name : lot.nameCn}</div>
                                                            <div className="parking-popup-type">{typeLabel}</div>
                                                            {rateText && (
                                                                <div className="parking-popup-type">💲 {rateText}</div>
                                                            )}
                                                            {dist && (
                                                                <div className="parking-popup-dist">📍 {dist}</div>
                                                            )}
                                                        </div>
                                                    </InfoWindow>
                                                )}
                                            </div>
                                        );
                                    })}
                                </Map>
                            </APIProvider>
                        </div>

                        {/* Price legend (UW parking-map style): marker color = rate tier. */}
                        <div className="parking-map-legend">
                            <div className="parking-map-legend-title">
                                {isEnglish ? 'Legend' : '图例'}
                            </div>
                            <div className="parking-map-legend-item">
                                <span className="parking-map-legend-star">⭐</span>
                                {isEnglish ? 'Event venue' : '活动场地'}
                            </div>
                            {legendRates.map(rate => (
                                <div key={rate.id} className="parking-map-legend-item">
                                    <span
                                        className="parking-map-legend-dot"
                                        style={{background: colorById[rate.id]}}
                                    >P</span>
                                    {rateLabel(rate, isEnglish)}
                                </div>
                            ))}
                            {hasUnratedLot && (
                                <div className="parking-map-legend-item">
                                    <span
                                        className="parking-map-legend-dot"
                                        style={{background: NO_RATE_COLOR}}
                                    >P</span>
                                    {isEnglish ? 'Rate not posted' : '未公布费率'}
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Info panel */}
                    <div className="parking-info-panel">
                        {/* Find any parking lot and see its distance from the venue */}
                        <LotSearch
                            lots={mappableLots}
                            selectedLotId={focusedLotId}
                            distanceFor={distanceFor}
                            onSelect={focusLot}
                            isEnglish={isEnglish}
                        />

                        {/* Time / Free parking info */}
                        <div className="parking-info-card">
                            <div className="parking-info-icon parking-info-icon--time">🕐</div>
                            <div className="parking-info-text">
                                {isEnglish ? (
                                    <>
                                        Parking permits are complimentary during <strong>Saturdays after
                                        noon</strong> until{' '}
                                        <strong>Monday 6 a.m.</strong>, except when{' '}
                                        <strong>event rates</strong>{' '}
                                        are in effect.
                                    </>
                                ) : (
                                    <>
                                        <strong>周六中午</strong>至<strong>周一早上6点</strong>期间停车免费，
                                        <strong>活动费率</strong>
                                        生效时除外。
                                    </>
                                )}
                            </div>
                        </div>

                        {/* One card per parking lot */}
                        {hydratedLots.map(lot => {
                            const badge = lotBadgeChar(lot.type);
                            const iconClass = lot.type === 'disabled' ? 'parking-info-icon--disabled'
                                : lot.type === 'garage' ? 'parking-info-icon--garage' : 'parking-info-icon--general';
                            const typeLabel = lotTypeLabel(lot.type, isEnglish);
                            const name = isEnglish ? lot.name : (lot.nameCn || lot.name);
                            const dist = distanceFor(lot);
                            const rate = rateLabelFor(lot);
                            return (
                                <div key={lot.id} className="parking-info-card">
                                    <div className={`parking-info-icon ${iconClass}`}>{badge}</div>
                                    <div className="parking-info-text">
                                        <div className="parking-lot-name-row">
                                            <span className="parking-lot-name">{name}</span>
                                        </div>
                                        <div className="parking-lot-type">{typeLabel}</div>
                                        {dist && <div className="parking-lot-dist">📍 {dist}</div>}
                                        {rate && <div className="parking-lot-rate">💲 {rate}</div>}
                                    </div>
                                </div>
                            );
                        })}

                        {/* More info link */}
                        <div className="parking-info-card">
                            <div className="parking-info-icon parking-info-icon--info">🅿️</div>
                            <div className="parking-info-text">
                                {isEnglish ? (
                                    <>
                                        For more information, visit{' '}
                                        <a
                                            href={PARKING_INFO_URL}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                        >
                                            {PARKING_INFO_URL}
                                        </a>
                                    </>
                                ) : (
                                    <>
                                        更多信息请访问{' '}
                                        <a
                                            href={PARKING_INFO_URL}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                        >
                                            {PARKING_INFO_URL}
                                        </a>
                                    </>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            ) : (
                /* No venue selected (e.g. event has no linked venue) — prompt to pick one. */
                <div className="parking-error parking-error--inline">
                    <div className="parking-error-icon">🅿️</div>
                    <h2 className="parking-error-title">
                        {isEnglish ? 'Choose a Venue' : '选择场地'}
                    </h2>
                    <p className="parking-error-desc">
                        {isEnglish
                            ? 'Pick a venue above to see its parking map and nearby lots.'
                            : '在上方选择场地，即可查看其停车地图及附近停车场。'}
                    </p>
                </div>
            )}

            {/* Footer branding */}
            <div className="parking-footer">
                <span className="parking-footer-text">
                    <span className="parking-footer-sparkle">✦</span>
                    Sekai Beyond 2026
                    <span className="parking-footer-sparkle">✦</span>
                </span>
            </div>
        </div>
    );
};
