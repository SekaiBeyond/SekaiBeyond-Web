import type { ClockRange, UwEventPricing, UwLot } from './uwParking';

/**
 * What parking at a UW lot is like over a stretch of one day: the status the
 * parking guide's pins, pills and filters show. Kept free of the page and of
 * language, so it can be checked on its own.
 *
 * UW lists two windows a day for each lot: when a permit is required, and when
 * a visitor can pay instead. Outside the permit window, parking is free; inside
 * it but outside the pay window, only permit holders can park. Sundays have
 * neither. A day on UW's event-parking calendar replaces both with a flat rate.
 * UW's holidays aren't in its data, so on one the guide may say pay when it's free.
 */

/** How a stretch of time is: free, pay to park, or permit holders only. */
export type Segment = 'free' | 'pay' | 'permit';

/** What a pin's color and a status pill say. */
export type StatusKind = 'free' | 'part' | 'paid' | 'permit' | 'event';

export interface Stretch {
    segment: Segment;
    /** Minutes since midnight on the site clock; end is at most 1440. */
    start: number;
    end: number;
}

export interface ParkingWindow {
    /** YYYY-MM-DD on the site clock. */
    date: string;
    /** Minutes since midnight on the site clock, start < end ≤ 1440. */
    start: number;
    end: number;
    /**
     * A moment rather than an event's hours, for a guide opened without one: the
     * status then describes `start` and what comes after it that day.
     */
    isNow: boolean;
}

export type StatusPhrase =
    | {key: 'event'; price: number}
    /** Pay around the clock. */
    | {key: 'allDay'}
    /** The same throughout: "Free during your event", "Permits only now". */
    | {key: 'only'; segment: Segment}
    /** Changes partway; names the first change: "Pay until 12 pm, then free". */
    | {key: 'change'; from: Segment; to: Segment; at: number};

export interface LotStatus {
    kind: StatusKind;
    phrase: StatusPhrase;
    isNow: boolean;
    /** The event-rate day that applies, when kind is 'event'. */
    pricing: UwEventPricing | null;
    /** 0 = Sunday … 6 = Saturday. */
    dow: number;
    /** The lot's whole day, midnight to midnight, for explaining the status. */
    day: Stretch[];
}

export const DAY_MINUTES = 24 * 60;

/** "HH:mm" as minutes since midnight. */
export const clockMinutes = (clock: string): number => {
    const [h, m] = clock.split(':').map(Number);
    return h * 60 + m;
};

/** Day of the week for a YYYY-MM-DD date, 0 = Sunday. */
export const dayOfWeek = (date: string): number => {
    const [y, m, d] = date.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
};

/**
 * A listed window in minutes. UW writes 24 hours as a start equal to its end
 * (00:00–00:00), and an end of 00:00 means midnight at the close of the day.
 */
export function windowMinutes(range: ClockRange | null | undefined): [number, number] | null {
    if (!range) return null;
    const start = clockMinutes(range.start);
    const end = clockMinutes(range.end);
    if (start === end) return [0, DAY_MINUTES];
    // A window past midnight counts until midnight; the guide looks at one day at a time.
    return [start, end > start ? end : DAY_MINUTES];
}

const within = (w: [number, number] | null, minute: number) => w !== null && minute >= w[0] && minute < w[1];

/** A lot's day as stretches from midnight to midnight, each free, pay or permit only. */
export function daySchedule(lot: UwLot, dow: number): Stretch[] {
    if (dow === 0) return [{segment: 'free', start: 0, end: DAY_MINUTES}];
    const pick = (hours: UwLot['paidHours'] | undefined) => hours && (dow === 6 ? hours.saturday : hours.weekday);
    const pay = windowMinutes(pick(lot.paidHours));
    // Lots synced before permit hours were kept have only paid hours; assume they match.
    const permit = lot.permitHours ? windowMinutes(pick(lot.permitHours)) : pay;

    const marks = [...new Set([0, DAY_MINUTES, ...(pay ?? []), ...(permit ?? [])])].sort((a, b) => a - b);
    const stretches: Stretch[] = [];
    for (let i = 0; i + 1 < marks.length; i++) {
        const [start, end] = [marks[i], marks[i + 1]];
        const segment: Segment = within(pay, start) ? 'pay' : within(permit, start) ? 'permit' : 'free';
        const last = stretches.at(-1);
        if (last?.segment === segment) last.end = end;
        else stretches.push({segment, start, end});
    }
    return stretches;
}

/** The part of a day's stretches between `start` and `end`. */
function clip(day: Stretch[], start: number, end: number): Stretch[] {
    return day
        .filter(s => s.end > start && s.start < end)
        .map(s => ({segment: s.segment, start: Math.max(s.start, start), end: Math.min(s.end, end)}));
}

