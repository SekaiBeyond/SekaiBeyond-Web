import { useEffect, useState } from 'react';
import { useParams } from 'react-router';
import { doc, getDoc } from 'firebase/firestore';
import { getFirebaseDb } from '~/lib/firebase';
import { hasCoordinates, PARKING_INFO_URL, resolveVenueById, useVenues, type Venue, } from '~/lib/venues';
import { type ParkingLot, useParkingLots } from '~/lib/parkingLots';
import { useLanguage } from '~/components/LanguageContextProvider';
import { LanguageSwitcher } from '~/components/LanguageSwitcher';
import { AdvancedMarker, APIProvider, InfoWindow, Map } from '@vis.gl/react-google-maps';

type HydratedLot = ParkingLot;

/**
 * Minimal interface mirroring the fields we need from the upcomingEvents doc.
 */
interface EventSnapshot {
    title: string;
    titleCn: string;
    location: string;
    locationCn: string;
    venueId: string;
}

export const ParkingGuide = () => {
    const {eventId} = useParams<{eventId: string}>();
    const {isEnglish} = useLanguage();
    const {venues, loading: venuesLoading} = useVenues();
    const {parkingLots, loading: lotsLoading} = useParkingLots();

    const [event, setEvent] = useState<EventSnapshot | null>(null);
    const [eventLoading, setEventLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    // Track which marker's popup is currently open
    const [openInfoWindowId, setOpenInfoWindowId] = useState<string | null>(null);

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

    const venue: Venue | null = event ? resolveVenueById(event.venueId, venues) : null;
    const hydratedLots: HydratedLot[] = venue
        ? venue.parkingLots
            .map(link => parkingLots.find(l => l.id === link.lotId) ?? null)
            .filter((l): l is HydratedLot => l !== null)
        : [];
    const loading = eventLoading || venuesLoading || lotsLoading;

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
                    <a href="/#upcoming" className="parking-back-btn">
                        <span className="parking-back-arrow">←</span>
                        {isEnglish ? 'Back to Events' : '返回活动'}
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

    if (!venue) {
        return (
            <div className="parking-page">
                <div className="parking-topbar">
                    <a href="/#upcoming" className="parking-back-btn">
                        <span className="parking-back-arrow">←</span>
                        {isEnglish ? 'Back to Events' : '返回活动'}
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
                            ? `No parking guide is available for "${event.location}". Check back later or contact the organizers.`
                            : `暂无"${event.locationCn || event.location}"的停车指南。请稍后查看或联系主办方。`}
                    </p>
                </div>
            </div>
        );
    }

    // The map shows every lot; this tells us which to highlight as linked to this venue.
    const linkedLotIds = new Set(venue.parkingLots.map(l => l.lotId));
    // Only plot lots with real coordinates (skip 0,0 placeholders).
    const mappableLots = parkingLots.filter(l => hasCoordinates(l.lat, l.lng));

    // Frame the map on the venue and its linked (primary) lots so they're the prominent
    // focus. Every other lot is still rendered (dimmed), so users see them too and can
    // pan/zoom out to explore; the padding keeps nearby lots in view on load.
    const focusPoints = [
        {lat: venue.lat, lng: venue.lng},
        ...mappableLots.filter(l => linkedLotIds.has(l.id)),
    ];
    const mapBounds = {
        north: Math.max(...focusPoints.map(p => p.lat)),
        south: Math.min(...focusPoints.map(p => p.lat)),
        east: Math.max(...focusPoints.map(p => p.lng)),
        west: Math.min(...focusPoints.map(p => p.lng)),
    };

    const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY || '';
    const mapId = import.meta.env.VITE_GOOGLE_MAPS_MAP_ID || 'DEMO_MAP_ID';

    return (
        <div className="parking-page">
            {/* Decorative blobs */}
            <div className="parking-deco-blob parking-deco-blob--1"/>
            <div className="parking-deco-blob parking-deco-blob--2"/>

            {/* Top bar: back button + language toggle */}
            <div className="parking-topbar">
                <a href="/#upcoming" className="parking-back-btn">
                    <span className="parking-back-arrow">←</span>
                    {isEnglish ? 'Back to Events' : '返回活动'}
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
                    <span className="parking-venue-name">
                        {isEnglish ? venue.nameEn : venue.nameCn}
                    </span>
                </div>
            </header>

            {/* Main content */}
            <div className="parking-content">
                {/* Map */}
                <div className="parking-map-container">
                    <div className="parking-map">
                        <APIProvider apiKey={apiKey}>
                            <Map
                                defaultBounds={{...mapBounds, padding: 90}}
                                mapId={mapId}
                                gestureHandling="greedy"
                                disableDefaultUI={true}
                                zoomControl={true}
                            >
                                {/* Venue Marker */}
                                <AdvancedMarker
                                    position={{lat: venue.lat, lng: venue.lng}}
                                    onClick={() => setOpenInfoWindowId('venue')}
                                >
                                    <div className="parking-marker-venue-inner">⭐</div>
                                </AdvancedMarker>

                                {openInfoWindowId === 'venue' && (
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
                                    const colorClass = lot.type === 'disabled' ? 'parking-marker-p--disabled'
                                        : lot.type === 'garage' ? 'parking-marker-p--garage'
                                            : '';

                                    const typeLabel = isEnglish
                                        ? (lot.type === 'disabled' ? 'Disabled Parking'
                                            : lot.type === 'garage' ? 'Parking Garage'
                                                : 'General Parking')
                                        : (lot.type === 'disabled' ? '无障碍停车'
                                            : lot.type === 'garage' ? '停车库'
                                                : '普通停车');
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
                                                        className={`parking-marker-p ${colorClass}`}>{lot.type === 'disabled' ? '♿' : 'P'}</div>
                                                    {linked && (
                                                        <div
                                                            className="parking-marker-label">{lot.name.split(' ').slice(0, 1).join(' ')}<span>{typeLabel}</span>
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
                                                    </div>
                                                </InfoWindow>
                                            )}
                                        </div>
                                    );
                                })}
                            </Map>
                        </APIProvider>
                    </div>
                </div>

                {/* Info panel */}
                <div className="parking-info-panel">
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
                        const badge = lot.type === 'disabled' ? '♿'
                            : lot.type === 'garage' ? 'G' : 'P';
                        const iconClass = lot.type === 'disabled' ? 'parking-info-icon--disabled'
                            : lot.type === 'garage' ? 'parking-info-icon--garage' : 'parking-info-icon--general';
                        const typeLabel = isEnglish
                            ? (lot.type === 'disabled' ? 'Disabled Parking'
                                : lot.type === 'garage' ? 'Parking Garage' : 'General Parking')
                            : (lot.type === 'disabled' ? '无障碍停车'
                                : lot.type === 'garage' ? '停车库' : '普通停车');
                        const name = isEnglish ? lot.name : (lot.nameCn || lot.name);
                        const desc = isEnglish ? lot.descriptionEn : lot.descriptionCn;
                        return (
                            <div key={lot.id} className="parking-info-card">
                                <div className={`parking-info-icon ${iconClass}`}>{badge}</div>
                                <div className="parking-info-text">
                                    <div className="parking-lot-name-row">
                                        <span className="parking-lot-name">{name}</span>
                                    </div>
                                    <div className="parking-lot-type">{typeLabel}</div>
                                    {desc && <div className="parking-lot-desc">{desc}</div>}
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
