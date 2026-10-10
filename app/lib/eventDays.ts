/**
 * The zone an event's calendar days are counted in — the one its ticket emails
 * print its time in. Mirrors functions/src/utils/eventDays.ts, which holds the
 * staff group and event staff to these days when they scan a ticket.
 */
const EVENT_TIME_ZONE = 'America/Los_Angeles';

const DAY_FORMAT = new Intl.DateTimeFormat('en-US', {
    timeZone: EVENT_TIME_ZONE,
    year: 'numeric', month: '2-digit', day: '2-digit',
});

/** The calendar day `ms` falls on in EVENT_TIME_ZONE, as YYYY-MM-DD, which sorts as it reads. */
const dayOf = (ms: number): string => {
    const parts = Object.fromEntries(DAY_FORMAT.formatToParts(ms).map(p => [p.type, p.value]));
    return `${parts.year}-${parts.month}-${parts.day}`;
};

/** The last moment the event runs. One that ends on the stroke of midnight doesn't run into the next day. */
const lastMs = (startAt: Date, endAt: Date): number => Math.max(startAt.getTime(), endAt.getTime() - 1);

/** Whether `now` is before, on, or after the calendar day(s) the event runs on, whatever its hours. */
export const eventDayStatus = (startAt: Date, endAt: Date, now: Date = new Date()): 'before' | 'during' | 'after' => {
    const today = dayOf(now.getTime());
    if (today < dayOf(startAt.getTime())) return 'before';
    if (today > dayOf(lastMs(startAt, endAt))) return 'after';
    return 'during';
};

/** The event's day, or its first and last, as dated in EVENT_TIME_ZONE. */
export const formatEventDays = (startAt: Date, endAt: Date, isEnglish: boolean): string => {
    const format = (ms: number) => new Date(ms).toLocaleDateString(isEnglish ? 'en-US' : 'zh-CN', {
        timeZone: EVENT_TIME_ZONE,
        weekday: 'short', month: 'short', day: 'numeric',
    });
    const first = format(startAt.getTime());
    const last = format(lastMs(startAt, endAt));
    return first === last ? first : `${first} – ${last}`;
};
