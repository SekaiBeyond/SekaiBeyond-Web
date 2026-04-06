import type { UserRecord } from './types';

const MAX_IMAGE_SIZE = 5 * 1024 * 1024; // 5MB

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const docToUserRecord = (docSnap: {id: string; data: () => Record<string, any>}): UserRecord => {
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
