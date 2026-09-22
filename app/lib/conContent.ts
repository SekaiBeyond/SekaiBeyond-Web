import { doc, getDoc } from 'firebase/firestore';
import { hasPermission, useAuth } from '~/components/AuthProvider';
import { createValueCache } from './collectionCache';
import { getFirebaseDb } from './firebase';
import { hasCoordinates, resolveVenueById, useVenues } from './venues';
import {
    CON,
    CON_SETTINGS,
    type ConEvent,
    type ConHeroVideo,
    type ConSettings,
    type EarlyBird,
    FAQ,
    type FaqEntry,
    type Guest,
    GUESTS,
    HERO_VIDEO,
    IN_PERSON_SALES,
    type InPersonSales,
    type Room,
    ROOM_ACCENTS,
    type RoomAccent,
    ROOMS,
    SCHEDULE,
    type ScheduleItem,
    TICKET_FEE,
    type TicketFee,
    TICKETS,
    type TicketTier,
    type Vendor,
    VENDOR_CTA,
    type VendorCta,
    VENDORS,
} from '~/pages/con/content';
import type { Localized } from '~/pages/con/i18n';

/**
 * The admin-editable half of the con page. Each key mirrors one section of
 * `content.ts` and one Save button in the admin panel's Con Content tab, and is
 * stored under that name in `conContent/main`.
 */
export interface ConContent {
    settings: ConSettings;
    event: ConEvent;
    heroVideo: ConHeroVideo;
    rooms: Room[];
    schedule: ScheduleItem[];
    guests: Guest[];
    vendors: {list: Vendor[]; cta: VendorCta};
    tickets: TicketTier[];
    ticketFee: TicketFee;
    inPersonSales: InPersonSales;
    faq: FaqEntry[];
}

/** What visitors see before the fetch resolves, and for any section never edited. */
export const DEFAULT_CON_CONTENT: ConContent = {
    settings: CON_SETTINGS,
    event: CON,
    heroVideo: HERO_VIDEO,
    rooms: ROOMS,
    schedule: SCHEDULE,
    guests: GUESTS,
    vendors: {list: VENDORS, cta: VENDOR_CTA},
    tickets: TICKETS,
    ticketFee: TICKET_FEE,
    inPersonSales: IN_PERSON_SALES,
    faq: FAQ,
};

export type ConContentSection = keyof ConContent;

const BLANK: Localized = {en: '', zh: ''};

/**
 * `saveConContent` validates everything on the way in, so a well-formed document
 * is the normal case. These readers exist for the abnormal one — a half-written
 * doc, or a field this build predates — where the alternative is the whole con
 * page crashing on a missing `.en`.
 */
const loc = (raw: unknown, fallback: Localized = BLANK): Localized => {
    if (!raw || typeof raw !== 'object') return fallback;
    const {en, zh} = raw as Partial<Localized>;
    if (typeof en !== 'string' || typeof zh !== 'string') return fallback;
    return {en, zh};
};

const str = (raw: unknown, fallback = ''): string => (typeof raw === 'string' ? raw : fallback);

/** Optional string fields are dropped when blank, so `guest.link &&` stays meaningful. */
const optStr = (raw: unknown): string | undefined =>
    typeof raw === 'string' && raw.trim() !== '' ? raw : undefined;

const obj = (raw: unknown): Record<string, unknown> =>
    raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};

/**
 * A stored `[]` means "the admin emptied this section" and is honoured; a missing
 * or non-array value means "never set" and falls back to the shipped copy.
 */
const list = <T>(raw: unknown, fallback: T[], read: (item: Record<string, unknown>) => T): T[] => {
    if (!Array.isArray(raw)) return fallback;
    return raw.filter(item => !!item && typeof item === 'object').map(item => read(item as Record<string, unknown>));
};

const readAccent = (raw: unknown): RoomAccent =>
    typeof raw === 'string' && (ROOM_ACCENTS as readonly string[]).includes(raw)
        ? raw as RoomAccent
        : 'slate';

const readRooms = (raw: unknown): Room[] =>
    list(raw, ROOMS, room => ({
        id: str(room.id),
        name: loc(room.name),
        accent: readAccent(room.accent),
    }));

