export const SITE_TIME_ZONE = "America/Los_Angeles";

const DAY_MS = 24 * 60 * 60 * 1000;

const CLOCK_FORMAT = new Intl.DateTimeFormat("en-US", {
    timeZone: SITE_TIME_ZONE,
    hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
});

function clockAt(ms: number): number {
    const parts = Object.fromEntries(CLOCK_FORMAT.formatToParts(ms).map(p => [p.type, Number(p.value)]));
    return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second) + ms % 1000;
}

function momentAt(clock: number): number {
    const first = clock - (clockAt(clock) - clock);
    const second = clock - (clockAt(first) - first);
    return clockAt(second) === clock ? second : first;
}

const CLOCK_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?$/;
const ZONED_RE = /(Z|[+-]\d{2}:\d{2})$/;

export function parseSiteTime(value: string): Date {
    const clock = CLOCK_RE.exec(value);
    if (!clock) return ZONED_RE.test(value) ? new Date(value) : new Date(NaN);
    const [, year, month, day, hour, minute, second] = clock.map(Number);
    return new Date(momentAt(Date.UTC(year, month - 1, day, hour, minute, second || 0)));
}

export function siteDay(ms: number): string {
    return new Date(clockAt(ms)).toISOString().slice(0, 10);
}

export function addSiteDays(ms: number, days: number): number {
    return momentAt(clockAt(ms) + days * DAY_MS);
}
