import {
    collection,
    type DocumentData,
    documentId,
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
import type { ShowToast } from '~/lib/useToasts';
import { MAX_IMAGE_SIZE_MB, MAX_VIDEO_SIZE_MB } from '~/constants';

export const WEBP_QUALITY = 0.95;

const MAX_IMAGE_SIZE_BYTES = MAX_IMAGE_SIZE_MB * 1024 * 1024;
const MAX_VIDEO_SIZE_BYTES = MAX_VIDEO_SIZE_MB * 1024 * 1024;

// Re-exported so the admin panel keeps importing its toaster type from here,
// while there is only one definition of it (in ~/lib/useToasts).
export type { ShowToast };

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
        bannerURL: data.bannerURL ?? '',
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

/**
 * Users by uid, for a screen holding a list of uids rather than a query — the
 * passport stock table resolving its holders, for instance.
 *
 * Firestore takes at most 30 ids per `in`, so the ids are chunked and the chunks
 * run together. A uid with no document (a deleted account) is simply missing from
 * the result, which callers read as "deleted" rather than as a failure.
 */
export const fetchUsersByUids = async (uids: string[]): Promise<Map<string, UserRecord>> => {
    const unique = [...new Set(uids)];
    if (unique.length === 0) return new Map();
    const users = collection(getFirebaseDb(), 'users');
    const chunks: string[][] = [];
    for (let i = 0; i < unique.length; i += 30) chunks.push(unique.slice(i, i + 30));
    const snapshots = await Promise.all(
        chunks.map(chunk => getDocs(query(users, where(documentId(), 'in', chunk)))),
    );
    return new Map(snapshots.flatMap(snap => snap.docs.map(d => [d.id, docToUserRecord(d)] as const)));
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

/**
 * Each slot takes one container, not either of them: the stored filename's
 * extension is minted from the slot, and the `<source type>` the hero renders
 * comes from the same place. A WebM dropped into the MP4 slot would be served to
 * Safari as an .mp4 it cannot decode, and the hero would vanish for iOS alone.
 *
 * The browser reports the container, not the codecs, so this only rules out the
 * wrong kind of file. A .webm holding AV1, or an .mp4 holding HEVC, passes here
 * and then fails to decode in some browsers — which is why the hero lists both
 * sources and why the helper text names H.264 and VP9.
 */
export function validateVideoFile(
    f: File,
    expected: 'video/mp4' | 'video/webm',
    isEnglish: boolean,
    showToast: ShowToast,
): boolean {
    if (f.type !== expected) {
        const name = expected === 'video/mp4' ? 'MP4' : 'WebM';
        showToast(
            isEnglish ? `Please upload a ${name} video.` : `请上传 ${name} 格式的视频。`,
            'error',
        );
        return false;
    }
    if (f.size > MAX_VIDEO_SIZE_BYTES) {
        showToast(
            isEnglish
                ? `Video must be under ${MAX_VIDEO_SIZE_MB} MB.`
                : `视频大小不能超过 ${MAX_VIDEO_SIZE_MB} MB。`,
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
