import type { MouseEvent } from 'react';
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
