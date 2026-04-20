import { collection, type DocumentData, getDocs, query, where } from 'firebase/firestore';
import { getFirebaseDb } from '~/lib/firebase';
import type { UserRecord } from './types';

const MAX_IMAGE_SIZE = 5 * 1024 * 1024; // 5MB
const MAX_RAW_IMAGE_SIZE = 25 * 1024 * 1024; // 25MB, pre-crop browser-side sanity cap
export const WEBP_QUALITY = 0.95;

export type ShowToast = (message: string, type: 'success' | 'warning' | 'error') => void;

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
    showToast: ShowToast,
    opts?: {allowAnyImage?: boolean},
): boolean => {
    if (opts?.allowAnyImage) {
        if (!file.type.startsWith('image/')) {
            showToast(isEnglish ? 'Please select an image file.' : '请选择图片文件。', 'error');
            return false;
        }
        if (file.size > MAX_RAW_IMAGE_SIZE) {
            showToast(isEnglish ? 'Image must be under 25MB.' : '图片大小不能超过 25MB。', 'error');
            return false;
        }
        return true;
    }
    if (file.type !== 'image/webp') {
        showToast(isEnglish ? 'Please upload a WebP image.' : '请上传 WebP 格式的图片。', 'error');
        return false;
    }
    if (file.size > MAX_IMAGE_SIZE) {
        showToast(isEnglish ? 'Image must be under 5MB.' : '图片大小不能超过 5MB。', 'error');
        return false;
    }
    return true;
};

export const convertImageToWebp = async (file: File): Promise<File> => {
    if (file.type === 'image/webp') return file;
    const url = URL.createObjectURL(file);
    try {
        const img = await new Promise<HTMLImageElement>((resolve, reject) => {
            const i = new Image();
            i.onload = () => resolve(i);
            i.onerror = () => reject(new Error('load-failed'));
            i.src = url;
        });
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('canvas-unsupported');
        ctx.drawImage(img, 0, 0);
        const blob = await new Promise<Blob | null>(resolve =>
            canvas.toBlob(b => resolve(b), 'image/webp', WEBP_QUALITY)
        );
        if (!blob) throw new Error('encode-failed');
        const name = file.name.replace(/\.[^.]+$/, '') + '.webp';
        return new File([blob], name, {type: 'image/webp'});
    } finally {
        URL.revokeObjectURL(url);
    }
};
