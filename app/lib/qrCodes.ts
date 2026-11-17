import { createCollectionCache, toDate } from './collectionCache';
import { fetchScans, type ScanHistory } from './scans';
import { hasCoordinates } from './venues';

export type QrExpirationMode = 'none' | 'event' | 'date';

export interface QrCode {
    id: string;
    label: string;
    labelCn: string;
    targetUrl: string;
    eventId: string;
    platforms: string[];
    platformScans: Record<string, number>;
    expirationMode: QrExpirationMode;
    expiresAt: Date | null;
    lat: number;
    lng: number;
    spotLabel: string;
    spotLabelCn: string;
    scanCount: number;
    lastScanAt: Date | null;
    createdAt: Date | null;
    createdByName: string;
}

const cache = createCollectionCache<QrCode>('qrCodes', docSnap => {
    const data = docSnap.data();
    const mode = data.expirationMode;
    const platformScans: Record<string, number> = {};
    if (data.platformScans && typeof data.platformScans === 'object') {
        for (const [k, v] of Object.entries(data.platformScans)) {
            if (typeof v === 'number') platformScans[k] = v;
        }
    }
    return {
        id: docSnap.id,
        label: data.label ?? '',
        labelCn: data.labelCn ?? '',
        targetUrl: data.targetUrl ?? '',
        eventId: data.eventId ?? '',
        platforms: Array.isArray(data.platforms)
            ? data.platforms.filter((p: unknown): p is string => typeof p === 'string')
            : [],
        platformScans,
        expirationMode: (mode === 'event' || mode === 'date') ? mode : 'none',
        expiresAt: toDate(data.expiresAt),
        lat: typeof data.lat === 'number' ? data.lat : 0,
        lng: typeof data.lng === 'number' ? data.lng : 0,
        spotLabel: data.spotLabel ?? '',
        spotLabelCn: data.spotLabelCn ?? '',
        scanCount: typeof data.scanCount === 'number' ? data.scanCount : 0,
        lastScanAt: toDate(data.lastScanAt),
        createdAt: toDate(data.createdAt),
        createdByName: data.createdByName ?? '',
    };
});

export function useQrCodes(): {qrCodes: QrCode[]; loading: boolean; refresh: () => Promise<void>} {
    const {items, loading, refresh} = cache.useItems();
    return {qrCodes: items, loading, refresh};
}

export function qrScanUrl(id: string, origin: string, platform?: string): string {
    const base = `${origin}/qr?id=${encodeURIComponent(id)}`;
    return platform ? `${base}&p=${encodeURIComponent(platform)}` : base;
}

export function qrIsSocial(code: Pick<QrCode, 'platforms'>): boolean {
    return code.platforms.length > 0;
}

export function qrHasSpot(code: Pick<QrCode, 'lat' | 'lng'>): boolean {
    return hasCoordinates(code.lat, code.lng);
}

export function qrIsActive(code: QrCode, eventEndAt: Date | null): boolean {
    const now = new Date();
    if (code.expirationMode === 'date') return code.expiresAt ? code.expiresAt > now : false;
    if (code.expirationMode === 'event') return eventEndAt ? eventEndAt > now : false;
    return true;
}

export const fetchQrScans = (id: string): Promise<ScanHistory> => fetchScans('qrCodes', id);
