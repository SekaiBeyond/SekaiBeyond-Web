import { doc, getDoc } from 'firebase/firestore';
import { createValueCache } from './collectionCache';
import { getFirebaseDb } from './firebase';
import type { ConEdition } from '~/constants';

export interface TeamMemberConfig {
    id: string;
    uid?: string;
    name: string;
    nameCn: string;
    role: string;
    roleCn: string;
    imageUrl: string;
    isHonorary?: boolean;
    // When a member is linked to an account (uid set), each of these opts that field
    // into following the account's live value; the stored value is kept as a fallback.
    // role -> account title (+ titleCn for the Chinese role), photo -> account photoURL.
    // Names are always custom: linking an account only prefills a blank name.
    useAccountRole?: boolean;
    useAccountPhoto?: boolean;
}

export interface SiteConfig {
    bilibiliVideoBvid: string;
    bilibiliVideoCoverUrl: string;
    teamMembers: TeamMemberConfig[];
    conEdition: ConEdition | null;
}

const DEFAULT_CONFIG: SiteConfig = {
    bilibiliVideoBvid: '',
    bilibiliVideoCoverUrl: '',
    teamMembers: [],
    conEdition: null,
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
    };
}, DEFAULT_CONFIG);

export function useSiteConfig(): {config: SiteConfig; loading: boolean; refresh: () => Promise<void>} {
    const {value: config, loading, refresh} = cache.useValue();
    return {config, loading, refresh};
}
