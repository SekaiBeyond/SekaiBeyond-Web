import { collection, getDocs, limit, orderBy, query } from 'firebase/firestore';
import { toDate } from './collectionCache';
import { getFirebaseDb } from './firebase';

/** One scan event, as recordScan writes it under a QR code's `scans` subcollection. */
export interface ScanEvent {
    at: Date;
    /** Platform tag from a QR link's `p` param; '' for a code reached without one. */
    platform: string;
}

/**
 * Scans are kept a year, so a poster's code can hold tens of thousands; the
 * chart only needs the newest slice.
 */
export const SCAN_FETCH_LIMIT = 5000;

/** What one code's scan history looks like once it has been read. */
export interface ScanHistory {
    /** Oldest first, as the chart wants them. */
    events: ScanEvent[];
    /** Whether older events exist beyond the ones returned. */
    truncated: boolean;
}

/** The newest {@link SCAN_FETCH_LIMIT} scan events under one document. */
export async function fetchScans(parentCollection: string, parentId: string): Promise<ScanHistory> {
    const db = getFirebaseDb();
    // Newest first is the only way to bound this; reversed for the chart.
    const snap = await getDocs(query(
        collection(db, parentCollection, parentId, 'scans'),
        orderBy('scannedAt', 'desc'),
        limit(SCAN_FETCH_LIMIT),
    ));
    const events = snap.docs.flatMap(d => {
        const data = d.data();
        const at = toDate(data.scannedAt);
        return at ? [{at, platform: typeof data.platform === 'string' ? data.platform : ''}] : [];
    });
    events.reverse();
    return {events, truncated: snap.size === SCAN_FETCH_LIMIT};
}
