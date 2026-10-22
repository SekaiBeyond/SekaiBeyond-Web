import { doc, getDoc } from 'firebase/firestore';
import { hasPermission, useAuth } from '~/components/AuthProvider';
import { createValueCache } from './collectionCache';
import { getFirebaseDb } from './firebase';
import { toDatetimeLocal } from './siteTime';
import { useAllUpcomingEvents, useUpcomingEvents } from './upcomingEvents';
import { resolveVenueById, useVenues } from './venues';
import { isHallTable } from '~/pages/con/hall';
import type { Localized } from '~/pages/con/i18n';

/* Admin-editable /con content: saved to staff-only `conContent/draft` and mirrored
   to public `conContent/main` while published. */

export const CON_NAME: Localized = {en: 'Sekai Beyond Con', zh: '彼世界动漫游戏展'};

export interface NavLink {
    id: string
    label: Localized
}

export const CON_NAV_LINKS: NavLink[] = [
    {id: 'tickets', label: {en: 'Tickets', zh: '门票'}},
    {id: 'about', label: {en: 'About', zh: '关于漫展'}},
    {id: 'schedule', label: {en: 'Schedule', zh: '活动日程'}},
    {id: 'lineup', label: {en: 'Share Card', zh: '分享卡'}},
    {id: 'cafe', label: {en: 'Maid Café', zh: '女仆咖啡'}},
    {id: 'vendors', label: {en: 'Artist Alley', zh: '创作者市集'}},
    {id: 'faq', label: {en: 'FAQ', zh: '常见问题'}},
];

/** Chip colours a room can use (`sbc-accent--pink`, etc.). */
export const ROOM_ACCENTS = ['pink', 'violet', 'amber', 'sky', 'mint', 'slate'] as const;

export type RoomAccent = typeof ROOM_ACCENTS[number]

interface ConSettings {
    published: boolean
}

interface ConEvent {
    tagline: Localized
    intro: Localized
    /** Linked `upcomingEvents` doc id providing hours, venue, and ticket URL. */
    upcomingEventId: string
}

interface ConHeroVideo {
    webm: string;
}

export interface Room {
    id: string
    name: Localized
    accent: RoomAccent
}

export interface ScheduleItem {
    /** Omitted for announced slots whose time is still TBA. */
    start?: string
    end?: string
    room?: string
    title: Localized
}

export interface Maid {
    name: string
    poster: string
}

export interface MaidCafe {
    theme: Localized
    intro: Localized
    location: Localized
    start: string
    end: string
    poster: string
    maids: Maid[]
}

export interface Vendor {
    /** Table code from `HALL_TABLES` (e.g. "A1"). */
    table: string
    name: string
    link?: string
}

interface VendorCta {
    visible: boolean
    heading: Localized
    body: Localized
    label: Localized
}

/** Discounted price valid until `endsAt` (`YYYY-MM-DDTHH:MM` on the Pacific clock). */
export interface EarlyBird {
    price: number
    endsAt: string
}

export interface TicketTier {
    id: string
    name: Localized
    price: number
    earlyBird?: EarlyBird
    note: Localized
    perks: Localized[]
    featured?: boolean
}

export interface TicketFee {
    percent: number
    flat: number
}

export interface InPersonSession {
    /** YYYY-MM-DD */
    date: string
    /** HH:MM */
    start: string
    end: string
}

export interface InPersonSales {
    location: Localized
    note: Localized
    sessions: InPersonSession[]
}

interface FaqEntry {
    q: Localized
    a: Localized
}

export interface ConContent {
    settings: ConSettings;
    event: ConEvent;
    heroVideo: ConHeroVideo;
    rooms: Room[];
    schedule: ScheduleItem[];
    cafe: MaidCafe;
    vendors: {tables: Vendor[]; cta: VendorCta};
    tickets: TicketTier[];
    ticketFee: TicketFee;
    inPersonSales: InPersonSales;
    faq: FaqEntry[];
}

export type ConContentSection = keyof ConContent;

const BLANK: Localized = {en: '', zh: ''};

/**
 * What a section reads as until first saved, and the staff preview's fallback
 * when the read fails. Blank on purpose: this file ships in the public bundle,
 * so anything written here would be public before the con is.
 */