const readSettings = (raw: unknown): ConSettings => {
    // Only an explicit `true` publishes. A missing or malformed field means "never
    // configured", and an unconfigured con is not one anybody has agreed to show.
    const s = obj(raw);
    return {published: s.published === true};
};

const readEvent = (raw: unknown): ConEvent => {
    if (!raw || typeof raw !== 'object') return CON;
    const e = obj(raw);
    return {
        edition: typeof e.edition === 'number' ? e.edition : CON.edition,
        tagline: loc(e.tagline, CON.tagline),
        intro: loc(e.intro, CON.intro),
        date: str(e.date, CON.date),
        endTime: str(e.endTime, CON.endTime),
        venueId: str(e.venueId, CON.venueId),
        ticketUrl: str(e.ticketUrl, CON.ticketUrl),
    };
};

/**
 * Both fields are optional — a con with no clip uploaded yet stores two empty
 * strings, and the hero falls through to the Bilibili embed on its own.
 */
const readHeroVideo = (raw: unknown): ConHeroVideo => {
    if (!raw || typeof raw !== 'object') return HERO_VIDEO;
    const v = obj(raw);
    return {webm: str(v.webm), poster: str(v.poster)};
};

const readScheduleItem = (item: Record<string, unknown>): ScheduleItem => ({
    // Absent times mean "TBA", which the page renders — so they stay undefined
    // rather than collapsing to '' and reading as a real, empty time.
    start: optStr(item.start),
    end: optStr(item.end),
    room: optStr(item.room),
    title: loc(item.title),
    detail: item.detail ? loc(item.detail) : undefined,
});

const readSchedule = (raw: unknown): ScheduleItem[] => list(raw, SCHEDULE, readScheduleItem);

const readGuests = (raw: unknown): Guest[] =>
    list(raw, GUESTS, guest => ({
        name: str(guest.name),
        role: loc(guest.role),
        blurb: loc(guest.blurb),
        avatar: optStr(guest.avatar),
        link: optStr(guest.link),
    }));

const readVendors = (raw: unknown): ConContent['vendors'] => {
    if (!raw || typeof raw !== 'object') return DEFAULT_CON_CONTENT.vendors;
    const v = obj(raw);
    const cta = obj(v.cta);
    return {
        list: list(v.list, VENDORS, vendor => ({
            name: str(vendor.name),
            kind: loc(vendor.kind),
            handle: optStr(vendor.handle),
            link: optStr(vendor.link),
        })),
        cta: {
            heading: loc(cta.heading, VENDOR_CTA.heading),
            body: loc(cta.body, VENDOR_CTA.body),
            label: loc(cta.label, VENDOR_CTA.label),
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
    list(raw, TICKETS, tier => ({
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
    if (!raw || typeof raw !== 'object') return TICKET_FEE;
    const f = obj(raw);
    return {percent: nonNegative(f.percent), flat: nonNegative(f.flat)};
};

const readInPersonSales = (raw: unknown): InPersonSales => {
    if (!raw || typeof raw !== 'object') return IN_PERSON_SALES;
    const s = obj(raw);
    return {
        location: loc(s.location, IN_PERSON_SALES.location),
        note: loc(s.note),
        sessions: list(s.sessions, [], session => ({
            date: str(session.date),
            start: str(session.start),
            end: str(session.end),
        })),
    };
};

const readFaq = (raw: unknown): FaqEntry[] =>
    list(raw, FAQ, entry => ({q: loc(entry.q), a: loc(entry.a)}));

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
    return {...readSections(data), settings: {published: true}};
}, DEFAULT_CON_CONTENT);

/**
 * The editable draft, readable by staff only. This is what the admin panel shows
 * and what core staff preview on /con before publishing.
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
 * public, the unpublished draft for core staff so they can preview before the
 * page goes live. Resolving it here rather than at the page level keeps all nine
 * section components on one call and stops half the page rendering one source
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
    /** Empty when the venue has no coordinates to point a map at. */
    mapUrl: string;
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
        mapUrl: hasCoordinates(venue.lat, venue.lng)
            ? `https://www.google.com/maps/search/?api=1&query=${venue.lat},${venue.lng}`
            : '',
    };
}

/**
 * The editable draft, for the admin panel. Always the draft — plain `staff` can
 * open the Con Content tab read-only but cannot preview /con, so it cannot go
 * through `useConContent`.
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
