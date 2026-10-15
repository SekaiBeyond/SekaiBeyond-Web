import { useMemo } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { hasPermission, useAuth } from '~/components/AuthProvider';
import { createValueCache } from './collectionCache';
import { getFirebaseDb } from './firebase';
import { resolveVenueById, useVenues } from './venues';
import { isHallTable } from '~/pages/con/hall';
import type { Localized } from '~/pages/con/i18n';

/* Everything on /con that admins edit in Admin → Con Content, plus the page's fixed
   pieces. The editor saves to the staff-only `conContent/draft`, mirrored whole to
   the public `conContent/main` while the con is published. */

// Fixed in code

/**
 * Shown in the hero, the navbar logo and the footer; the same every edition.
 */
export const CON_NAME: Localized = {en: 'Sekai Beyond Con', zh: '彼世界动漫游戏展'};

export interface NavLink {
    id: string
    label: Localized
}

/** Each id is a section's anchor on the page, which an admin cannot add. */
const NAV_LINKS: NavLink[] = [
    {id: 'tickets', label: {en: 'Tickets', zh: '门票'}},
    {id: 'about', label: {en: 'About', zh: '关于漫展'}},
    {id: 'schedule', label: {en: 'Schedule', zh: '活动日程'}},
    {id: 'lineup', label: {en: 'Share Card', zh: '分享卡'}},
    {id: 'guests', label: {en: 'Guests', zh: '嘉宾'}},
    {id: 'cafe', label: {en: 'Maid Café', zh: '女仆咖啡'}},
    {id: 'vendors', label: {en: 'Artist Alley', zh: '创作者市集'}},
    {id: 'faq', label: {en: 'FAQ', zh: '常见问题'}},
];

/**
 * Chip colours a room can use. Fixed in code because each is a CSS class
 * (`sbc-accent--pink`).
 */
export const ROOM_ACCENTS = ['pink', 'violet', 'amber', 'sky', 'mint', 'slate'] as const;

export type RoomAccent = typeof ROOM_ACCENTS[number]

/**
 * The sections an admin can hide. Each is both an anchor id and a content key,
 * so hiding one also keeps its copy out of the public mirror.
 */
export const HIDEABLE_SECTIONS = ['guests', 'vendors'] as const;

export type HideableSection = typeof HIDEABLE_SECTIONS[number]

// What each section holds

/** Page-level switches, kept apart from the copy they govern. */
export interface ConSettings {
    /**
     * When false, /con is for staff and above only; everyone else gets a "coming
     * soon" card. Off by default, and publishing is what creates the public mirror,
     * so an unannounced line-up is never readable from the database.
     */
    published: boolean
    /**
     * Sections taken off the page, navbar and footer, in HIDEABLE_SECTIONS
     * order so the editor's JSON dirty check doesn't see a reordering as a
     * change.
     */
    hiddenSections: HideableSection[]
}

export interface ConEvent {
    edition: number
    tagline: Localized
    intro: Localized
    /** Pacific time, no zone suffix — read with parseSiteTime. */
    date: string
    endTime: string
    /** A document in `venues`, managed in Admin → Locations. */
    venueId: string
    ticketUrl: string
}

/**
 * The hero backdrop, a short silent loop. Without one, or for reduced motion, the
 * hero is a gradient.
 */
export interface ConHeroVideo {
    webm: string;
}

export interface Room {
    /** Stable slug referenced by `ScheduleItem.room`. */
    id: string
    name: Localized
    accent: RoomAccent
}

export interface ScheduleItem {
    /**
     * Both omitted for an announced but unscheduled slot, which the page lists
     * under the grid as "time to be confirmed".
     */
    start?: string
    end?: string
    /**
     * A `Room.id`, absent on a slot with no time: the room and the hour are booked
     * together. The server refuses an id matching no room.
     */
    room?: string
    title: Localized
}

export interface Guest {
    name: string
    role: Localized
    blurb: Localized
    /** Path under public/, e.g. '/guests/name.webp'. Falls back to an initial badge. */
    avatar?: string
    link?: string
}

/** One of the maids at the café, shown on the page as their poster. */
export interface Maid {
    name: string
    /** Blank until uploaded — a maid can be announced before their poster is drawn. */
    poster: string
}

/** The maid café, with a poster of its own and one per maid. */
export interface MaidCafe {
    /** This edition's theme, e.g. "Trick or Treat Tea Time". */
    theme: Localized
    intro: Localized
    /** Where in the venue, e.g. "HUB 214". */
    location: Localized
    /** HH:MM on the con's day, both or neither — blank until the hours are set. */
    start: string
    end: string
    /** The café's own poster. Blank until one is uploaded. */
    poster: string
    maids: Maid[]
}

/** Who is at a table on the main hall floor plan (con/hall.ts). */
export interface Vendor {
    /** A table on the floor plan, e.g. "A1" — one of HALL_TABLES. One vendor per table. */
    table: string
    /** As they asked to be listed; a shared table is one entry, "A & B". */
    name: string
    link?: string
}

