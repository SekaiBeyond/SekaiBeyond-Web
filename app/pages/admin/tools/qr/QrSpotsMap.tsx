import { useEffect } from 'react';
import { AdvancedMarker, APIProvider, Map, useMap } from '@vis.gl/react-google-maps';
import { DEFAULT_ZOOM } from '~/lib/venues';
import { type QrCode, qrHasSpot } from '~/lib/qrCodes';
import { useLanguage } from '~/components/LanguageContextProvider';
import { GOOGLE_MAPS_API_KEY, GOOGLE_MAPS_MAP_ID } from '~/lib/googleMaps';
import { heatColor } from './heat';

interface QrSpotsMapProps {
    codes: QrCode[];
    onSelect?: (id: string) => void;
    height?: number;
}

/**
 * Read-only map of every QR code that has a pinned spot, with a count marker
 * heat-colored by scan volume — the "where are my hotspots" view.
 */
export const QrSpotsMap = ({codes, onSelect, height = 340}: QrSpotsMapProps) => {
    const {isEnglish} = useLanguage();
    const spotted = codes.filter(qrHasSpot);
    const maxCount = spotted.reduce((m, c) => Math.max(m, c.scanCount), 0);

    if (spotted.length === 0) {
        return (
            <p className="admin-no-results">
                {isEnglish
                    ? 'No QR codes are pinned to a map spot yet.'
                    : '暂无关联地图位置的二维码。'}
            </p>
        );
    }

    return (
        <div className="admin-qr-map" style={{height}}>
            <APIProvider apiKey={GOOGLE_MAPS_API_KEY}>
                <Map
                    defaultCenter={spotted[0]}
                    defaultZoom={DEFAULT_ZOOM}
                    mapId={GOOGLE_MAPS_MAP_ID}
                    gestureHandling="greedy"
                    disableDefaultUI={false}
                    zoomControl={true}
                >
                    <FitBounds points={spotted}/>
                    {spotted.map(code => (
                        <AdvancedMarker
                            key={code.id}
                            position={{lat: code.lat, lng: code.lng}}
                            title={code.label}
                            onClick={onSelect ? () => onSelect(code.id) : undefined}
                        >
                            <div
                                className="admin-qr-map-pin"
                                style={{background: heatColor(code.scanCount, maxCount)}}
                            >
                                {code.scanCount}
                            </div>
                        </AdvancedMarker>
                    ))}
                </Map>
            </APIProvider>
        </div>
    );
};

/** Pan/zoom to enclose every pinned spot once the map is ready. */
const FitBounds = ({points}: {points: QrCode[]}) => {
    const map = useMap();
    useEffect(() => {
        if (!map || points.length === 0) return;
        if (points.length === 1) {
            map.setCenter({lat: points[0].lat, lng: points[0].lng});
            map.setZoom(DEFAULT_ZOOM);
            return;
        }
        // A bounds literal avoids referencing the `google` global, which isn't
        // in this project's restricted `types` set.
        const lats = points.map(p => p.lat);
        const lngs = points.map(p => p.lng);
        map.fitBounds({
            north: Math.max(...lats),
            south: Math.min(...lats),
            east: Math.max(...lngs),
            west: Math.min(...lngs),
        }, 64);
    }, [map, points]);
    return null;
};
