import { useEffect } from 'react';
import { useLocation } from 'react-router';

/**
 * Scrolls to the hash anchor (e.g. #upcoming) on load and when the hash
 * changes, after a short delay for rendering. Pass `ready: false` while the
 * target sections haven't rendered, so the attempts aren't spent on an empty
 * page.
 */
export function useHashScroll(ready: boolean = true) {
    const {hash, key} = useLocation();

    useEffect(() => {
        if (!hash || !ready) return;

        const timers: ReturnType<typeof setTimeout>[] = [];

        const scrollToHash = () => {
            const id = hash.replace('#', '');
            const element = document.getElementById(id);
            if (element) {
                // A delay lets layout shifts (images loading) settle, mostly.
                timers.push(setTimeout(() => {
                    element.scrollIntoView({behavior: 'smooth'});
                }, 100));
            }
        };

        scrollToHash();

        // Also try after a short delay to account for async content rendering
        timers.push(setTimeout(scrollToHash, 500));

        return () => timers.forEach(clearTimeout);
    }, [hash, key, ready]); // Re-run on hash change, route change (key), or once ready
}
