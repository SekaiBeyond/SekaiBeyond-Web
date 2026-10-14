import 'maplibre-gl/dist/maplibre-gl.css';
import {
    AttributionControl,
    type FilterSpecification,
    type LayerSpecification,
    Map as MapLibreMap,
    type MapOptions,
    Marker,
    type MarkerOptions,
    NavigationControl,
    Popup,
    type PopupOptions,
    setWorkerUrl,
    type StyleSpecification,
} from 'maplibre-gl';
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import { useEffect, useRef, useState } from 'react';

/**
 * What every map on the site shares: MapLibre GL drawing OpenFreeMap's tiles,
 * which are OpenStreetMap data with no key, no billing and no request limit.
 * The public parking guide and the admin's Locations map, map picker and QR
 * spots map all start here.
 */

// MapLibre looks for its worker beside its own script, which the bundle moves.
setWorkerUrl(maplibreWorkerUrl);

export const MAP_STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty';

export type {MapLibreMap};

/**
 * A map in `container` with the site's defaults: no rotation or tilt, zoom
 * buttons top-right, compact attribution bottom-right (`attribution` adds to
 * OpenStreetMap's), and the base map tidied before it's drawn. Null when
 * MapLibre can't start, which almost always means no WebGL.
 */
export function createMap(
    container: HTMLElement,
    {attribution, ...options}: Omit<MapOptions, 'container'> & {attribution?: string},
): MapLibreMap | null {
    let map: MapLibreMap;
    try {
        map = new MapLibreMap({
            maxZoom: 19.5,
            dragRotate: false,
            pitchWithRotate: false,
            touchPitch: false,
            attributionControl: false,
            ...options,
            container,
        });
    } catch (err) {
        console.error('[maplibre] map failed to start:', err);
        return null;
    }
    map.touchZoomRotate.disableRotation();
    map.keyboard.disableRotation();
    map.addControl(new NavigationControl({showCompass: false}), 'top-right');
    map.addControl(new AttributionControl({compact: true, customAttribution: attribution}), 'bottom-right');
    // Some places in the style ask for icons its sprite doesn't have; a blank
    // stand-in leaves their names showing and keeps MapLibre from warning per icon.
    map.setMissingStyleImageResolver(id => {
        if (!map.hasImage(id)) map.addImage(id, {width: 1, height: 1, data: new Uint8Array(4)});
    });
    map.setStyle(MAP_STYLE_URL, {transformStyle: (_previous, next) => tidyStyle(next)});
    return map;
}

/**
 * The base map as the site wants it, applied before anything is drawn: flat
 * buildings rather than the style's 3D ones, as a campus map reads best; no
 * OpenStreetMap parking icons, which would sit beside the guide's own pins
 * and include lots visitors can't use; and no highway shields, which campus
 * maps don't need and whose filters warn on every tile.
 */
function tidyStyle(style: StyleSpecification): StyleSpecification {
    const notParking = ['!=', ['get', 'class'], 'parking'] as FilterSpecification;
    const layers = style.layers
        .filter(layer => layer.id !== 'building-3d' && !layer.id.includes('shield'))
        .map((layer): LayerSpecification => {
            if (layer.id === 'building') return {...layer, maxzoom: 24};
            if ('source-layer' in layer && layer['source-layer'] === 'poi') {
                const filter = layer.filter ? ['all', layer.filter, notParking] as FilterSpecification : notParking;
                return {...layer, filter} as LayerSpecification;
            }
            return layer;
        });
    return {...style, layers};
}

/** The first label layer above the buildings: a layer added before it sits on the buildings, under the labels. */
export function firstLabelAboveBuildings(map: MapLibreMap): string | undefined {
    const layers = map.getStyle().layers;
    const lastBuilding = layers.findLastIndex(l => 'source-layer' in l && l['source-layer'] === 'building');
    return layers.slice(lastBuilding + 1).find(l => l.type === 'symbol')?.id;
}

export interface MarkerPoint {
    key: string;
    lng: number;
    lat: number;
}

export interface PlacedMarkers {
    /** A bare element per point for React to render into with a portal; MapLibre owns its classes and transform. */
    elements: Record<string, HTMLElement>;
    markers: Record<string, Marker>;
}

/**
 * One marker per point, each a bare wrapper element to portal React content
 * into. Remade when the set of points or their positions change. The default
 * anchor, the top lifted 15px, puts the middle of a 30px pin on the point
 * with any label hanging below it.
 */
export function useMarkerElements(
    map: MapLibreMap | null,
    points: MarkerPoint[],
    options: Pick<MarkerOptions, 'anchor' | 'offset'> = {anchor: 'top', offset: [0, -15]},
): PlacedMarkers {
    const [placed, setPlaced] = useState<PlacedMarkers>({elements: {}, markers: {}});
    const latest = useRef({points, options});
    latest.current = {points, options};
    // Sorted, so a reordering alone doesn't remake every marker.
    const pointsKey = points.map(p => `${p.key}@${p.lng},${p.lat}`).sort().join(';');

    useEffect(() => {
        if (!map) return;
        const elements: Record<string, HTMLElement> = {};
        const markers: Record<string, Marker> = {};
        for (const point of latest.current.points) {
            const element = document.createElement('div');
            element.className = 'map-marker';
            markers[point.key] = new Marker({element, ...latest.current.options})
                .setLngLat([point.lng, point.lat])
                .addTo(map);
            elements[point.key] = element;
        }
        setPlaced({elements, markers});
        return () => Object.values(markers).forEach(m => m.remove());
    }, [map, pointsKey]);

    return placed;
}

/** A popup for the map, with an element to portal its content into. Opening and closing are the caller's. */
export function usePopup(map: MapLibreMap | null, options: PopupOptions): {popup: Popup | null; content: HTMLElement | null} {
    const [made, setMade] = useState<{popup: Popup | null; content: HTMLElement | null}>({popup: null, content: null});
    const firstOptions = useRef(options);

    useEffect(() => {
        if (!map) return;
        const content = document.createElement('div');
        const popup = new Popup(firstOptions.current).setDOMContent(content);
        setMade({popup, content});
        return () => {
            popup.remove();
            setMade({popup: null, content: null});
        };
    }, [map]);

    return made;
}

export const prefersReducedMotion = () =>
    typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
