import { collection, type DocumentData, type Firestore, getDocs, query, where, writeBatch } from 'firebase/firestore';
import { getFirebaseDb } from '~/lib/firebase';
import type { UserRecord } from './types';

const MAX_IMAGE_SIZE = 5 * 1024 * 1024; // 5MB
const MAX_BATCH_OPS = 450; // Firestore limit is 500, leave margin

type BatchOp = (batch: ReturnType<typeof writeBatch>) => void;

/**
 * Execute batch operations in chunks to stay under Firestore's 500-op batch limit.
 * Each callback in `ops` should call exactly one batch method (set/update/delete).
 */
export const commitInChunks = async (db: Firestore, ops: BatchOp[]): Promise<void> => {
    for (let i = 0; i < ops.length; i += MAX_BATCH_OPS) {
        const chunk = ops.slice(i, i + MAX_BATCH_OPS);
        const batch = writeBatch(db);
        for (const op of chunk) op(batch);
        await batch.commit();
    }
};

export const docToUserRecord = (docSnap: {id: string; data: () => DocumentData}): UserRecord => {
    const data = docSnap.data();
    return {
        uid: docSnap.id,
        displayName: data.displayName ?? '',
        email: data.email ?? '',
        photoURL: data.photoURL ?? '',
        joinedAt: data.joinedAt?.toDate() ?? new Date(),
        attendedEvents: data.attendedEvents ?? [],
        badges: data.badges ?? [],
        group: data.group ?? 'visitor',
    };
};

export const fetchEventAttendees = async (eventId: string): Promise<UserRecord[]> => {
    const db = getFirebaseDb();
    const q = query(collection(db, 'users'), where('attendedEvents', 'array-contains', eventId));
    const snapshot = await getDocs(q);
    return snapshot.docs.map(docToUserRecord);
};

export const getClaimUrl = (code: string): string => {
    return `${window.location.origin}/claim?code=${code}`;
};

export const isValidHttpUrl = (url: string): boolean => {
    try {
        const parsed = new URL(url);
        return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch {
        return false;
    }
};

export const validateImageFile = (file: File, isEnglish: boolean): boolean => {
    if (file.type !== 'image/webp') {
        alert(isEnglish ? 'Please upload a WebP image.' : '请上传 WebP 格式的图片。');
        return false;
    }
    if (file.size > MAX_IMAGE_SIZE) {
        alert(isEnglish ? 'Image must be under 5MB.' : '图片大小不能超过 5MB。');
        return false;
    }
    return true;
};