const DEFAULT_CON_CONTENT: ConContent = {
    settings: {published: false},
    event: {tagline: BLANK, intro: BLANK, upcomingEventId: ''},
    heroVideo: {webm: ''},
    rooms: [],
    schedule: [],
    cafe: {theme: BLANK, intro: BLANK, location: BLANK, start: '', end: '', poster: '', maids: []},
    vendors: {tables: [], cta: {visible: false, heading: BLANK, body: BLANK, label: BLANK}},
    tickets: [],
    ticketFee: {percent: 0, flat: 0},
    inPersonSales: {location: BLANK, note: BLANK, sessions: []},
    faq: [],
};

const loc = (raw: unknown): Localized => {
    if (!raw || typeof raw !== 'object') return BLANK;
    const {en, zh} = raw as Partial<Localized>;
    if (typeof en !== 'string' || typeof zh !== 'string') return BLANK;
    return {en, zh};
};

const str = (raw: unknown): string => (typeof raw === 'string' ? raw : '');

const optStr = (raw: unknown): string | undefined =>
    typeof raw === 'string' && raw.trim() !== '' ? raw : undefined;

const obj = (raw: unknown): Record<string, unknown> =>
    raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};

const list = <T>(raw: unknown, read: (item: Record<string, unknown>) => T): T[] => {
    if (!Array.isArray(raw)) return [];
    return raw.filter(item => !!item && typeof item === 'object').map(item => read(item as Record<string, unknown>));
};

const readAccent = (raw: unknown): RoomAccent =>
    typeof raw === 'string' && (ROOM_ACCENTS as readonly string[]).includes(raw)
        ? raw as RoomAccent
        : 'slate';

const readRooms = (raw: unknown): Room[] =>
    list(raw, room => ({
        id: str(room.id),
        name: loc(room.name),
        accent: readAccent(room.accent),
    }));

const readSettings = (raw: unknown): ConSettings => ({published: obj(raw).published === true});

const readEvent = (raw: unknown): ConEvent => {
    const e = obj(raw);
    return {
        tagline: loc(e.tagline),
        intro: loc(e.intro),
        upcomingEventId: str(e.upcomingEventId),
    };
};

const readHeroVideo = (raw: unknown): ConHeroVideo => ({webm: str(obj(raw).webm)});

const readScheduleItem = (item: Record<string, unknown>): ScheduleItem => ({
    start: optStr(item.start),
    end: optStr(item.end),
    room: optStr(item.room),
    title: loc(item.title),
});

const readSchedule = (raw: unknown): ScheduleItem[] => list(raw, readScheduleItem);

const readCafe = (raw: unknown): MaidCafe => {
    const c = obj(raw);
    return {
        theme: loc(c.theme),
        intro: loc(c.intro),
        location: loc(c.location),
        start: str(c.start),
        end: str(c.end),
        poster: str(c.poster),
        maids: list(c.maids, maid => ({name: str(maid.name), poster: str(maid.poster)})),
    };
};

const readVendors = (raw: unknown): ConContent['vendors'] => {
    const v = obj(raw);
    const cta = obj(v.cta);
    const seen = new Set<string>();
    return {
        tables: list(v.tables, vendor => ({
            table: str(vendor.table),
            name: str(vendor.name),
            link: optStr(vendor.link),
        })).filter(vendor => {
            if (!isHallTable(vendor.table) || seen.has(vendor.table)) return false;
            seen.add(vendor.table);
            return true;
        }),
        cta: {
            visible: cta.visible === true,
            heading: loc(cta.heading),
            body: loc(cta.body),
            label: loc(cta.label),
        },
    };
};

const nonNegative = (raw: unknown): number =>
    typeof raw === 'number' && Number.isFinite(raw) && raw >= 0 ? raw : 0;

const readEarlyBird = (raw: unknown): EarlyBird | undefined => {
    const e = obj(raw);
    const endsAt = optStr(e.endsAt);
    return endsAt ? {price: nonNegative(e.price), endsAt} : undefined;
};

const readTickets = (raw: unknown): TicketTier[] =>
    list(raw, tier => ({
        id: str(tier.id),
        name: loc(tier.name),
        price: nonNegative(tier.price),
        // Always present so key order matches the editor's draft for JSON dirty checks.
        earlyBird: readEarlyBird(tier.earlyBird),
        note: loc(tier.note),
        perks: Array.isArray(tier.perks) ? tier.perks.map(perk => loc(perk)) : [],
        featured: tier.featured === true,
    }));

const readTicketFee = (raw: unknown): TicketFee => {
    const f = obj(raw);
    return {percent: nonNegative(f.percent), flat: nonNegative(f.flat)};
};

const readInPersonSales = (raw: unknown): InPersonSales => {
    const s = obj(raw);
    return {
        location: loc(s.location),
        note: loc(s.note),
        sessions: list(s.sessions, session => ({
            date: str(session.date),
            start: str(session.start),
            end: str(session.end),
        })),
    };
};

