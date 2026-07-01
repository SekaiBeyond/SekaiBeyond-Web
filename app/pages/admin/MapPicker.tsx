import { useEffect, useRef, useState } from 'react';
import { AdvancedMarker, APIProvider, Map, useMap, useMapsLibrary, } from '@vis.gl/react-google-maps';
import { DEFAULT_ZOOM, hasCoordinates, UW_CAMPUS_CENTER } from '~/lib/venues';
import { useLanguage } from '~/components/LanguageContextProvider';

interface MapPickerProps {
    value: {lat: number; lng: number};
    onChange: (next: {lat: number; lng: number}) => void;
    height?: number;
}

/**
 * Map-based coordinate picker with three input methods:
 * - Type into the search box (Google Places autocomplete) to jump to a place.
 * - Click anywhere on the map to drop the marker at that point.
 * - Drag the marker for fine-tuning.
 */
export const MapPicker = (props: MapPickerProps) => {
    const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY || '';
    const mapId = import.meta.env.VITE_GOOGLE_MAPS_MAP_ID || 'DEMO_MAP_ID';

    return (
        <APIProvider apiKey={apiKey} libraries={['places']}>
            <MapPickerInner {...props} mapId={mapId}/>
        </APIProvider>
    );
};

interface MapPickerInnerProps extends MapPickerProps {
    mapId: string;
}

const MapPickerInner = ({value, onChange, height = 320, mapId}: MapPickerInnerProps) => {
    const {isEnglish} = useLanguage();
    const hasValue = hasCoordinates(value.lat, value.lng);
    const initialCenter = hasValue ? value : UW_CAMPUS_CENTER;

    return (
        <div className="admin-map-picker">
            <SearchBox onPick={onChange}/>
            <div className="admin-map-picker-canvas" style={{height}}>
                <Map
                    defaultCenter={initialCenter}
                    defaultZoom={DEFAULT_ZOOM}
                    mapId={mapId}
                    gestureHandling="greedy"
                    disableDefaultUI={false}
                    zoomControl={true}
                    onClick={e => {
                        const latLng = e.detail?.latLng;
                        if (latLng) onChange({lat: latLng.lat, lng: latLng.lng});
                    }}
                >
                    <MapRecenter target={value} enabled={hasValue}/>
                    {hasValue && (
                        <AdvancedMarker
                            position={value}
                            draggable
                            onDragEnd={e => {
                                const latLng = e.latLng;
                                if (latLng) onChange({lat: latLng.lat(), lng: latLng.lng()});
                            }}
                        />
                    )}
                </Map>
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

/**
 * Pans the map to `target` whenever it changes externally (search or drag).
 * Without this the map would stay at its initial center.
 */
const MapRecenter = ({target, enabled}: {target: {lat: number; lng: number}; enabled: boolean}) => {
    const map = useMap();
    useEffect(() => {
        if (!map || !enabled) return;
        map.panTo(target);
    }, [map, target.lat, target.lng, enabled]);
    return null;
};

/**
 * Google Places Autocomplete attached to a text input. On selection,
 * passes the picked coordinates up via `onPick`.
 *
 * Uses the legacy `places.Autocomplete` API. Google has deprecated it in favor of
 * `PlaceAutocompleteElement`, but the legacy widget still works on existing API keys
 * and is much simpler to embed in React than the new web component.
 */
const SearchBox = ({onPick}: {onPick: (pt: {lat: number; lng: number}) => void}) => {
    const {isEnglish} = useLanguage();
    const placesLib = useMapsLibrary('places');
    const inputRef = useRef<HTMLInputElement>(null);
    const [unavailable, setUnavailable] = useState(false);

    useEffect(() => {
        if (!placesLib || !inputRef.current) return;
        // Some newer API keys do not have access to the legacy Autocomplete.
        if (typeof placesLib.Autocomplete !== 'function') {
            setUnavailable(true);
            return;
        }
        const ac = new placesLib.Autocomplete(inputRef.current, {
            fields: ['geometry'],
        });
        const listener = ac.addListener('place_changed', () => {
            const place = ac.getPlace();
            const loc = place.geometry?.location;
            if (loc) onPick({lat: loc.lat(), lng: loc.lng()});
        });
        return () => {
            listener.remove();
        };
    }, [placesLib, onPick]);

    return (
        <input
            ref={inputRef}
            className="admin-input"
            placeholder={unavailable
                ? (isEnglish ? 'Search unavailable — use map or drag the marker.' : '搜索不可用 — 请使用地图或拖动标记。')
                : (isEnglish ? 'Search a place…' : '搜索地点…')}
            disabled={unavailable}
            type="text"
        />
    );
};
