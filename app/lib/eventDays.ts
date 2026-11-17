import { formatSiteTime, siteDay } from '~/lib/siteTime';

const lastMs = (startAt: Date, endAt: Date): number => Math.max(startAt.getTime(), endAt.getTime() - 1);

export const eventDayStatus = (startAt: Date, endAt: Date, now: Date = new Date()): 'before' | 'during' | 'after' => {
    const today = siteDay(now);
    if (today < siteDay(startAt)) return 'before';
    if (today > siteDay(new Date(lastMs(startAt, endAt)))) return 'after';
    return 'during';
};

export const formatEventDays = (startAt: Date, endAt: Date, isEnglish: boolean): string => {
    const format = (date: Date) => formatSiteTime(date, isEnglish, {weekday: 'short', month: 'short', day: 'numeric'});
    const first = format(startAt);
    const last = format(new Date(lastMs(startAt, endAt)));
    return first === last ? first : `${first} – ${last}`;
};
