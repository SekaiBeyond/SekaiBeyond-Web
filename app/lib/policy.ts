import { useCallback, useEffect, useState } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { getFirebaseDb } from './firebase';

export interface Policy {
    contentEn: string;
    contentCn: string;
    updatedAt?: Date;
    updatedByName?: string;
}

const EMPTY_POLICY: Policy = {contentEn: '', contentCn: ''};

let cachedPolicy: Policy | null = null;
let fetchPromise: Promise<Policy> | null = null;
const subscribers = new Set<(policy: Policy) => void>();

async function fetchPolicy(force = false): Promise<Policy> {
    if (!force && cachedPolicy) return cachedPolicy;
    if (fetchPromise) return fetchPromise;

    fetchPromise = (async () => {
        const db = getFirebaseDb();
        const snap = await getDoc(doc(db, 'policy', 'main'));
        const data = snap.data();
        const policy: Policy = {
            contentEn: data?.contentEn ?? '',
            contentCn: data?.contentCn ?? '',
            updatedAt: data?.updatedAt?.toDate?.(),
            updatedByName: data?.updatedByName,
        };
        cachedPolicy = policy;
        fetchPromise = null;
        return policy;
    })();

    return fetchPromise;
}

async function refreshPolicy(): Promise<Policy> {
    cachedPolicy = null;
    fetchPromise = null;
    const policy = await fetchPolicy();
    for (const fn of subscribers) fn(policy);
    return policy;
}

export function usePolicy(): {policy: Policy; loading: boolean; refresh: () => Promise<void>} {
    const [policy, setPolicy] = useState<Policy>(cachedPolicy ?? EMPTY_POLICY);
    const [loading, setLoading] = useState(cachedPolicy === null);

    useEffect(() => {
        subscribers.add(setPolicy);
        return () => {
            subscribers.delete(setPolicy);
        };
    }, []);

    useEffect(() => {
        if (cachedPolicy) {
            setPolicy(cachedPolicy);
            setLoading(false);
            return;
        }
        fetchPolicy()
            .then(result => {
                setPolicy(result);
                setLoading(false);
            })
            .catch(err => {
                console.error('Failed to load policy:', err);
                setLoading(false);
            });
    }, []);

    const refresh = useCallback(async () => {
        await refreshPolicy();
    }, []);

    return {policy, loading, refresh};
}
