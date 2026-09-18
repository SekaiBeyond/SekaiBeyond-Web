import { useMemo } from 'react';
import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore';
import { createCollectionCache, toDate } from './collectionCache';
import { getFirebaseDb } from './firebase';
import { fetchScans, type ScanHistory } from './scans';

export type PassportStatus = 'unclaimed' | 'claimed' | 'void';

/**
 * A physical passport. The document id is the public code printed on the
 * sticker, so it is also the URL: /p/<id>.
 *
 * Binding is permanent — `ownerUid` and `claimedAt` are written once, by the
 * claim, and never cleared. There is no unbind and no rebind, which is what lets
 * the scan URL be treated as a stable address for a person.
 */
export interface Passport {
    id: string;
    designId: string;
    /** The design's year, copied at generation — a design's year never changes. */
    year: number;
    status: PassportStatus;
    ownerUid: string | null;
    claimedAt: Date | null;
    /** Days of membership this passport grants on claim (365 at generation). */
    termDays: number;
    batchId: string;
    createdAt: Date | null;
    createdByName: string;
    /** When the current activation key was minted — bumped by a key reissue. */
    keyIssuedAt: Date | null;
    keyReissueCount: number;
    failedAttempts: number;
    lockedUntil: Date | null;
    scanCount: number;
    lastScanAt: Date | null;
}

/**
 * What a batch of passports is printed from: the name they go by and their cover
 * art. A year can have several designs, and no two in the same year share a name
 * in either language.
 */
export interface PassportDesign {
    id: string;
    /** Set on creation and fixed after. */
    year: number;
    name: string;
    /** Optional; the English name stands in when it's blank. */
    nameCn: string;
    coverImageUrl: string;
    /** Optional art for the outside of the passport — what the public page shows
     * while it is shut, before the cover flips open. The cover art above stands
     * in when this is blank, which is what every design did before there were
     * two of them. */
    outerCoverImageUrl: string;
    /** Days of membership its passports grant. Copied onto each passport at
     * generation, so an edit only reaches batches generated afterwards. */
    termDays: number;
}

/**
 * One scanned sticker, resolved for anyone — the only unauthenticated read of a
 * member's public data. It is keyed by the printed passport code, never by uid.
 * The owner's uid comes back only to link to their profile; `isOwner` is decided
 * server-side.
 *
 * Mirrors what getPassportPublicProfile returns in
 * functions/src/functions/passports.ts.
 */
export type PassportPublicProfile =
    | {status: 'invalid'}
    | {status: 'private'}
    | {status: 'unclaimed'; designId: string; termDays: number}
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

/** An entry in a passport's permanent audit trail. */
export interface PassportClaimEvent {
    id: string;
    action: 'claim' | 'void' | 'key-reissue' | 'key-view';
    uid: string | null;
    at: Date | null;
    performedBy: string;
    performedByName: string;
    daysGranted: number | null;
}

const toPassport = (docSnap: {id: string; data: () => Record<string, any>}): Passport => {
    const data = docSnap.data();
    const status = data.status;
    return {
        id: docSnap.id,
        designId: data.designId ?? '',
        year: typeof data.year === 'number' ? data.year : 0,
        status: (status === 'claimed' || status === 'void') ? status : 'unclaimed',
        ownerUid: typeof data.ownerUid === 'string' ? data.ownerUid : null,
        claimedAt: toDate(data.claimedAt),
        termDays: typeof data.termDays === 'number' ? data.termDays : 0,
        batchId: data.batchId ?? '',
        createdAt: toDate(data.createdAt),
        createdByName: data.createdByName ?? '',
        keyIssuedAt: toDate(data.keyIssuedAt),
        keyReissueCount: typeof data.keyReissueCount === 'number' ? data.keyReissueCount : 0,
        failedAttempts: typeof data.failedAttempts === 'number' ? data.failedAttempts : 0,
        lockedUntil: toDate(data.lockedUntil),
        scanCount: typeof data.scanCount === 'number' ? data.scanCount : 0,
        lastScanAt: toDate(data.lastScanAt),
    };
};

