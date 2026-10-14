import 'maplibre-gl/dist/maplibre-gl.css';
import {
    AttributionControl,
    type FilterSpecification,
    Map as MapLibreMap,
    type MapOptions,
    Marker,
    type MarkerOptions,
    NavigationControl,
    Popup,
    type PopupOptions,
    setWorkerUrl,
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
 * OpenStreetMap's), and the base map tidied once loaded. Null when MapLibre
 * can't start, which almost always means no WebGL.
 */
export function createMap(
    container: HTMLElement,
    {attribution, ...options}: Omit<MapOptions, 'container'> & {attribution?: string},
): MapLibreMap | null {
    let map: MapLibreMap;
    try {
        map = new MapLibreMap({
            style: MAP_STYLE_URL,
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
    map.on('load', () => tidyBaseMap(map));
    return map;
}

/**
 * Flat buildings, as a campus map reads best, rather than the style's 3D ones;
 * and no OpenStreetMap parking icons, which would sit beside the guide's own
 * pins and include lots visitors can't use.
 */
function tidyBaseMap(map: MapLibreMap): void {
    if (map.getLayer('building-3d')) map.setLayoutProperty('building-3d', 'visibility', 'none');
    if (map.getLayer('building')) map.setLayerZoomRange('building', 13, 24);
    const notParking = ['!=', ['get', 'class'], 'parking'] as FilterSpecification;
    for (const layer of map.getStyle().layers) {
        if (!('source-layer' in layer) || layer['source-layer'] !== 'poi') continue;
        map.setFilter(layer.id, layer.filter ? ['all', layer.filter, notParking] as FilterSpecification : notParking);
    }
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
