import { useCallback, useEffect, useState } from 'react';
import { doc, getDoc } from 'firebase/firestore';
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

let cachedConfig: SiteConfig | null = null;
let fetchPromise: Promise<SiteConfig> | null = null;
const subscribers = new Set<(config: SiteConfig) => void>();

async function fetchConfig(force = false): Promise<SiteConfig> {
    if (!force && cachedConfig) return cachedConfig;
    if (fetchPromise) return fetchPromise;

    fetchPromise = (async () => {
        const db = getFirebaseDb();
        const snap = await getDoc(doc(db, 'config', 'main'));
        const data = snap.data();
        const config: SiteConfig = {
            bilibiliVideoBvid: data?.bilibiliVideoBvid ?? '',
            bilibiliVideoCoverUrl: data?.bilibiliVideoCoverUrl ?? '',
            teamMembers: data?.teamMembers ?? [],
            conEdition: data?.conEdition ?? null,
        };
        cachedConfig = config;
        fetchPromise = null;
        return config;
    })();

    return fetchPromise;
}

async function refreshConfig(): Promise<SiteConfig> {
    cachedConfig = null;
    fetchPromise = null;
    const config = await fetchConfig();
    for (const fn of subscribers) fn(config);
    return config;
}

export function useSiteConfig(): {config: SiteConfig; loading: boolean; refresh: () => Promise<void>} {
    const [config, setConfig] = useState<SiteConfig>(cachedConfig ?? DEFAULT_CONFIG);
    const [loading, setLoading] = useState(cachedConfig === null);

    useEffect(() => {
        subscribers.add(setConfig);
        return () => {
            subscribers.delete(setConfig);
        };
    }, []);

    useEffect(() => {
        if (cachedConfig) {
            setConfig(cachedConfig);
            setLoading(false);
            return;
        }
        fetchConfig()
            .then(result => {
                setConfig(result);
                setLoading(false);
            })
            .catch(err => {
                console.error('Failed to load site config:', err);
                setLoading(false);
            });
    }, []);

    const refresh = useCallback(async () => {
        await refreshConfig();
    }, []);

    return {config, loading, refresh};
}
