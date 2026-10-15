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

// The accounts the site links to, each with an icon drawn in code. Mirrored by
// SOCIAL_LINK_PATTERNS in functions/src/functions/admin.ts.
export const SOCIAL_LINK_KEYS = ['discord', 'instagram', 'bilibili', 'xiaohongshu', 'linkedin', 'github'] as const;
export type SocialLinkKey = typeof SOCIAL_LINK_KEYS[number];
/** Profile URL per account. Blank hides every link to that account. */
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
    // With a linked account (uid set), each flag makes a field follow the account's live
    // value, keeping the stored one as a fallback: role follows its title (titleCn for
    // Chinese), photo its photoURL. Names stay custom; linking only prefills a blank
    // one.
    useAccountRole?: boolean;
    useAccountPhoto?: boolean;
}

export interface SiteConfig {
    bilibiliVideoBvid: string;
    bilibiliVideoCoverUrl: string;
    teamMembers: TeamMemberConfig[];
    conEdition: ConEdition | null;
    contactEmail: string;
    socialLinks: SocialLinks;
    // The part before the @ of the From address; the server sets the domain.
    // Blank uses its default prefix.
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

/** `failed` means the read never succeeded, so `config` is DEFAULT_CONFIG. */
export function useSiteConfig(): {
    config: SiteConfig;
    loading: boolean;
    failed: boolean;
    refresh: () => Promise<void>;
} {
    const {value: config, loading, error, refresh} = cache.useValue();
    return {config, loading, failed: error !== null, refresh};
}
