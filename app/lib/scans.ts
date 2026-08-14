import { collection, getDocs, limit, orderBy, query } from 'firebase/firestore';
import { toDate } from './collectionCache';
import { getFirebaseDb } from './firebase';

/**
 * One scan event. QR codes and passports both write this shape into a `scans`
 * subcollection (and share one TTL policy on that collection group), so both
 * read through here and render through the same trend chart.
 */
export interface ScanEvent {
    at: Date;
    /** Platform tag from a QR link's `p` param. Always '' for passport scans. */
    platform: string;
}

/**
 * Most events are kept for a year (SCAN_RETENTION_DAYS), so a code that has been
 * out on a poster for a season can hold tens of thousands. This is the admin's
 * browser downloading them to draw a chart that buckets by the hour, so it reads
 * the newest slice rather than the lot.
 */
export const SCAN_FETCH_LIMIT = 5000;

/** What one subject's scan history looks like once it has been read. */
export interface ScanHistory {
    /** Oldest first, as the chart wants them. */
    events: ScanEvent[];
    /** Whether older events exist beyond the ones returned. */
    truncated: boolean;
}

/** The newest {@link SCAN_FETCH_LIMIT} scan events under one document. */
export async function fetchScans(parentCollection: string, parentId: string): Promise<ScanHistory> {
    const db = getFirebaseDb();
    // Newest-first with a limit is the only way to bound this; the chart wants
    // them the other way round, so the slice is reversed on the way out.
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
