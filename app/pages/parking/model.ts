import { clockMinutes, DAY_MINUTES, type LotStatus, lotStatus, type ParkingWindow } from '~/lib/parkingStatus';
import { siteDay, toDatetimeLocal } from '~/lib/siteTime';
import type { UwLot, UwParkingData, WalkingTime } from '~/lib/uwParking';
import { hasCoordinates, haversineMiles, type Venue } from '~/lib/venues';
import type { Localized } from '~/pages/con/i18n';

/** The event the guide was opened for: an upcoming event, or the con on a venue link. */
export interface GuideEvent {
    title: Localized;
    venueId: string;
    /** YYYY-MM-DDTHH:mm on the site clock. */
    start: string;
    /** YYYY-MM-DDTHH:mm on the site clock; may fall on a later day. */
    end: string;
}

/** One lot as the guide shows it from the selected venue. */
export interface LotView {
    lot: UwLot;
    status: LotStatus;
    /** Place among the venue's suggested lots, from 1; 0 when not suggested. */
    rank: number;
    /** The organizers' note on a suggested lot, if they left one. */
    note: Localized | null;
    walk: WalkingTime | null;
    /** Straight-line distance from the venue, for when there's no walking time. */
    miles: number | null;
    /** Seconds to sort by: the walking time, or one estimated from `miles`. */
    sortSeconds: number;
}

export type LotFilter = 'free' | 'ada' | 'ev' | 'moto' | 'garage';
export const LOT_FILTERS: LotFilter[] = ['free', 'ada', 'ev', 'moto', 'garage'];

const toLocal = (value: string) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value) ? value.slice(0, 16) : '';

/**
 * The stretch of the event's first day the status covers. An event running past
 * midnight is judged on its first day, from its start until midnight.
 */
export function eventWindow(event: GuideEvent): ParkingWindow | null {
    const start = toLocal(event.start), end = toLocal(event.end);
    if (!start) return null;
    const date = start.slice(0, 10);
    const from = clockMinutes(start.slice(11));
    const until = !end ? from : end.slice(0, 10) === date ? clockMinutes(end.slice(11)) : DAY_MINUTES;
    // An event with no end, or one before its start, is judged at its first minute.
    return {date, start: from, end: until > from ? until : Math.min(from + 1, DAY_MINUTES), isNow: false};
}

/** This minute on the site clock, for a guide opened without an event. */
export function nowWindow(now: Date): ParkingWindow {
    const local = toDatetimeLocal(now);
    const start = clockMinutes(local.slice(11, 16));
    return {date: siteDay(now), start, end: start + 1, isNow: true};
}

// Straight-line distance times this is a fair guess at the walk on a campus grid;
// 1.39 m/s is the router's walking pace, about 5 km/h.
const DETOUR = 1.3;
const WALK_METERS_PER_SECOND = 1.39;
const METERS_PER_MILE = 1609.34;

/** The venue's walking times, unless it has moved since they were measured. */
function venueWalking(parking: UwParkingData, venue: Venue): Record<string, WalkingTime> | null {
    const walking = parking.walking[venue.id];
    return walking && walking.lat === venue.lat && walking.lng === venue.lng ? walking.lots : null;
}

/** Every visitor lot as seen from `venue` during `window`, nearest on foot first. */
export function lotViews(parking: UwParkingData, venue: Venue, window: ParkingWindow): LotView[] {
    const walking = venueWalking(parking, venue);
    const located = hasCoordinates(venue.lat, venue.lng);
    // Ranked among the suggestions UW still lists, so a dropped lot leaves no gap.
    const listed = new Set(parking.lots.map(l => l.code));
    const picks = venue.suggestedLots.filter(s => listed.has(s.code));
    return parking.lots.map(lot => {
        const pick = picks.findIndex(s => s.code === lot.code);
        const suggested = pick >= 0 ? picks[pick] : null;
        const walk = walking?.[lot.code] ?? null;
        const miles = located ? haversineMiles(venue.lat, venue.lng, lot.lat, lot.lng) : null;
        return {
            lot,
            status: lotStatus(lot, window, parking.eventPricing),
            rank: pick + 1,
            note: suggested && (suggested.noteEn || suggested.noteCn) ? {en: suggested.noteEn, zh: suggested.noteCn} : null,
            walk,
            miles,
            sortSeconds: walk?.seconds
                ?? (miles === null ? Infinity : miles * METERS_PER_MILE * DETOUR / WALK_METERS_PER_SECOND),
        };
    }).sort((a, b) => a.sortSeconds - b.sortSeconds || a.lot.code.localeCompare(b.lot.code));
}

/** The first suggested lot UW still lists for a venue, with its walking time, for the venue switcher. */
export function firstSuggestion(parking: UwParkingData, venue: Venue): {code: string; walk: WalkingTime | null} | null {
    const code = venue.suggestedLots.find(s => parking.lots.some(l => l.code === s.code))?.code;
    if (!code) return null;
    return {code, walk: venueWalking(parking, venue)?.[code] ?? null};
}

export const isGarage = (lot: UwLot) => /Garage/.test(lot.type);

export function matchesFilters(view: LotView, query: string, filters: ReadonlySet<LotFilter>): boolean {
    const q = query.trim().toLowerCase();
    const {lot} = view;
    if (q && !lot.code.toLowerCase().includes(q) && !lot.name.toLowerCase().includes(q)) return false;
    if (filters.has('free') && view.status.kind !== 'free') return false;
    if (filters.has('ada') && !(lot.stalls.accessible && lot.stalls.accessible > 0)) return false;
    if (filters.has('ev') && !(lot.stalls.ev && lot.stalls.ev > 0)) return false;
    if (filters.has('moto') && !(lot.stalls.motorcycle && lot.stalls.motorcycle > 0)) return false;
    if (filters.has('garage') && !isGarage(lot)) return false;
    return true;
}

/** A lot's name when it has one beyond its code (garages do), else its type. */
export const lotSubtitle = (lot: UwLot, typeLabel: string) => lot.name !== lot.code ? lot.name : typeLabel;

export const localizedVenueName = (venue: Venue, isEnglish: boolean) =>
    isEnglish ? venue.nameEn : (venue.nameCn || venue.nameEn);
