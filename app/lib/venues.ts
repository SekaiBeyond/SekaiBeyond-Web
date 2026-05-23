import { useCallback, useEffect, useState } from 'react';
import { collection, getDocs, query } from 'firebase/firestore';
import { getFirebaseDb } from './firebase';

export interface VenueLotLink {
    lotId: string;
    walkingMinutes: number;
    /** Whether this lot is the primary recommendation for the venue. */
    recommended: boolean;
}

export interface Venue {
    id: string;
    nameEn: string;
    nameCn: string;
    lat: number;
    lng: number;
    parkingLots: VenueLotLink[];
}

/** Default map center (UW campus center) when no venue-specific center is available. */
export const UW_CAMPUS_CENTER = {lat: 47.6553, lng: -122.3035};
export const DEFAULT_ZOOM = 17;

let cachedVenues: Venue[] | null = null;
let fetchPromise: Promise<Venue[]> | null = null;
const subscribers = new Set<(venues: Venue[]) => void>();

async function fetchVenues(force = false): Promise<Venue[]> {
    if (!force && cachedVenues) return cachedVenues;
    if (fetchPromise) return fetchPromise;

    fetchPromise = (async () => {
        const db = getFirebaseDb();
        const q = query(collection(db, 'venues'));
        const snapshot = await getDocs(q);
        const venues: Venue[] = [];
        snapshot.forEach(docSnap => {
            const data = docSnap.data();
            const rawLots = Array.isArray(data.parkingLots) ? data.parkingLots : [];
            const parkingLots: VenueLotLink[] = rawLots
                .map((link: any) => ({
                    lotId: typeof link?.lotId === 'string' ? link.lotId : '',
                    walkingMinutes: typeof link?.walkingMinutes === 'number' ? link.walkingMinutes : 0,
                    recommended: Boolean(link?.recommended),
                }))
                .filter((link: VenueLotLink) => link.lotId.length > 0);
            venues.push({
                id: docSnap.id,
                nameEn: data.nameEn ?? '',
                nameCn: data.nameCn ?? '',
                lat: typeof data.lat === 'number' ? data.lat : 0,
                lng: typeof data.lng === 'number' ? data.lng : 0,
                parkingLots,
            });
        });
        cachedVenues = venues;
        fetchPromise = null;
        return venues;
    })();

    return fetchPromise;
}

async function refreshVenues(): Promise<Venue[]> {
    const venues = await fetchVenues(true);
    for (const fn of subscribers) fn(venues);
    return venues;
}

export function useVenues(): {venues: Venue[]; loading: boolean; refresh: () => Promise<void>} {
    const [venues, setVenues] = useState<Venue[]>(cachedVenues ?? []);
    const [loading, setLoading] = useState(cachedVenues === null);

    useEffect(() => {
        subscribers.add(setVenues);
        return () => {
            subscribers.delete(setVenues);
        };
    }, []);

    useEffect(() => {
        if (cachedVenues) {
            setVenues(cachedVenues);
            setLoading(false);
            return;
        }
        fetchVenues()
            .then(result => {
                setVenues(result);
                setLoading(false);
            })
            .catch(err => {
                console.error('Failed to load venues:', err);
                setLoading(false);
            });
    }, []);

    const refresh = useCallback(async () => {
        await refreshVenues();
    }, []);

    return {venues, loading, refresh};
}

/**
 * Resolve an event's `location` string to a known venue by exact match on nameEn.
 * Returns null if no match. The Location picker in the admin event editor writes
 * `venue.nameEn` into `event.location`, so this is an exact lookup.
 */
export function resolveVenue(location: string, venues: Venue[]): Venue | null {
    if (!location) return null;
    return venues.find(v => v.nameEn === location) ?? null;
}
