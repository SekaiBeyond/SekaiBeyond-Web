import { type QueryDocumentSnapshot } from 'firebase/firestore';
import { createCollectionCache } from './collectionCache';

/**
 * A traffic source the QR tool can tag tracked codes with. Creating a tracked
 * code "per platform" makes one code per selected platform, all pointing at the
 * same target URL, so per-code scan counts compare click-through by platform.
 */
export interface SocialPlatform {
    id: string;
    label: string;
    /** Chinese display name, when the brand differs (falls back to `label`). */
    labelCn?: string;
    /** Sort order in the picker (ascending). */
    order: number;
}

/**
 * Built-in platform list. These seed the editable `socialPlatforms` collection
 * and act as a fallback so per-platform tracking works before any admin
 * customises the list (and never ends up with an empty picker).
 * Stable ids let {@link seedSocialPlatforms} re-seed idempotently.
 */
export const DEFAULT_SOCIAL_PLATFORMS: SocialPlatform[] = [
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

/**
 * The effective platform list: the Firestore collection once it has entries,
 * otherwise the built-in defaults. Deleting every custom platform safely falls
 * back to defaults, so the picker is never empty.
 */
function effective(items: SocialPlatform[] | null): SocialPlatform[] {
    return items && items.length ? sortPlatforms(items) : DEFAULT_SOCIAL_PLATFORMS;
}

/**
 * Hook returning the live effective platform list. `customized` is true once the
 * Firestore collection has its own entries (i.e. defaults have been seeded/edited),
 * false while the built-in defaults are standing in.
 */
export function useSocialPlatforms(): {
    platforms: SocialPlatform[];
    customized: boolean;
    loading: boolean;
    refresh: () => Promise<void>;
} {
    const {items, loading, refresh} = cache.useItems();
    return {platforms: effective(items), customized: items.length > 0, loading, refresh};
}

/** Synchronous effective list for code that runs outside React (e.g. qrToDraft). */
export function socialPlatformsSnapshot(): SocialPlatform[] {
    return effective(cache.peek());
}

export const getSocialPlatform = (
    id: string,
    platforms: SocialPlatform[] = socialPlatformsSnapshot(),
): SocialPlatform | undefined => platforms.find(p => p.id === id);

/**
 * Display name for a platform tag stored on a QR code. Falls back to the raw
 * id so codes tagged with a since-deleted platform still show something useful.
 */
export function socialPlatformName(
    id: string,
    isEnglish: boolean,
    platforms: SocialPlatform[] = socialPlatformsSnapshot(),
): string {
    const p = getSocialPlatform(id, platforms);
    if (!p) return id;
    return isEnglish ? p.label : (p.labelCn ?? p.label);
}
