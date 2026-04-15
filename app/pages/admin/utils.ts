import { collection, type DocumentData, getDocs, query, where } from 'firebase/firestore';
import { getFirebaseDb } from '~/lib/firebase';
import type { UserRecord } from './types';

const MAX_IMAGE_SIZE = 5 * 1024 * 1024; // 5MB
const MAX_RAW_IMAGE_SIZE = 25 * 1024 * 1024; // 25MB, pre-crop browser-side sanity cap

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
        title: data.title ?? '',
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

export const validateImageFile = (
    file: File,
    isEnglish: boolean,
    opts?: {allowAnyImage?: boolean},
): boolean => {
    if (opts?.allowAnyImage) {
        if (!file.type.startsWith('image/')) {
            alert(isEnglish ? 'Please select an image file.' : '请选择图片文件。');
            return false;
        }
        if (file.size > MAX_RAW_IMAGE_SIZE) {
            alert(isEnglish ? 'Image must be under 25MB.' : '图片大小不能超过 25MB。');
            return false;
        }
        return true;
    }
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