// Designs are a handful of documents that change a few times a year, and they
// are publicly readable — the public passport page reads them straight from here
// while signed out.
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
    // Memoized so the array keeps its identity between renders: consumers put it
    // in effect dependencies, and a fresh copy each render would re-run them.
    const designs = useMemo(
        () => [...items].sort((a, b) => b.year - a.year || a.name.localeCompare(b.name)),
        [items],
    );
    return {designs, loading, refresh};
}

export const passportStatusLabel = (status: PassportStatus, isEnglish: boolean): string => {
    if (status === 'claimed') return isEnglish ? 'Claimed' : '已激活';
    if (status === 'void') return isEnglish ? 'Void' : '已作废';
    return isEnglish ? 'Unclaimed' : '未激活';
};

/** What a passport is called, on the shelf and on its page: its design's name.
 * Blank while the designs are still loading. */
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
 * All passports generated from one design, for the admin dashboard. Filtering
 * and per-batch counts are done on the result: a design is hundreds of
 * documents, and equality on one field needs no composite index.
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
 * Everything one account owns. Rules let a signed-in user read their own
 * passports only through this exact filter, so the ownerUid clause is load
 * bearing rather than an optimization.
 */
export async function fetchPassportsByOwner(uid: string): Promise<Passport[]> {
    const snap = await getDocs(query(collection(getFirebaseDb(), 'passports'), where('ownerUid', '==', uid)));
    return snap.docs.map(toPassport).sort((a, b) =>
        b.year - a.year || (b.claimedAt?.getTime() ?? 0) - (a.claimedAt?.getTime() ?? 0));
}

/** The bind/void/key trail for one passport (newest first). Core-staff+. */
export async function fetchPassportClaims(id: string): Promise<PassportClaimEvent[]> {
    const snap = await getDocs(collection(getFirebaseDb(), 'passports', id, 'claims'));
    return snap.docs
        .map(d => {
            const data = d.data();
            const action = data.action;
            return {
                id: d.id,
                action: (action === 'void' || action === 'key-reissue' || action === 'key-view')
                    ? action
                    : 'claim' as const,
                uid: typeof data.uid === 'string' ? data.uid : null,
                at: toDate(data.at),
                performedBy: data.performedBy ?? '',
                performedByName: data.performedByName ?? '',
                daysGranted: typeof data.daysGranted === 'number' ? data.daysGranted : null,
            };
        })
        .sort((a, b) => (b.at?.getTime() ?? 0) - (a.at?.getTime() ?? 0));
}

/** Scan history for one passport — backs the same trend chart the QR codes use. */
export const fetchPassportScans = (id: string): Promise<ScanHistory> => fetchScans('passports', id);

// Printed codes are read back by hand, so the dashes we print for legibility,
// stray spaces, and lowercase are all folded away before the code is used.
// Mirrors normalizeCode in functions/src/utils/passports.ts.
export const normalizePassportCode = (raw: string): string =>
    raw.replace(/[\s-]+/g, '').toUpperCase();

export const PASSPORT_ID_LENGTH = 10;
export const ACTIVATION_KEY_LENGTH = 12;
/** Mirrors MAX_BATCH_COUNT in functions/src/utils/passports.ts, which enforces it. */
export const MAX_PASSPORT_BATCH = 200;
/** What a new design's term starts at. */
export const DEFAULT_PASSPORT_TERM_DAYS = 365;
/** Mirrors MAX_GRANT_DAYS in functions/src/utils/membership.ts, which enforces it. */
export const MAX_PASSPORT_TERM_DAYS = 3650;
/** Ambiguous glyphs (O/0, I/1/L) are absent by construction — see CODE_ALPHABET. */
const CODE_CHAR = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]*$/;

export const isPassportCodeShape = (raw: string, length: number): boolean => {
    const code = normalizePassportCode(raw);
    return code.length === length && CODE_CHAR.test(code);
};
