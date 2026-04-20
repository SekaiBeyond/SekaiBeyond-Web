import { useCallback, useEffect, useState } from 'react';
import { collection, getDocs, query } from 'firebase/firestore';
import { getFirebaseDb } from './firebase';

export interface Tag {
    id: string;
    name: string;
    nameCn: string;
}

let cachedTags: Tag[] | null = null;
let fetchPromise: Promise<Tag[]> | null = null;
const subscribers = new Set<(tags: Tag[]) => void>();

async function fetchTags(force = false): Promise<Tag[]> {
    if (!force && cachedTags) return cachedTags;
    if (fetchPromise) return fetchPromise;

    fetchPromise = (async () => {
        const db = getFirebaseDb();
        const q = query(collection(db, 'eventLabels'));
        const snapshot = await getDocs(q);
        const tags: Tag[] = [];
        snapshot.forEach(docSnap => {
            const data = docSnap.data();
            tags.push({
                id: docSnap.id,
                name: data.name ?? '',
                nameCn: data.nameCn ?? '',
            });
        });
        cachedTags = tags;
        fetchPromise = null;
        return tags;
    })();

    return fetchPromise;
}

async function refreshTags(): Promise<Tag[]> {
    const tags = await fetchTags(true);
    for (const fn of subscribers) fn(tags);
    return tags;
}

export function useTags(): {tags: Tag[]; loading: boolean; refresh: () => Promise<void>} {
    const [tags, setTags] = useState<Tag[]>(cachedTags ?? []);
    const [loading, setLoading] = useState(cachedTags === null);

    useEffect(() => {
        subscribers.add(setTags);
        return () => {
            subscribers.delete(setTags);
        };
    }, []);

    useEffect(() => {
        if (cachedTags) {
            setTags(cachedTags);
            setLoading(false);
            return;
        }
        fetchTags()
            .then(result => {
                setTags(result);
                setLoading(false);
            })
            .catch(err => {
                console.error('Failed to load tags:', err);
                setLoading(false);
            });
    }, []);

    const refresh = useCallback(async () => {
        await refreshTags();
    }, []);

    return {tags, loading, refresh};
}
