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
import { isGarage, type UwLot, type UwParkingData, type WalkingTime } from '~/lib/uwParking';
import { hasCoordinates, haversineMiles, type Venue } from '~/lib/venues';
import type { Localized } from '~/pages/convention/i18n';

export interface GuideEvent {
    id: string;
    title: Localized;
    venueId: string;
    start: string;
    end: string;
}

export interface LotView {
    lot: UwLot;
    status: LotStatus;
    rates: Rate[];
    suggested: boolean;
    note: Localized | null;
    walk: WalkingTime | null;
    miles: number | null;
    sortSeconds: number;
}

export type LotFilter = 'free' | 'ada' | 'ev' | 'moto' | 'garage';
const LOT_FILTERS: LotFilter[] = ['free', 'ada', 'ev', 'moto', 'garage'];

export const offeredFilters = (views: LotView[]): LotFilter[] =>
    LOT_FILTERS.filter(f => f !== 'free' || views.some(v => v.status.kind === 'free'));

const toLocal = (value: string) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value) ? value.slice(0, 16) : '';

export interface EventDay {
    key: string;
    event: GuideEvent;
    window: ParkingWindow;
}

const MAX_EVENT_DAYS = 7;

const nextDate = (date: string) => {
    const [y, m, d] = date.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
};

export function eventDays(event: GuideEvent, today: string): EventDay[] {
    const start = toLocal(event.start), end = toLocal(event.end);
    if (!start) return [];
    const first = start.slice(0, 10), from = clockMinutes(start.slice(11));
    const day = (date: string, s: number, e: number): EventDay =>
        ({key: `${event.id}/${date}`, event, window: {date, start: s, end: e, isNow: false}});
    if (end <= start) return first < today ? [] : [day(first, from, Math.min(from + 1, DAY_MINUTES))];

    const last = end.slice(0, 10), until = clockMinutes(end.slice(11));
    const days: EventDay[] = [];
    for (let date = first; date <= last && days.length < MAX_EVENT_DAYS; date = nextDate(date)) {
        const s = date === first ? from : 0, e = date === last ? until : DAY_MINUTES;
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

export function nowWindow(now: Date): ParkingWindow {
    const local = toDatetimeLocal(now);
    const start = clockMinutes(local.slice(11, 16));
    return {date: siteDay(now), start, end: start + 1, isNow: true};
}

const DETOUR = 1.3;
const WALK_METERS_PER_SECOND = 1.39;
const METERS_PER_MILE = 1609.34;

const sortSecondsFor = (walk: WalkingTime | null, miles: number | null) =>
    walk?.seconds ?? (miles === null ? Infinity : miles * METERS_PER_MILE * DETOUR / WALK_METERS_PER_SECOND);

function venueWalking(parking: UwParkingData, venue: Venue): Record<string, WalkingTime> | null {
    const walking = parking.walking[venue.id];
    return walking && walking.lat === venue.lat && walking.lng === venue.lng ? walking.lots : null;
}

export function lotViews(parking: UwParkingData, venue: Venue | null, window: ParkingWindow): LotView[] {
    const walking = venue && venueWalking(parking, venue);
    const from = venue && hasCoordinates(venue.lat, venue.lng) ? venue : null;
    const suggestions = new Map((venue?.suggestedLots ?? []).map(s => [s.code, s] as const));
    return parking.lots.map(lot => {
        const suggested = suggestions.get(lot.code);
        const walk = walking?.[lot.code] ?? null;
        const miles = from ? haversineMiles(from.lat, from.lng, lot.lat, lot.lng) : null;
        const status = lotStatus(lot, window, parking.eventPricing);
        return {
            lot,
            status,
            rates: status.kind === 'event' ? [] : ratesDuring(lot, status.dow, window.start, window.end),
            suggested: !!suggested,
            note: suggested && (suggested.noteEn || suggested.noteCn) ? {
                en: suggested.noteEn,
                zh: suggested.noteCn
            } : null,
            walk,
            miles,
            sortSeconds: sortSecondsFor(walk, miles),
        };
    }).sort((a, b) => a.sortSeconds - b.sortSeconds || a.lot.code.localeCompare(b.lot.code));
}

export function nearestSuggestion(parking: UwParkingData, venue: Venue): {
    code: string;
    walk: WalkingTime | null
} | null {
    const walking = venueWalking(parking, venue);
    const from = hasCoordinates(venue.lat, venue.lng) ? venue : null;
    const suggested = new Set(venue.suggestedLots.map(s => s.code));
    let nearest: {code: string; walk: WalkingTime | null; seconds: number} | null = null;
    for (const lot of parking.lots) {
        if (!suggested.has(lot.code)) continue;
        const walk = walking?.[lot.code] ?? null;
        const seconds = sortSecondsFor(walk, from && haversineMiles(from.lat, from.lng, lot.lat, lot.lng));
        if (!nearest || seconds < nearest.seconds) nearest = {code: lot.code, walk, seconds};
    }
    return nearest && {code: nearest.code, walk: nearest.walk};
}

export function matchesFilters(view: LotView, query: string, filters: ReadonlySet<LotFilter>): boolean {
    const q = query.trim().toLowerCase();
    const {lot} = view;
    if (q && !lot.code.toLowerCase().includes(q) && !lot.name.toLowerCase().includes(q)) return false;
    if (filters.has('free') && view.status.kind !== 'free') return false;
    if (filters.has('ada') && accessibleStalls(lot) === 0) return false;
    if (filters.has('ev') && !(lot.stalls.ev && lot.stalls.ev > 0)) return false;
    if (filters.has('moto') && !(lot.stalls.motorcycle && lot.stalls.motorcycle > 0)) return false;
    if (filters.has('garage') && !isGarage(lot)) return false;
    return true;
}

export const accessibleStalls = (lot: UwLot): number => lot.stalls.accessible ?? 0;

export const UW_ACCESSIBLE_PARKING_URL = 'https://transportation.uw.edu/park/accessible';
export const DISABILITY_ONLY_LOT = 'N22';

export const lotSubtitle = (lot: UwLot, typeLabel: string) => lot.name !== lot.code ? lot.name : typeLabel;
