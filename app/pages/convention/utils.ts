import type { MouseEvent } from 'react';
import { formatSiteTime, labelSiteZone, parseSiteTime, SITE_TIME_ZONE } from '~/lib/siteTime';
import type { EarlyBird, InPersonSession, TicketFee, TicketTier } from '~/lib/conContent';
import type { Language } from '~/components/LanguageContextProvider';

const locales: Record<Language, string> = {en: 'en-US', zh: 'zh-CN'};

export const formatEventDate = (iso: string, lang: Language) =>
    formatSiteTime(parseSiteTime(iso), lang === 'en', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
    });

export const formatWeekday = (iso: string, lang: Language) =>
    formatSiteTime(parseSiteTime(iso), lang === 'en', {weekday: 'long'});

const TIME_OPTIONS: Intl.DateTimeFormatOptions = {hour: 'numeric', minute: '2-digit'};

export const formatTimeRange = (startIso: string, endIso: string, lang: Language) => {
    const options = {...TIME_OPTIONS, timeZone: SITE_TIME_ZONE};
    const start = parseSiteTime(startIso).toLocaleTimeString(locales[lang], options);
    const end = parseSiteTime(endIso).toLocaleTimeString(locales[lang], options);
    return labelSiteZone(`${start} – ${end}`, lang === 'en');
};

export const formatDeadline = (iso: string, lang: Language) =>
    formatSiteTime(parseSiteTime(iso), lang === 'en', {month: 'short', day: 'numeric', ...TIME_OPTIONS});

export const formatPrice = (price: number, lang: Language) => {
    if (price === 0) return lang === 'en' ? 'Free' : '免费';
    return price.toLocaleString(locales[lang], {
        style: 'currency',
        currency: 'USD',
        currencyDisplay: 'narrowSymbol',
        minimumFractionDigits: Number.isInteger(price) ? 0 : 2,
    });
};

export const activeEarlyBird = (tier: TicketTier, now: number): EarlyBird | null => {
    if (!tier.earlyBird) return null;
    const ends = parseSiteTime(tier.earlyBird.endsAt).getTime();
    return Number.isFinite(ends) && now < ends ? tier.earlyBird : null;
};

export const ticketFeeFor = (price: number, fee: TicketFee) => {
    if (price <= 0) return 0;
    const cents = Math.round(price * 100);
    const basisPoints = Math.round(fee.percent * 100);
    return (Math.round(cents * basisPoints / 10000) + Math.round(fee.flat * 100)) / 100;
};

export const formatSessionDay = (date: string, lang: Language) =>
    new Date(`${date}T00:00`).toLocaleDateString(locales[lang], {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
    });

export const sessionBounds = (session: InPersonSession) => ({
    opens: `${session.date}T${session.start}`,
    closes: `${session.date}T${session.end}`,
});

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;

export const parseClockTime = (time: string | undefined): number | null => {
    const parts = time ? HHMM.exec(time) : null;
    return parts ? Number(parts[1]) * 60 + Number(parts[2]) : null;
};

export const formatClockTime = (time: string, lang: Language) => {
    const minutes = parseClockTime(time);
    if (minutes === null) return time;

    const clock = new Date(2000, 0, 1, Math.floor(minutes / 60), minutes % 60);
    return clock.toLocaleTimeString(locales[lang], TIME_OPTIONS);
};

export const pad = (value: number) => String(value).padStart(2, '0');

export const scrollToSection =
    (id: string, onDone?: () => void) => (event: MouseEvent<HTMLAnchorElement>) => {
        const target = document.getElementById(id);
        if (!target) return;

        event.preventDefault();
        target.scrollIntoView({behavior: 'smooth'});
        onDone?.();
    };
