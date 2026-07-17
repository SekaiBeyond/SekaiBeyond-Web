import { doc, getDoc } from 'firebase/firestore';
import { createValueCache } from './collectionCache';
import { getFirebaseDb } from './firebase';

export interface Policy {
    contentEn: string;
    contentCn: string;
    updatedAt?: Date;
    updatedByName?: string;
}

const EMPTY_POLICY: Policy = {contentEn: '', contentCn: ''};

const cache = createValueCache<Policy>('policy', async () => {
    const db = getFirebaseDb();
    const snap = await getDoc(doc(db, 'policy', 'main'));
    const data = snap.data();
    return {
        contentEn: data?.contentEn ?? '',
        contentCn: data?.contentCn ?? '',
        updatedAt: data?.updatedAt?.toDate?.(),
        updatedByName: data?.updatedByName,
    };
}, EMPTY_POLICY);

export function usePolicy(): {policy: Policy; loading: boolean; refresh: () => Promise<void>} {
    const {value: policy, loading, refresh} = cache.useValue();
    return {policy, loading, refresh};
}
