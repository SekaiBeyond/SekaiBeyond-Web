import { useCallback, useEffect, useState } from 'react';
import { collection, getDocs, query, type QueryConstraint, type QueryDocumentSnapshot } from 'firebase/firestore';
import { getFirebaseDb } from './firebase';

/**
 * A Firestore Timestamp field as a Date, or null when the field is absent or is
 * something else. Every `mapDoc` below reaches for this, so it lives here rather
 * than being re-spelled in each data module.
 */
export const toDate = (v: unknown): Date | null =>
    v && typeof (v as {toDate?: () => Date}).toDate === 'function'
        ? (v as {toDate: () => Date}).toDate()
        : null;

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
    /**
     * Hook returning the cached value, a loading flag, an `error`, and a `refresh`
     * that re-fetches. `error` is non-null only while `value` is still the fallback
     * — i.e. it answers "is this real data?", not "did the last request fail?". A
     * refresh that fails on top of an already-loaded value leaves it null, because
     * the value on screen is still the one the server gave us.
     *
     * Pass `enabled: false` to hold off the fetch entirely — for a cache the
     * current viewer is not allowed to read, where firing the request would only
     * produce a permission error. It reports the fallback and `loading: false`,
     * and fetches if `enabled` later flips true.
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
                // Clear on success and failure alike, so a failed fetch can be retried
                // instead of pinning a rejected promise forever.
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
            // Subscribers holding a previously fetched value keep it — a refresh that
            // fails is a stale screen, not a missing one. Only a cache that has never
            // loaded is downgraded to "what you see is the fallback".
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

        // Derived, not stored: `enabled` can flip true a render before the effect
        // starts the fetch, and a separately-tracked `loading` would read false in
        // that gap — long enough for a caller to act on the fallback value.
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
