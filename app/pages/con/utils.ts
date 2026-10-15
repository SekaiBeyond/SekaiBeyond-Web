import type { MouseEvent } from 'react';
import { formatSiteTime, labelSiteZone, parseSiteTime, SITE_TIME_ZONE } from '~/lib/siteTime';
import type { EarlyBird, InPersonSession, TicketFee, TicketTier } from '~/lib/conContent';
import type { ConLanguage } from '~/pages/con/i18n';

const locales: Record<ConLanguage, string> = {en: 'en-US', zh: 'zh-CN'};

/* Con times are stored zoneless and mean the Pacific clock: parseSiteTime reads
   them that way and they're shown in SITE_TIME_ZONE, so a visitor abroad sees
   the con's own hours. */

/** "November 14, 2026" / "2026年11月14日" */
export const formatEventDate = (iso: string, lang: ConLanguage) =>
    formatSiteTime(parseSiteTime(iso), lang === 'en', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
    });

/** "Saturday" / "星期六" */
export const formatWeekday = (iso: string, lang: ConLanguage) =>
    formatSiteTime(parseSiteTime(iso), lang === 'en', {weekday: 'long'});

const TIME_OPTIONS: Intl.DateTimeFormatOptions = {hour: 'numeric', minute: '2-digit'};

/** "11:00 AM – 8:00 PM PT" / "11:00 – 20:00（太平洋时间）" */
export const formatTimeRange = (startIso: string, endIso: string, lang: ConLanguage) => {
    const options = {...TIME_OPTIONS, timeZone: SITE_TIME_ZONE};
    const start = parseSiteTime(startIso).toLocaleTimeString(locales[lang], options);
    const end = parseSiteTime(endIso).toLocaleTimeString(locales[lang], options);
    return labelSiteZone(`${start} – ${end}`, lang === 'en');
};

/** "Oct 1, 11:59 PM PT" / "10月1日 23:59（太平洋时间）" */
export const formatDeadline = (iso: string, lang: ConLanguage) =>
    formatSiteTime(parseSiteTime(iso), lang === 'en', {month: 'short', day: 'numeric', ...TIME_OPTIONS});

/**
 * 10 → "$10", 12.5 → "$12.50", 0 → "Free" / "免费". `narrowSymbol` keeps zh-CN at
 * "$" rather than "US$".
 */
export const formatPrice = (price: number, lang: ConLanguage) => {
    if (price === 0) return lang === 'en' ? 'Free' : '免费';
    return price.toLocaleString(locales[lang], {
        style: 'currency',
        currency: 'USD',
        currencyDisplay: 'narrowSymbol',
        minimumFractionDigits: Number.isInteger(price) ? 0 : 2,
    });
};

/**
 * The tier's early bird if still running at `now`, else null. An unparseable
 * deadline reads as ended.
 */
export const activeEarlyBird = (tier: TicketTier, now: number): EarlyBird | null => {
    if (!tier.earlyBird) return null;
    const ends = parseSiteTime(tier.earlyBird.endsAt).getTime();
    return Number.isFinite(ends) && now < ends ? tier.earlyBird : null;
};

/**
 * The online fee on a ticket of `price`, to the cent. A free ticket has no fee,
 * flat part or not.
 */
export const ticketFeeFor = (price: number, fee: TicketFee) => {
    if (price <= 0) return 0;
    // In whole cents and hundredths of a percent: in floats, 25 * 2.9 is 72.4999…
    // and rounds down.
    const cents = Math.round(price * 100);
    const basisPoints = Math.round(fee.percent * 100);
    return (Math.round(cents * basisPoints / 10000) + Math.round(fee.flat * 100)) / 100;
};

/** "Mon, Oct 5" / "10月5日周一" for a bare YYYY-MM-DD. */
export const formatSessionDay = (date: string, lang: ConLanguage) =>
    // With a time it parses in the viewer's clock; bare, it would be UTC midnight,
    // the day before west of Greenwich.
    new Date(`${date}T00:00`).toLocaleDateString(locales[lang], {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
    });

/** When an in-person session opens and closes, as zoneless ISO strings on the Pacific clock (see parseSiteTime). */
export const sessionBounds = (session: InPersonSession) => ({
    opens: `${session.date}T${session.start}`,
    closes: `${session.date}T${session.end}`,
});

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** "13:30" → 810 minutes past midnight, or null for anything that is not HH:MM. */
export const parseClockTime = (time: string | undefined): number | null => {
    const parts = time ? HHMM.exec(time) : null;
    return parts ? Number(parts[1]) * 60 + Number(parts[2]) : null;
};

/**
 * "13:30" → "1:30 PM" / "13:30". The date is arbitrary; only the time is read
 * back. Anything not HH:MM is shown as stored rather than as "Invalid Date".
 */
export const formatClockTime = (time: string, lang: ConLanguage) => {
    const minutes = parseClockTime(time);
    if (minutes === null) return time;

    const clock = new Date(2000, 0, 1, Math.floor(minutes / 60), minutes % 60);
    return clock.toLocaleTimeString(locales[lang], TIME_OPTIONS);
};

/** Zero-pads to two digits: countdown segments, and hours and minutes in HH:MM. */
export const pad = (value: number) => String(value).padStart(2, '0');

/**
 * Smooth-scrolls to a section, keeping the href so middle-click still works.
 */
export const scrollToSection =
    (id: string, onDone?: () => void) => (event: MouseEvent<HTMLAnchorElement>) => {
        const target = document.getElementById(id);
        if (!target) return;

        event.preventDefault();
        target.scrollIntoView({behavior: 'smooth'});
        onDone?.();
    };
