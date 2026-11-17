import { collection, getDocs, limit, orderBy, query } from 'firebase/firestore';
import { toDate } from './collectionCache';
import { getFirebaseDb } from './firebase';

export interface ScanEvent {
    at: Date;
    platform: string;
}

export const SCAN_FETCH_LIMIT = 5000;

export interface ScanHistory {
    events: ScanEvent[];
    truncated: boolean;
}

export async function fetchScans(parentCollection: string, parentId: string): Promise<ScanHistory> {
    const db = getFirebaseDb();
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
