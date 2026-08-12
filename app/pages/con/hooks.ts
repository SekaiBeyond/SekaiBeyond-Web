import { useEffect, useState } from 'react';

/**
 * Tracks a CSS media query in JS. The con hero uses it to keep the Bilibili
 * iframe off phones and off reduced-motion setups entirely, rather than just
 * hiding it with CSS.
 */
export const useMediaQuery = (query: string) => {
    const [matches, setMatches] = useState(false);

    useEffect(() => {
        const list = window.matchMedia(query);
        setMatches(list.matches);

        const onChange = (event: MediaQueryListEvent) => setMatches(event.matches);
        list.addEventListener('change', onChange);
        return () => list.removeEventListener('change', onChange);
    }, [query]);

    return matches;
};

export interface Countdown {
    days: number;
    hours: number;
    minutes: number;
    seconds: number;
    /** True once the start time has passed. */
    started: boolean;
    /** True once the end time has passed. */
    ended: boolean;
}

const remainingFrom = (target: number, end: number): Countdown => {
    const now = Date.now();
    const ended = Number.isFinite(end) && now > end;
    const diff = target - now;
    // An unparseable date reads as "not started" with zeroed digits rather than
    // rendering NaN in every segment.
    if (!Number.isFinite(diff)) {
        return {days: 0, hours: 0, minutes: 0, seconds: 0, started: false, ended};
    }
    if (diff <= 0) {
        return {days: 0, hours: 0, minutes: 0, seconds: 0, started: true, ended};
    }
    const seconds = Math.floor(diff / 1000);
    return {
        days: Math.floor(seconds / 86400),
        hours: Math.floor((seconds % 86400) / 3600),
        minutes: Math.floor((seconds % 3600) / 60),
        seconds: seconds % 60,
        started: false,
        ended,
    };
};

/**
 * Counts down to `isoDate`, ticking once a second, and reports when `endIsoDate`
 * has passed too. The timer exists only to move something on screen, so it stops
 * once the con has ended — until then it has to keep running even after the start
 * time, because the live → ended transition is what it drives.
 */
export const useCountdown = (isoDate: string, endIsoDate: string): Countdown => {
    const target = new Date(isoDate).getTime();
    const end = new Date(endIsoDate).getTime();
    const [countdown, setCountdown] = useState(() => remainingFrom(target, end));

    useEffect(() => {
        const tick = () => {
            const next = remainingFrom(target, end);
            setCountdown(next);
            return next;
        };

        if (tick().ended || Number.isNaN(target)) return;

        const id = window.setInterval(() => {
            if (tick().ended) window.clearInterval(id);
        }, 1000);
        return () => window.clearInterval(id);
    }, [target, end]);

    return countdown;
};

/** True once the page has scrolled past `offset` — used to solidify the con navbar. */
export const useScrolledPast = (offset: number) => {
    const [passed, setPassed] = useState(false);

    useEffect(() => {
        const onScroll = () => setPassed(window.scrollY > offset);
        onScroll();
        window.addEventListener('scroll', onScroll, {passive: true});
        return () => window.removeEventListener('scroll', onScroll);
    }, [offset]);

    return passed;
};

/**
 * Returns the id of the section currently filling most of the viewport, so the
 * navbar can highlight where the reader is.
 */
export const useActiveSection = (ids: string[]) => {
    const [active, setActive] = useState('');

    useEffect(() => {
        const sections = ids
            .map(id => document.getElementById(id))
            .filter((el): el is HTMLElement => el !== null);
        if (sections.length === 0) return;

        const observer = new IntersectionObserver(
            entries => {
                const visible = entries
                    .filter(entry => entry.isIntersecting)
                    .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
                if (visible) setActive(visible.target.id);
            },
            {rootMargin: '-30% 0px -55% 0px', threshold: [0, 0.25, 0.5, 1]},
        );

        sections.forEach(section => observer.observe(section));
        return () => observer.disconnect();
    }, [ids]);

    return active;
};
