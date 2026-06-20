import { createCollectionCache } from './collectionCache';

export interface Tag {
    id: string;
    name: string;
    nameCn: string;
}

const cache = createCollectionCache<Tag>('eventLabels', docSnap => {
    const data = docSnap.data();
    return {
        id: docSnap.id,
        name: data.name ?? '',
        nameCn: data.nameCn ?? '',
    };
});

export function useTags(): {tags: Tag[]; loading: boolean; refresh: () => Promise<void>} {
    const {items, loading, refresh} = cache.useItems();
    return {tags: items, loading, refresh};
}
