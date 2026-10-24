import { useMemo } from 'react';
import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore';
import { createCollectionCache, toDate } from './collectionCache';
import { getFirebaseDb } from './firebase';

export type PassportStatus = 'unclaimed' | 'claimed';

/**
 * A physical passport. The doc id is the public code on the sticker, and so the
 * URL: /p/<id>.
 *
 * Binding is permanent: `ownerUid` and `claimedAt` are written once, by the
 * claim, so the scan URL is a stable address for a person. Unclaimed stock can
 * be deleted in bulk; a claimed passport only from its own admin page.
 */
export interface Passport {
    id: string;
    designId: string;
    /** The design's year, copied at generation — a design's year never changes. */
    year: number;
    status: PassportStatus;
    ownerUid: string | null;
    claimedAt: Date | null;
    /** Days of membership this passport grants on claim: its design's term, copied at generation. */
    termDays: number;
    createdAt: Date | null;
    createdByName: string;
    /** When the current activation key was minted — bumped by a key reissue. */
    keyIssuedAt: Date | null;
    keyReissueCount: number;
    /** The address its key was emailed to; blank for printed stock. */
    sentTo: string;
    /** When the key email went; null while it waits in the queue. */
    emailSentAt: Date | null;
    /** Waiting in the overflow queue for the daily cap to reopen. */
    emailScheduled: boolean;
}

/**
 * What a passport is printed from: its name and cover art. A year can have
 * several designs, with distinct names in both languages.
 */
export interface PassportDesign {
    id: string;
    /** Set on creation and fixed after. */
    year: number;
    name: string;
    /** Optional; the English name stands in when it's blank. */
    nameCn: string;
    coverImageUrl: string;
    /**
     * Optional art for the outside, shown while the public page is shut. The
     * cover art stands in when blank.
     */
    outerCoverImageUrl: string;
    /**
     * Days of membership its passports grant, copied onto each at generation.
     */
    termDays: number;
}

/**
 * One scanned sticker, resolved for anyone, keyed by the printed code, never by
 * uid. The owner's uid is only for linking to their profile; `isOwner` is
 * decided server-side. Mirrors getPassportPublicProfile in
 * functions/src/functions/passports.ts.
 */
export type PassportPublicProfile =
    | {status: 'invalid'}
    | {status: 'private'}
    | {status: 'unclaimed'; designId: string}
    | {
    status: 'claimed';
    designId: string;
    claimedAt: string | null;
    isOwner: boolean;
    hidden: boolean;
    owner: {
        /** For the link to their profile, which still requires signing in. */
        uid: string;
        displayName: string;
        photoURL: string;
        joinedAt: string | null;
        group: string;
        title: string;
        titleCn: string;
    };
};

const toPassport = (docSnap: {id: string; data: () => Record<string, any>}): Passport => {
    const data = docSnap.data();
    return {
        id: docSnap.id,
        designId: data.designId ?? '',
        year: typeof data.year === 'number' ? data.year : 0,
        status: data.status === 'claimed' ? 'claimed' : 'unclaimed',
        ownerUid: typeof data.ownerUid === 'string' ? data.ownerUid : null,
        claimedAt: toDate(data.claimedAt),
        termDays: typeof data.termDays === 'number' ? data.termDays : 0,
        createdAt: toDate(data.createdAt),
        createdByName: data.createdByName ?? '',
        keyIssuedAt: toDate(data.keyIssuedAt),
        keyReissueCount: typeof data.keyReissueCount === 'number' ? data.keyReissueCount : 0,
        sentTo: typeof data.sentTo === 'string' ? data.sentTo : '',
        emailSentAt: toDate(data.emailSentAt),
        emailScheduled: data.emailScheduled === true,
    };
};

// A handful of public documents that rarely change; the public passport page
// reads them signed out.
const designCache = createCollectionCache<PassportDesign>('passportDesigns', docSnap => {
    const data = docSnap.data();
    return {
        id: docSnap.id,
        year: typeof data.year === 'number' ? data.year : 0,
        name: data.name ?? '',
        nameCn: data.nameCn ?? '',
        coverImageUrl: data.coverImageUrl ?? '',
        outerCoverImageUrl: data.outerCoverImageUrl ?? '',
        termDays: typeof data.termDays === 'number' ? data.termDays : 0,
    };
});

