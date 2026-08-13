import { collection, getDocs, orderBy, query } from 'firebase/firestore';
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

/** Scan events (oldest first) under one document's `scans` subcollection. */
export async function fetchScans(parentCollection: string, parentId: string): Promise<ScanEvent[]> {
    const db = getFirebaseDb();
    const snap = await getDocs(query(
        collection(db, parentCollection, parentId, 'scans'),
        orderBy('scannedAt', 'asc'),
    ));
    return snap.docs.flatMap(d => {
        const data = d.data();
        const at = toDate(data.scannedAt);
        return at ? [{at, platform: typeof data.platform === 'string' ? data.platform : ''}] : [];
    });
}
