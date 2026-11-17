import type { Timestamp } from "firebase-admin/firestore";
import { siteDay } from "./siteTime";

export function isOnEventDay(startAt: Timestamp | undefined, endAt: Timestamp | undefined, nowMs: number): boolean {
    const startMs = startAt?.toMillis?.();
    const endMs = endAt?.toMillis?.();
    if (startMs === undefined || endMs === undefined) return false;
    const today = siteDay(nowMs);
    return siteDay(startMs) <= today && today <= siteDay(Math.max(startMs, endMs - 1));
}
