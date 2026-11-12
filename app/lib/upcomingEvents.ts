import { useCallback, useEffect, useMemo, useState } from 'react';
import { doc, type DocumentData, getDoc, orderBy, where } from 'firebase/firestore';
import { createCollectionCache, toDate } from './collectionCache';
import { getFirebaseDb } from './firebase';
import { type ConInfo, readConInfo } from './conEditions';
import { readRoomIds } from './venues';

export interface UpcomingEvent {
    id: string;
    title: string;
    titleCn: string;
    description: string;
    descriptionCn: string;
    location: string;
    locationCn: string;
    venueId: string;
    /** Rooms of its venue it's in; none means the venue as a whole. */
    roomIds: string[];
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
    /** Set when this is a year's Sekai Beyond Con. */
    con: ConInfo | null;
}

const mapDoc = (docSnap: {id: string; data: () => DocumentData}): UpcomingEvent => {
    const data = docSnap.data();
    return {
        id: docSnap.id,
        title: data.title ?? '',
        titleCn: data.titleCn ?? '',
        description: data.description ?? '',
        descriptionCn: data.descriptionCn ?? '',
        location: data.location ?? '',
        locationCn: data.locationCn ?? '',
        venueId: data.venueId ?? '',
        roomIds: readRoomIds(data.roomIds),
        startAt: toDate(data.startAt) ?? new Date(),
        endAt: toDate(data.endAt) ?? new Date(),
        poster: data.poster ?? '',
        emailHeaderBg: data.emailHeaderBg ?? '',
        posterCredit: data.posterCredit ?? '',
        buyTicket: data.buyTicket ?? '',
        learnMore: data.learnMore ?? '',
        customButtonText: data.customButtonText ?? '',
        customButtonTextCn: data.customButtonTextCn ?? '',
        customButtonLink: data.customButtonLink ?? '',
        published: data.published === true,
        paid: data.paid === true,
        deleteAt: toDate(data.deleteAt),
        con: readConInfo(data.con),
    };
};

const publishedCache = createCollectionCache<UpcomingEvent>(
    'upcomingEvents',
    mapDoc,
    where('published', '==', true),
    orderBy('startAt', 'asc'),
);

const adminCache = createCollectionCache<UpcomingEvent>(
    'upcomingEvents',
    mapDoc,
    orderBy('startAt', 'asc'),
);

export function useUpcomingEvents(enabled: boolean = true): {
    upcomingEvents: UpcomingEvent[];
    activeEvents: UpcomingEvent[];
    hasActive: boolean;
    loading: boolean;
} {
    const {items: upcomingEvents, loading} = publishedCache.useItems(enabled);

    const activeEvents = useMemo(
        () => upcomingEvents.filter(e => e.endAt > new Date()),
        [upcomingEvents]
    );
    const hasActive = activeEvents.length > 0;

    return {upcomingEvents, activeEvents, hasActive, loading};
}

export function useAllUpcomingEvents(enabled: boolean = true): {
    upcomingEvents: UpcomingEvent[];
    loading: boolean;
    refresh: () => Promise<void>;
} {
    const {items: upcomingEvents, loading} = adminCache.useItems(enabled);

    // An admin edit also changes what the public site shows, so refresh both caches.
    const refresh = useCallback(async () => {
        await Promise.all([adminCache.refresh(), publishedCache.refresh()]);
    }, []);

    return {upcomingEvents, loading, refresh};
}

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

    // idsKey stands in for `ids`, whose identity can change every render.
    useEffect(() => {
        fetchById(ids);
    }, [idsKey]);

    const refresh = useCallback(async () => {
        await fetchById(ids);
    }, [idsKey]);

    return {upcomingEvents, loading, refresh};
}
