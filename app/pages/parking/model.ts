import {
    clockMinutes,
    DAY_MINUTES,
    type LotStatus,
    lotStatus,
    type ParkingWindow,
    type Rate,
    ratesDuring
} from '~/lib/parkingStatus';
import { siteDay, toDatetimeLocal } from '~/lib/siteTime';
import type { UpcomingEvent } from '~/lib/upcomingEvents';
import type { UwLot, UwParkingData, WalkingTime } from '~/lib/uwParking';
import { hasCoordinates, haversineMiles, type Venue } from '~/lib/venues';
import type { Localized } from '~/pages/con/i18n';

/** An event the guide can show parking for: an upcoming event, or the con. */
export interface GuideEvent {
    /** The upcoming event's id, or 'con'. */
    id: string;
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
    /** Right now, or during the event's hours on the day shown, on an event's guide. */
    status: LotStatus;
    /** What a visitor pays then: none when it's free, permits only or event-priced. */
    rates: Rate[];
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

/** One day of an event, which its guide can be switched to. */
export interface EventDay {
    /** Stays the same as the events load and the clock moves on. */
    key: string;
    event: GuideEvent;
    /** The event's hours that day. */
    window: ParkingWindow;
}

// The most days one event offers, should its end be mistyped a year out.
const MAX_EVENT_DAYS = 7;

const nextDate = (date: string) => {
    const [y, m, d] = date.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
};

/**
 * The event's hours on each of its days from `today` on. An event running past
 * midnight has one per day: from its start until midnight, then from midnight
 * until its end.
 */
export function eventDays(event: GuideEvent, today: string): EventDay[] {
    const start = toLocal(event.start), end = toLocal(event.end);
    if (!start) return [];
    const first = start.slice(0, 10), from = clockMinutes(start.slice(11));
    const day = (date: string, s: number, e: number): EventDay =>
        ({key: `${event.id}/${date}`, event, window: {date, start: s, end: e, isNow: false}});
    // An event with no end, or one before its start, is judged at its first minute.
    if (end <= start) return first < today ? [] : [day(first, from, Math.min(from + 1, DAY_MINUTES))];

    const last = end.slice(0, 10), until = clockMinutes(end.slice(11));
    const days: EventDay[] = [];
    for (let date = first; date <= last && days.length < MAX_EVENT_DAYS; date = nextDate(date)) {
        const s = date === first ? from : 0, e = date === last ? until : DAY_MINUTES;
        // An event ending at midnight has nothing on the day it ends.
        if (e > s && date >= today) days.push(day(date, s, e));
    }
    return days;
}

export const fromUpcoming = (event: UpcomingEvent): GuideEvent => ({
    id: event.id,
    title: {en: event.title, zh: event.titleCn},
    venueId: event.venueId,
    start: toDatetimeLocal(event.startAt),
    end: toDatetimeLocal(event.endAt),
});

/** This minute on the site clock, which the guide shows unless it's an event's guide. */
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

/**
 * Every visitor lot as seen from `venue` during `window`, nearest on foot first.
 * Without a venue, none is suggested or has a distance, and they go by code.
 */
export function lotViews(parking: UwParkingData, venue: Venue | null, window: ParkingWindow): LotView[] {
    const walking = venue && venueWalking(parking, venue);
    const from = venue && hasCoordinates(venue.lat, venue.lng) ? venue : null;
    // Ranked among the suggestions UW still lists, so a dropped lot leaves no gap.
    const listed = new Set(parking.lots.map(l => l.code));
    const picks = venue?.suggestedLots.filter(s => listed.has(s.code)) ?? [];
    return parking.lots.map(lot => {
        const pick = picks.findIndex(s => s.code === lot.code);
        const suggested = pick >= 0 ? picks[pick] : null;
        const walk = walking?.[lot.code] ?? null;
        const miles = from ? haversineMiles(from.lat, from.lng, lot.lat, lot.lng) : null;
        const status = lotStatus(lot, window, parking.eventPricing);
        return {
            lot,
            status,
            // A moment's window is its one minute, so these are this minute's rates.
            rates: status.kind === 'event' ? [] : ratesDuring(lot, status.dow, window.start, window.end),
            rank: pick + 1,
            note: suggested && (suggested.noteEn || suggested.noteCn) ? {
                en: suggested.noteEn,
                zh: suggested.noteCn
            } : null,
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
