import { createCollectionCache } from './collectionCache';

/** A UW lot the organizers suggest for a venue, by UW facility code, with an optional note. */
export interface SuggestedLot {
    code: string;
    noteEn: string;
    noteCn: string;
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
    const rawSuggested = Array.isArray(data.suggestedLots) ? data.suggestedLots : [];
    const suggestedLots: SuggestedLot[] = rawSuggested
        .map((s: any) => ({
            code: typeof s?.code === 'string' ? s.code : '',
            noteEn: typeof s?.noteEn === 'string' ? s.noteEn : '',
            noteCn: typeof s?.noteCn === 'string' ? s.noteCn : '',
        }))
        .filter((s: SuggestedLot) => s.code.length > 0);
    return {
        id: docSnap.id,
        nameEn: data.nameEn ?? '',
        nameCn: data.nameCn ?? '',
        lat: typeof data.lat === 'number' ? data.lat : 0,
        lng: typeof data.lng === 'number' ? data.lng : 0,
        buildingCode: typeof data.buildingCode === 'string' ? data.buildingCode : '',
        suggestedLots,
    };
});

export function useVenues(): {venues: Venue[]; loading: boolean; refresh: () => Promise<void>} {
    const {items, loading, refresh} = cache.useItems();
    return {venues: items, loading, refresh};
}

/** An event's `venueId` as its {@link Venue}, or null if unset or unknown. */
export function resolveVenueById(venueId: string | undefined, venues: Venue[]): Venue | null {
    if (!venueId) return null;
    return venues.find(v => v.id === venueId) ?? null;
}

/**
 * An event's location for display: its free-text location, else its venue's name, else ''.
 */
export function eventLocationDisplay(
    location: string | undefined,
    locationCn: string | undefined,
    venueId: string | undefined,
    venues: Venue[],
    isEnglish: boolean,
): string {
    const text = isEnglish ? (location ?? '') : (locationCn || location || '');
    if (text.trim()) return text;
    const venue = resolveVenueById(venueId, venues);
    if (!venue) return '';
    return isEnglish ? venue.nameEn : (venue.nameCn || venue.nameEn);
}
