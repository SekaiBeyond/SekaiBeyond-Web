import { useCallback, useEffect, useMemo, useState } from 'react';
import { collection, doc, getDoc, getDocs, orderBy, query, where } from 'firebase/firestore';
import { getFirebaseDb } from './firebase';

export interface UpcomingEvent {
    id: string;
    title: string;
    titleCn: string;
    description: string;
    descriptionCn: string;
    location: string;
    locationCn: string;
    venueId: string;
    startAt: Date;
    endAt: Date;
    poster: string;
    emailHeaderBg: string;
    posterCredit: string;
    buyTicket: string;
    learnMore: string;
    customButtonText: string;
    customButtonTextCn: string;
    customButtonLink: string;
    published: boolean;
    paid: boolean;
    deleteAt: Date | null;
}

interface FirestoreDocLike {
    id: string;
    data: () => Record<string, unknown>;
}

const mapDoc = (docSnap: FirestoreDocLike): UpcomingEvent => {
    const data = docSnap.data() as Record<string, unknown>;
    const startAtRaw = data.startAt as {toDate?: () => Date} | undefined;
    const endAtRaw = data.endAt as {toDate?: () => Date} | undefined;
    const deleteAtRaw = data.deleteAt as {toDate?: () => Date} | undefined;
    return {
        id: docSnap.id,
        // Fallback to legacy `name`/`nameCn` for docs predating the rename.
        title: (data.title as string) ?? (data.name as string) ?? '',
        titleCn: (data.titleCn as string) ?? (data.nameCn as string) ?? '',
        description: (data.description as string) ?? '',
        descriptionCn: (data.descriptionCn as string) ?? '',
        location: (data.location as string) ?? '',
        locationCn: (data.locationCn as string) ?? '',
        venueId: (data.venueId as string) ?? '',
        startAt: startAtRaw?.toDate?.() ?? new Date(),
        endAt: endAtRaw?.toDate?.() ?? new Date(),
        poster: (data.poster as string) ?? '',
        emailHeaderBg: (data.emailHeaderBg as string) ?? '',
        posterCredit: (data.posterCredit as string) ?? '',
        buyTicket: (data.buyTicket as string) ?? '',
        learnMore: (data.learnMore as string) ?? '',
        customButtonText: (data.customButtonText as string) ?? '',
        customButtonTextCn: (data.customButtonTextCn as string) ?? '',
        customButtonLink: (data.customButtonLink as string) ?? '',
        published: (data.published as boolean) ?? false,
        paid: (data.paid as boolean) ?? false,
        deleteAt: deleteAtRaw?.toDate?.() ?? null,
    };
};

// ---------- Public (published-only) ----------

let publishedCache: UpcomingEvent[] | null = null;
let publishedFetchPromise: Promise<UpcomingEvent[]> | null = null;
let publishedSubscribers: Array<(events: UpcomingEvent[]) => void> = [];

async function fetchPublishedEvents(force = false): Promise<UpcomingEvent[]> {
    if (publishedFetchPromise) return publishedFetchPromise;
    if (!force && publishedCache) return publishedCache;

    publishedFetchPromise = (async () => {
        try {
            const db = getFirebaseDb();
            const q = query(
                collection(db, 'upcomingEvents'),
                where('published', '==', true),
                orderBy('startAt', 'asc'),
            );
            const snapshot = await getDocs(q);
            const events: UpcomingEvent[] = snapshot.docs.map(mapDoc);
            publishedCache = events;
            publishedFetchPromise = null;
            return events;
        } catch (err) {
            publishedFetchPromise = null;
            console.error('[fetchPublishedEvents]', err);
            throw err;
        }
    })();

    return publishedFetchPromise;
}

async function refreshUpcomingEvents(): Promise<UpcomingEvent[]> {
    try {
        const events = await fetchPublishedEvents(true);
        publishedSubscribers.forEach(fn => fn(events));
        return events;
    } catch (err) {
        console.error('[refreshUpcomingEvents]', err);
        throw err;
    }
}

