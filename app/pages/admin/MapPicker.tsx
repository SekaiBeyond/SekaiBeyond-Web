import { Marker } from 'maplibre-gl';
import { useEffect, useRef, useState } from 'react';
import { useLanguage } from '~/components/LanguageContextProvider';
import { createMap, type MapLibreMap, prefersReducedMotion } from '~/lib/maplibre';
import { DEFAULT_ZOOM, hasCoordinates, UW_CAMPUS_CENTER } from '~/lib/venues';

interface MapPickerProps {
    value: {lat: number; lng: number};
    onChange: (next: {lat: number; lng: number}) => void;
}

// Six decimals of a degree is about 10 cm, as fine as a pin dropped by hand can mean.
const round = (n: number) => Math.round(n * 1e6) / 1e6;
const keyOf = (p: {lat: number; lng: number}) => `${p.lat},${p.lng}`;

/**
 * Coordinate picker: search a place (Nominatim), click the map to drop the
 * marker, or drag it.
 */
export const MapPicker = ({value, onChange}: MapPickerProps) => {
    const {isEnglish} = useLanguage();
    const containerRef = useRef<HTMLDivElement>(null);
    const [map, setMap] = useState<MapLibreMap | null>(null);
    const [failed, setFailed] = useState(false);
    const marker = useRef<Marker | null>(null);
    const hasValue = hasCoordinates(value.lat, value.lng);
    // The map's handlers outlive renders, so they call the latest onChange through this.
    const onChangeRef = useRef(onChange);
    onChangeRef.current = onChange;
    // A point the map just set is in view; only one from elsewhere (search, a
    // building lookup) pans.
    const placedHere = useRef('');

    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;
        const start = hasCoordinates(value.lat, value.lng) ? value : UW_CAMPUS_CENTER;
        const created = createMap(container, {center: [start.lng, start.lat], zoom: DEFAULT_ZOOM});
        if (!created) {
            setFailed(true);
            return;
        }
        const place = (lat: number, lng: number) => {
            const next = {lat: round(lat), lng: round(lng)};
            placedHere.current = keyOf(next);
            onChangeRef.current(next);
        };
        created.on('click', e => place(e.lngLat.lat, e.lngLat.lng));
        marker.current = new Marker({color: '#ff6b9d', draggable: true});
        marker.current.on('dragend', () => {
            const at = marker.current?.getLngLat();
            if (at) place(at.lat, at.lng);
        });
        setMap(created);
        return () => {
            marker.current?.remove();
            created.remove();
            setMap(null);
        };
    }, []);

    useEffect(() => {
        const pin = marker.current;
        if (!map || !pin) return;
        if (!hasValue) {
            pin.remove();
            return;
        }
        pin.setLngLat([value.lng, value.lat]).addTo(map);
        if (placedHere.current !== keyOf(value)) {
            map.easeTo({center: [value.lng, value.lat], duration: prefersReducedMotion() ? 0 : 500});
        }
        placedHere.current = '';
    }, [map, value.lat, value.lng, hasValue]);

    return (
        <div className="admin-map-picker">
            <PlaceSearch onPick={p => onChange({lat: round(p.lat), lng: round(p.lng)})}/>
            <div ref={containerRef} className="admin-map-picker-canvas">
                {failed && (
                    <div className="admin-map-failed">
                        {isEnglish ? 'The map couldn’t load. Reload the page to try again.' : '地图加载失败，请刷新页面重试。'}
                    </div>
                )}
            </div>
            <p className="admin-helper-text admin-map-picker-hint">
                {isEnglish
                    ? 'Search, click the map, or drag the marker to set the location.'
                    : '搜索、点击地图，或拖动标记来设置位置。'}
                {' '}
                <span className="admin-map-picker-coords">
                    {value.lat.toFixed(5)}, {value.lng.toFixed(5)}
                </span>
            </p>
        </div>
    );
};

// OpenStreetMap's public geocoder. Its policy allows one search per request, at
// most once a second, and no search-as-you-type, so this searches on Enter or
// the button. Results lean towards Seattle.
const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';
const SEATTLE_VIEWBOX = '-122.46,47.78,-122.22,47.48';
const MIN_SEARCH_GAP_MS = 1_100;

