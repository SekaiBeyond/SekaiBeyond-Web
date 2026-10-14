import { useEffect, useMemo, useRef, useState } from 'react';
import { AdvancedMarker, APIProvider, InfoWindow, Map, useMap } from '@vis.gl/react-google-maps';
import { useLanguage } from '~/components/LanguageContextProvider';
import { GOOGLE_MAPS_API_KEY, GOOGLE_MAPS_MAP_ID } from '~/lib/googleMaps';
import { type UwLot, useUwParking, uwLotGlyph, uwLotTypeLabel } from '~/lib/uwParking';
import { DEFAULT_ZOOM, hasCoordinates, UW_CAMPUS_CENTER, type Venue } from '~/lib/venues';

/** Which marker's popup is currently open on the overview map: a venue by ID, a lot by UW code. */
type MapSelection = {kind: 'venue' | 'lot'; id: string};

/** One row in the combined venue + parking-lot search dropdown. */
interface SearchItem {
    kind: 'venue' | 'lot';
    id: string;
    name: string;
    meta: string;
    badgeType: 'venue' | 'garage' | 'lot';
    badgeChar: string;
    /** False when the item has no coordinates — picking it jumps to its list card instead. */
    mappable: boolean;
}

const isGarage = (lot: UwLot) => /Garage/.test(lot.type);

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
 * Searchable finder over every venue and UW parking lot. Picking a mappable item focuses it
 * on the overview map; venues without coordinates jump straight to their list card.
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
                                    {isEnglish ? 'UW Visitor Lots' : 'UW 访客停车场'}
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
 * guide. Plots every venue (star) and UW visitor lot (P / G) on one map; selecting a
 * venue highlights its suggested lots, and a venue's popup can jump to its card in the
 * list below via `onShowVenue` / `onEditVenue`.
 */
interface LocationsMapProps {
    venues: Venue[];
    onShowVenue: (venueId: string) => void;
    /** Jump to the card AND open its inline edit form. */
    onEditVenue: (venueId: string) => void;
    readOnly?: boolean;
}

