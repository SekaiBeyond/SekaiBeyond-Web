import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { createMap, type MapLibreMap, useMarkerElements } from '~/lib/maplibre';
import { DEFAULT_ZOOM } from '~/lib/venues';
import { type QrCode, qrHasSpot } from '~/lib/qrCodes';
import { useLanguage } from '~/components/LanguageContextProvider';
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
    return <SpotsMap spotted={spotted} maxCount={maxCount} onSelect={onSelect} height={height}/>;
};

const SpotsMap = ({spotted, maxCount, onSelect, height}: {
    spotted: QrCode[];
    maxCount: number;
    onSelect?: (id: string) => void;
    height: number;
}) => {
    const {isEnglish} = useLanguage();
    const containerRef = useRef<HTMLDivElement>(null);
    const [map, setMap] = useState<MapLibreMap | null>(null);
    const [failed, setFailed] = useState(false);

    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;
        const created = createMap(container, {center: [spotted[0].lng, spotted[0].lat], zoom: DEFAULT_ZOOM});
        if (!created) {
            setFailed(true);
            return;
        }
        setMap(created);
        return () => {
            created.remove();
            setMap(null);
        };
    }, []);

    // Enclose every pinned spot, again whenever the spots change.
    const spotsKey = spotted.map(c => `${c.id}@${c.lng},${c.lat}`).join(';');
    useEffect(() => {
        if (!map) return;
        if (spotted.length === 1) {
            map.jumpTo({center: [spotted[0].lng, spotted[0].lat], zoom: DEFAULT_ZOOM});
            return;
        }
        const lngs = spotted.map(c => c.lng), lats = spotted.map(c => c.lat);
        map.fitBounds(
            [[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]],
            {padding: 64, maxZoom: 17, duration: 0},
        );
    }, [map, spotsKey]);

    const {elements} = useMarkerElements(
        map,
        spotted.map(c => ({key: c.id, lng: c.lng, lat: c.lat})),
        {anchor: 'center'},
    );

    return (
        <div ref={containerRef} className="admin-qr-map" style={{height}}>
            {failed && (
                <div className="admin-map-failed">
                    {isEnglish ? 'The map couldn’t load. Reload the page to try again.' : '地图加载失败，请刷新页面重试。'}
                </div>
            )}
            {spotted.map(code => elements[code.id] && createPortal(
                <button
                    type="button"
                    className="admin-qr-map-pin"
                    style={{background: heatColor(code.scanCount, maxCount)}}
                    title={code.label}
                    aria-label={isEnglish ? `${code.label}: ${code.scanCount} scans` : `${code.label}：${code.scanCount} 次扫描`}
                    onClick={onSelect ? () => onSelect(code.id) : undefined}
                >
                    {code.scanCount}
                </button>,
                elements[code.id],
                code.id,
            ))}
        </div>
    );
};
