import { useCallback, useEffect, useState } from 'react';
import { collection, getDocs, query, type QueryConstraint, type QueryDocumentSnapshot } from 'firebase/firestore';
import { getFirebaseDb } from './firebase';

/**
 * A Firestore Timestamp field as a Date, or null when absent or not a Timestamp.
 */
export const toDate = (v: unknown): Date | null =>
    v && typeof (v as {toDate?: () => Date}).toDate === 'function'
        ? (v as {toDate: () => Date}).toDate()
        : null;

/**
 * A module-level read-through cache shared by every component that uses it: the first
 * `useValue()` fetches once and every subscriber gets the result, and `refresh()` fans a
 * new value out app-wide. For small, rarely-changing data loaded whole, not a substitute
 * for `onSnapshot`.
 */
export interface ValueCache<T> {
    /**
     * The cached value, a loading flag, an `error`, and `refresh`. `error` is set
     * only while `value` is still the fallback: it answers "is this real data?", so
     * a failed refresh over loaded data leaves it null.
     *
     * `enabled: false` holds off the fetch, for a cache this viewer can't read. It
     * reports the fallback with `loading: false` and fetches once `enabled` turns
     * true.
     */
    useValue: (enabled?: boolean) => {value: T; loading: boolean; error: unknown; refresh: () => Promise<void>};
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
    const subscribers = new Set<(value: T, error: unknown) => void>();

    async function fetchValue(force = false): Promise<T> {
        if (!force && cached !== null) return cached;
        if (fetchPromise) return fetchPromise;

        fetchPromise = (async () => {
            try {
                cached = await fetcher();
                return cached;
            } finally {
                // Cleared either way, so a failed fetch can be retried.
                fetchPromise = null;
            }
        })();

        return fetchPromise;
    }

    async function refresh(): Promise<T> {
        try {
            const value = await fetchValue(true);
            for (const fn of subscribers) fn(value, null);
            return value;
        } catch (err) {
            // Subscribers with a value keep it; only a cache that never loaded falls
            // back.
            if (cached === null) for (const fn of subscribers) fn(initialValue, err);
            throw err;
        }
    }

    interface State {
        value: T;
        error: unknown;
        /** Whether this consumer has a resolved answer — a value or a failure. */
        settled: boolean;
    }

    function useValue(enabled: boolean = true) {
        const [state, setState] = useState<State>(
            () => (cached !== null
                ? {value: cached, error: null, settled: true}
                : {value: initialValue, error: null, settled: false}),
        );

        // Derived, not stored: `enabled` can turn true a render before the fetch
        // starts, and a stored flag would read false in that gap.
        const loading = enabled && !state.settled;

        useEffect(() => {
            const notify = (value: T, error: unknown) => setState({value, error, settled: true});
            subscribers.add(notify);
            return () => {
                subscribers.delete(notify);
            };
        }, []);

        useEffect(() => {
            if (!enabled) return;
            if (cached !== null) {
                setState({value: cached, error: null, settled: true});
                return;
            }
            fetchValue()
                .then(result => setState({value: result, error: null, settled: true}))
                .catch(err => {
                    console.error(`Failed to load ${label}:`, err);
                    setState({value: initialValue, error: err, settled: true});
                });
        }, [enabled]);

        const doRefresh = useCallback(async () => {
            await refresh();
        }, []);

        return {value: state.value, loading, error: state.error, refresh: doRefresh};
    }

    return {useValue, refresh, peek: () => cached};
}

/**
 * A `ValueCache` over a Firestore collection and optional query constraints, for
 * small, rarely-changing top-level collections such as tags and venues.
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
