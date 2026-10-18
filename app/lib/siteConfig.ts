import { doc, getDoc } from 'firebase/firestore';
import { createValueCache } from './collectionCache';
import { getFirebaseDb } from './firebase';

export interface ConEdition {
    year: number;
    date: string;
    location: string;
    locationCn?: string;
    description: string;
    descriptionCn: string;
    image: string;
    highlights: {
        labelEn: string;
        labelCn: string;
        icon: string;
    }[];
}

// Mirrors SOCIAL_LINK_PATTERNS in functions/src/functions/admin.ts.
export const SOCIAL_LINK_KEYS = ['discord', 'instagram', 'bilibili', 'xiaohongshu', 'linkedin', 'github'] as const;
export type SocialLinkKey = typeof SOCIAL_LINK_KEYS[number];
export type SocialLinks = Record<SocialLinkKey, string>;

export const SOCIAL_LINK_NAMES: Record<SocialLinkKey, {en: string; zh: string}> = {
    discord: {en: 'Discord', zh: 'Discord'},
    instagram: {en: 'Instagram', zh: 'Instagram'},
    bilibili: {en: 'Bilibili', zh: '哔哩哔哩'},
    xiaohongshu: {en: 'Xiaohongshu', zh: '小红书'},
    linkedin: {en: 'LinkedIn', zh: '领英'},
    github: {en: 'GitHub', zh: 'GitHub'},
};

const NO_SOCIAL_LINKS: SocialLinks = {
    discord: '',
    instagram: '',
    bilibili: '',
    xiaohongshu: '',
    linkedin: '',
    github: '',
};

export interface TeamMemberConfig {
    id: string;
    uid?: string;
    name: string;
    nameCn: string;
    role: string;
    roleCn: string;
    imageUrl: string;
    isHonorary?: boolean;
    /** When `uid` is set, follow the linked account's live title / photoURL. */
    useAccountRole?: boolean;
    useAccountPhoto?: boolean;
}

interface SiteConfig {
    bilibiliVideoBvid: string;
    bilibiliVideoCoverUrl: string;
    teamMembers: TeamMemberConfig[];
    conEdition: ConEdition | null;
    contactEmail: string;
    socialLinks: SocialLinks;
    senderPrefix: string;
}

const DEFAULT_CONFIG: SiteConfig = {
    bilibiliVideoBvid: '',
    bilibiliVideoCoverUrl: '',
    teamMembers: [],
    conEdition: null,
    contactEmail: '',
    socialLinks: NO_SOCIAL_LINKS,
    senderPrefix: '',
};

const cache = createValueCache<SiteConfig>('site config', async () => {
    const db = getFirebaseDb();
    const snap = await getDoc(doc(db, 'config', 'main'));
    const data = snap.data();
    return {
        bilibiliVideoBvid: data?.bilibiliVideoBvid ?? '',
        bilibiliVideoCoverUrl: data?.bilibiliVideoCoverUrl ?? '',
        teamMembers: data?.teamMembers ?? [],
        conEdition: data?.conEdition ?? null,
        contactEmail: data?.contactEmail ?? '',
        socialLinks: {...NO_SOCIAL_LINKS, ...data?.socialLinks},
        senderPrefix: data?.senderPrefix ?? '',
    };
}, DEFAULT_CONFIG);

export function useSiteConfig(): {
    config: SiteConfig;
    loading: boolean;
    failed: boolean;
    refresh: () => Promise<void>;
} {
    const {value: config, loading, error, refresh} = cache.useValue();
    return {config, loading, failed: error !== null, refresh};
}
