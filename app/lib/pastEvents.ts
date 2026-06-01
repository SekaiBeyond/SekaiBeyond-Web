import { useCallback, useEffect, useState } from 'react';
import { collection, getDocs, orderBy, query } from 'firebase/firestore';
import { getFirebaseDb } from './firebase';

export interface PastEvent {
    id: string;
    tagId: string;
    title: string;
    titleCn: string;
    date: string;
    location: string;
    locationCn: string;
    description: string;
    descriptionCn: string;
    icon: string;
    recapLink: string;
    recapLinkCn: string;
    published: boolean;
    paid: boolean;
    deleteAt: Date | null;
}

let cachedEvents: PastEvent[] | null = null;
let fetchPromise: Promise<PastEvent[]> | null = null;
let subscribers: Array<(events: PastEvent[]) => void> = [];

async function fetchPastEvents(force = false): Promise<PastEvent[]> {
    if (!force && cachedEvents) return cachedEvents;
    if (fetchPromise) return fetchPromise;

    fetchPromise = (async () => {
        const db = getFirebaseDb();
        const q = query(collection(db, 'pastEvents'), orderBy('date', 'desc'));
        const snapshot = await getDocs(q);
        const events: PastEvent[] = [];
        snapshot.forEach(docSnap => {
            const data = docSnap.data();
            events.push({
                id: docSnap.id,
                tagId: data.tagId ?? '',
                title: data.title ?? '',
                titleCn: data.titleCn ?? '',
                date: data.date ?? '',
                location: data.location ?? '',
                locationCn: data.locationCn ?? '',
                description: data.description ?? '',
                descriptionCn: data.descriptionCn ?? '',
                icon: data.icon ?? '',
                recapLink: data.recapLink ?? '',
                recapLinkCn: data.recapLinkCn ?? '',
                published: data.published ?? true,
                paid: data.paid ?? false,
                deleteAt: data.deleteAt?.toDate?.() ?? null,
            });
        });
        cachedEvents = events;
        fetchPromise = null;
        return events;
    })();

    return fetchPromise;
}

async function refreshPastEvents(): Promise<PastEvent[]> {
    const events = await fetchPastEvents(true);
    subscribers.forEach(fn => fn(events));
    return events;
}

export function usePastEvents(): {pastEvents: PastEvent[]; loading: boolean; refresh: () => Promise<void>} {
    const [pastEvents, setPastEvents] = useState<PastEvent[]>(cachedEvents ?? []);
    const [loading, setLoading] = useState(cachedEvents === null);

    useEffect(() => {
        subscribers.push(setPastEvents);
        return () => {
            subscribers = subscribers.filter(fn => fn !== setPastEvents);
        };
    }, []);

    useEffect(() => {
        if (cachedEvents) {
            setPastEvents(cachedEvents);
            setLoading(false);
            return;
        }
        fetchPastEvents()
            .then(events => {
                setPastEvents(events);
                setLoading(false);
            })
            .catch(err => {
                console.error('Failed to load past events:', err);
                setLoading(false);
            });
    }, []);

    const refresh = useCallback(async () => {
        await refreshPastEvents();
    }, []);

    return {pastEvents, loading, refresh};
}