/** Newest year first, then by name within a year. */
export function usePassportDesigns(): {
    designs: PassportDesign[];
    loading: boolean;
    refresh: () => Promise<void>;
} {
    const {items, loading, refresh} = designCache.useItems();
    // Memoized: consumers use it in effect dependencies.
    const designs = useMemo(
        () => [...items].sort((a, b) => b.year - a.year || a.name.localeCompare(b.name)),
        [items],
    );
    return {designs, loading, refresh};
}

export const passportStatusLabel = (status: PassportStatus, isEnglish: boolean): string => {
    if (status === 'claimed') return isEnglish ? 'Claimed' : '已激活';
    return isEnglish ? 'Unclaimed' : '未激活';
};

/** A passport's name, its design's. Blank while designs load. */
export const passportName = (design: PassportDesign | undefined, isEnglish: boolean): string =>
    !design ? '' : isEnglish ? design.name : (design.nameCn || design.name);

/** Date and time as the admin passport screens show it, with the caller's blank. */
export const passportDateTime = (date: Date | null, isEnglish: boolean, blank: string): string =>
    date
        ? date.toLocaleString(isEnglish ? 'en-US' : 'zh-CN', {
            year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
        })
        : blank;

/** The URL encoded on the sticker, and the only address a passport ever has. */
export const passportScanUrl = (id: string, origin: string): string =>
    `${origin}/p/${encodeURIComponent(id)}`;

/**
 * Every passport from one design, newest first, for the admin dashboard.
 * Filtered and counted client-side: hundreds of docs, and one equality filter
 * needs no composite index.
 */
export async function fetchPassportsByDesign(designId: string): Promise<Passport[]> {
    const snap = await getDocs(query(collection(getFirebaseDb(), 'passports'), where('designId', '==', designId)));
    return snap.docs.map(toPassport).sort((a, b) => (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0));
}

/** One passport by its printed code. Null when there is no such passport. */
export async function fetchPassport(id: string): Promise<Passport | null> {
    const snap = await getDoc(doc(getFirebaseDb(), 'passports', normalizePassportCode(id)));
    return snap.exists() ? toPassport(snap) : null;
}

/**
 * Everything one account owns. The rules only let users read their own
 * passports through this exact filter.
 */
export async function fetchPassportsByOwner(uid: string): Promise<Passport[]> {
    const snap = await getDocs(query(collection(getFirebaseDb(), 'passports'), where('ownerUid', '==', uid)));
    return snap.docs.map(toPassport).sort((a, b) =>
        b.year - a.year || (b.claimedAt?.getTime() ?? 0) - (a.claimedAt?.getTime() ?? 0));
}

// Typed by hand, so dashes, spaces and case are folded away. Mirrors
// normalizeCode in functions/src/utils/passports.ts.
export const normalizePassportCode = (raw: string): string =>
    raw.replace(/[\s-]+/g, '').toUpperCase();

export const PASSPORT_ID_LENGTH = 10;
/**
 * Mirrors MAX_GENERATE_COUNT in functions/src/utils/passports.ts, which
 * enforces it.
 */
export const MAX_PASSPORT_GENERATE = 200;
/** What a new design's term starts at. */
export const DEFAULT_PASSPORT_TERM_DAYS = 365;
/**
 * Mirrors MAX_DELETE_COUNT in functions/src/utils/passports.ts, which enforces
 * it.
 */
export const MAX_PASSPORT_DELETE = 200;
/**
 * Mirrors MAX_EMAIL_COUNT in functions/src/utils/passports.ts, which enforces
 * it: the addresses one emailPassports call takes.
 */
export const MAX_PASSPORT_EMAIL = 100;
/**
 * Mirrors MAX_KEY_EXPORT_COUNT in functions/src/utils/passports.ts, which
 * enforces it.
 */
export const MAX_PASSPORT_KEY_EXPORT = 500;
/** Mirrors MAX_GRANT_DAYS in functions/src/utils/membership.ts, which enforces it. */
export const MAX_PASSPORT_TERM_DAYS = 3650;
/** Ambiguous glyphs (O/0, I/1/L) are absent by construction — see CODE_ALPHABET. */
const CODE_CHAR = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]*$/;

export const isPassportCodeShape = (raw: string, length: number): boolean => {
    const code = normalizePassportCode(raw);
    return code.length === length && CODE_CHAR.test(code);
};
