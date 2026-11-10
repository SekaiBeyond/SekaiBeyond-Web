import { useEffect, useState } from 'react';
import { CON_NAV_LINKS, useConListing } from '~/lib/conContent';
import { type Duration, splitDuration } from '~/lib/countdown';
import { parseSiteTime } from '~/lib/siteTime';

/**
 * A CSS media query in JS; the hero uses it to keep its clip off entirely for
 * reduced motion.
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

interface CountdownState extends Duration {
    /** True once the start time has passed. */
    started: boolean;
    /** True once the end time has passed. */
    ended: boolean;
}

const remainingFrom = (target: number, end: number): CountdownState => {
    const now = Date.now();
    const ended = Number.isFinite(end) && now > end;
    const diff = target - now;
    // An unparseable date reads as not started, with zeroed digits rather than
    // NaN.
    return {...splitDuration(diff), started: Number.isFinite(diff) && diff <= 0, ended};
};

/**
 * Counts down to `isoDate` once a second and reports when `endIsoDate` has
 * passed. Both are read with parseSiteTime, so it ends when the con opens
 * wherever the viewer is. It keeps ticking past the start, since the live →
 * ended change is what it drives, and stops at the end.
 */
export const useCountdown = (isoDate: string, endIsoDate: string): CountdownState => {
    const target = parseSiteTime(isoDate).getTime();
    const end = parseSiteTime(endIsoDate).getTime();
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

// setTimeout fires at once past ~24.8 days, so longer waits go in hops.
const MAX_TIMEOUT = 2 ** 31 - 1;

/**
 * The current time, re-read only as each of `isoDates` passes, so a page left
 * open across an early-bird deadline switches price without ticking every
 * second.
 */
export const useNowAcross = (isoDates: string[]) => {
    const [now, setNow] = useState(() => Date.now());
    // Joined so a fresh array with the same dates does not reschedule the timer.
    const key = isoDates.join('|');

    useEffect(() => {
        const next = Math.min(
            ...key.split('|')
                .map(iso => parseSiteTime(iso).getTime())
                .filter(time => Number.isFinite(time) && time > now),
        );
        if (!Number.isFinite(next)) return;

        const id = window.setTimeout(() => setNow(Date.now()), Math.min(next - now, MAX_TIMEOUT));
        return () => window.clearTimeout(id);
    }, [key, now]);

    return now;
};

/**
 * True once the con's event has ended, switching on a page left open as it
 * does. False with no event linked or an unparseable end.
 */
export const useConEnded = () => {
    const {endTime} = useConListing().listing;
    const now = useNowAcross([endTime]);
    const end = parseSiteTime(endTime).getTime();
    // At, not only past: useNowAcross can wake exactly at the end and won't
    // wake again for it.
    return Number.isFinite(end) && now >= end;
};

/** The con's nav links, less Tickets once the con has ended and its section is gone. */
export const useConNavLinks = () => {
    const ended = useConEnded();
    return ended ? CON_NAV_LINKS.filter(link => link.id !== 'tickets') : CON_NAV_LINKS;
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
 * The id of the section filling most of the viewport, for the navbar's
 * highlight.
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
