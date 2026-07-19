import { useEffect, useMemo, useRef, useState } from 'react';
import { AdvancedMarker, APIProvider, InfoWindow, Map, useMap } from '@vis.gl/react-google-maps';
import { useLanguage } from '~/components/LanguageContextProvider';
import { GOOGLE_MAPS_API_KEY, GOOGLE_MAPS_MAP_ID } from '~/lib/googleMaps';
import { lotBadgeChar, lotTypeLabel, lotTypeShortLabel, type ParkingLot } from '~/lib/parkingLots';
import { NO_RATE_COLOR, type ParkingRate, rateColorById, rateLabel } from '~/lib/parkingRates';
import { DEFAULT_ZOOM, hasCoordinates, UW_CAMPUS_CENTER, type Venue } from '~/lib/venues';

/** Which marker's popup is currently open on the overview map. */
type MapSelection = {kind: 'venue' | 'lot'; id: string};

/** One row in the combined venue + parking-lot search dropdown. */
interface SearchItem {
    kind: 'venue' | 'lot';
    id: string;
    name: string;
    meta: string;
    badgeType: 'venue' | ParkingLot['type'];
    badgeChar: string;
    /** False when the item has no coordinates — picking it jumps to its list card instead. */
    mappable: boolean;
}

/**
 * Headless helper that lives inside the Map and pans it to the given point whenever it
 * changes — used to focus an item picked from the search. The nonce lets re-picking the
 * same item pan again after the user has dragged away.
 */
const MapPanner = ({target}: {target: {lat: number; lng: number; nonce: number} | null}) => {
    const map = useMap();
    useEffect(() => {
        if (!map || !target) return;
        map.panTo({lat: target.lat, lng: target.lng});
    }, [map, target]);
    return null;
};

/**
 * Searchable finder over every venue and parking lot. Picking a mappable item focuses it
 * on the overview map; items without coordinates jump straight to their list card.
 */
interface LocationSearchProps {
    items: SearchItem[];
    onPick: (item: SearchItem) => void;
    isEnglish: boolean;
}

const LocationSearch = ({items, onPick, isEnglish}: LocationSearchProps) => {
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState('');
    const containerRef = useRef<HTMLDivElement>(null);

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
    const results = q ? items.filter(i => i.name.toLowerCase().includes(q)) : items;
    const venueResults = results.filter(i => i.kind === 'venue');
    const lotResults = results.filter(i => i.kind === 'lot');

    const choose = (item: SearchItem) => {
        onPick(item);
        setQuery(item.name);
        setOpen(false);
    };

    const renderOption = (item: SearchItem) => (
        <button
            key={`${item.kind}-${item.id}`}
            type="button"
            role="option"
            className="admin-locmap-search-option"
            onClick={() => choose(item)}
        >
            <span className="admin-locmap-badge" data-type={item.badgeType}>{item.badgeChar}</span>
            <span className="admin-locmap-search-opt-body">
                <span className="admin-locmap-search-opt-name">{item.name}</span>
                <span className="admin-locmap-search-opt-meta">{item.meta}</span>
            </span>
        </button>
    );

    return (
        <div className="admin-locmap-search" ref={containerRef}>
            <input
                className="admin-input"
                type="text"
                value={query}
                onChange={e => {
                    setQuery(e.target.value);
                    setOpen(true);
                }}
                onFocus={() => setOpen(true)}
                placeholder={isEnglish ? 'Search venues & parking lots…' : '搜索场地和停车场…'}
            />
            {open && (
                <div className="admin-locmap-search-panel" role="listbox">
                    {results.length === 0 ? (
                        <div className="admin-locmap-search-empty">
                            {isEnglish ? 'No locations found' : '未找到地点'}
                        </div>
                    ) : (
                        <>
                            {venueResults.length > 0 && (
                                <div className="admin-locmap-search-group">
                                    {isEnglish ? 'Venues' : '场地'}
                                </div>
                            )}
                            {venueResults.map(renderOption)}
                            {lotResults.length > 0 && (
                                <div className="admin-locmap-search-group">
                                    {isEnglish ? 'Parking Lots' : '停车场'}
                                </div>
                            )}
                            {lotResults.map(renderOption)}
                        </>
                    )}
                </div>
            )}
        </div>
    );
};

