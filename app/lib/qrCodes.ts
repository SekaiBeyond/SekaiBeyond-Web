import { createCollectionCache, toDate } from './collectionCache';
import { fetchScans, type ScanHistory } from './scans';

export type QrExpirationMode = 'none' | 'event' | 'date';

export interface QrCode {
    id: string;
    label: string;
    labelCn: string;
    targetUrl: string;
    /** Optional linked event — drives dashboard filtering and event-based expiry. */
    eventId: string;
    /**
     * Source platforms ([] = a location code). A social code is one record for
     * one URL carrying a QR link per platform (see {@link qrScanUrl}); the list
     * is editable after creation and each platform's scans tally separately in
     * {@link platformScans} so click-through can be compared. The kind itself
     * (social vs. location) is fixed at creation.
     */
    platforms: string[];
    /** Per-platform scan tallies keyed by platform id (social codes only). */
    platformScans: Record<string, number>;
    expirationMode: QrExpirationMode;
    /** Only set when expirationMode === 'date'. */
    expiresAt: Date | null;
    /** Map spot. (0, 0) is the "unset" sentinel — use {@link qrHasSpot}. */
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

/**
 * The stable link encoded into a managed QR code's image. Social codes get one
 * link per platform — the `p` param routes the scan into that platform's tally.
 */
export function qrScanUrl(id: string, origin: string, platform?: string): string {
    const base = `${origin}/qr?id=${encodeURIComponent(id)}`;
    return platform ? `${base}&p=${encodeURIComponent(platform)}` : base;
}

/** Social codes carry platform tags; location codes never do. */
export function qrIsSocial(code: Pick<QrCode, 'platforms'>): boolean {
    return code.platforms.length > 0;
}

/** A spot is "set" only when both coords are finite and not the (0, 0) sentinel. */
export function qrHasSpot(code: Pick<QrCode, 'lat' | 'lng'>): boolean {
    return Number.isFinite(code.lat) && Number.isFinite(code.lng) && !(code.lat === 0 && code.lng === 0);
}

/**
 * Whether a code would still redirect, for admin display. `eventEndAt` is the
 * linked event's end time (null if unknown/archived) and is only consulted for
 * event-based expiry.
 */
export function qrIsActive(code: QrCode, eventEndAt: Date | null): boolean {
    const now = new Date();
    if (code.expirationMode === 'date') return code.expiresAt ? code.expiresAt > now : false;
    if (code.expirationMode === 'event') return eventEndAt ? eventEndAt > now : false;
    return true;
}

/** Scan history for one code — backs the trend chart. */
export const fetchQrScans = (id: string): Promise<ScanHistory> => fetchScans('qrCodes', id);