interface PlaceResult {
    name: string;
    lat: number;
    lng: number;
}

const PlaceSearch = ({onPick}: {onPick: (p: {lat: number; lng: number}) => void}) => {
    const {isEnglish} = useLanguage();
    const [query, setQuery] = useState('');
    const [results, setResults] = useState<PlaceResult[] | null>(null);
    const [state, setState] = useState<'idle' | 'searching' | 'failed'>('idle');
    const lastSearch = useRef(0);

    const search = async (e?: {preventDefault: () => void}) => {
        e?.preventDefault();
        const q = query.trim();
        if (!q || state === 'searching') return;
        setState('searching');
        const wait = lastSearch.current + MIN_SEARCH_GAP_MS - Date.now();
        if (wait > 0) await new Promise(resolve => setTimeout(resolve, wait));
        lastSearch.current = Date.now();
        try {
            const params = new URLSearchParams({
                q,
                format: 'jsonv2',
                limit: '5',
                viewbox: SEATTLE_VIEWBOX,
                'accept-language': isEnglish ? 'en' : 'zh,en',
            });
            const res = await fetch(`${NOMINATIM_URL}?${params}`);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const raw: unknown = await res.json();
            const found = (Array.isArray(raw) ? raw : []).flatMap((r: {
                lat?: unknown;
                lon?: unknown;
                display_name?: unknown
            } | null) => {
                const lat = Number(r?.lat), lng = Number(r?.lon);
                return typeof r?.display_name === 'string' && Number.isFinite(lat) && Number.isFinite(lng)
                    ? [{name: r.display_name, lat, lng}] : [];
            });
            setResults(found);
            setState('idle');
        } catch (err) {
            console.error('[MapPicker] place search failed:', err);
            setResults(null);
            setState('failed');
        }
    };

    const pick = (result: PlaceResult) => {
        onPick(result);
        setResults(null);
    };

    return (
        <div className="admin-map-search">
            {/* Not a <form>: the picker sits inside other editors' forms. */}
            <div className="admin-map-search-row">
                <input
                    className="admin-input"
                    type="search"
                    value={query}
                    onChange={e => {
                        setQuery(e.target.value);
                        setResults(null);
                        if (state === 'failed') setState('idle');
                    }}
                    onKeyDown={e => {
                        if (e.key === 'Enter') search(e);
                        if (e.key === 'Escape') setResults(null);
                    }}
                    placeholder={isEnglish ? 'Search a place, then press Enter…' : '搜索地点，按回车…'}
                    aria-label={isEnglish ? 'Search a place' : '搜索地点'}
                />
                <button
                    type="button"
                    className="admin-venue-lot-add"
                    onClick={() => search()}
                    disabled={state === 'searching' || !query.trim()}
                >
                    {state === 'searching' ? (isEnglish ? 'Searching…' : '搜索中…') : (isEnglish ? 'Search' : '搜索')}
                </button>
            </div>
            {state === 'failed' && (
                <p className="admin-helper-text admin-map-search-note">
                    {isEnglish ? 'The search didn’t answer. Try again, or click the map.' : '搜索没有响应。请重试，或直接点击地图。'}
                </p>
            )}
            {results && (
                results.length === 0 ? (
                    <p className="admin-helper-text admin-map-search-note">
                        {isEnglish ? 'No places found. Try other words, or click the map.' : '未找到地点。请换个关键词，或直接点击地图。'}
                    </p>
                ) : (
                    <div className="admin-map-search-results" role="listbox">
                        {results.map((r, i) => (
                            <button
                                key={`${i}-${r.lat},${r.lng}`}
                                type="button"
                                role="option"
                                aria-selected={false}
                                className="admin-map-search-result"
                                onClick={() => pick(r)}
                            >
                                {r.name}
                            </button>
                        ))}
                        <span className="admin-map-search-credit">© OpenStreetMap contributors</span>
                    </div>
                )
            )}
        </div>
    );
};
