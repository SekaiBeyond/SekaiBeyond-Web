import { type QueryDocumentSnapshot } from 'firebase/firestore';
import { createCollectionCache } from './collectionCache';

export interface SocialPlatform {
    id: string;
    label: string;
    /** Chinese display name, when the brand differs (falls back to `label`). */
    labelCn?: string;
    /** URL prefix the cleaned handle is appended to when building a target URL. */
    buildPrefix: string;
    /** Hostnames (www-stripped, lowercased) that identify this platform in a saved URL. */
    hosts: string[];
    /** Path segment preceding the handle, stripped when detecting (e.g. '@', 'user/'). */
    pathPrefix: string;
    /** Example handle shown as the input placeholder. */
    placeholder: string;
    /** Sort order in the picker (ascending). */
    order: number;
}

/**
 * Built-in profile-link templates. These seed the editable `socialPlatforms`
 * collection and act as a fallback so the QR form's "Social profile" mode works
 * before any admin customises the list (and never ends up with an empty picker).
 * Stable ids let {@link seedSocialPlatforms} re-seed idempotently.
 */
export const DEFAULT_SOCIAL_PLATFORMS: SocialPlatform[] = [
    {
        id: 'instagram',
        label: 'Instagram',
        buildPrefix: 'https://instagram.com/',
        hosts: ['instagram.com'],
        pathPrefix: '',
        placeholder: '@handle',
        order: 0
    },
    {
        id: 'x',
        label: 'X (Twitter)',
        buildPrefix: 'https://x.com/',
        hosts: ['x.com', 'twitter.com'],
        pathPrefix: '',
        placeholder: '@handle',
        order: 1
    },
    {
        id: 'tiktok',
        label: 'TikTok',
        buildPrefix: 'https://www.tiktok.com/@',
        hosts: ['tiktok.com'],
        pathPrefix: '@',
        placeholder: '@handle',
        order: 2
    },
    {
        id: 'youtube',
        label: 'YouTube',
        buildPrefix: 'https://www.youtube.com/@',
        hosts: ['youtube.com'],
        pathPrefix: '@',
        placeholder: '@handle',
        order: 3
    },
    {
        id: 'facebook',
        label: 'Facebook',
        buildPrefix: 'https://facebook.com/',
        hosts: ['facebook.com', 'fb.com'],
        pathPrefix: '',
        placeholder: 'page name',
        order: 4
    },
    {
        id: 'bilibili',
        label: 'Bilibili',
        labelCn: '哔哩哔哩',
        buildPrefix: 'https://space.bilibili.com/',
        hosts: ['space.bilibili.com'],
        pathPrefix: '',
        placeholder: 'user UID (numbers)',
        order: 5
    },
    {
        id: 'xiaohongshu',
        label: 'Xiaohongshu (RED)',
        labelCn: '小红书',
        buildPrefix: 'https://www.xiaohongshu.com/user/profile/',
        hosts: ['xiaohongshu.com'],
        pathPrefix: 'user/profile/',
        placeholder: 'profile ID',
        order: 6
    },
    {
        id: 'weibo',
        label: 'Weibo',
        labelCn: '微博',
        buildPrefix: 'https://weibo.com/',
        hosts: ['weibo.com'],
        pathPrefix: '',
        placeholder: 'username',
        order: 7
    },
    {
        id: 'douyin',
        label: 'Douyin',
        labelCn: '抖音',
        buildPrefix: 'https://www.douyin.com/user/',
        hosts: ['douyin.com'],
        pathPrefix: 'user/',
        placeholder: 'user ID',
        order: 8
    },
];

function mapDoc(docSnap: QueryDocumentSnapshot): SocialPlatform {
    const data = docSnap.data();
    return {
        id: docSnap.id,
        label: data.label ?? '',
        labelCn: data.labelCn || undefined,
        buildPrefix: data.buildPrefix ?? '',
        hosts: Array.isArray(data.hosts) ? data.hosts.filter((h: unknown): h is string => typeof h === 'string') : [],
        pathPrefix: data.pathPrefix ?? '',
        placeholder: data.placeholder ?? '',
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

/** Strip a leading @ and surrounding slashes/whitespace from a user-entered handle. */
export function cleanHandle(raw: string): string {
    return raw.trim().replace(/^@+/, '').replace(/^\/+|\/+$/g, '');
}

/** Build a profile URL from a platform id + handle, or '' when either is missing. */
export function buildSocialUrl(
    platformId: string,
    handle: string,
    platforms: SocialPlatform[] = socialPlatformsSnapshot(),
): string {
    const platform = platforms.find(p => p.id === platformId);
    const clean = cleanHandle(handle);
    if (!platform || !clean) return '';
    return platform.buildPrefix + clean;
}

export interface SocialMatch {
    platformId: string;
    handle: string;
}

/**
 * Recognise a saved profile URL as one of the known platforms so the form can
 * reopen it in social mode. Returns null for anything that isn't a clean
 * single-handle profile link (those stay in custom-URL mode).
 */
export function detectSocialUrl(
    url: string,
    platforms: SocialPlatform[] = socialPlatformsSnapshot(),
): SocialMatch | null {
    let parsed: URL;
    try {
        parsed = new URL(url);
    } catch {
        return null;
    }
    const host = parsed.hostname.replace(/^www\./, '').toLowerCase();
    const platform = platforms.find(p => p.hosts.includes(host));
    if (!platform) return null;
    let path = parsed.pathname.replace(/^\/+/, '').replace(/\/+$/, '');
    if (platform.pathPrefix) {
        if (!path.startsWith(platform.pathPrefix)) return null;
        path = path.slice(platform.pathPrefix.length);
    }
    if (!path || path.includes('/')) return null;
    return {platformId: platform.id, handle: path};
}
