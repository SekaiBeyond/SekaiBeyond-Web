import type { GeoJSONSource, LngLatBoundsLike, PaddingOptions } from 'maplibre-gl';
import { type Dispatch, type Ref, type SetStateAction, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
    createMap,
    firstLabelAboveBuildings,
    type MapLibreMap,
    prefersReducedMotion,
    useMarkerElements,
    usePopup,
} from '~/lib/maplibre';
import type { ParkingWindow } from '~/lib/parkingStatus';
import { uwLotGlyph, type VenueOutline } from '~/lib/uwParking';
import { hasCoordinates, type Venue } from '~/lib/venues';
import { localizedVenueName, lotSubtitle, type LotView } from './model';
import { RatesLine, StatusPill, walkText } from './parts';
import type { ParkingText } from './text';

const ATTRIBUTION = 'UW Transportation Services · UW Facilities GIS';
// Lot codes appear beside the plain pins from this zoom; suggested lots always show theirs.
const LABEL_ZOOM = 17.4;
// Clicking a lot zooms to at least this.
const LOT_ZOOM = 17;

export type HoverTarget = {kind: 'lot'; code: string; pinned: boolean} | {kind: 'venue'; id: string};

export interface ParkingMapApi {
    /** Centers a lot, zooming in if the map is further out. */
    focusLot: (code: string) => void;
}

interface ParkingMapProps {
    ref: Ref<ParkingMapApi>;
    views: LotView[];
    /** Lots the search and filters leave; the rest are hidden unless suggested or selected. */
    visibleCodes: ReadonlySet<string>;
    venues: Venue[];
    /** None for the whole campus. */
    venue: Venue | null;
    outline: VenueOutline | null;
    eventVenueId: string;
    selectedCode: string | null;
    hotCode: string | null;
    hover: HoverTarget | null;
    setHover: Dispatch<SetStateAction<HoverTarget | null>>;
    /** Right now, or the event's hours on the day shown. */
    parkingWindow: ParkingWindow;
    onOpenLot: (code: string) => void;
    onSelectVenue: (id: string) => void;
    tx: ParkingText;
}

/** Whether the guide is in the stacked layout parking.css switches to at 1024px. */
export const narrowScreen = () => window.matchMedia('(max-width: 1024px)').matches;

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

