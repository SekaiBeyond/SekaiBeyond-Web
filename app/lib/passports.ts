import { useMemo } from 'react';
import { collection, doc, endAt, getDoc, getDocs, limit, orderBy, query, startAt, where } from 'firebase/firestore';
import { createCollectionCache, toDate } from './collectionCache';
import { getFirebaseDb } from './firebase';
import { localized } from './localized';

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
    /**
     * The activating account's address, kept since the redeem warning; null
     * unclaimed or activated before. Compared with `sentTo` by claimedElsewhere.
     */
    claimedEmail: string | null;
    /**
     * Staff's note, such as why it was made; blank without one. Kept in
     * passportNotes, which only staff can read, so it's blank wherever the
     * holder reads their own passports.
     */
    note: string;
}

/** What a shelf card on /profile shows, all someone else's profile carries. */
export type ShelfPassport = Pick<Passport, 'id' | 'designId' | 'year' | 'claimedAt'>;

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
        claimedEmail: typeof data.claimedEmail === 'string' ? data.claimedEmail : null,
        note: '',
    };
};

const noteOf = (data: Record<string, any> | undefined): string =>
    typeof data?.note === 'string' ? data.note : '';

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
    !design ? '' : localized(isEnglish, design.name, design.nameCn);

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
 * For an emailed passport activated on an account with another address, that
 * address ("" for an account without one); null when it matches, when it isn't
 * emailed or activated, or until it's known. One activated before addresses
 * were kept goes by its holder's address now, `holderEmail`, undefined while
 * that loads.
 */
export function claimedElsewhere(passport: Passport, holderEmail: string | undefined): string | null {
    if (passport.status !== 'claimed' || !passport.sentTo) return null;
    const email = passport.claimedEmail ?? holderEmail;
    if (email === undefined) return null;
    return email.toLowerCase() === passport.sentTo.toLowerCase() ? null : email;
}

/**
 * Every passport from one design, with its note, newest first, for the admin
 * dashboard. Filtered and counted client-side: hundreds of docs, and one
 * equality filter needs no composite index. Staff only, for the notes.
 */
export async function fetchPassportsByDesign(designId: string): Promise<Passport[]> {
    const db = getFirebaseDb();
    const [snap, notes] = await Promise.all([
        getDocs(query(collection(db, 'passports'), where('designId', '==', designId))),
        getDocs(query(collection(db, 'passportNotes'), where('designId', '==', designId))),
    ]);
    const noteById = new Map(notes.docs.map(d => [d.id, noteOf(d.data())]));
    return snap.docs
        .map(d => ({...toPassport(d), note: noteById.get(d.id) ?? ''}))
        .sort((a, b) => (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0));
}

/**
 * One passport by its printed code, with its note. Null when there is no such
 * passport. Staff only, for the note.
 */
export async function fetchPassport(id: string): Promise<Passport | null> {
    const db = getFirebaseDb();
    const code = normalizePassportCode(id);
    const [snap, noteSnap] = await Promise.all([
        getDoc(doc(db, 'passports', code)),
        getDoc(doc(db, 'passportNotes', code)),
    ]);
    return snap.exists() ? {...toPassport(snap), note: noteOf(noteSnap.data())} : null;
}

/**
 * Emailed passports whose address starts with `prefix`, across designs, for the
 * admin search. Without notes: the search lists rows, not details.
 */
export async function fetchPassportsSentTo(prefix: string): Promise<Passport[]> {
    const start = prefix.trim().toLowerCase();
    if (!start) return [];
    const snap = await getDocs(query(
        collection(getFirebaseDb(), 'passports'),
        orderBy('sentTo'),
        startAt(start),
        endAt(start + ''),
        limit(PASSPORT_SEARCH_LIMIT),
    ));
    return snap.docs.map(toPassport);
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
/** Mirrors PASSPORT_NOTE_MAX in functions/src/utils/passports.ts, which enforces it. */
export const PASSPORT_NOTE_MAX = 500;
/** Emailed passports one address search lists. */
const PASSPORT_SEARCH_LIMIT = 50;
/** Ambiguous glyphs (O/0, I/1/L) are absent by construction — see CODE_ALPHABET. */
const CODE_CHAR = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]*$/;

export const isPassportCodeShape = (raw: string, length: number): boolean => {
    const code = normalizePassportCode(raw);
    return code.length === length && CODE_CHAR.test(code);
};
