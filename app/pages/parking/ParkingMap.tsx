import 'maplibre-gl/dist/maplibre-gl.css';
import {
    AttributionControl,
    type FilterSpecification,
    type GeoJSONSource,
    type LngLatBoundsLike,
    Map as MapLibreMap,
    Marker,
    NavigationControl,
    type PaddingOptions,
    Popup,
    setWorkerUrl,
} from 'maplibre-gl';
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import { type Dispatch, type Ref, type SetStateAction, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { VenueOutline } from '~/lib/uwParking';
import { hasCoordinates, type Venue } from '~/lib/venues';
import { localizedVenueName, lotSubtitle, type LotView } from './model';
import { pinGlyph, rateText, StatusPill, walkText } from './parts';
import type { ParkingText } from './text';

// MapLibre looks for its worker beside its own script, which the bundle moves.
setWorkerUrl(maplibreWorkerUrl);

// OpenFreeMap: OpenStreetMap tiles with no key, no billing and no request limit.
const STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty';
const ATTRIBUTION = 'UW Transportation Services · UW Facilities GIS';
// Lot codes appear beside the plain pins from this zoom; suggested lots always show theirs.
const LABEL_ZOOM = 17.4;
// Clicking a lot zooms to at least this.
const LOT_ZOOM = 17;

export type HoverTarget = {kind: 'lot'; code: string; pinned: boolean} | {kind: 'venue'; id: string};

export interface ParkingMapApi {
    /** Frames the venue and its suggested lots again. */
    fitVenue: () => void;
    /** Centers a lot, zooming in if the map is further out. */
    focusLot: (code: string) => void;
}

interface ParkingMapProps {
    ref: Ref<ParkingMapApi>;
    views: LotView[];
    /** Lots the search and filters leave; the rest are hidden unless suggested or selected. */
    visibleCodes: ReadonlySet<string>;
    venues: Venue[];
    venue: Venue;
    outline: VenueOutline | null;
    eventVenueId: string;
    selectedCode: string | null;
    hotCode: string | null;
    hover: HoverTarget | null;
    setHover: Dispatch<SetStateAction<HoverTarget | null>>;
    isNow: boolean;
    onOpenLot: (code: string) => void;
    onSelectVenue: (id: string) => void;
    tx: ParkingText;
}

const reducedMotion = () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const narrowScreen = () => window.matchMedia('(max-width: 1024px)').matches;

// Extra room around the framed points, and on desktop room on the left for the legend.
const fitPadding = (): PaddingOptions => narrowScreen()
    ? {top: 80, bottom: 70, left: 50, right: 50}
    : {top: 100, bottom: 110, left: 240, right: 100};

type Point = [lng: number, lat: number];

function boundsAround(points: Point[], marginLng: number, marginLat: number): LngLatBoundsLike {
    const lngs = points.map(p => p[0]), lats = points.map(p => p[1]);
    return [
        [Math.min(...lngs) - marginLng, Math.min(...lats) - marginLat],
        [Math.max(...lngs) + marginLng, Math.max(...lats) + marginLat],
    ];
}

/** The venue with its suggested lots, or its three nearest when it has none. */
function venueBounds(venue: Venue, views: LotView[]): LngLatBoundsLike | null {
    const picks = views.filter(v => v.rank > 0);
    const lots = (picks.length > 0 ? picks : views.slice(0, 3)).map(v => [v.lot.lng, v.lot.lat] as Point);
    const points = hasCoordinates(venue.lat, venue.lng) ? [[venue.lng, venue.lat] as Point, ...lots] : lots;
    return points.length > 0 ? boundsAround(points, 0.0012, 0.0008) : null;
}

interface OutlineData {
    type: 'FeatureCollection';
    features: {type: 'Feature'; properties: object; geometry: {type: 'MultiPolygon'; coordinates: Point[][][]}}[];
}

/** The venue's building as GeoJSON, rings unflattened from how Firestore stores them. */
function outlineData(outline: VenueOutline | null): OutlineData {
    if (!outline) return {type: 'FeatureCollection', features: []};
    const coordinates = outline.polygons.map(rings => Object.keys(rings)
        .sort((a, b) => Number(a) - Number(b))
        .map(key => {
            const flat = rings[key];
            const ring: Point[] = [];
            for (let i = 0; i + 1 < flat.length; i += 2) ring.push([flat[i], flat[i + 1]]);
            return ring;
        }));
    return {
        type: 'FeatureCollection',
        features: [{type: 'Feature', properties: {}, geometry: {type: 'MultiPolygon', coordinates}}],
    };
}

export const ParkingMap = (props: ParkingMapProps) => {
    const {ref, views, visibleCodes, venues, venue, outline, eventVenueId, selectedCode, hotCode, hover, setHover,
        isNow, onOpenLot, onSelectVenue, tx} = props;
    const containerRef = useRef<HTMLDivElement>(null);
    const [map, setMap] = useState<MapLibreMap | null>(null);
    const [styleReady, setStyleReady] = useState(false);
    const [failed, setFailed] = useState(false);
    const [lotElements, setLotElements] = useState<Record<string, HTMLElement>>({});
    const [venueElements, setVenueElements] = useState<Record<string, HTMLElement>>({});
    const venueMarkers = useRef<Record<string, Marker>>({});
    const popup = useRef<Popup | null>(null);
    const [popupContent, setPopupContent] = useState<HTMLElement | null>(null);
    // How the last pin was reached: a tap shows its card first, a click or Enter opens it.
    const lastPointer = useRef('mouse');
    // The map's own handlers outlive renders, so they read the props through this.
    const latest = useRef(props);
    latest.current = props;

    const fitVenue = (animate: boolean) => {
        const bounds = map && venueBounds(latest.current.venue, latest.current.views);
        if (map && bounds) map.fitBounds(bounds, {padding: fitPadding(), duration: animate && !reducedMotion() ? 700 : 0});
    };

    useImperativeHandle(ref, () => ({
        fitVenue: () => fitVenue(true),
        focusLot: code => {
            const view = latest.current.views.find(v => v.lot.code === code);
            if (!map || !view) return;
            map.easeTo({
                center: [view.lot.lng, view.lot.lat],
                zoom: Math.max(map.getZoom(), LOT_ZOOM),
                duration: reducedMotion() ? 0 : 600,
            });
        },
    }));

    // The map, its controls and the hover card, made once.
    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;
        const {views: firstViews, venues: allVenues, venue: firstVenue} = latest.current;
        // Panning stops a little past campus: every lot and venue, with room to spare.
        const points: Point[] = [
            ...firstViews.map(v => [v.lot.lng, v.lot.lat] as Point),
            ...allVenues.filter(v => hasCoordinates(v.lat, v.lng)).map(v => [v.lng, v.lat] as Point),
        ];
        let created: MapLibreMap;
        try {
            created = new MapLibreMap({
                container,
                style: STYLE_URL,
                bounds: venueBounds(firstVenue, firstViews) ?? undefined,
                fitBoundsOptions: {padding: fitPadding()},
                maxBounds: points.length > 0 ? boundsAround(points, 0.012, 0.008) : undefined,
                minZoom: 14,
                maxZoom: 19.5,
                dragRotate: false,
                pitchWithRotate: false,
                touchPitch: false,
                attributionControl: false,
            });
        } catch (err) {
            // No WebGL, most likely; the list beside the map still works.
            console.error('[ParkingMap] map failed to start:', err);
            setFailed(true);
            return;
        }
        created.touchZoomRotate.disableRotation();
        created.keyboard.disableRotation();
        created.addControl(new NavigationControl({showCompass: false}), 'top-right');
        created.addControl(new AttributionControl({compact: true, customAttribution: ATTRIBUTION}), 'bottom-right');

        const content = document.createElement('div');
        popup.current = new Popup({
            closeButton: false,
            closeOnClick: false,
            offset: 24,
            maxWidth: '300px',
            className: 'parking-hover-popup',
            focusAfterOpen: false,
        }).setDOMContent(content);
        setPopupContent(content);

        created.on('load', () => {
            // Flat buildings, as on the site's other maps, rather than the style's 3D ones.
            if (created.getLayer('building-3d')) created.setLayoutProperty('building-3d', 'visibility', 'none');
            if (created.getLayer('building')) created.setLayerZoomRange('building', 13, 24);
            const layers = created.getStyle().layers;
            // OpenStreetMap's own parking icons would sit beside the guide's pins, permit-only lots included.
            for (const layer of layers) {
                if (!('source-layer' in layer) || layer['source-layer'] !== 'poi') continue;
                const notParking = ['!=', ['get', 'class'], 'parking'] as FilterSpecification;
                created.setFilter(layer.id, layer.filter ? ['all', layer.filter, notParking] as FilterSpecification : notParking);
            }
            // The venue's highlight goes over the buildings but under the labels.
            const lastBuilding = layers.findLastIndex(l => 'source-layer' in l && l['source-layer'] === 'building');
            const beforeId = layers.slice(lastBuilding + 1).find(l => l.type === 'symbol')?.id;
            created.addSource('venue-outline', {type: 'geojson', data: outlineData(null)});
            created.addLayer({
                id: 'venue-fill', type: 'fill', source: 'venue-outline',
                paint: {'fill-color': '#ffc4da', 'fill-opacity': 0.85},
            }, beforeId);
            created.addLayer({
                id: 'venue-line', type: 'line', source: 'venue-outline',
                paint: {'line-color': '#ff6b9d', 'line-width': 2.5},
            }, beforeId);
            setStyleReady(true);
            // The container can settle to its final size after the map is made, which
            // cut off the edge of the first framing; frame it again now it has.
            created.resize();
            const bounds = venueBounds(latest.current.venue, latest.current.views);
            if (bounds) created.fitBounds(bounds, {padding: fitPadding(), duration: 0});
        });

        // A click on the map itself lets go of a card a tap pinned open.
        created.on('click', e => {
            const target = e.originalEvent.target;
            if (target instanceof Element && target.closest('.maplibregl-marker, .maplibregl-popup')) return;
            latest.current.setHover(h => h?.kind === 'lot' && h.pinned ? null : h);
        });
        const zoomClass = () => container.classList.toggle('is-zoomed-in', created.getZoom() >= LABEL_ZOOM);
        created.on('zoom', zoomClass);
        zoomClass();

        setMap(created);
        return () => {
            popup.current?.remove();
            created.remove();
            setMap(null);
            setStyleReady(false);
        };
    }, []);

    // Lot pins. Each marker element is a bare wrapper MapLibre positions; the pin is
    // rendered into it, so MapLibre's own classes and transform are left alone.
    const lots = views.map(v => v.lot);
    const lotsKey = lots.map(l => `${l.code}@${l.lat},${l.lng}`).sort().join(';');
    useEffect(() => {
        if (!map) return;
        const markers: Marker[] = [];
        const elements: Record<string, HTMLElement> = {};
        for (const lot of latest.current.views.map(v => v.lot)) {
            const element = document.createElement('div');
            element.className = 'parking-marker';
            // Anchored at the top, then lifted half a pin, so the pin's middle sits on the lot.
            markers.push(new Marker({element, anchor: 'top', offset: [0, -15]}).setLngLat([lot.lng, lot.lat]).addTo(map));
            elements[lot.code] = element;
        }
        setLotElements(elements);
        return () => markers.forEach(m => m.remove());
    }, [map, lotsKey]);

    // Venue stars, the current one bigger.
    const mappedVenues = venues.filter(v => hasCoordinates(v.lat, v.lng));
    const venuesKey = mappedVenues.map(v => `${v.id}@${v.lat},${v.lng}`).join(';');
    useEffect(() => {
        if (!map) return;
        const markers: Record<string, Marker> = {};
        const elements: Record<string, HTMLElement> = {};
        for (const v of latest.current.venues.filter(v => hasCoordinates(v.lat, v.lng))) {
            const element = document.createElement('div');
            element.className = 'parking-marker';
            markers[v.id] = new Marker({element, anchor: 'top', offset: [0, -15]}).setLngLat([v.lng, v.lat]).addTo(map);
            elements[v.id] = element;
        }
        venueMarkers.current = markers;
        setVenueElements(elements);
        return () => Object.values(markers).forEach(m => m.remove());
    }, [map, venuesKey]);

    // Stacking and visibility live on the wrapper, the element MapLibre stacks.
    useEffect(() => {
        for (const view of views) {
            const element = lotElements[view.lot.code];
            if (!element) continue;
            const selected = view.lot.code === selectedCode;
            element.style.zIndex = String(selected ? 6 : view.rank ? 5 : 1);
            element.style.display = visibleCodes.has(view.lot.code) || view.rank || selected ? '' : 'none';
        }
    }, [lotElements, views, visibleCodes, selectedCode]);
    useEffect(() => {
        for (const [id, element] of Object.entries(venueElements)) {
            const current = id === venue.id;
            element.style.zIndex = current ? '7' : '4';
            venueMarkers.current[id]?.setOffset([0, current ? -20 : -15]);
        }
    }, [venueElements, venue.id]);

    // Switching venue moves the highlight and reframes the map.
    useEffect(() => {
        if (!map || !styleReady) return;
        (map.getSource('venue-outline') as GeoJSONSource | undefined)?.setData(outlineData(outline));
    }, [map, styleReady, outline]);
    const framedVenue = useRef(venue.id);
    useEffect(() => {
        if (framedVenue.current === venue.id) return;
        framedVenue.current = venue.id;
        fitVenue(true);
    }, [venue.id]);

    // The hover card follows `hover`; a pinned one takes clicks, a passing one lets them through.
    useEffect(() => {
        const card = popup.current;
        if (!map || !card) return;
        const at = hover?.kind === 'lot'
            ? views.find(v => v.lot.code === hover.code)?.lot
            : hover ? venues.find(v => v.id === hover.id) : undefined;
        if (!at) {
            card.remove();
            return;
        }
        card.setLngLat([at.lng, at.lat]);
        if (!card.isOpen()) card.addTo(map);
        if (hover?.kind === 'lot' && hover.pinned) card.addClassName('is-pinned');
        else card.removeClassName('is-pinned');
    }, [map, hover, views, venues]);

    const showLot = (code: string, pinned: boolean) => setHover({kind: 'lot', code, pinned});
    const leave = (matches: (h: HoverTarget) => boolean) =>
        setHover(h => h && matches(h) && !(h.kind === 'lot' && h.pinned) ? null : h);
    const touchLike = () => lastPointer.current === 'touch' || lastPointer.current === 'pen';

    const hoveredView = hover?.kind === 'lot' ? views.find(v => v.lot.code === hover.code) : undefined;
    const hoveredVenue = hover?.kind === 'venue' ? venues.find(v => v.id === hover.id) : undefined;
    const venueName = localizedVenueName(venue, tx.isEnglish);
    const hasPicks = views.some(v => v.rank > 0);

    return (
        <>
            <div ref={containerRef} className="parking-map"/>
            {failed && <div className="parking-map-failed">{tx.t('mapFailed')}</div>}

            {map && (
                <button type="button" className="parking-back-btn parking-map-recenter" onClick={() => fitVenue(true)}>
                    <span aria-hidden="true">⭐</span>
                    <span className="parking-map-recenter-name">{tx.t('recenter', {v: venueName})}</span>
                </button>
            )}

            {/* Translucent "glass" and click-through, so any marker behind it stays
                visible and usable rather than being hidden. */}
            <div className="parking-map-legend">
                <div className="parking-map-legend-title">{tx.t(isNow ? 'legendNow' : 'legendEvent')}</div>
                <div className="parking-map-legend-item"><span className="parking-map-legend-dot parking-k-free">P</span>{tx.t('lg_free')}</div>
                {!isNow && (
                    <div className="parking-map-legend-item"><span className="parking-map-legend-dot parking-k-part">P</span>{tx.t('lg_part')}</div>
                )}
                <div className="parking-map-legend-item"><span className="parking-map-legend-dot parking-k-paid">P</span>{tx.t('lg_paid')}</div>
                <div className="parking-map-legend-item"><span className="parking-map-legend-dot parking-k-permit">P</span>{tx.t('lg_permit')}</div>
                <div className="parking-map-legend-item"><span className="parking-map-legend-dot parking-k-event">P</span>{tx.t('lg_event')}</div>
                {hasPicks && (
                    <div className="parking-map-legend-item is-optional"><span className="parking-map-legend-dot is-pick">1</span>{tx.t('lg_pick')}</div>
                )}
                <div className="parking-map-legend-item is-optional"><span className="parking-map-legend-star">⭐</span>{tx.t('lg_venue')}</div>
                {mappedVenues.length > 1 && (
                    <div className="parking-map-legend-item is-optional"><span className="parking-map-legend-star is-other">⭐</span>{tx.t('lg_other')}</div>
                )}
            </div>

            {views.map(view => {
                const element = lotElements[view.lot.code];
                if (!element) return null;
                const {lot, status, rank} = view;
                const typeLabel = tx.lotType(lot.type);
                return createPortal(
                    <div className={`parking-pin-wrap${rank ? ' is-pick' : ''}`}>
                        <button
                            type="button"
                            className={`parking-pin parking-k-${status.kind}${lot.code === selectedCode ? ' is-selected' : ''}${lot.code === hotCode ? ' is-hot' : ''}`}
                            aria-label={[lot.code, tx.status(status), walkText(view, tx)].filter(Boolean).join(', ')}
                            onPointerDown={e => { lastPointer.current = e.pointerType; }}
                            onKeyDown={() => { lastPointer.current = 'keyboard'; }}
                            onPointerEnter={e => { if (e.pointerType === 'mouse') showLot(lot.code, false); }}
                            onPointerLeave={e => {
                                if (e.pointerType === 'mouse') leave(h => h.kind === 'lot' && h.code === lot.code);
                            }}
                            onFocus={() => { if (!touchLike()) showLot(lot.code, false); }}
                            onBlur={() => leave(h => h.kind === 'lot' && h.code === lot.code)}
                            onClick={() => {
                                // A tap shows the card first; a second tap, or its Details button, opens the lot.
                                if (touchLike() && !(hover?.kind === 'lot' && hover.pinned && hover.code === lot.code)) {
                                    showLot(lot.code, true);
                                    return;
                                }
                                onOpenLot(lot.code);
                            }}
                        >
                            {pinGlyph(view)}
                        </button>
                        <div className="parking-pin-label" aria-hidden="true">
                            {lot.code}
                            {rank > 0 && <span>{typeLabel}</span>}
                        </div>
                    </div>,
                    element,
                    lot.code,
                );
            })}

            {mappedVenues.map(v => {
                const element = venueElements[v.id];
                if (!element) return null;
                const current = v.id === venue.id;
                const name = localizedVenueName(v, tx.isEnglish);
                return createPortal(
                    <button
                        type="button"
                        className={`parking-vpin${current ? ' is-current' : ''}`}
                        aria-label={current ? name : `${name}: ${tx.t('venueHover')}`}
                        aria-current={current || undefined}
                        onPointerDown={e => { lastPointer.current = e.pointerType; }}
                        onPointerEnter={e => { if (e.pointerType === 'mouse' && !current) setHover({kind: 'venue', id: v.id}); }}
                        onPointerLeave={e => {
                            if (e.pointerType === 'mouse') leave(h => h.kind === 'venue' && h.id === v.id);
                        }}
                        onFocus={() => { if (!current && !touchLike()) setHover({kind: 'venue', id: v.id}); }}
                        onBlur={() => leave(h => h.kind === 'venue' && h.id === v.id)}
                        onClick={() => { if (!current) onSelectVenue(v.id); }}
                    >
                        <span className="parking-vpin-dot" aria-hidden="true">⭐</span>
                        <span className="parking-vpin-label">{name}</span>
                    </button>,
                    element,
                    v.id,
                );
            })}

            {popupContent && createPortal(
                hoveredView ? (
                    <LotCard
                        view={hoveredView}
                        pinned={hover?.kind === 'lot' && hover.pinned}
                        onDetails={() => onOpenLot(hoveredView.lot.code)}
                        tx={tx}
                    />
                ) : hoveredVenue ? (
                    <div className="parking-hc">
                        <div className="parking-hc-top">
                            <span className="parking-hc-title">{localizedVenueName(hoveredVenue, tx.isEnglish)}</span>
                        </div>
                        {(hoveredVenue.buildingCode || hoveredVenue.id === eventVenueId) && (
                            <div className="parking-rate-line">
                                {[
                                    hoveredVenue.buildingCode && tx.t('venueCode', {c: hoveredVenue.buildingCode}),
                                    hoveredVenue.id === eventVenueId && tx.t('thisEvent'),
                                ].filter(Boolean).join(' · ')}
                            </div>
                        )}
                        <div className="parking-dist">⭐ {tx.t('venueHover')}</div>
                    </div>
                ) : null,
                popupContent,
            )}
        </>
    );
};