export interface VendorCta {
    /**
     * Off unless turned on: a recruiting call left up after the tables are taken
     * would be an offer the con can't keep.
     */
    visible: boolean
    heading: Localized
    body: Localized
    label: Localized
}

/**
 * A cheaper price until `endsAt`, a zoneless `YYYY-MM-DDTHH:MM` on the Pacific
 * clock. After that the page shows the regular `price`.
 */
export interface EarlyBird {
    price: number
    endsAt: string
}

export interface TicketTier {
    id: string
    name: Localized
    /**
     * The regular price in US dollars. `formatPrice` renders it per language; 0
     * reads as "Free".
     */
    price: number
    earlyBird?: EarlyBird
    note: Localized
    perks: Localized[]
    featured?: boolean
}

/**
 * What buying online adds per paid ticket: a share of the price plus a flat
 * amount. Both at 0 means no fee line.
 */
export interface TicketFee {
    /** Percent of the ticket price, e.g. 2.9 for 2.9%. */
    percent: number
    /** US dollars. */
    flat: number
}

/** One day the in-person table is selling. Zoneless, read on the Pacific clock. */
export interface InPersonSession {
    /** YYYY-MM-DD */
    date: string
    /** HH:MM */
    start: string
    end: string
}

/**
 * Tickets sold in person before the con, without the online fee. Each session
 * drops off the page once it ends.
 */
export interface InPersonSales {
    location: Localized
    /** Optional — payment methods, where to find the table. */
    note: Localized
    sessions: InPersonSession[]
}

export interface FaqEntry {
    q: Localized
    a: Localized
}

/**
 * The admin-editable part of the con page. Each key is one Save button in Con
 * Content, stored under that name in the draft and the mirror.
 */
export interface ConContent {
    settings: ConSettings;
    event: ConEvent;
    heroVideo: ConHeroVideo;
    rooms: Room[];
    schedule: ScheduleItem[];
    guests: Guest[];
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
export const DEFAULT_CON_CONTENT: ConContent = {
    settings: {published: false, hiddenSections: []},
    event: {edition: 2026, tagline: BLANK, intro: BLANK, date: '', endTime: '', venueId: '', ticketUrl: ''},
    heroVideo: {webm: ''},
    rooms: [],
    schedule: [],
    guests: [],
    cafe: {theme: BLANK, intro: BLANK, location: BLANK, start: '', end: '', poster: '', maids: []},
    vendors: {tables: [], cta: {visible: false, heading: BLANK, body: BLANK, label: BLANK}},
    tickets: [],
    ticketFee: {percent: 0, flat: 0},
    inPersonSales: {location: BLANK, note: BLANK, sessions: []},
    faq: [],
};

/**
 * `saveConContent` validates everything, so these readers are for a half-written
 * doc or an unknown field, where the alternative is the page crashing on a
 * missing `.en`.
 */
const loc = (raw: unknown): Localized => {
    if (!raw || typeof raw !== 'object') return BLANK;
    const {en, zh} = raw as Partial<Localized>;
    if (typeof en !== 'string' || typeof zh !== 'string') return BLANK;
    return {en, zh};
};

const str = (raw: unknown): string => (typeof raw === 'string' ? raw : '');

/** Optional string fields are dropped when blank, so `guest.link &&` stays meaningful. */
const optStr = (raw: unknown): string | undefined =>
    typeof raw === 'string' && raw.trim() !== '' ? raw : undefined;

const obj = (raw: unknown): Record<string, unknown> =>
    raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};

/** Anything but an array reads as empty, the same as a section never saved. */
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

const readSettings = (raw: unknown): ConSettings => {
    // Only an explicit `true` publishes; anything else means nobody has agreed to
    // show it.
    const s = obj(raw);
    const hidden = Array.isArray(s.hiddenSections) ? s.hiddenSections : [];
    return {
        published: s.published === true,
        hiddenSections: HIDEABLE_SECTIONS.filter(section => hidden.includes(section)),
    };
};

const readEvent = (raw: unknown): ConEvent => {
    const e = obj(raw);
    return {
        edition: typeof e.edition === 'number' ? e.edition : DEFAULT_CON_CONTENT.event.edition,
        tagline: loc(e.tagline),
        intro: loc(e.intro),
        date: str(e.date),
        endTime: str(e.endTime),
        venueId: str(e.venueId),
        ticketUrl: str(e.ticketUrl),
    };
};

/** Empty when no clip is uploaded; the hero shows its gradient. */
const readHeroVideo = (raw: unknown): ConHeroVideo => ({webm: str(obj(raw).webm)});

const readScheduleItem = (item: Record<string, unknown>): ScheduleItem => ({
    // Absent times mean TBA, so they stay undefined rather than becoming ''.
    start: optStr(item.start),
    end: optStr(item.end),
    room: optStr(item.room),
    title: loc(item.title),
});

const readSchedule = (raw: unknown): ScheduleItem[] => list(raw, readScheduleItem);

