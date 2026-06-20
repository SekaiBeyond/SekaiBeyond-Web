import { collection, getDocs, orderBy, query } from 'firebase/firestore';
import { getFirebaseDb } from './firebase';
import { createCollectionCache } from './collectionCache';

export type QrExpirationMode = 'none' | 'event' | 'date';

export interface QrCode {
    id: string;
    label: string;
    labelCn: string;
    targetUrl: string;
    /** Optional linked event — drives dashboard filtering and event-based expiry. */
    eventId: string;
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

const toDate = (v: unknown): Date | null =>
    v && typeof (v as {toDate?: () => Date}).toDate === 'function'
        ? (v as {toDate: () => Date}).toDate()
        : null;

const cache = createCollectionCache<QrCode>('qrCodes', docSnap => {
    const data = docSnap.data();
    const mode = data.expirationMode;
    return {
        id: docSnap.id,
        label: data.label ?? '',
        labelCn: data.labelCn ?? '',
        targetUrl: data.targetUrl ?? '',
        eventId: data.eventId ?? '',
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

/** The stable link encoded into a managed QR code's image. */
export function qrScanUrl(id: string, origin: string): string {
    return `${origin}/qr?id=${encodeURIComponent(id)}`;
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

/** Scan timestamps (oldest first) for one code — backs the trend chart. */
export async function fetchQrScans(id: string): Promise<Date[]> {
    const db = getFirebaseDb();
    const snap = await getDocs(query(
        collection(db, 'qrCodes', id, 'scans'),
        orderBy('scannedAt', 'asc'),
    ));
    return snap.docs
        .map(d => toDate(d.data().scannedAt))
        .filter((d): d is Date => d !== null);
}
