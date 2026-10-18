import { type QueryDocumentSnapshot } from 'firebase/firestore';
import { createCollectionCache } from './collectionCache';

export interface SocialPlatform {
    id: string;
    label: string;
    labelCn?: string;
    order: number;
}

const DEFAULT_SOCIAL_PLATFORMS: SocialPlatform[] = [
    {id: 'instagram', label: 'Instagram', order: 0},
    {id: 'x', label: 'X (Twitter)', order: 1},
    {id: 'tiktok', label: 'TikTok', order: 2},
    {id: 'youtube', label: 'YouTube', order: 3},
    {id: 'facebook', label: 'Facebook', order: 4},
    {id: 'bilibili', label: 'Bilibili', labelCn: '哔哩哔哩', order: 5},
    {id: 'xiaohongshu', label: 'Xiaohongshu (RED)', labelCn: '小红书', order: 6},
    {id: 'weibo', label: 'Weibo', labelCn: '微博', order: 7},
    {id: 'douyin', label: 'Douyin', labelCn: '抖音', order: 8},
];

function mapDoc(docSnap: QueryDocumentSnapshot): SocialPlatform {
    const data = docSnap.data();
    return {
        id: docSnap.id,
        label: data.label ?? '',
        labelCn: data.labelCn || undefined,
        order: typeof data.order === 'number' ? data.order : 0,
    };
}

const cache = createCollectionCache<SocialPlatform>('socialPlatforms', mapDoc);

const sortPlatforms = (list: SocialPlatform[]): SocialPlatform[] =>
    [...list].sort((a, b) => a.order - b.order || a.label.localeCompare(b.label));

function effective(items: SocialPlatform[] | null): SocialPlatform[] {
    return items && items.length ? sortPlatforms(items) : DEFAULT_SOCIAL_PLATFORMS;
}

export function useSocialPlatforms(): {
    platforms: SocialPlatform[];
    customized: boolean;
    refresh: () => Promise<void>;
} {
    const {items, refresh} = cache.useItems();
    return {platforms: effective(items), customized: items.length > 0, refresh};
}

export function socialPlatformName(
    id: string,
    isEnglish: boolean,
    platforms: SocialPlatform[] = DEFAULT_SOCIAL_PLATFORMS,
): string {
    const p = platforms.find(item => item.id === id);
    if (!p) return id;
    return isEnglish ? p.label : (p.labelCn ?? p.label);
}
