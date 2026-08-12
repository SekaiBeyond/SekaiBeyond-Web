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
import { getFirebaseDb } from '~/lib/firebase';
import { normalizeGroup, type UserGroup } from '~/components/AuthProvider';
import type { UserRecord } from './types';
import { MAX_IMAGE_SIZE_MB } from '~/constants';

export const WEBP_QUALITY = 0.95;

const MAX_IMAGE_SIZE_BYTES = MAX_IMAGE_SIZE_MB * 1024 * 1024;

export type ShowToast = (message: string, type: 'success' | 'warning' | 'error') => void;

/**
 * Format a Date as the `YYYY-MM-DDTHH:mm` value a `datetime-local` input expects.
 * Built from local getters rather than `toISOString`, which would shift the
 * displayed time by the UTC offset. A null date maps to the empty (unset) input.
 */
export const toDatetimeLocal = (date: Date | null): string => {
    if (!date) return '';
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
        + `T${pad(date.getHours())}:${pad(date.getMinutes())}`;
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
        group: normalizeGroup(data.group),
        membershipExpiresAt: data.membershipExpiresAt?.toDate() ?? null,
        title: data.title ?? '',
        titleCn: data.titleCn ?? '',
        eventStaffEvents: data.eventStaffEvents ?? [],
    };
};

// The browsable user list, filtered by role and/or active membership. Members-only
// has to order by membershipExpiresAt because Firestore requires the first orderBy
// to match the inequality field — so that view is sorted by expiry rather than by
// join date, which is the more useful ordering for it anyway.
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

export const USER_SEARCH_LIMIT = 10;

// Shared by every admin surface that looks a user up, so they all match the same way.
// Both displayName and email are matched as prefixes: Firestore has no substring search,
// but a [p, p + \uf8ff] range covers every value starting with p.
//
// Emails are stored lowercase, so one query covers them. displayName is mixed case and
// Firestore ranges are case-sensitive, so the name query is repeated with the first letter
// in each case and the results merged — that covers the usual "ben" vs "Ben" mismatch
// without needing a search index. An "@" can only be an email, so it skips the name queries.
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
    // The group and membership filters are applied here rather than in the query:
    // combining either with a prefix range would need a composite index, and each
    // query is already capped at USER_SEARCH_LIMIT.
    const deduped = new Map<string, UserRecord>();
    snaps.forEach(s => s.docs.forEach(d => {
        const r = docToUserRecord(d);
        if (group && r.group !== group) return;
        if (membersOnly && !(r.membershipExpiresAt && r.membershipExpiresAt.getTime() > Date.now())) return;
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
    if (allowAnyImage) {
        if (!f.type.startsWith('image/')) {
            showToast(isEnglish ? 'Please select an image file.' : '请选择图片文件。', 'error');
            return false;
        }
    } else if (f.type !== 'image/webp') {
        showToast(isEnglish ? 'Please upload a WebP image.' : '请上传 WebP 格式的图片。', 'error');
        return false;
    }
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