/** The venue with its suggested lots, or its three nearest when it has none; every lot without a venue. */
function venueBounds(venue: Venue | null, views: LotView[]): LngLatBoundsLike | null {
    const picks = views.filter(v => v.suggested);
    const framed = !venue ? views : picks.length > 0 ? picks : views.slice(0, 3);
    const lots = framed.map(v => [v.lot.lng, v.lot.lat] as Point);
    const points = venue && hasCoordinates(venue.lat, venue.lng) ? [[venue.lng, venue.lat] as Point, ...lots] : lots;
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
    const {
        ref, views, visibleCodes, venues, venue, outline, eventVenueId, selectedCode, hotCode, hover, setHover,
        parkingWindow, onOpenLot, onSelectVenue, tx
    } = props;
    const {isNow} = parkingWindow;
    const containerRef = useRef<HTMLDivElement>(null);
    const [map, setMap] = useState<MapLibreMap | null>(null);
    const [styleReady, setStyleReady] = useState(false);
    const [failed, setFailed] = useState(false);
    const {popup: card, content: popupContent} = usePopup(map, {
        closeButton: false,
        closeOnClick: false,
        offset: 24,
        maxWidth: '300px',
        className: 'parking-hover-popup',
        focusAfterOpen: false,
    });
    // How the last pin was reached: a tap shows its card first, a click or Enter opens it.
    const lastPointer = useRef('mouse');
    // The map's own handlers outlive renders, so they read the props through this.
    const latest = useRef(props);
    latest.current = props;

    const fitVenue = () => {
        const bounds = map && venueBounds(latest.current.venue, latest.current.views);
        if (map && bounds) map.fitBounds(bounds, {padding: fitPadding(), duration: prefersReducedMotion() ? 0 : 700});
    };

    useImperativeHandle(ref, () => ({
        focusLot: code => {
            const view = latest.current.views.find(v => v.lot.code === code);
            if (!map || !view) return;
            map.easeTo({
                center: [view.lot.lng, view.lot.lat],
                zoom: Math.max(map.getZoom(), LOT_ZOOM),
                duration: prefersReducedMotion() ? 0 : 600,
            });
        },
    }));

    // The map and its handlers, made once.
    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;
        const {views: firstViews, venues: allVenues, venue: firstVenue} = latest.current;
        // Panning stops a little past campus: every lot and venue, with room to spare.
        const points: Point[] = [
            ...firstViews.map(v => [v.lot.lng, v.lot.lat] as Point),
            ...allVenues.filter(v => hasCoordinates(v.lat, v.lng)).map(v => [v.lng, v.lat] as Point),
        ];
        const created = createMap(container, {
            attribution: ATTRIBUTION,
            bounds: venueBounds(firstVenue, firstViews) ?? undefined,
            fitBoundsOptions: {padding: fitPadding()},
            maxBounds: points.length > 0 ? boundsAround(points, 0.012, 0.008) : undefined,
            minZoom: 14,
        });
        if (!created) {
            // The list beside the map still works.
            setFailed(true);
            return;
        }

        created.on('load', () => {
            // The venue's highlight goes over the buildings but under the labels.
            const beforeId = firstLabelAboveBuildings(created);
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
            // A link to a lot opens on it.
            const linked = latest.current.views.find(v => v.lot.code === latest.current.selectedCode);
            if (linked) created.jumpTo({center: [linked.lot.lng, linked.lot.lat], zoom: LOT_ZOOM});
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
            created.remove();
            setMap(null);
            setStyleReady(false);
        };
    }, []);

    // Lot pins and venue stars, rendered into the markers' wrappers below.
    const {elements: lotElements} = useMarkerElements(map, views.map(v => ({
        key: v.lot.code,
        lng: v.lot.lng,
        lat: v.lot.lat
    })));
    const mappedVenues = venues.filter(v => hasCoordinates(v.lat, v.lng));
    const {
        elements: venueElements,
        markers: venueMarkers
    } = useMarkerElements(map, mappedVenues.map(v => ({key: v.id, ...v})));

    // Stacking and visibility live on the wrapper, the element MapLibre stacks.
    useEffect(() => {
        for (const view of views) {
            const element = lotElements[view.lot.code];
            if (!element) continue;
            const selected = view.lot.code === selectedCode;
            element.style.zIndex = String(selected ? 6 : view.suggested ? 5 : 1);
            element.style.display = visibleCodes.has(view.lot.code) || view.suggested || selected ? '' : 'none';
        }
    }, [lotElements, views, visibleCodes, selectedCode]);
    useEffect(() => {
        for (const [id, element] of Object.entries(venueElements)) {
            const current = id === venue?.id;
            element.style.zIndex = current ? '7' : '4';
            venueMarkers[id]?.setOffset([0, current ? -20 : -15]);
        }
    }, [venueElements, venueMarkers, venue?.id]);

    // Switching venue moves the highlight and reframes the map.
    useEffect(() => {
        if (!map || !styleReady) return;
        (map.getSource('venue-outline') as GeoJSONSource | undefined)?.setData(outlineData(outline));
    }, [map, styleReady, outline]);
    const framedVenue = useRef(venue?.id);
    useEffect(() => {
        if (framedVenue.current === venue?.id) return;
        framedVenue.current = venue?.id;
        fitVenue();
    }, [venue?.id]);

    // The hover card follows `hover`; a pinned one takes clicks, a passing one lets them through.
    useEffect(() => {
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
    }, [map, card, hover, views, venues]);

    const showLot = (code: string, pinned: boolean) => setHover({kind: 'lot', code, pinned});
    const leave = (matches: (h: HoverTarget) => boolean) =>
        setHover(h => h && matches(h) && !(h.kind === 'lot' && h.pinned) ? null : h);
    const touchLike = () => lastPointer.current === 'touch' || lastPointer.current === 'pen';

    const hoveredView = hover?.kind === 'lot' ? views.find(v => v.lot.code === hover.code) : undefined;
    const hoveredVenue = hover?.kind === 'venue' ? venues.find(v => v.id === hover.id) : undefined;
    const hasPicks = views.some(v => v.suggested);

    return (
        <>
            <div ref={containerRef} className="parking-map"/>
            {failed && <div className="parking-map-failed">{tx.t('mapFailed')}</div>}

            {/* Click-through, so markers behind it stay usable. */}
            <div className="parking-map-legend">
                <div className="parking-map-legend-title">
                    {isNow ? tx.t('legendNow') : tx.t('legendEvent', {d: tx.date(parkingWindow.date)})}
                </div>
                <div className="parking-map-legend-item"><span
                    className="parking-map-legend-dot parking-k-free">P</span>{tx.t('lg_free')}</div>
                {!isNow && (
                    <div className="parking-map-legend-item"><span
                        className="parking-map-legend-dot parking-k-part">P</span>{tx.t('lg_part')}</div>
                )}
                <div className="parking-map-legend-item"><span
                    className="parking-map-legend-dot parking-k-paid">P</span>{tx.t('lg_paid')}</div>
                <div className="parking-map-legend-item"><span
                    className="parking-map-legend-dot parking-k-permit">P</span>{tx.t('lg_permit')}</div>
                <div className="parking-map-legend-item"><span
                    className="parking-map-legend-dot parking-k-event">P</span>{tx.t('lg_event')}</div>
                {hasPicks && (
                    <div className="parking-map-legend-item is-optional"><span
                        className="parking-map-legend-dot is-pick">P</span>{tx.t('lg_pick')}</div>
                )}
                {venue && (
                    <div className="parking-map-legend-item is-optional"><span
                        className="parking-map-legend-star">⭐</span>{tx.t('lg_venue')}</div>
                )}
                {mappedVenues.some(v => v.id !== venue?.id) && (
                    <div className="parking-map-legend-item is-optional"><span
                        className="parking-map-legend-star is-other">⭐</span>{tx.t(venue ? 'lg_other' : 'lg_venues')}
                    </div>
                )}
            </div>

            {views.map(view => {
                const element = lotElements[view.lot.code];
                if (!element) return null;
                const {lot, status, suggested} = view;
                const typeLabel = tx.lotType(lot.type);
                return createPortal(
                    <div className={`parking-pin-wrap${suggested ? ' is-pick' : ''}`}>
                        <button
                            type="button"
                            className={`parking-pin parking-k-${status.kind}${lot.code === selectedCode ? ' is-selected' : ''}${lot.code === hotCode ? ' is-hot' : ''}`}
                            aria-label={[lot.code, tx.status(status), walkText(view, tx)].filter(Boolean).join(', ')}
                            onPointerDown={e => {
                                lastPointer.current = e.pointerType;
                            }}
                            onKeyDown={() => {
                                lastPointer.current = 'keyboard';
                            }}
                            onPointerEnter={e => {
                                if (e.pointerType === 'mouse') showLot(lot.code, false);
                            }}
                            onPointerLeave={e => {
                                if (e.pointerType === 'mouse') leave(h => h.kind === 'lot' && h.code === lot.code);
                            }}
                            onFocus={() => {
                                if (!touchLike()) showLot(lot.code, false);
                            }}
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
                            {uwLotGlyph(lot.type)}
                        </button>
                        <div className="parking-pin-label" aria-hidden="true">
                            {lot.code}
                            {suggested && <span>{typeLabel}</span>}
                        </div>
                    </div>,
                    element,
                    lot.code,
                );
            })}

            {mappedVenues.map(v => {
                const element = venueElements[v.id];
                if (!element) return null;
                const current = v.id === venue?.id;
                const name = localizedVenueName(v, tx.isEnglish);
                return createPortal(
                    <button
                        type="button"
                        className={`parking-vpin${current ? ' is-current' : ''}`}
                        aria-label={current ? name : `${name}: ${tx.t('venueHover')}`}
                        aria-current={current || undefined}
                        onPointerDown={e => {
                            lastPointer.current = e.pointerType;
                        }}
                        onPointerEnter={e => {
                            if (e.pointerType === 'mouse' && !current) setHover({kind: 'venue', id: v.id});
                        }}
                        onPointerLeave={e => {
                            if (e.pointerType === 'mouse') leave(h => h.kind === 'venue' && h.id === v.id);
                        }}
                        onFocus={() => {
                            if (!current && !touchLike()) setHover({kind: 'venue', id: v.id});
                        }}
                        onBlur={() => leave(h => h.kind === 'venue' && h.id === v.id)}
                        onClick={() => {
                            if (!current) onSelectVenue(v.id);
                        }}
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
                        isNow={isNow}
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
const LotCard = ({view, pinned, onDetails, isNow, tx}: {
    view: LotView;
    pinned: boolean;
    onDetails: () => void;
    isNow: boolean;
    tx: ParkingText
}) => {
    const {lot, status, suggested} = view;
    const walk = walkText(view, tx);
    return (
        <div className="parking-hc">
            <div className="parking-hc-top">
                <span className="parking-hc-title">{lot.code}</span>
                <span className="parking-hc-type">{lotSubtitle(lot, tx.lotType(lot.type))}</span>
                {suggested && <span className="parking-pick-badge">{tx.t('pick')}</span>}
            </div>
            <StatusPill status={status} tx={tx}/>
            <RatesLine rates={view.rates} isNow={isNow} tx={tx}/>
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
