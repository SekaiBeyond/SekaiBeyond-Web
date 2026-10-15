import type { Timestamp } from "firebase-admin/firestore";
import { siteDay } from "./siteTime";

/**
 * Whether `nowMs` falls on any calendar day the event runs on, whatever its
 * hours, counted in SITE_TIME_ZONE. False without both times. Mirrors
 * app/lib/eventDays.ts.
 */
export function isOnEventDay(startAt: Timestamp | undefined, endAt: Timestamp | undefined, nowMs: number): boolean {
    const startMs = startAt?.toMillis?.();
    const endMs = endAt?.toMillis?.();
    if (startMs === undefined || endMs === undefined) return false;
    const today = siteDay(nowMs);
    // An event that ends on the stroke of midnight doesn't run into the next day.
    return siteDay(startMs) <= today && today <= siteDay(Math.max(startMs, endMs - 1));
}