/** The event-rate day covering this lot during the window, if there is one. */
export function eventPricingFor(lot: UwLot, window: ParkingWindow, pricing: UwEventPricing[]): UwEventPricing | null {
    return pricing.find(p => p.date === window.date
            && (p.allLots || p.lots.includes(lot.code))
            && (p.start === null || p.end === null
                || (clockMinutes(p.start) < window.end && (clockMinutes(p.end) || DAY_MINUTES) > window.start)))
        ?? null;
}

const KIND_OF: Record<Segment, StatusKind> = {free: 'free', pay: 'paid', permit: 'permit'};

/** What parking at `lot` is like during `window`. */
export function lotStatus(lot: UwLot, window: ParkingWindow, pricing: UwEventPricing[]): LotStatus {
    const dow = dayOfWeek(window.date);
    const day = daySchedule(lot, dow);
    const base = {isNow: window.isNow, dow, day};

    const event = eventPricingFor(lot, window, pricing);
    if (event) return {...base, kind: 'event', phrase: {key: 'event', price: event.price}, pricing: event};

    // A moment looks ahead to the rest of the day, so it can say when things change.
    const stretches = clip(day, window.start, window.isNow ? DAY_MINUTES : window.end);
    const [first, second] = stretches;
    const allDayPay = day.length === 1 && day[0].segment === 'pay';
    const status = (kind: StatusKind, phrase: StatusPhrase): LotStatus => ({...base, kind, phrase, pricing: null});

    if (allDayPay) return status('paid', {key: 'allDay'});
    if (!first) return status('free', {key: 'only', segment: 'free'});
    if (!second) return status(KIND_OF[first.segment], {key: 'only', segment: first.segment});

    const phrase: StatusPhrase = {key: 'change', from: first.segment, to: second.segment, at: first.end};
    // A moment is colored by how it is now; an event by how much of it costs or is closed.
    if (window.isNow) return status(KIND_OF[first.segment], phrase);
    return status(stretches.some(s => s.segment === 'pay') ? 'part' : 'permit', phrase);
}

/**
 * UW's visitor rates come in two periods (transportation.uw.edu/park/visitor):
 * the hourly and daily rates are for weekdays 6 am – 4 pm, and the night rate,
 * UW's "nights & weekends" rate, for weekdays 4 – 9 pm and Saturdays 7 am – noon.
 * Outside both (E01's paid hours run around the clock) no period says which applies.
 */
export const DAY_RATE_HOURS: [number, number] = [6 * 60, 16 * 60];
export const NIGHT_RATE_HOURS = {weekday: [16 * 60, 21 * 60], saturday: [7 * 60, 12 * 60]} as const;

export type RateUnit = 'hour' | 'day' | 'night';

export interface Rate {
    unit: RateUnit;
    amount: number;
}

/** Every rate UW lists for the lot: hourly, daily, then night. */
export function listedRates(lot: UwLot): Rate[] {
    const {hourly, daily, night} = lot.rates;
    const rates: Rate[] = [];
    if (hourly) rates.push({unit: 'hour', amount: hourly});
    if (daily) rates.push({unit: 'day', amount: daily});
    if (night) rates.push({unit: 'night', amount: night});
    return rates;
}

const overlaps = (a: number, b: number, [c, d]: readonly [number, number]) => a < d && b > c;

/**
 * The rates a visitor pays at the lot between `start` and `end` on day `dow`:
 * only for time the lot charges, and only those of the rate periods that time
 * falls in. When the lot lists no rate for those periods, it gets whatever it
 * does list, since UW's data is what the gate charges. Empty when nothing is
 * paid then (free, permits only, or a Sunday).
 */
export function ratesDuring(lot: UwLot, dow: number, start: number, end: number): Rate[] {
    const paid = daySchedule(lot, dow).filter(s => s.segment === 'pay' && s.end > start && s.start < end)
        .map(s => [Math.max(s.start, start), Math.min(s.end, end)] as [number, number]);
    if (paid.length === 0) return [];
    const weekday = dow >= 1 && dow <= 5;
    const dayPeriod = weekday && paid.some(([a, b]) => overlaps(a, b, DAY_RATE_HOURS));
    const nightHours = weekday ? NIGHT_RATE_HOURS.weekday : dow === 6 ? NIGHT_RATE_HOURS.saturday : null;
    const nightPeriod = nightHours !== null && paid.some(([a, b]) => overlaps(a, b, nightHours));
    const all = listedRates(lot);
    const inPeriod = all.filter(r => r.unit === 'night' ? nightPeriod : dayPeriod);
    return inPeriod.length > 0 ? inPeriod : all;
}

/** The rates a visitor can ever pay at the lot in a week, which leaves out any whose period the lot is never paid in. */
export function weeklyRates(lot: UwLot): Rate[] {
    const units = new Set([...ratesDuring(lot, 1, 0, DAY_MINUTES), ...ratesDuring(lot, 6, 0, DAY_MINUTES)].map(r => r.unit));
    return listedRates(lot).filter(r => units.has(r.unit));
}
