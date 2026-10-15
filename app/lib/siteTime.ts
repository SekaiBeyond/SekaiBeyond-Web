/**
 * The zone the site keeps dates and times in: its events', its ticket emails',
 * and the one admins type in. Named rather than a fixed offset, so each date gets
 * the offset in force on it. Mirrors functions/src/utils/siteTime.ts.
 *
 * Times the club sets (event hours, code windows, expiries) are typed and shown
 * on this clock; timestamps of things that happened stay in the viewer's zone.
 */
export const SITE_TIME_ZONE = 'America/Los_Angeles';

const DAY_MS = 24 * 60 * 60 * 1000;

const CLOCK_FORMAT = new Intl.DateTimeFormat('en-US', {
    timeZone: SITE_TIME_ZONE,
    // h23, so midnight reads 00 rather than 24.
    hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
});

/**
 * SITE_TIME_ZONE's wall clock at `ms`, as the UTC moment that reads the same, for
 * arithmetic that never meets a DST change.
 */
const clockAt = (ms: number): number => {
    const parts = Object.fromEntries(CLOCK_FORMAT.formatToParts(ms).map(p => [p.type, Number(p.value)]));
    return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second) + ms % 1000;
};

/** The moment the clock in SITE_TIME_ZONE reads `clock`, as clockAt writes it. */
const momentAt = (clock: number): number => {
    // Guessed with the offset at one moment, then corrected with the offset at
    // the guess; they agree unless DST changes in between.
    const first = clock - (clockAt(clock) - clock);
    const second = clock - (clockAt(first) - first);
    // In the hour spring skips, no moment reads `clock`, and `first` lands an
    // hour on. In the hour fall repeats, `second` is the first pass.
    return clockAt(second) === clock ? second : first;
};

const CLOCK_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?$/;
const ZONED_RE = /(Z|[+-]\d{2}:\d{2})$/;

/**
 * A time as the moment it names. An ISO string with Z or an offset is read as
 * written; a zoneless YYYY-MM-DDTHH:mm[:ss], as datetime-local inputs and con
 * content hold, is read on SITE_TIME_ZONE's clock. Anything else is an Invalid
 * Date.
 */
export const parseSiteTime = (value: string): Date => {
    const clock = CLOCK_RE.exec(value);
    if (!clock) return ZONED_RE.test(value) ? new Date(value) : new Date(NaN);
    const [, year, month, day, hour, minute, second] = clock.map(Number);
    return new Date(momentAt(Date.UTC(year, month - 1, day, hour, minute, second || 0)));
};

/**
 * `date` as a datetime-local value on SITE_TIME_ZONE's clock; empty for no
 * date.
 */
export const toDatetimeLocal = (date: Date | null): string =>
    date && !Number.isNaN(date.getTime()) ? new Date(clockAt(date.getTime())).toISOString().slice(0, 16) : '';

/**
 * `days` calendar days on from `ms`, at the same wall-clock time, not `days` × 24
 * hours. Mirrors addSiteDays in functions/src/utils/siteTime.ts.
 */
export const addSiteDays = (ms: number, days: number): number => momentAt(clockAt(ms) + days * DAY_MS);

/** The calendar day `date` falls on in SITE_TIME_ZONE, as YYYY-MM-DD, which sorts as it reads. */
export const siteDay = (date: Date): string => toDatetimeLocal(date).slice(0, 10);

/** `text` with the zone named after it, so a reader elsewhere doesn't take it for their own clock. */
export const labelSiteZone = (text: string, isEnglish: boolean): string =>
    isEnglish ? `${text} PT` : `${text}（太平洋时间）`;

/**
 * `date` on SITE_TIME_ZONE's clock in the reader's language, naming the zone
 * when the hour is shown.
 */
export const formatSiteTime = (date: Date, isEnglish: boolean, options: Intl.DateTimeFormatOptions): string => {
    const text = date.toLocaleString(isEnglish ? 'en-US' : 'zh-CN', {...options, timeZone: SITE_TIME_ZONE});
    return options.hour === undefined ? text : labelSiteZone(text, isEnglish);
};