const readGuests = (raw: unknown): Guest[] =>
    list(raw, guest => ({
        name: str(guest.name),
        role: loc(guest.role),
        blurb: loc(guest.blurb),
        avatar: optStr(guest.avatar),
        link: optStr(guest.link),
    }));

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
        // A table the plan doesn't have, or one listed twice, has nowhere to be
        // drawn, so it is dropped rather than kept invisibly.
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
            // Only an explicit true, as with `published`.
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
    // The deadline is what makes it an early bird; without one the tier is
    // regular-priced.
    return endsAt ? {price: nonNegative(e.price), endsAt} : undefined;
};

const readTickets = (raw: unknown): TicketTier[] =>
    list(raw, tier => ({
        id: str(tier.id),
        name: loc(tier.name),
        price: nonNegative(tier.price),
        // Always present, even undefined, so the key sits where the editor's
        // draft has it for the JSON dirty check.
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
    guests: readGuests(data.guests),
    cafe: readCafe(data.cafe),
    vendors: readVendors(data.vendors),
    tickets: readTickets(data.tickets),
    ticketFee: readTicketFee(data.ticketFee),
    inPersonSales: readInPersonSales(data.inPersonSales),
    faq: readFaq(data.faq),
});

/**
 * The public mirror. It exists only while the con is published, so its existence
 * is the publish switch.
 */
const publicCache = createValueCache<ConContent>('con content', async () => {
    const db = getFirebaseDb();
    const snap = await getDoc(doc(db, 'conContent', 'main'));
    const data = snap.data();
    if (!data) return DEFAULT_CON_CONTENT;
    return {...readSections(data), settings: {...readSettings(data.settings), published: true}};
}, DEFAULT_CON_CONTENT);

/**
 * The draft, staff only: what the admin panel edits and staff preview on /con.
 */
const draftCache = createValueCache<ConContent>('con content draft', async () => {
    const db = getFirebaseDb();
    const snap = await getDoc(doc(db, 'conContent', 'draft'));

    const data = snap.data();
    if (!data) return DEFAULT_CON_CONTENT;
    return {...readSections(data), settings: readSettings(data.settings)};
}, DEFAULT_CON_CONTENT);

export interface ConContentRead {
    content: ConContent;
    loading: boolean;
    /**
     * True when `content` is the fallback because the read failed, not because
     * nothing is stored: the page mustn't take an unreadable switch as
     * "published", and the editor mustn't save defaults over the real document. A
     * failed refresh over a loaded document doesn't set this.
     */
    failed: boolean;
    refresh: () => Promise<void>;
}

/**
 * What /con renders for this viewer: the mirror for the public, the draft for
 * staff to preview. Resolved here so no page renders half of each.
 */
export function useConContent(): ConContentRead {
    const {profile, loading: authLoading} = useAuth();
    const canPreview = !!profile && hasPermission(profile.group, 'staff');

    // Only one is fetched; asking for the staff-only draft anonymously would just
    // be denied.
    const pub = publicCache.useValue(!authLoading && !canPreview);
    const draft = draftCache.useValue(!authLoading && canPreview);
    const chosen = canPreview ? draft : pub;

    return {
        content: chosen.value,
        loading: authLoading || chosen.loading,
        failed: chosen.error !== null,
        refresh: chosen.refresh,
    };
}

export interface ConVenue {
    name: Localized;
    parkingUrl: string;
}

/**
 * Where the con is, from the venue in the event details. Null when none is
 * picked or it was deleted.
 */
export function useConVenue(): ConVenue | null {
    const {venueId} = useConContent().content.event;
    const venue = resolveVenueById(venueId, useVenues().venues);
    if (!venue) return null;
    return {
        name: {en: venue.nameEn, zh: venue.nameCn || venue.nameEn},
        parkingUrl: '/parking/event/con',
    };
}

/**
 * The navbar and footer links, less hidden sections, whose anchors aren't on the
 * page. Memoised because the navbar's IntersectionObserver rebuilds on every new
 * array.
 */
export function useConNavLinks(): NavLink[] {
    const {hiddenSections} = useConContent().content.settings;
    return useMemo(
        () => NAV_LINKS.filter(link => !(hiddenSections as readonly string[]).includes(link.id)),
        [hiddenSections],
    );
}

/**
 * The draft, for the admin panel. Always the draft: going through
 * `useConContent` would hand anyone who can't preview the public mirror to
 * edit.
 */
export function useConDraft(): ConContentRead {
    const {value: content, loading, error, refresh} = draftCache.useValue();
    return {content, loading, failed: error !== null, refresh};
}

/**
 * Re-fetches and returns the stored draft, so the editor re-seeds from what the
 * server kept (trimmed copy, generated ids) rather than what it sent. The public
 * mirror is refreshed too, but only if something subscribes to it, so a save isn't
 * reported failed over a copy nobody is viewing.
 */
export const refreshConContent = async (): Promise<ConContent> => {
    const [draft] = await Promise.all([
        draftCache.refresh(),
        publicCache.peek() === null ? Promise.resolve(null) : publicCache.refresh().catch(() => null),
    ]);
    return draft;
};
