import {
    collection,
    type DocumentData,
    endAt,
    getDocs,
    limit,
    orderBy,
    type Query,
    query,
    type QueryDocumentSnapshot,
    startAfter,
    startAt,
    Timestamp,
    where,
} from 'firebase/firestore';
import { getDocsByIds, toDate } from '~/lib/collectionCache';
import { getFirebaseDb } from '~/lib/firebase';
import { isMembershipActive, normalizeGroup, type UserGroup } from '~/components/AuthProvider';
import type { UserRecord } from './types';
import type { ShowToast } from '~/lib/useToasts';

export const WEBP_QUALITY = 0.95;

// Re-exported so the admin panel imports it from here; defined in
// ~/lib/useToasts.
export type { ShowToast };

/**
 * The re-read after an admin write. Its failure is a stale screen, so it warns and
 * never throws: inside the write's try it would read as "Failed to save", and a
 * retry would duplicate the write.
 */
export async function refreshAfterSave(
    refresh: () => Promise<unknown>,
    showToast: ShowToast,
    isEnglish: boolean,
): Promise<void> {
    try {
        await refresh();
    } catch (err) {
        console.error('Re-read after a save failed:', err);
        showToast(isEnglish
            ? 'The change was saved, but this page couldn\'t reload, so it may not show it yet. Reload the page to see it.'
            : '更改已保存，但页面未能重新加载，可能暂未显示。请刷新页面查看。', 'warning');
    }
}

export const docToUserRecord = (docSnap: {id: string; data: () => DocumentData}): UserRecord => {
    const data = docSnap.data();
    return {
        uid: docSnap.id,
        displayName: data.displayName ?? '',
        email: data.email ?? '',
        photoURL: data.photoURL ?? '',
        bannerURL: data.bannerURL ?? '',
        joinedAt: toDate(data.joinedAt) ?? new Date(),
        attendedEvents: data.attendedEvents ?? [],
        badges: data.badges ?? [],
        group: normalizeGroup(data.group),
        membershipExpiresAt: toDate(data.membershipExpiresAt),
        title: data.title ?? '',
        titleCn: data.titleCn ?? '',
        eventStaffEvents: data.eventStaffEvents ?? [],
        hidePassportPage: data.hidePassportPage === true,
    };
};

/**
 * Users by uid, for screens holding uids rather than a query. Chunked for `in`'s
 * 30-id limit. A uid with no document (a deleted account) is missing from the
 * result, which callers read as deleted.
 */
export const fetchUsersByUids = async (uids: string[]): Promise<Map<string, UserRecord>> =>
    new Map((await getDocsByIds('users', uids)).map(d => [d.id, docToUserRecord(d)]));

// The browsable user list, filtered by role and/or active membership. Members-only
// orders by membershipExpiresAt, since Firestore's first orderBy must match the
// inequality field.
export const buildUserListQuery = (opts: {
    group: UserGroup | '';
    membersOnly: boolean;
    pageSize: number;
    cursor?: QueryDocumentSnapshot | null;
}): Query => {
    const users = collection(getFirebaseDb(), 'users');
    const clauses = [];
    if (opts.group) clauses.push(where('group', '==', opts.group));
    if (opts.membersOnly) {
        clauses.push(where('membershipExpiresAt', '>', Timestamp.now()));
        clauses.push(orderBy('membershipExpiresAt', 'desc'));
    } else {
        clauses.push(orderBy('joinedAt', 'desc'));
    }
    if (opts.cursor) clauses.push(startAfter(opts.cursor));
    clauses.push(limit(opts.pageSize));
    return query(users, ...clauses);
};

const USER_SEARCH_LIMIT = 10;

// How every admin surface looks a user up: displayName and email as prefixes, via a [p, p +
// \uf8ff] range, since Firestore has no substring search.
//
// Emails are stored lowercase. Names are mixed case and ranges are case-sensitive, so the
// name query runs with the first letter in each case. An "@" means an email and skips the
// name queries.
export const searchUsers = async (
    rawQuery: string,
    group: UserGroup | '' = '',
    membersOnly = false,
): Promise<UserRecord[]> => {
    const q = rawQuery.trim();
    if (!q) return [];
    const users = collection(getFirebaseDb(), 'users');

    const prefixQuery = (field: string, prefix: string) => getDocs(query(
        users,
        orderBy(field),
        startAt(prefix),
        endAt(prefix + '\uf8ff'),
        limit(USER_SEARCH_LIMIT),
    ));

    const searches = [prefixQuery('email', q.toLowerCase())];
    if (!q.includes('@')) {
        const names = new Set<string>([q]);
        const first = q.charAt(0);
        if (first && first.toLowerCase() !== first.toUpperCase()) {
            names.add(first.toUpperCase() + q.slice(1));
            names.add(first.toLowerCase() + q.slice(1));
        }
        names.forEach(prefix => searches.push(prefixQuery('displayName', prefix)));
    }

    const snaps = await Promise.all(searches);
    // Filtered here, since combining either filter with a prefix range would need
    // a composite index.
    const deduped = new Map<string, UserRecord>();
    snaps.forEach(s => s.docs.forEach(d => {
        const r = docToUserRecord(d);
        if (group && r.group !== group) return;
        if (membersOnly && !isMembershipActive(r.membershipExpiresAt)) return;
        deduped.set(r.uid, r);
    }));
    return Array.from(deduped.values());
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

export const getClaimUrl = (code: string): string => {
    return `${window.location.origin}/claim?code=${code}`;
};

/** `maxMb` is the server's image cap, from useUploadLimits. */
export function validateImageFile(f: File, maxMb: number, isEnglish: boolean, showToast: ShowToast, allowAnyImage: boolean = false): boolean {
    if (allowAnyImage) {
        if (!f.type.startsWith('image/')) {
            showToast(isEnglish ? 'Please select an image file.' : '请选择图片文件。', 'error');
            return false;
        }
    } else if (f.type !== 'image/webp') {
        showToast(isEnglish ? 'Please upload a WebP image.' : '请上传 WebP 格式的图片。', 'error');
        return false;
    }
    if (f.size > maxMb * 1024 * 1024) {
        showToast(isEnglish ? `Image must be under ${maxMb} MB.` : `图片大小不能超过 ${maxMb} MB。`, 'error');
        return false;
    }
    return true;
}

/**
 * The con hero's clip must be WebM: it's stored as .webm and served as a WebM
 * source, so anything else plays nowhere. The browser reports the container, not
 * the codecs, so an AV1 WebM still passes here, which is why the helper text
 * names VP9. `maxMb` is the server's video cap.
 */
export function validateVideoFile(f: File, maxMb: number, isEnglish: boolean, showToast: ShowToast): boolean {
    if (f.type !== 'video/webm') {
        showToast(
            isEnglish ? 'Please upload a WebM video.' : '请上传 WebM 格式的视频。',
            'error',
        );
        return false;
    }
    if (f.size > maxMb * 1024 * 1024) {
        showToast(
            isEnglish
                ? `Video must be under ${maxMb} MB.`
                : `视频大小不能超过 ${maxMb} MB。`,
            'error',
        );
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
