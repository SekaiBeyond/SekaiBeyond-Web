import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLanguage } from '~/components/LanguageContextProvider';
import { createMap, type MapLibreMap, prefersReducedMotion, useMarkerElements, usePopup } from '~/lib/maplibre';
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


// Lot codes appear beside every pin from this zoom; the selected venue's suggested lots always show theirs.
const LABEL_ZOOM = 17.4;
// Picking a location from the search zooms to at least this.
const FOCUS_ZOOM = 16.5;

/**
 * Interactive overview map for the admin Locations tab, modeled on the public parking
 * guide and drawn with its pins. Plots every venue (star) and UW visitor lot (P / G) on
 * one map; selecting a venue highlights its suggested lots, and a venue's popup can jump
 * to its card in the list below via `onShowVenue` / `onEditVenue`.
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
    const containerRef = useRef<HTMLDivElement>(null);
    const [map, setMap] = useState<MapLibreMap | null>(null);
    const [failed, setFailed] = useState(false);
    // Until the admin moves the map, it keeps framing everything as venues and lots arrive.
    const userMoved = useRef(false);
    const {popup, content: popupContent} = usePopup(map, {
        closeButton: true,
        closeOnClick: false,
        offset: 26,
        maxWidth: '300px',
        className: 'admin-locmap-popup',
    });

    const lots = parking.lots;
    const mappableVenues = venues.filter(v => hasCoordinates(v.lat, v.lng));
    const unmappedCount = venues.length - mappableVenues.length;
    // Venues and lots load after the first render; the map's container only exists once there are some.
    const empty = venues.length === 0 && lots.length === 0;

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

    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;
        const created = createMap(container, {
            attribution: 'UW Transportation Services',
            center: [UW_CAMPUS_CENTER.lng, UW_CAMPUS_CENTER.lat],
            zoom: DEFAULT_ZOOM - 1,
        });
        if (!created) {
            setFailed(true);
            return;
        }
        created.on('movestart', e => {
            if ('originalEvent' in e && e.originalEvent) userMoved.current = true;
        });
        // A click on the map itself closes the open popup; one on a marker or the popup doesn't.
        created.on('click', e => {
            const target = e.originalEvent.target;
            if (target instanceof Element && target.closest('.maplibregl-marker, .maplibregl-popup')) return;
            setSelected(null);
        });
        const zoomClass = () => container.classList.toggle('is-zoomed-in', created.getZoom() >= LABEL_ZOOM);
        created.on('zoom', zoomClass);
        zoomClass();
        setMap(created);
        return () => {
            created.remove();
            setMap(null);
        };
    }, [empty]);

    // Frame everything that has coordinates.
    const points = [...mappableVenues, ...lots];
    const pointsKey = points.map(p => `${p.lng},${p.lat}`).join(';');
    useEffect(() => {
        if (!map || userMoved.current || points.length === 0) return;
        if (points.length === 1) {
            map.jumpTo({center: [points[0].lng, points[0].lat], zoom: DEFAULT_ZOOM});
            return;
        }
        const lngs = points.map(p => p.lng), lats = points.map(p => p.lat);
        map.fitBounds(
            [[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]],
            {padding: 60, maxZoom: 17, duration: 0},
        );
    }, [map, pointsKey]);

    const {elements: venueElements, markers: venueMarkers} = useMarkerElements(
        map, mappableVenues.map(v => ({key: v.id, lng: v.lng, lat: v.lat})));
    const {elements: lotElements} = useMarkerElements(
        map, lots.map(l => ({key: l.code, lng: l.lng, lat: l.lat})));

    // Stacking lives on the wrappers, the elements MapLibre stacks; the selected
    // venue's bigger star sits a little higher so its middle stays on the venue.
    useEffect(() => {
        for (const [id, element] of Object.entries(venueElements)) {
            const current = selectedVenue?.id === id;
            element.style.zIndex = current ? '7' : '4';
            venueMarkers[id]?.setOffset([0, current ? -20 : -15]);
        }
    }, [venueElements, venueMarkers, selectedVenue]);
    useEffect(() => {
        for (const [code, element] of Object.entries(lotElements)) {
            const open = selected?.kind === 'lot' && selected.id === code;
            element.style.zIndex = open ? '6' : suggestedCodes.has(code) ? '5' : '1';
        }
    }, [lotElements, selected, suggestedCodes]);

    // The popup follows the selection; closing it with its × clears the selection.
    const selectedPoint = selected?.kind === 'venue'
        ? mappableVenues.find(v => v.id === selected.id)
        : selected ? lots.find(l => l.code === selected.id) : undefined;
    useEffect(() => {
        if (!map || !popup) return;
        if (!selectedPoint) {
            popup.remove();
            return;
        }
        popup.setLngLat([selectedPoint.lng, selectedPoint.lat]);
        if (!popup.isOpen()) popup.addTo(map);
    }, [map, popup, selectedPoint?.lng, selectedPoint?.lat]);
    useEffect(() => {
        if (!popup) return;
        const onClose = () => setSelected(null);
        popup.on('close', onClose);
        return () => {
            popup.off('close', onClose);
        };
    }, [popup]);

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
        if (!target || !map) return;
        setSelected({kind: item.kind, id: item.id});
        userMoved.current = true;
        map.easeTo({
            center: [target.lng, target.lat],
            zoom: Math.max(map.getZoom(), FOCUS_ZOOM),
            duration: prefersReducedMotion() ? 0 : 600,
        });
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

    if (empty) {
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

    const selectedLot = selected?.kind === 'lot' ? lots.find(l => l.code === selected.id) : undefined;

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

            <div ref={containerRef} className="admin-locmap-canvas">
                {failed && (
                    <div className="admin-map-failed">
                        {isEnglish ? 'The map couldn’t load. Reload the page to try again.' : '地图加载失败，请刷新页面重试。'}
                    </div>
                )}
            </div>

            {mappableVenues.map(venue => venueElements[venue.id] && createPortal(
                <button
                    type="button"
                    className={`parking-vpin${selectedVenue?.id === venue.id ? ' is-current' : ''}`}
                    aria-label={venueName(venue)}
                    onClick={() => setSelected({kind: 'venue', id: venue.id})}
                >
                    <span className="parking-vpin-dot" aria-hidden="true">⭐</span>
                    <span className="parking-vpin-label">{venueName(venue)}</span>
                </button>,
                venueElements[venue.id],
                venue.id,
            ))}

            {lots.map(lot => lotElements[lot.code] && createPortal(
                <div className={`parking-pin-wrap${suggestedCodes.has(lot.code) ? ' is-pick' : ''}`}>
                    <button
                        type="button"
                        className={`parking-pin admin-locmap-pin${isGarage(lot) ? ' is-garage' : ''}${selectedLot?.code === lot.code ? ' is-selected' : ''}`}
                        aria-label={`${lot.code}, ${uwLotTypeLabel(lot.type, isEnglish)}`}
                        onClick={() => setSelected({kind: 'lot', id: lot.code})}
                    >
                        {uwLotGlyph(lot.type)}
                    </button>
                    <div className="parking-pin-label" aria-hidden="true">
                        {lot.code}
                        {suggestedCodes.has(lot.code) && <span>{uwLotTypeLabel(lot.type, isEnglish)}</span>}
                    </div>
                </div>,
                lotElements[lot.code],
                lot.code,
            ))}

            {popupContent && createPortal(
                selectedVenue ? (
                    <div className="admin-locmap-popup-body">
                        <div className="admin-locmap-popup-title">{selectedVenue.nameEn}</div>
                        {selectedVenue.nameCn && <div className="admin-locmap-popup-meta">{selectedVenue.nameCn}</div>}
                        <div className="admin-locmap-popup-meta">
                            {selectedVenue.suggestedLots.length > 0
                                ? (isEnglish
                                    ? `Suggested lots: ${selectedVenue.suggestedLots.map(s => s.code).join(' · ')} — highlighted on the map`
                                    : `推荐停车场：${selectedVenue.suggestedLots.map(s => s.code).join(' · ')} — 已在地图上高亮`)
                                : (isEnglish ? 'No suggested lots' : '无推荐停车场')}
                        </div>
                        {venueActions(selectedVenue.id)}
                    </div>
                ) : selectedLot ? (
                    <div className="admin-locmap-popup-body">
                        <div className="admin-locmap-popup-title">{lotTitle(selectedLot)}</div>
                        <div className="admin-locmap-popup-meta">
                            {uwLotTypeLabel(selectedLot.type, isEnglish)} · {selectedLot.access === 'Pay to Park'
                                ? (isEnglish ? 'Pay to park' : '付费停车')
                                : (isEnglish ? 'Permit or pay' : '持证或付费')}
                        </div>
                    </div>
                ) : null,
                popupContent,
            )}

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
