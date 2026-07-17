import { useCallback, useEffect, useMemo, useState } from 'react';
import { doc, getDoc, orderBy, where } from 'firebase/firestore';
import { createCollectionCache } from './collectionCache';
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

/** Published events only, for the public site. */
const publishedCache = createCollectionCache<UpcomingEvent>(
    'upcomingEvents',
    mapDoc,
    where('published', '==', true),
    orderBy('startAt', 'asc'),
);

/** All events including unpublished, for the admin panel. */
const adminCache = createCollectionCache<UpcomingEvent>(
    'upcomingEvents',
    mapDoc,
    orderBy('startAt', 'asc'),
);

/** Published upcoming events only. Used by the public site. */
export function useUpcomingEvents(): {
    upcomingEvents: UpcomingEvent[];
    activeEvents: UpcomingEvent[];
    hasActive: boolean;
    loading: boolean;
    refresh: () => Promise<void>;
} {
    const {items: upcomingEvents, loading, refresh} = publishedCache.useItems();

    const activeEvents = useMemo(
        () => upcomingEvents.filter(e => e.endAt > new Date()),
        [upcomingEvents]
    );
    const hasActive = activeEvents.length > 0;

    return {upcomingEvents, activeEvents, hasActive, loading, refresh};
}

/** All upcoming events including unpublished. For admin use only. */
export function useAllUpcomingEvents(): {
    upcomingEvents: UpcomingEvent[];
    loading: boolean;
    refresh: () => Promise<void>;
} {
    const {items: upcomingEvents, loading} = adminCache.useItems();

    // An admin edit also changes what the public site shows, so refresh both caches.
    const refresh = useCallback(async () => {
        await Promise.all([adminCache.refresh(), publishedCache.refresh()]);
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
