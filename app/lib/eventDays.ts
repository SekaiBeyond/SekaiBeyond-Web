import { formatSiteTime, siteDay } from '~/lib/siteTime';

/*
 * An event's calendar days are counted in SITE_TIME_ZONE, the zone its ticket
 * emails print its time in. Mirrors functions/src/utils/eventDays.ts, which holds
 * the staff group and event staff to these days when they scan a ticket.
 */

/** The last moment the event runs. One that ends on the stroke of midnight doesn't run into the next day. */
const lastMs = (startAt: Date, endAt: Date): number => Math.max(startAt.getTime(), endAt.getTime() - 1);

/** Whether `now` is before, on, or after the calendar day(s) the event runs on, whatever its hours. */
export const eventDayStatus = (startAt: Date, endAt: Date, now: Date = new Date()): 'before' | 'during' | 'after' => {
    const today = siteDay(now);
    if (today < siteDay(startAt)) return 'before';
    if (today > siteDay(new Date(lastMs(startAt, endAt)))) return 'after';
    return 'during';
};

/** The event's day, or its first and last, as dated in SITE_TIME_ZONE. */
export const formatEventDays = (startAt: Date, endAt: Date, isEnglish: boolean): string => {
    const format = (date: Date) => formatSiteTime(date, isEnglish, {weekday: 'short', month: 'short', day: 'numeric'});
    const first = format(startAt);
    const last = format(new Date(lastMs(startAt, endAt)));
    return first === last ? first : `${first} – ${last}`;
};
