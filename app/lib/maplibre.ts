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

setWorkerUrl(maplibreWorkerUrl);

const MAP_STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty';

export type { MapLibreMap };

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
    map.setMissingStyleImageResolver(id => {
        if (!map.hasImage(id)) map.addImage(id, {width: 1, height: 1, data: new Uint8Array(4)});
    });
    map.setStyle(MAP_STYLE_URL, {transformStyle: (_previous, next) => tidyStyle(next)});
    return map;
}

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

const LABEL_ZOOM = 17.4;

export function trackLabelZoom(map: MapLibreMap, container: HTMLElement): void {
    const update = () => container.classList.toggle('is-zoomed-in', map.getZoom() >= LABEL_ZOOM);
    map.on('zoom', update);
    update();
}

export function onBackgroundClick(map: MapLibreMap, handler: () => void): void {
    map.on('click', e => {
        const target = e.originalEvent.target;
        if (target instanceof Element && target.closest('.maplibregl-marker, .maplibregl-popup')) return;
        handler();
    });
}

export function firstLabelAboveBuildings(map: MapLibreMap): string | undefined {
    const layers = map.getStyle().layers;
    const lastBuilding = layers.findLastIndex(l => 'source-layer' in l && l['source-layer'] === 'building');
    return layers.slice(lastBuilding + 1).find(l => l.type === 'symbol')?.id;
}

interface MarkerPoint {
    key: string;
    lng: number;
    lat: number;
}

interface PlacedMarkers {
    elements: Record<string, HTMLElement>;
    markers: Record<string, Marker>;
}

export function useMarkerElements(
    map: MapLibreMap | null,
    points: MarkerPoint[],
    options: Pick<MarkerOptions, 'anchor' | 'offset'> = {anchor: 'top', offset: [0, -15]},
): PlacedMarkers {
    const [placed, setPlaced] = useState<PlacedMarkers>({elements: {}, markers: {}});
    const latest = useRef({points, options});
    latest.current = {points, options};
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

export function usePopup(map: MapLibreMap | null, options: PopupOptions): {
    popup: Popup | null;
    content: HTMLElement | null
} {
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
