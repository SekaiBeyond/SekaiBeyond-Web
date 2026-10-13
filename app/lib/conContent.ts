import { useMemo } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { hasPermission, useAuth } from '~/components/AuthProvider';
import { createValueCache } from './collectionCache';
import { getFirebaseDb } from './firebase';
import { resolveVenueById, useVenues } from './venues';
import { isHallTable } from '~/pages/con/hall';
import type { Localized } from '~/pages/con/i18n';

/*
 * Everything on /con that admins edit in Admin → Con Content, and the few fixed
 * pieces of the page around it. The copy itself lives in Firestore: the editor
 * saves to the staff-only `conContent/draft`, which is mirrored whole to the public
 * `conContent/main` while the con is published.
 */

// Fixed in code

/**
 * Shown in the hero, the navbar logo, and the footer. Fixed in code because the
 * con's name does not change between editions.
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
    {id: 'vendors', label: {en: 'Artist Alley', zh: '创作者市集'}},
    {id: 'faq', label: {en: 'FAQ', zh: '常见问题'}},
];

/**
 * Chip colours a room can use. The palette is fixed in code because each value
 * is a CSS class (`sbc-accent--pink`); which room wears which colour is not.
 */
export const ROOM_ACCENTS = ['pink', 'violet', 'amber', 'sky', 'mint', 'slate'] as const;

export type RoomAccent = typeof ROOM_ACCENTS[number]

/**
 * The sections an admin can hide. Each value is both the section's anchor id
 * and its key in the editable content, so hiding one also leaves its copy out
 * of the public `conContent/main` mirror.
 */
export const HIDEABLE_SECTIONS = ['guests', 'vendors'] as const;

export type HideableSection = typeof HIDEABLE_SECTIONS[number]

// What each section holds

/** Page-level switches, kept apart from the copy they govern. */
export interface ConSettings {
    /**
     * When false, /con is visible to staff and above only; everyone else gets a
     * short "coming soon" card.
     *
     * Defaults to false, and publishing is what creates the public `conContent/main`
     * mirror in the first place. Nothing about a con is public until someone ticks
     * the box in Admin → Con Content, which is the only reading under which the
     * switch is worth anything: the alternative — public by default, hidden by an
     * explicit flag — leaves the unannounced line-up readable to anyone who asks
     * the database directly.
     */
    published: boolean
    /**
     * Sections taken off the page, its navbar and its footer. Kept in
     * HIDEABLE_SECTIONS order so the editor's dirty check, which compares JSON,
     * does not see a reordering as a change.
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
 * The hero backdrop: a short silent loop uploaded in Admin → Con Content → Hero
 * Video. With none uploaded, or for a reduced-motion visitor, the hero is a gradient.
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
     * Omitted together when the slot is announced but unscheduled — the page
     * lists it under the grid as "time to be confirmed" rather than hiding it.
     */
    start?: string
    end?: string
    /**
     * A `Room.id`, and absent on a slot with no time. A con books the room and the
     * hour in one go, so an item waiting on the hour is waiting on the room too —
     * and a room guessed at now is one the page would show as settled. The grid has
     * a column per room, so an id matching none of them falls out of it; the server
     * refuses to store one either way.
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
     * Whether the callout shows at all, ticked in Admin → Con Content → Artist
     * Alley. Off unless explicitly turned on: a recruiting call left up after the
     * tables are taken reads as an offer the con can't keep.
     */
    visible: boolean
    heading: Localized
    body: Localized
    label: Localized
}

/**
 * A cheaper price that holds until `endsAt`, a zoneless `YYYY-MM-DDTHH:MM` read
 * on the Pacific clock like the event's own date. After it passes, the page
 * shows the tier's regular `price` on its own.
 */
export interface EarlyBird {
    price: number
    endsAt: string
}

export interface TicketTier {
    id: string
    name: Localized
    /**
     * The regular price in US dollars — what the tier costs once any early bird
     * has ended. A number, not copy: `formatPrice` renders it per language, and 0
     * reads as "Free".
     */
    price: number
    earlyBird?: EarlyBird
    note: Localized
    perks: Localized[]
    featured?: boolean
}

