import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore';
import { createCollectionCache } from './collectionCache';
import { getFirebaseDb } from './firebase';
import { fetchScans, type ScanEvent } from './scans';

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

/** One year's design — the art and copy shown on the shelf and the public page. */
export interface PassportDesign {
    year: number;
    name: string;
    nameCn: string;
    description: string;
    descriptionCn: string;
    coverImageUrl: string;
}

/** An entry in a passport's permanent audit trail. */
export interface PassportClaimEvent {
    id: string;
    action: 'claim' | 'void' | 'key-reissue';
    uid: string | null;
    at: Date | null;
    performedBy: string;
    performedByName: string;
    daysGranted: number | null;
}

const toDate = (v: unknown): Date | null =>
    v && typeof (v as {toDate?: () => Date}).toDate === 'function'
        ? (v as {toDate: () => Date}).toDate()
        : null;

const toPassport = (docSnap: {id: string; data: () => Record<string, any>}): Passport => {
    const data = docSnap.data();
    const status = data.status;
    return {
        id: docSnap.id,
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

// Designs are a handful of documents that change once a year, and they are
// publicly readable — the public passport page reads them straight from here
// while signed out.
const designCache = createCollectionCache<PassportDesign>('passportDesigns', docSnap => {
    const data = docSnap.data();
    return {
        year: typeof data.year === 'number' ? data.year : Number(docSnap.id) || 0,
        name: data.name ?? '',
        nameCn: data.nameCn ?? '',
        description: data.description ?? '',
        descriptionCn: data.descriptionCn ?? '',
        coverImageUrl: data.coverImageUrl ?? '',
    };
});

export function usePassportDesigns(): {
    designs: PassportDesign[];
    loading: boolean;
    refresh: () => Promise<void>;
} {
    const {items, loading, refresh} = designCache.useItems();
    return {designs: [...items].sort((a, b) => b.year - a.year), loading, refresh};
}

export const passportStatusLabel = (status: PassportStatus, isEnglish: boolean): string => {
    if (status === 'claimed') return isEnglish ? 'Claimed' : '已激活';
    if (status === 'void') return isEnglish ? 'Void' : '已作废';
    return isEnglish ? 'Unclaimed' : '未激活';
};

export const designName = (design: PassportDesign | undefined, year: number, isEnglish: boolean): string => {
    if (!design) return isEnglish ? `${year} Passport` : `${year} 通行证`;
    return (isEnglish ? design.name : (design.nameCn || design.name)) || `${year}`;
};

/** The URL encoded on the sticker, and the only address a passport ever has. */
export const passportScanUrl = (id: string, origin: string): string =>
    `${origin}/p/${encodeURIComponent(id)}`;

/**
 * All passports of one year, for the admin dashboard. Filtering and per-batch
 * counts are done on the result: a year is hundreds of documents, and equality
 * on one field needs no composite index.
 */
export async function fetchPassportsByYear(year: number): Promise<Passport[]> {
    const snap = await getDocs(query(collection(getFirebaseDb(), 'passports'), where('year', '==', year)));
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

/** The bind/void/reissue trail for one passport (newest first). Core-staff+. */
export async function fetchPassportClaims(id: string): Promise<PassportClaimEvent[]> {
    const snap = await getDocs(collection(getFirebaseDb(), 'passports', id, 'claims'));
    return snap.docs
        .map(d => {
            const data = d.data();
            const action = data.action;
            return {
                id: d.id,
                action: (action === 'void' || action === 'key-reissue') ? action : 'claim' as const,
                uid: typeof data.uid === 'string' ? data.uid : null,
                at: toDate(data.at),
                performedBy: data.performedBy ?? '',
                performedByName: data.performedByName ?? '',
                daysGranted: typeof data.daysGranted === 'number' ? data.daysGranted : null,
            };
        })
        .sort((a, b) => (b.at?.getTime() ?? 0) - (a.at?.getTime() ?? 0));
}

/** Scan events for one passport — backs the same trend chart the QR codes use. */
export const fetchPassportScans = (id: string): Promise<ScanEvent[]> => fetchScans('passports', id);

// Printed codes are read back by hand, so the dashes we print for legibility,
// stray spaces, and lowercase are all folded away before the code is used.
// Mirrors normalizeCode in functions/src/utils/passports.ts.
export const normalizePassportCode = (raw: string): string =>
    raw.replace(/[\s-]+/g, '').toUpperCase();

export const PASSPORT_ID_LENGTH = 10;
export const ACTIVATION_KEY_LENGTH = 12;
/** Mirrors MAX_BATCH_COUNT in functions/src/utils/passports.ts, which enforces it. */
export const MAX_PASSPORT_BATCH = 200;
/** Ambiguous glyphs (O/0, I/1/L) are absent by construction — see CODE_ALPHABET. */
const CODE_CHAR = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]*$/;

export const isPassportCodeShape = (raw: string, length: number): boolean => {
    const code = normalizePassportCode(raw);
    return code.length === length && CODE_CHAR.test(code);
};
