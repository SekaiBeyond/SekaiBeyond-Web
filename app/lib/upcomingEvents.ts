import { useCallback, useEffect, useMemo, useState } from 'react';
import { collection, getDocs, orderBy, query } from 'firebase/firestore';
import { getFirebaseDb } from './firebase';

export interface UpcomingEvent {
    id: string;
    name: string;
    nameCn: string;
    description: string;
    descriptionCn: string;
    location: string;
    locationCn: string;
    startAt: Date;
    endAt: Date;
    poster: string;
    posterCredit: string;
    buyTicket: string;
    learnMore: string;
    customButtonText: string;
    customButtonTextCn: string;
    customButtonLink: string;
}

let cachedEvents: UpcomingEvent[] | null = null;
let fetchPromise: Promise<UpcomingEvent[]> | null = null;
let subscribers: Array<(events: UpcomingEvent[]) => void> = [];

async function fetchUpcomingEvents(force = false): Promise<UpcomingEvent[]> {
    if (!force && cachedEvents) return cachedEvents;
    if (fetchPromise) return fetchPromise;

    fetchPromise = (async () => {
        const db = getFirebaseDb();
        const q = query(collection(db, 'upcomingEvents'), orderBy('startAt', 'asc'));
        const snapshot = await getDocs(q);
        const events: UpcomingEvent[] = [];
        snapshot.forEach(docSnap => {
            const data = docSnap.data();
            events.push({
                id: docSnap.id,
                name: data.name ?? '',
                nameCn: data.nameCn ?? '',
                description: data.description ?? '',
                descriptionCn: data.descriptionCn ?? '',
                location: data.location ?? '',
                locationCn: data.locationCn ?? '',
                startAt: data.startAt?.toDate() ?? new Date(),
                endAt: data.endAt?.toDate() ?? new Date(),
                poster: data.poster ?? '',
                posterCredit: data.posterCredit ?? '',
                buyTicket: data.buyTicket ?? '',
                learnMore: data.learnMore ?? '',
                customButtonText: data.customButtonText ?? '',
                customButtonTextCn: data.customButtonTextCn ?? '',
                customButtonLink: data.customButtonLink ?? '',
            });
        });
        cachedEvents = events;
        fetchPromise = null;
        return events;
    })();

    return fetchPromise;
}

export async function refreshUpcomingEvents(): Promise<UpcomingEvent[]> {
    const events = await fetchUpcomingEvents(true);
    subscribers.forEach(fn => fn(events));
    return events;
}

/** Returns all upcoming events (including past ones for admin). Filter client-side if needed. */
export function useUpcomingEvents(): {
    upcomingEvents: UpcomingEvent[];
    activeEvents: UpcomingEvent[];
    hasActive: boolean;
    loading: boolean;
    refresh: () => Promise<void>;
} {
    const [upcomingEvents, setUpcomingEvents] = useState<UpcomingEvent[]>(cachedEvents ?? []);
    const [loading, setLoading] = useState(cachedEvents === null);

    useEffect(() => {
        subscribers.push(setUpcomingEvents);
        return () => {
            subscribers = subscribers.filter(fn => fn !== setUpcomingEvents);
        };
    }, []);

    useEffect(() => {
        if (cachedEvents) {
            setUpcomingEvents(cachedEvents);
            setLoading(false);
            return;
        }
        fetchUpcomingEvents()
            .then(events => {
                setUpcomingEvents(events);
                setLoading(false);
            })
            .catch(err => {
                console.error('Failed to load upcoming events:', err);
                setLoading(false);
            });
    }, []);

    const refresh = useCallback(async () => {
        await refreshUpcomingEvents();
    }, []);

    const activeEvents = useMemo(
        () => upcomingEvents.filter(e => e.endAt > new Date()),
        [upcomingEvents]
    );
    const hasActive = activeEvents.length > 0;

    return {upcomingEvents, activeEvents, hasActive, loading, refresh};
}
