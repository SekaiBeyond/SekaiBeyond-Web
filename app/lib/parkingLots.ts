import { useCallback, useEffect, useState } from 'react';
import { collection, getDocs, query } from 'firebase/firestore';
import { getFirebaseDb } from './firebase';

export interface ParkingLot {
    id: string;
    name: string;
    nameCn: string;
    type: 'general' | 'disabled' | 'garage';
    lat: number;
    lng: number;
    descriptionEn: string;
    descriptionCn: string;
}

/** Localized full "<type> Parking" label (e.g. "Disabled Parking" / "无障碍停车"). */
export function lotTypeLabel(type: ParkingLot['type'], isEnglish: boolean): string {
    if (isEnglish) {
        return type === 'disabled' ? 'Disabled Parking'
            : type === 'garage' ? 'Parking Garage' : 'General Parking';
    }
    return type === 'disabled' ? '无障碍停车'
        : type === 'garage' ? '停车库' : '普通停车';
}

/** Short type label for compact admin lists (e.g. "Disabled" / "无障碍"). */
export function lotTypeShortLabel(type: ParkingLot['type'], isEnglish: boolean): string {
    if (isEnglish) {
        return type === 'disabled' ? 'Disabled'
            : type === 'garage' ? 'Garage' : 'General';
    }
    return type === 'disabled' ? '无障碍'
        : type === 'garage' ? '停车库' : '普通';
}

/** Single-character badge glyph for a lot type (♿ / G / P). */
export function lotBadgeChar(type: ParkingLot['type']): string {
    return type === 'disabled' ? '♿' : type === 'garage' ? 'G' : 'P';
}

let cachedLots: ParkingLot[] | null = null;
let fetchPromise: Promise<ParkingLot[]> | null = null;
const subscribers = new Set<(lots: ParkingLot[]) => void>();

async function fetchParkingLots(force = false): Promise<ParkingLot[]> {
    if (!force && cachedLots) return cachedLots;
    if (fetchPromise) return fetchPromise;

    fetchPromise = (async () => {
        const db = getFirebaseDb();
        const q = query(collection(db, 'parkingLots'));
        const snapshot = await getDocs(q);
        const lots: ParkingLot[] = [];
        snapshot.forEach(docSnap => {
            const data = docSnap.data();
            lots.push({
                id: docSnap.id,
                name: data.name ?? '',
                nameCn: data.nameCn ?? '',
                type: (data.type === 'disabled' || data.type === 'garage') ? data.type : 'general',
                lat: typeof data.lat === 'number' ? data.lat : 0,
                lng: typeof data.lng === 'number' ? data.lng : 0,
                descriptionEn: data.descriptionEn ?? '',
                descriptionCn: data.descriptionCn ?? '',
            });
        });
        cachedLots = lots;
        fetchPromise = null;
        return lots;
    })();

    return fetchPromise;
}

async function refreshParkingLots(): Promise<ParkingLot[]> {
    const lots = await fetchParkingLots(true);
    for (const fn of subscribers) fn(lots);
    return lots;
}

export function useParkingLots(): {parkingLots: ParkingLot[]; loading: boolean; refresh: () => Promise<void>} {
    const [parkingLots, setParkingLots] = useState<ParkingLot[]>(cachedLots ?? []);
    const [loading, setLoading] = useState(cachedLots === null);

    useEffect(() => {
        subscribers.add(setParkingLots);
        return () => {
            subscribers.delete(setParkingLots);
        };
    }, []);

    useEffect(() => {
        if (cachedLots) {
            setParkingLots(cachedLots);
            setLoading(false);
            return;
        }
        fetchParkingLots()
            .then(result => {
                setParkingLots(result);
                setLoading(false);
            })
            .catch(err => {
                console.error('Failed to load parking lots:', err);
                setLoading(false);
            });
    }, []);

    const refresh = useCallback(async () => {
        await refreshParkingLots();
    }, []);

    return {parkingLots, loading, refresh};
}