/**
 * Interactive overview map for the admin Locations tab, modeled on the public parking
 * guide. Plots every venue (star) and parking lot (P / G / ♿) on one map; selecting a
 * venue highlights its linked lots, and each popup can jump to the matching card in the
 * lists below via `onShowVenue` / `onShowLot`.
 */
interface LocationsMapProps {
    venues: Venue[];
    parkingLots: ParkingLot[];
    parkingRates: ParkingRate[];
    onShowVenue: (venueId: string) => void;
    onShowLot: (lotId: string) => void;
    /** Jump to the card AND open its inline edit form. */
    onEditVenue: (venueId: string) => void;
    onEditLot: (lotId: string) => void;
    readOnly?: boolean;
}

export const LocationsMap = ({
                                 venues,
                                 parkingLots,
                                 parkingRates,
                                 onShowVenue,
                                 onShowLot,
                                 onEditVenue,
                                 onEditLot,
                                 readOnly = false,
                             }: LocationsMapProps) => {
    const {isEnglish} = useLanguage();
    const [selected, setSelected] = useState<MapSelection | null>(null);
    const [focus, setFocus] = useState<{lat: number; lng: number; nonce: number} | null>(null);
    const focusNonce = useRef(0);

    const mappableVenues = venues.filter(v => hasCoordinates(v.lat, v.lng));
    const mappableLots = parkingLots.filter(l => hasCoordinates(l.lat, l.lng));
    const unmappedCount = (venues.length - mappableVenues.length) + (parkingLots.length - mappableLots.length);

    const selectedVenue = selected?.kind === 'venue'
        ? mappableVenues.find(v => v.id === selected.id) ?? null
        : null;
    // Lots linked to the selected venue get the parking guide's highlight treatment.
    const linkedLotIds = useMemo(
        () => new Set(selectedVenue?.parkingLots.map(l => l.lotId) ?? []),
        [selectedVenue],
    );

    const rateById = useMemo(() => {
        const lookup: Record<string, ParkingRate> = {};
        for (const r of parkingRates) lookup[r.id] = r;
        return lookup;
    }, [parkingRates]);
    // Marker colors encode the price tier (UW parking-map style); grey = no rate assigned.
    const colorById = useMemo(() => rateColorById(parkingRates), [parkingRates]);
    const lotColor = (lot: ParkingLot) =>
        (lot.rateId && colorById[lot.rateId]) || NO_RATE_COLOR;
    const hasUnratedLot = mappableLots.some(l => !l.rateId || !colorById[l.rateId]);

    const venueName = (v: Venue) => isEnglish ? v.nameEn : (v.nameCn || v.nameEn);
    const lotName = (l: ParkingLot) => isEnglish ? l.name : (l.nameCn || l.name);

    const searchItems: SearchItem[] = [
        ...venues.map(v => {
            const n = v.parkingLots.length;
            return {
                kind: 'venue' as const,
                id: v.id,
                name: venueName(v),
                meta: isEnglish
                    ? `Venue · ${n} lot${n === 1 ? '' : 's'}`
                    : `场地 · ${n} 个停车场`,
                badgeType: 'venue' as const,
                badgeChar: '⭐',
                mappable: hasCoordinates(v.lat, v.lng),
            };
        }),
        ...parkingLots.map(l => {
            const rate = l.rateId ? rateById[l.rateId] : undefined;
            return {
                kind: 'lot' as const,
                id: l.id,
                name: lotName(l),
                meta: lotTypeShortLabel(l.type, isEnglish) + (rate ? ` · ${rateLabel(rate, isEnglish)}` : ''),
                badgeType: l.type,
                badgeChar: lotBadgeChar(l.type),
                mappable: hasCoordinates(l.lat, l.lng),
            };
        }),
    ];

    const pickSearchItem = (item: SearchItem) => {
        if (!item.mappable) {
            // Nothing to focus on the map — send the admin straight to the list card.
            if (item.kind === 'venue') onShowVenue(item.id);
            else onShowLot(item.id);
            return;
        }
        const target = item.kind === 'venue'
            ? mappableVenues.find(v => v.id === item.id)
            : mappableLots.find(l => l.id === item.id);
        if (!target) return;
        setSelected({kind: item.kind, id: item.id});
        setFocus({lat: target.lat, lng: target.lng, nonce: ++focusNonce.current});
    };

    const jumpToList = (sel: MapSelection) => {
        setSelected(null);
        if (sel.kind === 'venue') onShowVenue(sel.id);
        else onShowLot(sel.id);
    };

    const jumpToEdit = (sel: MapSelection) => {
        setSelected(null);
        if (sel.kind === 'venue') onEditVenue(sel.id);
        else onEditLot(sel.id);
    };

    /** "Show in list" + (unless read-only) "Edit" actions shared by both popup kinds. */
    const popupActions = (sel: MapSelection) => (
        <div className="admin-locmap-popup-actions">
            <button
                type="button"
                className="admin-locmap-popup-btn admin-locmap-popup-btn--secondary"
                onClick={() => jumpToList(sel)}
            >
                {isEnglish ? 'Show in list ↓' : '在列表中显示 ↓'}
            </button>
            {!readOnly && (
                <button
                    type="button"
                    className="admin-locmap-popup-btn"
                    onClick={() => jumpToEdit(sel)}
                >
                    {isEnglish ? 'Edit' : '编辑'}
                </button>
            )}
        </div>
    );

    if (venues.length === 0 && parkingLots.length === 0) {
        return (
            <div className="admin-section">
                <p className="admin-no-results">
                    {isEnglish
                        ? 'Nothing to map yet — create a venue or parking lot below.'
                        : '暂无可显示的地点 — 请在下方创建场地或停车场。'}
                </p>
            </div>
        );
    }

    // Frame the map on everything that has coordinates; with fewer than two points a
    // bounds box degenerates, so fall back to a plain center + zoom.
    const points = [...mappableVenues, ...mappableLots];
    const mapBounds = points.length > 1
        ? {
            north: Math.max(...points.map(p => p.lat)),
            south: Math.min(...points.map(p => p.lat)),
            east: Math.max(...points.map(p => p.lng)),
            west: Math.min(...points.map(p => p.lng)),
        }
        : null;

    return (
        <div className="admin-section admin-locmap">
            <p className="admin-helper-text admin-section-intro">
                {isEnglish
                    ? 'Every venue (⭐) and parking lot on one map. Click a venue to highlight its linked lots, or search to find a location; popups jump to the matching card below.'
                    : '所有场地（⭐）与停车场都在同一张地图上。点击场地可高亮其关联停车场，或使用搜索定位；弹窗可跳转到下方对应卡片。'}
            </p>

            <div className="admin-locmap-toolbar">
                <LocationSearch items={searchItems} onPick={pickSearchItem} isEnglish={isEnglish}/>
                <div className="admin-locmap-legend">
                    <span className="admin-locmap-legend-item">
                        <span className="admin-locmap-legend-dot" data-type="venue">⭐</span>
                        {isEnglish ? 'Venue' : '场地'}
                    </span>
                    {/* Glyph = lot type; color = rate tier (below), like the UW parking map. */}
                    <span className="admin-locmap-legend-item">
                        <span className="admin-locmap-legend-dot" data-kind="glyph">P</span>
                        {lotTypeShortLabel('general', isEnglish)}
                    </span>
                    <span className="admin-locmap-legend-item">
                        <span className="admin-locmap-legend-dot" data-kind="glyph">G</span>
                        {lotTypeShortLabel('garage', isEnglish)}
                    </span>
                    <span className="admin-locmap-legend-item">
                        <span className="admin-locmap-legend-dot" data-kind="glyph">♿</span>
                        {lotTypeShortLabel('disabled', isEnglish)}
                    </span>
                    {parkingRates.map(rate => (
                        <span key={rate.id} className="admin-locmap-legend-item">
                            <span className="admin-locmap-legend-dot" style={{background: colorById[rate.id]}}/>
                            {rateLabel(rate, isEnglish)}
                        </span>
                    ))}
                    {hasUnratedLot && (
                        <span className="admin-locmap-legend-item">
                            <span className="admin-locmap-legend-dot" style={{background: NO_RATE_COLOR}}/>
                            {isEnglish ? 'No rate' : '无费率'}
                        </span>
                    )}
                </div>
            </div>

            <div className="admin-locmap-canvas">
                <APIProvider apiKey={GOOGLE_MAPS_API_KEY}>
                    <Map
                        defaultBounds={mapBounds ? {...mapBounds, padding: 80} : undefined}
                        defaultCenter={mapBounds ? undefined : (points[0] ?? UW_CAMPUS_CENTER)}
                        defaultZoom={mapBounds ? undefined : DEFAULT_ZOOM}
                        mapId={GOOGLE_MAPS_MAP_ID}
                        gestureHandling="greedy"
                        disableDefaultUI={true}
                        zoomControl={true}
                    >
                        <MapPanner target={focus}/>

                        {/* Venue markers */}
                        {mappableVenues.map(venue => (
                            <div key={venue.id}>
                                <AdvancedMarker
                                    position={{lat: venue.lat, lng: venue.lng}}
                                    onClick={() => setSelected({kind: 'venue', id: venue.id})}
                                    zIndex={selectedVenue?.id === venue.id ? 5 : 3}
                                >
                                    <div className="admin-locmap-venue-marker">
                                        <div className="parking-marker-venue-inner">⭐</div>
                                        <div className="parking-marker-label">{venueName(venue)}</div>
                                    </div>
                                </AdvancedMarker>

                                {selected?.kind === 'venue' && selected.id === venue.id && (
                                    <InfoWindow
                                        position={{lat: venue.lat, lng: venue.lng}}
                                        onCloseClick={() => setSelected(null)}
                                        pixelOffset={[0, -80]}
                                    >
                                        <div className="parking-popup-content">
                                            <div className="parking-popup-title">{venue.nameEn}</div>
                                            {venue.nameCn && (
                                                <div className="parking-popup-type">{venue.nameCn}</div>
                                            )}
                                            <div className="parking-popup-type">
                                                {venue.parkingLots.length > 0
                                                    ? (isEnglish
                                                        ? `${venue.parkingLots.length} linked lot${venue.parkingLots.length === 1 ? '' : 's'} — highlighted on the map`
                                                        : `${venue.parkingLots.length} 个关联停车场 — 已在地图上高亮`)
                                                    : (isEnglish ? 'No linked lots' : '无关联停车场')}
                                            </div>
                                            {popupActions({kind: 'venue', id: venue.id})}
                                        </div>
                                    </InfoWindow>
                                )}
                            </div>
                        ))}

                        {/* Parking lot markers — lots linked to the selected venue are highlighted. */}
                        {mappableLots.map(lot => {
                            const linked = linkedLotIds.has(lot.id);
                            const typeLabel = lotTypeLabel(lot.type, isEnglish);
                            const rate = lot.rateId ? rateById[lot.rateId] : undefined;
                            return (
                                <div key={lot.id}>
                                    <AdvancedMarker
                                        position={{lat: lot.lat, lng: lot.lng}}
                                        onClick={() => setSelected({kind: 'lot', id: lot.id})}
                                        zIndex={selected?.kind === 'lot' && selected.id === lot.id ? 4 : linked ? 2 : 1}
                                    >
                                        <div className={`parking-marker-lot-inner${linked ? ' is-linked' : ''}`}>
                                            <div className="parking-marker-p" style={{background: lotColor(lot)}}>
                                                {lotBadgeChar(lot.type)}
                                            </div>
                                            {linked && (
                                                <div className="parking-marker-label">
                                                    {lot.name.split(' ')[0] ?? ''}<span>{typeLabel}</span>
                                                </div>
                                            )}
                                        </div>
                                    </AdvancedMarker>

                                    {selected?.kind === 'lot' && selected.id === lot.id && (
                                        <InfoWindow
                                            position={{lat: lot.lat, lng: lot.lng}}
                                            onCloseClick={() => setSelected(null)}
                                            pixelOffset={[0, -52]}
                                        >
                                            <div className="parking-popup-content">
                                                <div className="parking-popup-title">{lot.name}</div>
                                                {lot.nameCn && (
                                                    <div className="parking-popup-type">{lot.nameCn}</div>
                                                )}
                                                <div className="parking-popup-type">
                                                    {typeLabel}{rate ? ` · ${rateLabel(rate, isEnglish)}` : ''}
                                                </div>
                                                {popupActions({kind: 'lot', id: lot.id})}
                                            </div>
                                        </InfoWindow>
                                    )}
                                </div>
                            );
                        })}
                    </Map>
                </APIProvider>
            </div>

            {unmappedCount > 0 && (
                <p className="admin-helper-text admin-locmap-hint">
                    {isEnglish
                        ? `${unmappedCount} location${unmappedCount === 1 ? ' has' : 's have'} no coordinates set and only appear${unmappedCount === 1 ? 's' : ''} in the lists below.`
                        : `${unmappedCount} 个地点未设置坐标，仅显示在下方列表中。`}
                </p>
            )}
        </div>
    );
};