/**
 * What buying a ticket online adds on top of its price, per paid ticket: a share
 * of the price plus a flat amount, the shape most payment processors charge in.
 * Either can be 0, and both at 0 means no fee line on the cards at all.
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
 * Tickets sold in person before the con, which skip the online transaction fee.
 * The page shows the block while any session is still to come, and drops each
 * session once it ends.
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
 * The admin-editable half of the con page. Each key is one Save button in the
 * admin panel's Con Content tab, and is stored under that name in the draft and
 * its public mirror.
 */
export interface ConContent {
    settings: ConSettings;
    event: ConEvent;
    heroVideo: ConHeroVideo;
    rooms: Room[];
    schedule: ScheduleItem[];
    guests: Guest[];
    vendors: {tables: Vendor[]; cta: VendorCta};
    tickets: TicketTier[];
    ticketFee: TicketFee;
    inPersonSales: InPersonSales;
    faq: FaqEntry[];
}

export type ConContentSection = keyof ConContent;

const BLANK: Localized = {en: '', zh: ''};

/**
 * What a section reads as until it is first saved in admin, and what the staff
 * preview falls back to when the read fails. /con waits for the fetch, so a
 * visitor never sees these on the way in.
 *
 * Blank on purpose: this file ships in the public bundle whatever the publish
 * switch says, so a line-up, a price or a vendor written here would be public
 * before the con is.
 */
export const DEFAULT_CON_CONTENT: ConContent = {
    settings: {published: false, hiddenSections: []},
    event: {edition: 2026, tagline: BLANK, intro: BLANK, date: '', endTime: '', venueId: '', ticketUrl: ''},
    heroVideo: {webm: ''},
    rooms: [],
    schedule: [],
    guests: [],
    vendors: {tables: [], cta: {visible: false, heading: BLANK, body: BLANK, label: BLANK}},
    tickets: [],
    ticketFee: {percent: 0, flat: 0},
    inPersonSales: {location: BLANK, note: BLANK, sessions: []},
    faq: [],
};

/**
 * `saveConContent` validates everything on the way in, so a well-formed document
 * is the normal case. These readers exist for the abnormal one — a half-written
 * doc, or a field this build predates — where the alternative is the whole con
 * page crashing on a missing `.en`.
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
    // Only an explicit `true` publishes. A missing or malformed field means "never
    // configured", and an unconfigured con is not one anybody has agreed to show.
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

/**
 * Optional — a con with no clip uploaded yet stores an empty string, and the hero
 * shows its gradient.
 */
const readHeroVideo = (raw: unknown): ConHeroVideo => ({webm: str(obj(raw).webm)});

