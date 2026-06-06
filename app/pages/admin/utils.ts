import { collection, type DocumentData, getDocs, limit, query, where } from 'firebase/firestore';
import { getFirebaseDb } from '~/lib/firebase';
import type { UserRecord } from './types';
import { MAX_IMAGE_SIZE_MB } from '~/constants';

export const WEBP_QUALITY = 0.95;

const MAX_IMAGE_SIZE_BYTES = MAX_IMAGE_SIZE_MB * 1024 * 1024;

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
        eventStaffEvents: data.eventStaffEvents ?? [],
    };
};

export const fetchEventAttendees = async (eventId: string): Promise<UserRecord[]> => {
    const db = getFirebaseDb();
    const q = query(collection(db, 'users'), where('attendedEvents', 'array-contains', eventId));
    const snapshot = await getDocs(q);
    return snapshot.docs.map(docToUserRecord);
};

export const fetchEventStaffCount = async (eventId: string): Promise<number> => {
    const db = getFirebaseDb();
    const q = query(collection(db, 'users'), where('eventStaffEvents', 'array-contains', eventId));
    const snapshot = await getDocs(q);
    return snapshot.size;
};

// True if an archived event has ticket attendees. Only paid events ever populate
// the attendees subcollection, so this detects paid events that were archived
// before the `paid` flag was stored on the past-event doc.
export const pastEventHasTickets = async (eventId: string): Promise<boolean> => {
    const db = getFirebaseDb();
    const snapshot = await getDocs(
        query(collection(db, 'pastEvents', eventId, 'attendees'), limit(1)),
    );
    return !snapshot.empty;
};

export const getClaimUrl = (code: string): string => {
    return `${window.location.origin}/claim?code=${code}`;
};

export function validateImageFile(f: File, isEnglish: boolean, showToast: ShowToast, allowAnyImage: boolean = false): boolean {
    // validate image file type
    if (allowAnyImage) {
        if (!f.type.startsWith('image/')) {
            showToast(isEnglish ? 'Please select an image file.' : '请选择图片文件。', 'error');
            return false;
        }
    } else if (f.type !== 'image/webp') {
        showToast(isEnglish ? 'Please upload a WebP image.' : '请上传 WebP 格式的图片。', 'error');
        return false;
    }
    // validate image size
    if (f.size > MAX_IMAGE_SIZE_BYTES) {
        showToast(isEnglish ? `Image must be under ${MAX_IMAGE_SIZE_MB} MB.` : `图片大小不能超过 ${MAX_IMAGE_SIZE_MB} MB。`, 'error');
        return false;
    }
    return true;
}

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
