import { createCollectionCache } from './collectionCache';
import { localized } from './localized';

export interface SuggestedLot {
    code: string;
    noteEn: string;
    noteCn: string;
}

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
    buildingCode: string;
    suggestedLots: SuggestedLot[];
    rooms: Room[];
}

export const UW_CAMPUS_CENTER = {lat: 47.6553, lng: -122.3035};
export const DEFAULT_ZOOM = 16;
export const PARKING_INFO_URL = 'https://transportation.uw.edu/park/visitor';

export function hasCoordinates(lat: number, lng: number): boolean {
    return Number.isFinite(lat) && Number.isFinite(lng) && !(lat === 0 && lng === 0);
}

export function haversineMiles(lat1: number, lng1: number, lat2: number, lng2: number): number {
    const toRad = (d: number) => (d * Math.PI) / 180;
    const R = 3958.8;
    const dLat = toRad(lat2 - lat1);
    const dLng = toRad(lng2 - lng1);
    const a = Math.sin(dLat / 2) ** 2
        + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(a));
}

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

export const localizedVenueName = (venue: Venue, isEnglish: boolean): string =>
    localized(isEnglish, venue.nameEn, venue.nameCn);

export function resolveVenueById(venueId: string | undefined, venues: Venue[]): Venue | null {
    if (!venueId) return null;
    return venues.find(v => v.id === venueId) ?? null;
}

interface EventLocationFields {
    location: string;
    locationCn: string;
    venueId: string;
    roomIds: string[];
}

export function venueLocationName(venue: Venue, roomIds: string[], isEnglish: boolean): string {
    const name = localizedVenueName(venue, isEnglish);
    const rooms = venue.rooms
        .filter(r => roomIds.includes(r.id))
        .map(r => localized(isEnglish, r.nameEn, r.nameCn));
    return rooms.length > 0 ? `${name} · ${rooms.join(isEnglish ? ', ' : '、')}` : name;
}

export function eventLocationDisplay(event: EventLocationFields, venues: Venue[], isEnglish: boolean): string {
    const venue = resolveVenueById(event.venueId, venues);
    if (venue) return venueLocationName(venue, event.roomIds, isEnglish);
    return localized(isEnglish, event.location, event.locationCn).trim();
}

export const readRoomIds = (raw: unknown): string[] =>
    Array.isArray(raw) ? raw.filter((id): id is string => typeof id === 'string') : [];
