import { useCallback, useEffect, useState } from 'react';
import { collection, getDocs, query, type QueryDocumentSnapshot } from 'firebase/firestore';
import { getFirebaseDb } from './firebase';

/**
 * A module-level read-through cache for a Firestore collection, shared across every
 * component that uses it. The first `useItems()` triggers a single fetch; the result is
 * cached in module scope and pushed to all mounted subscribers. `refresh()` re-fetches and
 * fans the new list out to everyone, so an admin write is reflected app-wide without each
 * consumer re-querying.
 *
 * Use this for small, rarely-changing top-level collections loaded in full (tags, venues,
 * parking lots). It is not a substitute for a live `onSnapshot` listener.
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
): CollectionCache<T> {
    let cached: T[] | null = null;
    let fetchPromise: Promise<T[]> | null = null;
    const subscribers = new Set<(items: T[]) => void>();

    async function fetchItems(force = false): Promise<T[]> {
        if (!force && cached) return cached;
        if (fetchPromise) return fetchPromise;

        fetchPromise = (async () => {
            try {
                const db = getFirebaseDb();
                const snapshot = await getDocs(query(collection(db, collectionName)));
                cached = snapshot.docs.map(mapDoc);
                return cached;
            } finally {
                // Clear on success and failure alike, so a failed fetch can be retried
                // instead of pinning a rejected promise forever.
                fetchPromise = null;
            }
        })();

        return fetchPromise;
    }

    async function refresh(): Promise<T[]> {
        const items = await fetchItems(true);
        for (const fn of subscribers) fn(items);
        return items;
    }

    function useItems() {
        const [items, setItems] = useState<T[]>(cached ?? []);
        const [loading, setLoading] = useState(cached === null);

        useEffect(() => {
            subscribers.add(setItems);
            return () => {
                subscribers.delete(setItems);
            };
        }, []);

        useEffect(() => {
            if (cached) {
                setItems(cached);
                setLoading(false);
                return;
            }
            fetchItems()
                .then(result => {
                    setItems(result);
                    setLoading(false);
                })
                .catch(err => {
                    console.error(`Failed to load ${collectionName}:`, err);
                    setLoading(false);
                });
        }, []);

        const doRefresh = useCallback(async () => {
            await refresh();
        }, []);

        return {items, loading, refresh: doRefresh};
    }

    return {useItems, refresh, peek: () => cached};
}
