import { useMemo } from 'react';
import { collection, doc, endAt, getDoc, getDocs, limit, orderBy, query, startAt, where } from 'firebase/firestore';
import { createCollectionCache, toDate } from './collectionCache';
import { getFirebaseDb } from './firebase';
import { localized } from './localized';

export type PassportStatus = 'unclaimed' | 'claimed';

export interface Passport {
    id: string;
    designId: string;
    year: number;
    status: PassportStatus;
    ownerUid: string | null;
    claimedAt: Date | null;
    termDays: number;
    createdAt: Date | null;
    createdByName: string;
    keyIssuedAt: Date | null;
    keyReissueCount: number;
    sentTo: string;
    emailSentAt: Date | null;
    emailScheduled: boolean;
    claimedEmail: string | null;
    note: string;
}

export type ShelfPassport = Pick<Passport, 'id' | 'designId' | 'year' | 'claimedAt'>;

export interface PassportDesign {
    id: string;
    year: number;
    name: string;
    nameCn: string;
    coverImageUrl: string;
    outerCoverImageUrl: string;
    termDays: number;
}

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

export function usePassportDesigns(): {
    designs: PassportDesign[];
    loading: boolean;
    refresh: () => Promise<void>;
} {
    const {items, loading, refresh} = designCache.useItems();
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

export const passportName = (design: PassportDesign | undefined, isEnglish: boolean): string =>
    !design ? '' : localized(isEnglish, design.name, design.nameCn);

export const passportDateTime = (date: Date | null, isEnglish: boolean, blank: string): string =>
    date
        ? date.toLocaleString(isEnglish ? 'en-US' : 'zh-CN', {
            year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
        })
        : blank;

export const passportScanUrl = (id: string, origin: string): string =>
    `${origin}/p/${encodeURIComponent(id)}`;

export function claimedElsewhere(passport: Passport, holderEmail: string | undefined): string | null {
    if (passport.status !== 'claimed' || !passport.sentTo) return null;
    const email = passport.claimedEmail ?? holderEmail;
    if (email === undefined) return null;
    return email.toLowerCase() === passport.sentTo.toLowerCase() ? null : email;
}

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

export async function fetchPassport(id: string): Promise<Passport | null> {
    const db = getFirebaseDb();
    const code = normalizePassportCode(id);
    const [snap, noteSnap] = await Promise.all([
        getDoc(doc(db, 'passports', code)),
        getDoc(doc(db, 'passportNotes', code)),
    ]);
    return snap.exists() ? {...toPassport(snap), note: noteOf(noteSnap.data())} : null;
}

export async function fetchPassportsByNote(text: string): Promise<Passport[]> {
    const needle = text.trim().toLowerCase();
    if (!needle) return [];
    const db = getFirebaseDb();
    const matches = (await getDocs(collection(db, 'passportNotes'))).docs
        .map(d => ({id: d.id, note: noteOf(d.data())}))
        .filter(({note}) => note.toLowerCase().includes(needle))
        .slice(0, PASSPORT_SEARCH_LIMIT);
    const snaps = await Promise.all(matches.map(({id}) => getDoc(doc(db, 'passports', id))));
    return snaps
        .flatMap((snap, i) => snap.exists() ? [{...toPassport(snap), note: matches[i].note}] : [])
        .sort((a, b) => (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0));
}

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

export async function fetchPassportsByOwner(uid: string): Promise<Passport[]> {
    const snap = await getDocs(query(collection(getFirebaseDb(), 'passports'), where('ownerUid', '==', uid)));
    return snap.docs.map(toPassport).sort((a, b) =>
        b.year - a.year || (b.claimedAt?.getTime() ?? 0) - (a.claimedAt?.getTime() ?? 0));
}

export const normalizePassportCode = (raw: string): string =>
    raw.replace(/[\s-]+/g, '').toUpperCase();

export const PASSPORT_ID_LENGTH = 10;
export const MAX_PASSPORT_GENERATE = 200;
export const DEFAULT_PASSPORT_TERM_DAYS = 365;
export const MAX_PASSPORT_DELETE = 200;
export const MAX_PASSPORT_EMAIL = 100;
export const MAX_PASSPORT_KEY_EXPORT = 500;
export const MAX_PASSPORT_TERM_DAYS = 3650;
export const PASSPORT_NOTE_MAX = 500;
const PASSPORT_SEARCH_LIMIT = 50;
const CODE_CHAR = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]*$/;

export const isPassportCodeShape = (raw: string, length: number): boolean => {
    const code = normalizePassportCode(raw);
    return code.length === length && CODE_CHAR.test(code);
};
