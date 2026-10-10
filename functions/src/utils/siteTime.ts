/**
 * The zone the site keeps its dates and times in: the one its events run in,
 * that ticket emails print times in, and that admins type times in, wherever
 * their own computer is. Named rather than a fixed offset, so each date is read
 * with the offset in force on it — PST through the winter, PDT through the
 * summer. Nothing here reads the server's own zone, which is UTC. Mirrors
 * app/lib/siteTime.ts.
 */
export const SITE_TIME_ZONE = "America/Los_Angeles";

const DAY_MS = 24 * 60 * 60 * 1000;

const CLOCK_FORMAT = new Intl.DateTimeFormat("en-US", {
    timeZone: SITE_TIME_ZONE,
    // h23, so midnight reads 00 rather than 24.
    hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
});

/**
 * What the clock in SITE_TIME_ZONE reads at `ms`, written as the UTC moment that
 * reads the same — a number the date arithmetic below can step through without
 * meeting a DST change.
 */
function clockAt(ms: number): number {
    const parts = Object.fromEntries(CLOCK_FORMAT.formatToParts(ms).map(p => [p.type, Number(p.value)]));
    return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second) + ms % 1000;
}

/** The moment the clock in SITE_TIME_ZONE reads `clock`, as clockAt writes it. */
function momentAt(clock: number): number {
    // Guessed with the offset at one moment, then corrected with the offset at
    // the guess. The two agree unless a DST change falls between them.
    const first = clock - (clockAt(clock) - clock);
    const second = clock - (clockAt(first) - first);
    // In the hour spring skips, no moment reads `clock`: `first`, taken with the
    // winter offset, lands an hour on, where a clock set to it would read. In the
    // hour fall repeats, `second` is its first pass, still on daylight time.
    return clockAt(second) === clock ? second : first;
}

const CLOCK_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?$/;
const ZONED_RE = /(Z|[+-]\d{2}:\d{2})$/;

/**
 * A time as the moment it names. One that carries its zone — an ISO string
 * ending in Z or an offset — is read as written. A zoneless YYYY-MM-DDTHH:mm[:ss],
 * what a datetime-local input holds, is read on the clock in SITE_TIME_ZONE.
 * Anything else is an Invalid Date.
 */
export function parseSiteTime(value: string): Date {
    const clock = CLOCK_RE.exec(value);
    if (!clock) return ZONED_RE.test(value) ? new Date(value) : new Date(NaN);
    const [, year, month, day, hour, minute, second] = clock.map(Number);
    return new Date(momentAt(Date.UTC(year, month - 1, day, hour, minute, second || 0)));
}

/** The calendar day `ms` falls on in SITE_TIME_ZONE, as YYYY-MM-DD, which sorts as it reads. */
export function siteDay(ms: number): string {
    return new Date(clockAt(ms)).toISOString().slice(0, 10);
}

/**
 * `days` calendar days on from `ms`: the same time on the clock in
 * SITE_TIME_ZONE, `days` dates later. Not `days` × 24 hours — across a DST change
 * a day is 23 or 25 of them, and counting hours would move a time an hour, which
 * for one set to 11:59 PM is the next day.
 */
export function addSiteDays(ms: number, days: number): number {
    return momentAt(clockAt(ms) + days * DAY_MS);
}