export const LocationsMap = ({venues, onShowVenue, onEditVenue, readOnly = false}: LocationsMapProps) => {
    const {isEnglish} = useLanguage();
    const {parking} = useUwParking();
    const [selected, setSelected] = useState<MapSelection | null>(null);
    const [focus, setFocus] = useState<{lat: number; lng: number; nonce: number} | null>(null);
    const focusNonce = useRef(0);

    const lots = parking.lots;
    const mappableVenues = venues.filter(v => hasCoordinates(v.lat, v.lng));
    const unmappedCount = venues.length - mappableVenues.length;

    const selectedVenue = selected?.kind === 'venue'
        ? mappableVenues.find(v => v.id === selected.id) ?? null
        : null;
    // The selected venue's suggested lots get the parking guide's highlight treatment.
    const suggestedCodes = useMemo(
        () => new Set(selectedVenue?.suggestedLots.map(s => s.code) ?? []),
        [selectedVenue],
    );

    const venueName = (v: Venue) => isEnglish ? v.nameEn : (v.nameCn || v.nameEn);
    const lotTitle = (lot: UwLot) => lot.name !== lot.code ? `${lot.code} · ${lot.name}` : lot.code;

    const searchItems: SearchItem[] = [
        ...venues.map(v => {
            const n = v.suggestedLots.length;
            return {
                kind: 'venue' as const,
                id: v.id,
                name: venueName(v),
                meta: isEnglish
                    ? `Venue · ${n} suggested lot${n === 1 ? '' : 's'}`
                    : `场地 · ${n} 个推荐停车场`,
                badgeType: 'venue' as const,
                badgeChar: '⭐',
                mappable: hasCoordinates(v.lat, v.lng),
            };
        }),
        ...lots.map(lot => ({
            kind: 'lot' as const,
            id: lot.code,
            name: lotTitle(lot),
            meta: uwLotTypeLabel(lot.type, isEnglish),
            badgeType: isGarage(lot) ? 'garage' as const : 'lot' as const,
            badgeChar: uwLotGlyph(lot.type),
            mappable: true,
        })),
    ];

    const pickSearchItem = (item: SearchItem) => {
        if (!item.mappable) {
            // Nothing to focus on the map — send the admin straight to the venue's card.
            onShowVenue(item.id);
            return;
        }
        const target = item.kind === 'venue'
            ? mappableVenues.find(v => v.id === item.id)
            : lots.find(l => l.code === item.id);
        if (!target) return;
        setSelected({kind: item.kind, id: item.id});
        setFocus({lat: target.lat, lng: target.lng, nonce: ++focusNonce.current});
    };

    const venueActions = (venueId: string) => (
        <div className="admin-locmap-popup-actions">
            <button
                type="button"
                className="admin-locmap-popup-btn admin-locmap-popup-btn--secondary"
                onClick={() => {
                    setSelected(null);
                    onShowVenue(venueId);
                }}
            >
                {isEnglish ? 'Show in list ↓' : '在列表中显示 ↓'}
            </button>
            {!readOnly && (
                <button
                    type="button"
                    className="admin-locmap-popup-btn"
                    onClick={() => {
                        setSelected(null);
                        onEditVenue(venueId);
                    }}
                >
                    {isEnglish ? 'Edit' : '编辑'}
                </button>
            )}
        </div>
    );

    if (venues.length === 0 && lots.length === 0) {
        return (
            <div className="admin-section">
                <p className="admin-no-results">
                    {isEnglish
                        ? 'Nothing to map yet — create a venue below, or sync UW’s parking data.'
                        : '暂无可显示的地点 — 请在下方创建场地，或同步 UW 停车数据。'}
                </p>
            </div>
        );
    }

    // Frame the map on everything that has coordinates; with fewer than two points a
    // bounds box degenerates, so fall back to a plain center + zoom.
    const points = [...mappableVenues, ...lots];
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
                    ? 'Every venue (⭐) and UW visitor lot on one map. Click a venue to highlight its suggested lots, or search to find a location; a venue’s popup jumps to its card below.'
                    : '所有场地（⭐）与 UW 访客停车场都在同一张地图上。点击场地可高亮其推荐停车场，或使用搜索定位；场地弹窗可跳转到下方对应卡片。'}
            </p>

            <div className="admin-locmap-toolbar">
                <LocationSearch items={searchItems} onPick={pickSearchItem} isEnglish={isEnglish}/>
                <div className="admin-locmap-legend">
                    <span className="admin-locmap-legend-item">
                        <span className="admin-locmap-legend-dot" data-type="venue">⭐</span>
                        {isEnglish ? 'Venue' : '场地'}
                    </span>
                    <span className="admin-locmap-legend-item">
                        <span className="admin-locmap-legend-dot" data-type="lot">P</span>
                        {isEnglish ? 'Surface lot' : '地面停车场'}
                    </span>
                    <span className="admin-locmap-legend-item">
                        <span className="admin-locmap-legend-dot" data-type="garage">G</span>
                        {isEnglish ? 'Garage' : '停车楼'}
                    </span>
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
                                                {venue.suggestedLots.length > 0
                                                    ? (isEnglish
                                                        ? `Suggested lots: ${venue.suggestedLots.map(s => s.code).join(' · ')} — highlighted on the map`
                                                        : `推荐停车场：${venue.suggestedLots.map(s => s.code).join(' · ')} — 已在地图上高亮`)
                                                    : (isEnglish ? 'No suggested lots' : '无推荐停车场')}
                                            </div>
                                            {venueActions(venue.id)}
                                        </div>
                                    </InfoWindow>
                                )}
                            </div>
                        ))}

                        {/* UW lot markers — the selected venue's suggested lots are highlighted. */}
                        {lots.map(lot => {
                            const suggested = suggestedCodes.has(lot.code);
                            const typeLabel = uwLotTypeLabel(lot.type, isEnglish);
                            return (
                                <div key={lot.code}>
                                    <AdvancedMarker
                                        position={{lat: lot.lat, lng: lot.lng}}
                                        onClick={() => setSelected({kind: 'lot', id: lot.code})}
                                        zIndex={selected?.kind === 'lot' && selected.id === lot.code ? 4 : suggested ? 2 : 1}
                                    >
                                        <div className={`parking-marker-lot-inner${suggested ? ' is-linked' : ''}`}>
                                            <div className={`parking-marker-p${isGarage(lot) ? ' is-garage' : ''}`}>
                                                {uwLotGlyph(lot.type)}
                                            </div>
                                            {suggested && (
                                                <div className="parking-marker-label">
                                                    {lot.code}<span>{typeLabel}</span>
                                                </div>
                                            )}
                                        </div>
                                    </AdvancedMarker>

                                    {selected?.kind === 'lot' && selected.id === lot.code && (
                                        <InfoWindow
                                            position={{lat: lot.lat, lng: lot.lng}}
                                            onCloseClick={() => setSelected(null)}
                                            pixelOffset={[0, -52]}
                                        >
                                            <div className="parking-popup-content">
                                                <div className="parking-popup-title">{lotTitle(lot)}</div>
                                                <div className="parking-popup-type">
                                                    {typeLabel} · {lot.access === 'Pay to Park'
                                                        ? (isEnglish ? 'Pay to park' : '付费停车')
                                                        : (isEnglish ? 'Permit or pay' : '持证或付费')}
                                                </div>
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
                        ? `${unmappedCount} venue${unmappedCount === 1 ? ' has' : 's have'} no coordinates set and only appear${unmappedCount === 1 ? 's' : ''} in the list below.`
                        : `${unmappedCount} 个场地未设置坐标，仅显示在下方列表中。`}
                </p>
            )}
        </div>
    );
};
