import { orderBy } from 'firebase/firestore';
import { createCollectionCache } from './collectionCache';

export interface PastEvent {
    id: string;
    tagIds: string[];
    title: string;
    titleCn: string;
    date: string;
    location: string;
    locationCn: string;
    venueId: string;
    description: string;
    descriptionCn: string;
    icon: string;
    recapLink: string;
    recapLinkCn: string;
    published: boolean;
    paid: boolean;
    deleteAt: Date | null;
}

const cache = createCollectionCache<PastEvent>('pastEvents', docSnap => {
    const data = docSnap.data();
    return {
        id: docSnap.id,
        // Prefer the multi-tag `tagIds` array; fall back to the legacy
        // single `tagId` field for events archived before the migration.
        tagIds: Array.isArray(data.tagIds)
            ? data.tagIds
            : (data.tagId ? [data.tagId] : []),
        title: data.title ?? '',
        titleCn: data.titleCn ?? '',
        date: data.date ?? '',
        location: data.location ?? '',
        locationCn: data.locationCn ?? '',
        venueId: data.venueId ?? '',
        description: data.description ?? '',
        descriptionCn: data.descriptionCn ?? '',
        icon: data.icon ?? '',
        recapLink: data.recapLink ?? '',
        recapLinkCn: data.recapLinkCn ?? '',
        published: data.published ?? true,
        paid: data.paid ?? false,
        deleteAt: data.deleteAt?.toDate?.() ?? null,
    };
}, orderBy('date', 'desc'));

export function usePastEvents(): {pastEvents: PastEvent[]; loading: boolean; refresh: () => Promise<void>} {
    const {items: pastEvents, loading, refresh} = cache.useItems();
    return {pastEvents, loading, refresh};
}
