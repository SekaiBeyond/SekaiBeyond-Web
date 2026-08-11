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

/** "11:00 AM – 8:00 PM" / "11:00–20:00" */
export const formatTimeRange = (startIso: string, endIso: string, lang: ConLanguage) => {
    const options: Intl.DateTimeFormatOptions = {hour: 'numeric', minute: '2-digit'};
    const start = new Date(startIso).toLocaleTimeString(locales[lang], options);
    const end = new Date(endIso).toLocaleTimeString(locales[lang], options);
    return `${start} – ${end}`;
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
