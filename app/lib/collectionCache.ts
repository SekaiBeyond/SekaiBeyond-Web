import { useCallback, useEffect, useState } from 'react';
import { collection, getDocs, query, type QueryConstraint, type QueryDocumentSnapshot } from 'firebase/firestore';
import { getFirebaseDb } from './firebase';

/**
 * A module-level read-through cache shared across every component that uses it. The first
 * `useValue()` triggers a single fetch; the result is cached in module scope and pushed to
 * all mounted subscribers. `refresh()` re-fetches and fans the new value out to everyone,
 * so an admin write is reflected app-wide without each consumer re-querying.
 *
 * Use this for small, rarely-changing data loaded in full (a config doc, a top-level
 * collection). It is not a substitute for a live `onSnapshot` listener.
 */
export interface ValueCache<T> {
    /** Hook returning the cached value, a loading flag, and a `refresh` that re-fetches. */
    useValue: () => {value: T; loading: boolean; refresh: () => Promise<void>};
    /** Re-fetch and notify all subscribers. Returns the fresh value. */
    refresh: () => Promise<T>;
    /** Synchronous snapshot of the cached value, or null if it hasn't loaded yet. */
    peek: () => T | null;
}

export function createValueCache<T>(
    label: string,
    fetcher: () => Promise<T>,
    initialValue: T,
): ValueCache<T> {
    let cached: T | null = null;
    let fetchPromise: Promise<T> | null = null;
    const subscribers = new Set<(value: T) => void>();

    async function fetchValue(force = false): Promise<T> {
        if (!force && cached !== null) return cached;
        if (fetchPromise) return fetchPromise;

        fetchPromise = (async () => {
            try {
                cached = await fetcher();
                return cached;
            } finally {
                // Clear on success and failure alike, so a failed fetch can be retried
                // instead of pinning a rejected promise forever.
                fetchPromise = null;
            }
        })();

        return fetchPromise;
    }

    async function refresh(): Promise<T> {
        const value = await fetchValue(true);
        for (const fn of subscribers) fn(value);
        return value;
    }

    function useValue() {
        const [value, setValue] = useState<T>(cached ?? initialValue);
        const [loading, setLoading] = useState(cached === null);

        useEffect(() => {
            subscribers.add(setValue);
            return () => {
                subscribers.delete(setValue);
            };
        }, []);

        useEffect(() => {
            if (cached !== null) {
                setValue(cached);
                setLoading(false);
                return;
            }
            fetchValue()
                .then(result => {
                    setValue(result);
                    setLoading(false);
                })
                .catch(err => {
                    console.error(`Failed to load ${label}:`, err);
                    setLoading(false);
                });
        }, []);

        const doRefresh = useCallback(async () => {
            await refresh();
        }, []);

        return {value, loading, refresh: doRefresh};
    }

    return {useValue, refresh, peek: () => cached};
}

/**
 * A `ValueCache` over a Firestore collection fetched with the given query constraints
 * (all documents when none are given). Use for small, rarely-changing top-level
 * collections (tags, venues, parking lots).
 */
export interface CollectionCache<T> {
    /** Hook returning the cached list, a loading flag, and a `refresh` that re-fetches. */
    useItems: () => {items: T[]; loading: boolean; refresh: () => Promise<void>};
    /** Re-fetch from Firestore and notify all subscribers. Returns the fresh list. */
    refresh: () => Promise<T[]>;
    /** Synchronous snapshot of the cached list, or null if it hasn't loaded yet. */
    peek: () => T[] | null;
}

export function createCollectionCache<T>(
    collectionName: string,
    mapDoc: (docSnap: QueryDocumentSnapshot) => T,
    ...constraints: QueryConstraint[]
): CollectionCache<T> {
    const cache = createValueCache<T[]>(collectionName, async () => {
        const db = getFirebaseDb();
        const snapshot = await getDocs(query(collection(db, collectionName), ...constraints));
        return snapshot.docs.map(mapDoc);
    }, []);

    function useItems() {
        const {value: items, loading, refresh} = cache.useValue();
        return {items, loading, refresh};
    }

    return {useItems, refresh: cache.refresh, peek: cache.peek};
}