/** Published upcoming events only. Used by the public site. */
export function useUpcomingEvents(): {
    upcomingEvents: UpcomingEvent[];
    activeEvents: UpcomingEvent[];
    hasActive: boolean;
    loading: boolean;
    refresh: () => Promise<void>;
} {
    const [upcomingEvents, setUpcomingEvents] = useState<UpcomingEvent[]>(publishedCache ?? []);
    const [loading, setLoading] = useState(publishedCache === null);

    useEffect(() => {
        publishedSubscribers.push(setUpcomingEvents);
        return () => {
            publishedSubscribers = publishedSubscribers.filter(fn => fn !== setUpcomingEvents);
        };
    }, []);

    useEffect(() => {
        if (publishedCache) {
            setUpcomingEvents(publishedCache);
            setLoading(false);
            return;
        }
        fetchPublishedEvents()
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

// ---------- Admin (all events, including unpublished) ----------

let adminCache: UpcomingEvent[] | null = null;
let adminFetchPromise: Promise<UpcomingEvent[]> | null = null;
let adminSubscribers: Array<(events: UpcomingEvent[]) => void> = [];

async function fetchAllUpcomingEvents(force = false): Promise<UpcomingEvent[]> {
    if (adminFetchPromise) return adminFetchPromise;
    if (!force && adminCache) return adminCache;

    adminFetchPromise = (async () => {
        try {
            const db = getFirebaseDb();
            const q = query(collection(db, 'upcomingEvents'), orderBy('startAt', 'asc'));
            const snapshot = await getDocs(q);
            const events: UpcomingEvent[] = snapshot.docs.map(mapDoc);
            adminCache = events;
            adminFetchPromise = null;
            return events;
        } catch (err) {
            adminFetchPromise = null;
            console.error('[fetchAllUpcomingEvents]', err);
            throw err;
        }
    })();

    return adminFetchPromise;
}

async function refreshAllUpcomingEvents(): Promise<UpcomingEvent[]> {
    try {
        const [all] = await Promise.all([
            fetchAllUpcomingEvents(true),
            refreshUpcomingEvents(),
        ]);
        adminSubscribers.forEach(fn => fn(all));
        return all;
    } catch (err) {
        console.error('[refreshAllUpcomingEvents]', err);
        throw err;
    }
}

/** All upcoming events including unpublished. For admin use only. */
export function useAllUpcomingEvents(): {
    upcomingEvents: UpcomingEvent[];
    loading: boolean;
    refresh: () => Promise<void>;
} {
    const [upcomingEvents, setUpcomingEvents] = useState<UpcomingEvent[]>(adminCache ?? []);
    const [loading, setLoading] = useState(adminCache === null);

    useEffect(() => {
        adminSubscribers.push(setUpcomingEvents);
        return () => {
            adminSubscribers = adminSubscribers.filter(fn => fn !== setUpcomingEvents);
        };
    }, []);

    useEffect(() => {
        if (adminCache) {
            setUpcomingEvents(adminCache);
            setLoading(false);
            return;
        }
        fetchAllUpcomingEvents()
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
        await refreshAllUpcomingEvents();
    }, []);

    return {upcomingEvents, loading, refresh};
}

// ---------- Per-ID fetch (event-staff) ----------

/** Fetch specific upcoming events by ID. Safe for event-staff users who lack collection-level read access. */
export function useUpcomingEventsByIds(ids: string[]): {
    upcomingEvents: UpcomingEvent[];
    loading: boolean;
    refresh: () => Promise<void>;
} {
    const [upcomingEvents, setUpcomingEvents] = useState<UpcomingEvent[]>([]);
    const [loading, setLoading] = useState(ids.length > 0);
    const idsKey = ids.join(',');

    const fetchById = useCallback(async (eventIds: string[]) => {
        if (eventIds.length === 0) {
            setUpcomingEvents([]);
            setLoading(false);
            return;
        }
        setLoading(true);
        try {
            const db = getFirebaseDb();
            const snaps = await Promise.all(eventIds.map(id => getDoc(doc(db, 'upcomingEvents', id))));
            setUpcomingEvents(snaps.filter(s => s.exists()).map(mapDoc));
        } catch (err) {
            console.error('[useUpcomingEventsByIds]', err);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchById(ids);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [idsKey]);

    const refresh = useCallback(async () => {
        await fetchById(ids);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [idsKey]);

    return {upcomingEvents, loading, refresh};
}
