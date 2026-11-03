import { orderBy } from 'firebase/firestore';
import { createCollectionCache, toDate } from './collectionCache';
import { type ConInfo, readConInfo } from './conEditions';
import { readRoomIds } from './venues';

export interface PastEvent {
    id: string;
    tagIds: string[];
    title: string;
    titleCn: string;
    date: string;
    location: string;
    locationCn: string;
    venueId: string;
    /** Rooms of its venue it's in; none means the venue as a whole. */
    roomIds: string[];
    description: string;
    descriptionCn: string;
    icon: string;
    recapLink: string;
    recapLinkCn: string;
    published: boolean;
    paid: boolean;
    deleteAt: Date | null;
    /** Set when this was a year's Sekai Beyond Con. */
    con: ConInfo | null;
}

const cache = createCollectionCache<PastEvent>('pastEvents', docSnap => {
    const data = docSnap.data();
    return {
        id: docSnap.id,
        tagIds: data.tagIds ?? [],
        title: data.title ?? '',
        titleCn: data.titleCn ?? '',
        date: data.date ?? '',
        location: data.location ?? '',
        locationCn: data.locationCn ?? '',
        venueId: data.venueId ?? '',
        roomIds: readRoomIds(data.roomIds),
        description: data.description ?? '',
        descriptionCn: data.descriptionCn ?? '',
        icon: data.icon ?? '',
        recapLink: data.recapLink ?? '',
        recapLinkCn: data.recapLinkCn ?? '',
        published: data.published === true,
        paid: data.paid === true,
        deleteAt: toDate(data.deleteAt),
        con: readConInfo(data.con),
    };
}, orderBy('date', 'desc'));

export function usePastEvents(): {pastEvents: PastEvent[]; loading: boolean; refresh: () => Promise<void>} {
    const {items: pastEvents, loading, refresh} = cache.useItems();
    return {pastEvents, loading, refresh};
}