const readFaq = (raw: unknown): FaqEntry[] =>
    list(raw, entry => ({q: loc(entry.q), a: loc(entry.a)}));

const readSections = (data: Record<string, unknown>): Omit<ConContent, 'settings'> => ({
    event: readEvent(data.event),
    heroVideo: readHeroVideo(data.heroVideo),
    rooms: readRooms(data.rooms),
    schedule: readSchedule(data.schedule),
    cafe: readCafe(data.cafe),
    vendors: readVendors(data.vendors),
    tickets: readTickets(data.tickets),
    ticketFee: readTicketFee(data.ticketFee),
    inPersonSales: readInPersonSales(data.inPersonSales),
    faq: readFaq(data.faq),
});

/** Exists only while the con is published. */
const publicCache = createValueCache<ConContent>('con content', async () => {
    const db = getFirebaseDb();
    const snap = await getDoc(doc(db, 'conContent', 'main'));
    const data = snap.data();
    if (!data) return DEFAULT_CON_CONTENT;
    return {...readSections(data), settings: {published: true}};
}, DEFAULT_CON_CONTENT);

const draftCache = createValueCache<ConContent>('con content draft', async () => {
    const db = getFirebaseDb();
    const snap = await getDoc(doc(db, 'conContent', 'draft'));

    const data = snap.data();
    if (!data) return DEFAULT_CON_CONTENT;
    return {...readSections(data), settings: readSettings(data.settings)};
}, DEFAULT_CON_CONTENT);

interface ConContentRead {
    content: ConContent;
    loading: boolean;
    /** True when the initial read failed, so callers don't treat fallback defaults as real data. */
    failed: boolean;
}

/** Reads the public mirror for visitors and the draft for staff preview. */
export function useConContent(): ConContentRead {
    const {profile, loading: authLoading} = useAuth();
    const canPreview = !!profile && hasPermission(profile.group, 'staff');

    const pub = publicCache.useValue(!authLoading && !canPreview);
    const draft = draftCache.useValue(!authLoading && canPreview);
    const chosen = canPreview ? draft : pub;

    return {
        content: chosen.value,
        loading: authLoading || chosen.loading,
        failed: chosen.error !== null,
    };
}

interface ConListing {
    /** Pacific-clock `YYYY-MM-DDTHH:MM` without zone suffix. */
    date: string;
    endTime: string;
    venueId: string;
    ticketUrl: string;
}

const NO_LISTING: ConListing = {date: '', endTime: '', venueId: '', ticketUrl: ''};

export function useConListing(): {listing: ConListing; loading: boolean} {
    const {profile, loading: authLoading} = useAuth();
    const canPreview = !!profile && hasPermission(profile.group, 'staff');
    const {content, loading: contentLoading} = useConContent();
    const published = useUpcomingEvents(!authLoading && !canPreview);
    const all = useAllUpcomingEvents(!authLoading && canPreview);
    const events = canPreview ? all : published;

    const {upcomingEventId} = content.event;
    const event = upcomingEventId ? events.upcomingEvents.find(e => e.id === upcomingEventId) : undefined;
    return {
        listing: event ? {
            date: toDatetimeLocal(event.startAt),
            endTime: toDatetimeLocal(event.endAt),
            venueId: event.venueId,
            ticketUrl: event.buyTicket,
        } : NO_LISTING,
        loading: contentLoading || events.loading,
    };
}

interface ConVenue {
    name: Localized;
    parkingUrl: string;
}

export function useConVenue(): ConVenue | null {
    const {upcomingEventId} = useConContent().content.event;
    const venue = resolveVenueById(useConListing().listing.venueId, useVenues().venues);
    if (!venue) return null;
    return {
        name: {en: venue.nameEn, zh: venue.nameCn || venue.nameEn},
        parkingUrl: `/parking/event/${encodeURIComponent(upcomingEventId)}`,
    };
}

export function useConDraft(): ConContentRead {
    const {value: content, loading, error} = draftCache.useValue();
    return {content, loading, failed: error !== null};
}

/**
 * Re-fetches and returns the stored draft so the editor re-seeds from server-normalized
 * values; refreshes the public mirror too if subscribed.
 */
export const refreshConContent = async (): Promise<ConContent> => {
    const [draft] = await Promise.all([
        draftCache.refresh(),
        publicCache.peek() === null ? Promise.resolve(null) : publicCache.refresh().catch(() => null),
    ]);
    return draft;
};
