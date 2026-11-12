import { createCollectionCache } from './collectionCache';
import { localized } from './localized';

/** A UW lot the organizers suggest for a venue, by UW facility code, with an optional note. */
export interface SuggestedLot {
    code: string;
    noteEn: string;
    noteCn: string;
}

/** A room in a venue, which an event can be held in, or several of. */
export interface Room {
    id: string;
    nameEn: string;
    nameCn: string;
}

export interface Venue {
    id: string;
    nameEn: string;
    nameCn: string;
    lat: number;
    lng: number;
    /** UW building code (e.g. "HUB"), or '' when not set. */
    buildingCode: string;
    /** UW lots the parking guide suggests for the venue, best first. */
    suggestedLots: SuggestedLot[];
    /** Its rooms, in the order events list them. */
    rooms: Room[];
}

// These are the values to change if the parking guide is ever used off the UW campus.
/** Default map center (UW campus center) when no venue-specific center is available. */
export const UW_CAMPUS_CENTER = {lat: 47.6553, lng: -122.3035};
/** A few blocks across. */
export const DEFAULT_ZOOM = 16;
/** External "more info" link shown on the parking guide. */
export const PARKING_INFO_URL = 'https://transportation.uw.edu/park/visitor';

/** Set only when both are finite and not the (0, 0) origin, the unset sentinel. */
export function hasCoordinates(lat: number, lng: number): boolean {
    return Number.isFinite(lat) && Number.isFinite(lng) && !(lat === 0 && lng === 0);
}

/** Great-circle (straight-line) distance between two lat/lng points, in miles. */
export function haversineMiles(lat1: number, lng1: number, lat2: number, lng2: number): number {
    const toRad = (d: number) => (d * Math.PI) / 180;
    const R = 3958.8; // Earth radius in miles
    const dLat = toRad(lat2 - lat1);
    const dLng = toRad(lng2 - lng1);
    const a = Math.sin(dLat / 2) ** 2
        + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(a));
}

/**
 * A straight-line distance for display. The "~" / "约" marks it as an estimate, not a
 * walking route; short distances switch to feet / metres.
 */
export function formatDistanceEstimate(miles: number, isEnglish: boolean): string {
    if (isEnglish) {
        if (miles < 0.1) {
            const ft = Math.max(50, Math.round((miles * 5280) / 50) * 50);
            return `~${ft} ft away`;
        }
        return `~${miles.toFixed(1)} mi away`;
    }
    const metres = miles * 1609.34;
    if (metres < 1000) {
        const m = Math.max(10, Math.round(metres / 10) * 10);
        return `约 ${m} 米`;
    }
    return `约 ${(metres / 1000).toFixed(1)} 公里`;
}

const cache = createCollectionCache<Venue>('venues', docSnap => {
    const data = docSnap.data();
    const rawSuggested: (Partial<Record<keyof SuggestedLot, unknown>> | null)[] =
        Array.isArray(data.suggestedLots) ? data.suggestedLots : [];
    const suggestedLots: SuggestedLot[] = rawSuggested
        .map(s => ({
            code: typeof s?.code === 'string' ? s.code : '',
            noteEn: typeof s?.noteEn === 'string' ? s.noteEn : '',
            noteCn: typeof s?.noteCn === 'string' ? s.noteCn : '',
        }))
        .filter(s => s.code.length > 0);
    const rawRooms: (Partial<Record<keyof Room, unknown>> | null)[] = Array.isArray(data.rooms) ? data.rooms : [];
    const rooms: Room[] = rawRooms
        .map(r => ({
            id: typeof r?.id === 'string' ? r.id : '',
            nameEn: typeof r?.nameEn === 'string' ? r.nameEn : '',
            nameCn: typeof r?.nameCn === 'string' ? r.nameCn : '',
        }))
        .filter(r => r.id.length > 0);
    return {
        id: docSnap.id,
        nameEn: data.nameEn ?? '',
        nameCn: data.nameCn ?? '',
        lat: typeof data.lat === 'number' ? data.lat : 0,
        lng: typeof data.lng === 'number' ? data.lng : 0,
        buildingCode: typeof data.buildingCode === 'string' ? data.buildingCode : '',
        suggestedLots,
        rooms,
    };
});

export function useVenues(): {venues: Venue[]; loading: boolean; refresh: () => Promise<void>} {
    const {items, loading, refresh} = cache.useItems();
    return {venues: items, loading, refresh};
}

/** A venue's name in the reader's language. */
export const localizedVenueName = (venue: Venue, isEnglish: boolean): string =>
    localized(isEnglish, venue.nameEn, venue.nameCn);

/** An event's `venueId` as its {@link Venue}, or null if unset or unknown. */
export function resolveVenueById(venueId: string | undefined, venues: Venue[]): Venue | null {
    if (!venueId) return null;
    return venues.find(v => v.id === venueId) ?? null;
}

/** The fields an event's location is made from, which upcoming and past events share. */
interface EventLocationFields {
    location: string;
    locationCn: string;
    venueId: string;
    /** Rooms of its venue it's in; none means the venue as a whole. */
    roomIds: string[];
}

/**
 * A venue's name and, if any, the rooms of it in `roomIds`, in the venue's order:
 * "Husky Union Building · 214, 250". Mirrors eventLocationText in
 * functions/src/utils/events.ts.
 */
export function venueLocationName(venue: Venue, roomIds: string[], isEnglish: boolean): string {
    const name = localizedVenueName(venue, isEnglish);
    const rooms = venue.rooms
        .filter(r => roomIds.includes(r.id))
        .map(r => localized(isEnglish, r.nameEn, r.nameCn));
    return rooms.length > 0 ? `${name} · ${rooms.join(isEnglish ? ', ' : '、')}` : name;
}

/**
 * An event's location for display: its venue's name and rooms, else its location
 * text, else ''. The text is never typed in: it's what a deleted venue showed
 * (deleteVenue), or a custom location from before venues set the location, kept
 * until the event gets a venue.
 */
export function eventLocationDisplay(event: EventLocationFields, venues: Venue[], isEnglish: boolean): string {
    const venue = resolveVenueById(event.venueId, venues);
    if (venue) return venueLocationName(venue, event.roomIds, isEnglish);
    return localized(isEnglish, event.location, event.locationCn).trim();
}

/** An event's `roomIds` as read from Firestore: [] when missing. */
export const readRoomIds = (raw: unknown): string[] =>
    Array.isArray(raw) ? raw.filter((id): id is string => typeof id === 'string') : [];
