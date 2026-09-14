import type { MouseEvent } from 'react';
import type { EarlyBird, InPersonSession, TicketFee, TicketTier } from '~/pages/con/content';
import type { ConLanguage } from '~/pages/con/i18n';

const locales: Record<ConLanguage, string> = {en: 'en-US', zh: 'zh-CN'};

/** "November 14, 2026" / "2026年11月14日" */
export const formatEventDate = (iso: string, lang: ConLanguage) =>
    new Date(iso).toLocaleDateString(locales[lang], {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
    });

/** "Saturday" / "星期六" */
export const formatWeekday = (iso: string, lang: ConLanguage) =>
    new Date(iso).toLocaleDateString(locales[lang], {weekday: 'long'});

const TIME_OPTIONS: Intl.DateTimeFormatOptions = {hour: 'numeric', minute: '2-digit'};

/** "11:00 AM – 8:00 PM" / "11:00–20:00" */
export const formatTimeRange = (startIso: string, endIso: string, lang: ConLanguage) => {
    const start = new Date(startIso).toLocaleTimeString(locales[lang], TIME_OPTIONS);
    const end = new Date(endIso).toLocaleTimeString(locales[lang], TIME_OPTIONS);
    return `${start} – ${end}`;
};

/** "Oct 1, 11:59 PM" / "10月1日 23:59" */
export const formatDeadline = (iso: string, lang: ConLanguage) =>
    new Date(iso).toLocaleString(locales[lang], {month: 'short', day: 'numeric', ...TIME_OPTIONS});

/**
 * 10 → "$10", 12.5 → "$12.50", 0 → "Free" / "免费". Cents only show when there
 * are some, and `narrowSymbol` keeps zh-CN at "$" rather than "US$".
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
 * The tier's early bird if it is still running at `now`, else null. An
 * unparseable deadline reads as ended, so a bad date shows the regular price
 * rather than a discount with "Invalid Date" beside it.
 */
export const activeEarlyBird = (tier: TicketTier, now: number): EarlyBird | null => {
    if (!tier.earlyBird) return null;
    const ends = new Date(tier.earlyBird.endsAt).getTime();
    return Number.isFinite(ends) && now < ends ? tier.earlyBird : null;
};

/**
 * The online transaction fee on a ticket that costs `price`, rounded to the cent.
 * A free ticket has no payment to charge a fee on, so it stays at 0 whatever
 * the flat part is.
 */
export const ticketFeeFor = (price: number, fee: TicketFee) => {
    if (price <= 0) return 0;
    // In whole cents and hundredths of a percent, because the float version rounds
    // 2.9% of $25 (72.5¢) down: 25 * 2.9 comes out as 72.4999…
    const cents = Math.round(price * 100);
    const basisPoints = Math.round(fee.percent * 100);
    return (Math.round(cents * basisPoints / 10000) + Math.round(fee.flat * 100)) / 100;
};

/** "Mon, Oct 5" / "10月5日周一" for a bare YYYY-MM-DD. */
export const formatSessionDay = (date: string, lang: ConLanguage) =>
    // With a time attached the date parses in the viewer's clock. Bare, it would
    // parse as UTC midnight and read as the day before anywhere west of Greenwich.
    new Date(`${date}T00:00`).toLocaleDateString(locales[lang], {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
    });

/** When an in-person session opens and closes, as zoneless ISO strings. */
export const sessionBounds = (session: InPersonSession) => ({
    opens: `${session.date}T${session.start}`,
    closes: `${session.date}T${session.end}`,
});

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;

/**
 * "13:30" → "1:30 PM" / "13:30". Schedule items store a bare clock time with no
 * date to hang it on, so the day below is arbitrary — only the time is read back.
 *
 * Anything that is not HH:MM is handed back untouched: the admin panel and the
 * save function both enforce the shape, and showing a stored oddity as-is beats
 * rendering "Invalid Date" where a time should be.
 */
export const formatClockTime = (time: string, lang: ConLanguage) => {
    const parts = HHMM.exec(time);
    if (!parts) return time;

    const clock = new Date(2000, 0, 1, Number(parts[1]), Number(parts[2]));
    return clock.toLocaleTimeString(locales[lang], TIME_OPTIONS);
};

/** Zero-pads countdown segments so the digits stop jumping around. */
export const pad = (value: number) => String(value).padStart(2, '0');

/**
 * Smooth-scrolls to a con section instead of letting the anchor jump, while
 * leaving the href intact so the link still works on middle-click.
 */
export const scrollToSection =
    (id: string, onDone?: () => void) => (event: MouseEvent<HTMLAnchorElement>) => {
        const target = document.getElementById(id);
        if (!target) return;

        event.preventDefault();
        target.scrollIntoView({behavior: 'smooth'});
        onDone?.();
    };