const readScheduleItem = (item: Record<string, unknown>): ScheduleItem => ({
    // Absent times mean "TBA", which the page renders — so they stay undefined
    // rather than collapsing to '' and reading as a real, empty time.
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

const readVendors = (raw: unknown): ConContent['vendors'] => {
    const v = obj(raw);
    const cta = obj(v.cta);
    const seen = new Set<string>();
    return {
        // `tables` replaced a plain `list` with no table numbers. A document still
        // holding only that has nothing the floor plan could place, so it reads
        // like a section never saved. A table the plan no longer has — or listed
        // twice — would have nowhere to be drawn, and the editor nowhere to show
        // it, so it is left out here rather than kept invisibly.
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
            // Only an explicit true shows it, as with `published`: a callout saved
            // before the switch existed stays off rather than reappearing.
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
    // A deadline is what makes it an early bird. Without one there is nothing
    // to say about when the price changes, so the tier reads as regular-priced.
    return endsAt ? {price: nonNegative(e.price), endsAt} : undefined;
};

const readTickets = (raw: unknown): TicketTier[] =>
    list(raw, tier => ({
        id: str(tier.id),
        name: loc(tier.name),
        price: nonNegative(tier.price),
        // Always present, even when undefined, so the key sits in the same place
        // as in the editor's draft — its dirty check compares JSON strings.
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
    vendors: readVendors(data.vendors),
    tickets: readTickets(data.tickets),
    ticketFee: readTicketFee(data.ticketFee),
    inPersonSales: readInPersonSales(data.inPersonSales),
    faq: readFaq(data.faq),
});

/**
 * The public mirror. `conContent/main` is written only while the con is published
 * and deleted when it is not, so its mere existence is the publish switch — an
 * unannounced line-up is absent from the public document rather than present in it
 * behind a flag the client is trusted to honour.
 */
const publicCache = createValueCache<ConContent>('con content', async () => {
    const db = getFirebaseDb();
    const snap = await getDoc(doc(db, 'conContent', 'main'));
    const data = snap.data();
    if (!data) return DEFAULT_CON_CONTENT;
    return {...readSections(data), settings: {...readSettings(data.settings), published: true}};
}, DEFAULT_CON_CONTENT);

/**
 * The editable draft, readable by staff only. This is what the admin panel shows
 * and what staff preview on /con before publishing.
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
     * True when `content` is the shipped fallback because the read failed, rather
     * than because nothing is stored yet. Both callers need the distinction: the
     * page must not treat "could not read the publish switch" as "published", and
     * the editor must not seed a form from defaults it would then save over the
     * real document. A refresh that fails on top of an already-loaded document
     * does not set this — that is a stale form, not a missing one.
     */
    failed: boolean;
    refresh: () => Promise<void>;
}

/**
 * What /con should render for the current viewer: the published mirror for the
 * public, the unpublished draft for staff so they can preview before the page
 * goes live. Resolving it here rather than at the page level keeps every
 * section component on one call and stops half the page rendering one source
 * while half renders the other.
 */
export function useConContent(): ConContentRead {
    const {profile, loading: authLoading} = useAuth();
    const canPreview = !!profile && hasPermission(profile.group, 'staff');

    // Only one of the two is ever fetched. The draft is staff-only, so asking for
    // it as an anonymous visitor would just produce a permission error.
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
 * Where the con is, looked up from the venue picked in the event details. Null
 * when none is picked or the picked venue has since been deleted from Locations.
 */
export function useConVenue(): ConVenue | null {
    const {venueId} = useConContent().content.event;
    const venue = resolveVenueById(venueId, useVenues().venues);
    if (!venue) return null;
    return {
        name: {en: venue.nameEn, zh: venue.nameCn || venue.nameEn},
        parkingUrl: `/parking?venue=${encodeURIComponent(venue.id)}`,
    };
}

/**
 * The navbar and footer links, less any section an admin has hidden — a link to
 * an anchor that is not on the page would scroll nowhere. Memoised because the
 * navbar hands the ids to an IntersectionObserver that rebuilds on every new array.
 */
export function useConNavLinks(): NavLink[] {
    const {hiddenSections} = useConContent().content.settings;
    return useMemo(
        () => NAV_LINKS.filter(link => !(hiddenSections as readonly string[]).includes(link.id)),
        [hiddenSections],
    );
}

/**
 * The editable draft, for the admin panel. Always the draft: going through
 * `useConContent` would tie the editor to who /con lets preview, and anyone
 * left out would be handed the public mirror to edit.
 */
export function useConDraft(): ConContentRead {
    const {value: content, loading, error, refresh} = draftCache.useValue();
    return {content, loading, failed: error !== null, refresh};
}

/**
 * Re-fetches and hands back the stored draft. The admin editor saves, then
 * re-seeds its form from this, so the fields show what the server actually kept
 * (trimmed copy, dropped blank perks, generated ids) instead of the draft it sent.
 *
 * The public mirror is refreshed alongside it, but only if something is already
 * subscribed to it — a save must not be reported as failed just because nobody
 * was looking at the published copy.
 */
export const refreshConContent = async (): Promise<ConContent> => {
    const [draft] = await Promise.all([
        draftCache.refresh(),
        publicCache.peek() === null ? Promise.resolve(null) : publicCache.refresh().catch(() => null),
    ]);
    return draft;
};
