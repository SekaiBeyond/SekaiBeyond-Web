import { useCallback, useEffect, useState } from 'react';
import {
    collection,
    documentId,
    getDocs,
    query,
    type QueryConstraint,
    type QueryDocumentSnapshot,
    where,
} from 'firebase/firestore';
import { getFirebaseDb } from './firebase';

/**
 * A Firestore Timestamp field as a Date, or null when absent or not a Timestamp.
 */
export const toDate = (v: unknown): Date | null =>
    v && typeof (v as {toDate?: () => Date}).toDate === 'function'
        ? (v as {toDate: () => Date}).toDate()
        : null;

/**
 * The docs in `collectionName` with these ids, read in chunks for `in`'s 30-id
 * limit. An id with no doc is left out.
 */
export async function getDocsByIds(collectionName: string, ids: string[]): Promise<QueryDocumentSnapshot[]> {
    const unique = [...new Set(ids)];
    const col = collection(getFirebaseDb(), collectionName);
    const chunks: string[][] = [];
    for (let i = 0; i < unique.length; i += 30) chunks.push(unique.slice(i, i + 30));
    const snaps = await Promise.all(chunks.map(chunk => getDocs(query(col, where(documentId(), 'in', chunk)))));
    return snaps.flatMap(snap => snap.docs);
}

/**
 * Module-level read-through cache shared across subscribers; `enabled: false`
 * defers fetching and returns `initialValue`.
 */
interface ValueCache<T> {
    useValue: (enabled?: boolean) => {value: T; loading: boolean; error: unknown; refresh: () => Promise<void>};
    refresh: () => Promise<T>;
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

interface CollectionCache<T> {
    useItems: (enabled?: boolean) => {items: T[]; loading: boolean; refresh: () => Promise<void>};
    refresh: () => Promise<T[]>;
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

    function useItems(enabled: boolean = true) {
        const {value: items, loading, refresh} = cache.useValue(enabled);
        return {items, loading, refresh};
    }

    return {useItems, refresh: cache.refresh};
}
