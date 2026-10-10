import type { Timestamp } from "firebase-admin/firestore";

/**
 * The zone an event's calendar days are counted in — the one its ticket emails
 * print its time in. Mirrors app/lib/eventDays.ts, which words the same rule
 * for the scanner.
 */
const EVENT_TIME_ZONE = "America/Los_Angeles";

const DAY_FORMAT = new Intl.DateTimeFormat("en-US", {
    timeZone: EVENT_TIME_ZONE,
    year: "numeric", month: "2-digit", day: "2-digit",
});

/** The calendar day `ms` falls on in EVENT_TIME_ZONE, as YYYY-MM-DD, which sorts as it reads. */
function dayOf(ms: number): string {
    const parts = Object.fromEntries(DAY_FORMAT.formatToParts(ms).map(p => [p.type, p.value]));
    return `${parts.year}-${parts.month}-${parts.day}`;
}

/**
 * Whether `nowMs` falls on any calendar day the event runs on, from the start of
 * the day it begins to the end of the day it ends, whatever its hours. False
 * for an event missing either time.
 */
export function isOnEventDay(startAt: Timestamp | undefined, endAt: Timestamp | undefined, nowMs: number): boolean {
    const startMs = startAt?.toMillis?.();
    const endMs = endAt?.toMillis?.();
    if (startMs === undefined || endMs === undefined) return false;
    const today = dayOf(nowMs);
    // An event that ends on the stroke of midnight doesn't run into the next day.
    return dayOf(startMs) <= today && today <= dayOf(Math.max(startMs, endMs - 1));
}
