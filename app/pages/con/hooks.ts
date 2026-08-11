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
}

const remainingFrom = (target: number): Countdown => {
    const diff = target - Date.now();
    if (diff <= 0) {
        return {days: 0, hours: 0, minutes: 0, seconds: 0, started: true};
    }
    const seconds = Math.floor(diff / 1000);
    return {
        days: Math.floor(seconds / 86400),
        hours: Math.floor((seconds % 86400) / 3600),
        minutes: Math.floor((seconds % 3600) / 60),
        seconds: seconds % 60,
        started: false,
    };
};

/** Counts down to an ISO date string, ticking once a second. */
export const useCountdown = (isoDate: string): Countdown => {
    const target = new Date(isoDate).getTime();
    const [countdown, setCountdown] = useState(() => remainingFrom(target));

    useEffect(() => {
        setCountdown(remainingFrom(target));
        if (Number.isNaN(target)) return;

        const id = window.setInterval(() => setCountdown(remainingFrom(target)), 1000);
        return () => window.clearInterval(id);
    }, [target]);

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
