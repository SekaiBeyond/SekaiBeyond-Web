import type { ClockRange, UwEventPricing, UwLot } from './uwParking';

/**
 * What parking at a UW lot is like over a stretch of one day: the status behind the
 * guide's pins, pills and filters, kept free of the page and of language.
 *
 * UW lists two windows a day per lot: when a permit is required, and when a visitor
 * can pay instead. Outside the permit window parking is free; inside it but outside
 * the pay window, it's permits only. Sundays have neither, a window past midnight
 * carries into the next morning, and a day on UW's event-parking calendar replaces
 * both with a flat rate. UW's holidays aren't in its data, so on one the guide may
 * say pay when it's free.
 */

export type Segment = 'free' | 'pay' | 'permit';

type StatusKind = 'free' | 'part' | 'paid' | 'permit' | 'event';

interface Stretch {
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
    isNow: boolean;
}

type StatusPhrase =
    | {key: 'event'; price: number}
    | {key: 'allDay'}
    | {key: 'only'; segment: Segment}
    | {key: 'change'; from: Segment; to: Segment; at: number};

export interface LotStatus {
    kind: StatusKind;
    phrase: StatusPhrase;
    isNow: boolean;
    pricing: UwEventPricing | null;
    /** 0 = Sunday … 6 = Saturday. */
    dow: number;
    day: Stretch[];
}

export const DAY_MINUTES = 24 * 60;

export const clockMinutes = (clock: string): number => {
    const [h, m] = clock.split(':').map(Number);
    return h * 60 + m;
};

const dayOfWeek = (date: string): number => {
    const [y, m, d] = date.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
};

/**
 * UW writes 24 hours as 00:00–00:00, and an end of 00:00 is midnight closing the
 * day. Windows past midnight are clipped to `DAY_MINUTES`; `pastMidnight` returns
 * the carry-over into the next morning.
 */
function windowMinutes(range: ClockRange | null): [number, number] | null {
    if (!range) return null;
    const start = clockMinutes(range.start);
    const end = clockMinutes(range.end);
    if (start === end) return [0, DAY_MINUTES];
    return [start, end > start ? end : DAY_MINUTES];
}

function pastMidnight(range: ClockRange | null): [number, number] | null {
    if (!range) return null;
    const start = clockMinutes(range.start);
    const end = clockMinutes(range.end);
    return end > 0 && end < start ? [0, end] : null;
}

function minutesOn(hours: UwLot['paidHours'], dow: number): [number, number][] {
    const listed = (day: number) => day === 0 ? null : day === 6 ? hours.saturday : hours.weekday;
    return [windowMinutes(listed(dow)), pastMidnight(listed((dow + 6) % 7))].filter(w => w !== null);
}

const within = (ws: [number, number][], minute: number) => ws.some(w => minute >= w[0] && minute < w[1]);

export function daySchedule(lot: UwLot, dow: number): Stretch[] {
    const pay = minutesOn(lot.paidHours, dow);
    const permit = minutesOn(lot.permitHours, dow);

    const marks = [...new Set([0, DAY_MINUTES, ...pay.flat(), ...permit.flat()])].sort((a, b) => a - b);
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

function clip(day: Stretch[], start: number, end: number): Stretch[] {
    return day
        .filter(s => s.end > start && s.start < end)
        .map(s => ({segment: s.segment, start: Math.max(s.start, start), end: Math.min(s.end, end)}));
}

function eventPricingFor(lot: UwLot, window: ParkingWindow, pricing: UwEventPricing[]): UwEventPricing | null {
    const covers = (p: UwEventPricing) => {
        const w = p.start === null || p.end === null ? null : windowMinutes({start: p.start, end: p.end});
        return w === null || (w[0] < window.end && w[1] > window.start);
    };
    return pricing.find(p => p.date === window.date && (p.allLots || p.lots.includes(lot.code)) && covers(p)) ?? null;
}

const KIND_OF: Record<Segment, StatusKind> = {free: 'free', pay: 'paid', permit: 'permit'};

export function lotStatus(lot: UwLot, window: ParkingWindow, pricing: UwEventPricing[]): LotStatus {
    const dow = dayOfWeek(window.date);
    const day = daySchedule(lot, dow);
    const base = {isNow: window.isNow, dow, day};

    const event = eventPricingFor(lot, window, pricing);
    if (event) return {...base, kind: 'event', phrase: {key: 'event', price: event.price}, pricing: event};

    // For `isNow`, look ahead to midnight so the phrase can report the next transition.
    const stretches = clip(day, window.start, window.isNow ? DAY_MINUTES : window.end);
    const [first, second] = stretches;
    const allDayPay = day.length === 1 && day[0].segment === 'pay';
    const status = (kind: StatusKind, phrase: StatusPhrase): LotStatus => ({...base, kind, phrase, pricing: null});

    if (allDayPay) return status('paid', {key: 'allDay'});
    if (!first) return status('free', {key: 'only', segment: 'free'});
    if (!second) return status(KIND_OF[first.segment], {key: 'only', segment: first.segment});

    const phrase: StatusPhrase = {key: 'change', from: first.segment, to: second.segment, at: first.end};
    if (window.isNow) return status(KIND_OF[first.segment], phrase);
    return status(stretches.some(s => s.segment === 'pay') ? 'part' : 'permit', phrase);
}

/**
 * UW visitor rate windows (transportation.uw.edu/park/visitor):
 * hourly/daily apply weekdays 6 am – 4 pm; night applies weekdays 4 – 9 pm and Saturdays 7 am – noon.
 */
export const DAY_RATE_HOURS: [number, number] = [6 * 60, 16 * 60];
export const NIGHT_RATE_HOURS = {weekday: [16 * 60, 21 * 60], saturday: [7 * 60, 12 * 60]} as const;

type RateUnit = 'hour' | 'day' | 'night';

export interface Rate {
    unit: RateUnit;
    amount: number;
}

function listedRates(lot: UwLot): Rate[] {
    const {hourly, daily, night} = lot.rates;
    const rates: Rate[] = [];
    if (hourly) rates.push({unit: 'hour', amount: hourly});
    if (daily) rates.push({unit: 'day', amount: daily});
    if (night) rates.push({unit: 'night', amount: night});
    return rates;
}

const overlaps = (a: number, b: number, [c, d]: readonly [number, number]) => a < d && b > c;

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

export function weeklyRates(lot: UwLot): Rate[] {
    const units = new Set([...ratesDuring(lot, 1, 0, DAY_MINUTES), ...ratesDuring(lot, 6, 0, DAY_MINUTES)].map(r => r.unit));
    return listedRates(lot).filter(r => units.has(r.unit));
}
