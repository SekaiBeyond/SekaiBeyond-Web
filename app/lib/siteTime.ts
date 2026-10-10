/**
 * The zone the site keeps its dates and times in: the one its events run in,
 * that ticket emails print times in, and that admins type times in, wherever
 * their own computer is. Named rather than a fixed offset, so each date is read
 * with the offset in force on it — PST through the winter, PDT through the
 * summer. Mirrors functions/src/utils/siteTime.ts.
 *
 * Times the club sets — event hours, code windows, expiries — are typed and shown
 * on this clock. Timestamps of things that happened (a scan, a sign-up, a log
 * entry) stay in the viewer's own zone.
 */
export const SITE_TIME_ZONE = 'America/Los_Angeles';

const CLOCK_FORMAT = new Intl.DateTimeFormat('en-US', {
    timeZone: SITE_TIME_ZONE,
    // h23, so midnight reads 00 rather than 24.
    hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
});

/**
 * What the clock in SITE_TIME_ZONE reads at `ms`, written as the UTC moment that
 * reads the same — a number that can be stepped through without meeting a DST change.
 */
const clockAt = (ms: number): number => {
    const parts = Object.fromEntries(CLOCK_FORMAT.formatToParts(ms).map(p => [p.type, Number(p.value)]));
    return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second) + ms % 1000;
};

/** The moment the clock in SITE_TIME_ZONE reads `clock`, as clockAt writes it. */
const momentAt = (clock: number): number => {
    // Guessed with the offset at one moment, then corrected with the offset at
    // the guess. The two agree unless a DST change falls between them.
    const first = clock - (clockAt(clock) - clock);
    const second = clock - (clockAt(first) - first);
    // In the hour spring skips, no moment reads `clock`: `first`, taken with the
    // winter offset, lands an hour on, where a clock set to it would read. In the
    // hour fall repeats, `second` is its first pass, still on daylight time.
    return clockAt(second) === clock ? second : first;
};

const CLOCK_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?$/;
const ZONED_RE = /(Z|[+-]\d{2}:\d{2})$/;

/**
 * A time as the moment it names. One that carries its zone — an ISO string
 * ending in Z or an offset — is read as written. A zoneless YYYY-MM-DDTHH:mm[:ss],
 * what a datetime-local input holds and what con content stores, is read on the
 * clock in SITE_TIME_ZONE, never the viewer's. Anything else is an Invalid Date.
 */
export const parseSiteTime = (value: string): Date => {
    const clock = CLOCK_RE.exec(value);
    if (!clock) return ZONED_RE.test(value) ? new Date(value) : new Date(NaN);
    const [, year, month, day, hour, minute, second] = clock.map(Number);
    return new Date(momentAt(Date.UTC(year, month - 1, day, hour, minute, second || 0)));
};

/**
 * `date` as the YYYY-MM-DDTHH:mm a datetime-local input holds, on the clock in
 * SITE_TIME_ZONE. Empty for no date, which leaves the input unset.
 */
export const toDatetimeLocal = (date: Date | null): string =>
    date && !Number.isNaN(date.getTime()) ? new Date(clockAt(date.getTime())).toISOString().slice(0, 16) : '';

/** The calendar day `date` falls on in SITE_TIME_ZONE, as YYYY-MM-DD, which sorts as it reads. */
export const siteDay = (date: Date): string => toDatetimeLocal(date).slice(0, 10);

/** `text` with the zone named after it, so a reader elsewhere doesn't take it for their own clock. */
export const labelSiteZone = (text: string, isEnglish: boolean): string =>
    isEnglish ? `${text} PT` : `${text}（太平洋时间）`;

/**
 * `date` on the clock in SITE_TIME_ZONE, in the reader's language. When
 * `options` include the hour, the zone is named after it.
 */
export const formatSiteTime = (date: Date, isEnglish: boolean, options: Intl.DateTimeFormatOptions): string => {
    const text = date.toLocaleString(isEnglish ? 'en-US' : 'zh-CN', {...options, timeZone: SITE_TIME_ZONE});
    return options.hour === undefined ? text : labelSiteZone(text, isEnglish);
};
