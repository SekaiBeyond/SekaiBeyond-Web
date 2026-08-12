import { createCollectionCache } from './collectionCache';

export interface VenueLotLink {
    lotId: string;
}

export interface Venue {
    id: string;
    nameEn: string;
    nameCn: string;
    lat: number;
    lng: number;
    parkingLots: VenueLotLink[];
}

// These are the values to change if the parking guide is ever used off the UW campus.
/** Default map center (UW campus center) when no venue-specific center is available. */
export const UW_CAMPUS_CENTER = {lat: 47.6553, lng: -122.3035};
export const DEFAULT_ZOOM = 17;
/** External "more info" link shown on the parking guide. */
export const PARKING_INFO_URL = 'https://transportation.uw.edu/park/visitor';

/**
 * A lat/lng pair counts as "set" only when both are finite and not the (0, 0) origin,
 * which we use as the unset sentinel (the admin map picker never leaves a real lot there).
 */
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
 * Format a straight-line distance for display. The leading "~" / "约" signals this is an
 * as-the-crow-flies estimate, not a measured walking route. Very short distances switch to
 * feet (English) / metres (Chinese) so close lots don't all read the same.
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
    const rawLots = Array.isArray(data.parkingLots) ? data.parkingLots : [];
    const parkingLots: VenueLotLink[] = rawLots
        .map((link: any) => ({
            lotId: typeof link?.lotId === 'string' ? link.lotId : '',
        }))
        .filter((link: VenueLotLink) => link.lotId.length > 0);
    return {
        id: docSnap.id,
        nameEn: data.nameEn ?? '',
        nameCn: data.nameCn ?? '',
        lat: typeof data.lat === 'number' ? data.lat : 0,
        lng: typeof data.lng === 'number' ? data.lng : 0,
        parkingLots,
    };
});

export function useVenues(): {venues: Venue[]; loading: boolean; refresh: () => Promise<void>} {
    const {items, loading, refresh} = cache.useItems();
    return {venues: items, loading, refresh};
}

/**
 * Resolve an event's explicit `venueId` to its building {@link Venue}. Events carry a direct
 * reference to the building (chosen in the admin event editor) rather than matching on the
 * free-text location string. Returns null if unset or unknown.
 */
export function resolveVenueById(venueId: string | undefined, venues: Venue[]): Venue | null {
    if (!venueId) return null;
    return venues.find(v => v.id === venueId) ?? null;
}

/**
 * Display string for an event's location. The free-text location is optional; when it's empty
 * we fall back to the linked venue's (building) name so the event still shows where it is.
 * Returns an empty string only when neither a location nor a resolvable venue is set.
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