/** The quick card a lot shows on hover, focus or a first tap. */
const LotCard = ({view, pinned, onDetails, tx}: {view: LotView; pinned: boolean; onDetails: () => void; tx: ParkingText}) => {
    const {lot, status, rank} = view;
    const rates = rateText(lot, tx);
    const walk = walkText(view, tx);
    return (
        <div className="parking-hc">
            <div className="parking-hc-top">
                <span className="parking-hc-title">{lot.code}</span>
                <span className="parking-hc-type">{lotSubtitle(lot, tx.lotType(lot.type))}</span>
                {rank > 0 && <span className="parking-pick-badge">{tx.t('pick', {n: rank})}</span>}
            </div>
            <StatusPill status={status} tx={tx}/>
            {rates && <div className="parking-rate-line">💲 {rates}</div>}
            <div className="parking-hc-facts">
                {walk && <span className="parking-dist">📍 {walk}</span>}
                {!!lot.stalls.accessible && <span title={tx.t('s_accessible')}>♿ {lot.stalls.accessible}</span>}
                {!!lot.stalls.ev && <span title={tx.t('s_ev')}>⚡ {lot.stalls.ev}</span>}
                {!!lot.stalls.motorcycle && <span title={tx.t('s_motorcycle')}>🏍️ {lot.stalls.motorcycle}</span>}
            </div>
            {pinned && (
                <button type="button" className="parking-cta parking-hc-more" onClick={onDetails}>
                    {tx.t('details')} →
                </button>
            )}
        </div>
    );
};
