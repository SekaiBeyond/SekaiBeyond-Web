import type { Timestamp } from "firebase-admin/firestore";
import { siteDay } from "./siteTime";

/**
 * Whether `nowMs` falls on any calendar day the event runs on, from the start of
 * the day it begins to the end of the day it ends, whatever its hours. Days are
 * counted in SITE_TIME_ZONE, the zone its ticket emails print its time in. False
 * for an event missing either time. Mirrors app/lib/eventDays.ts, which words the
 * same rule for the scanner.
 */
export function isOnEventDay(startAt: Timestamp | undefined, endAt: Timestamp | undefined, nowMs: number): boolean {
    const startMs = startAt?.toMillis?.();
    const endMs = endAt?.toMillis?.();
    if (startMs === undefined || endMs === undefined) return false;
    const today = siteDay(nowMs);
    // An event that ends on the stroke of midnight doesn't run into the next day.
    return siteDay(startMs) <= today && today <= siteDay(Math.max(startMs, endMs - 1));
}
