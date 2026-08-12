import { useEffect } from 'react';
import { useLocation } from 'react-router';

/**
 * A hook that handles scrolling to hash anchors (e.g., #upcoming) on page load
 * and when the hash changes. It includes a small delay to ensure that
 * content is rendered before scrolling.
 *
 * Pass `ready: false` while the target sections have not rendered yet — a page
 * that waits on a fetch before drawing its sections would otherwise burn both
 * scroll attempts on an empty DOM. The effect re-runs when it flips to true.
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
                // We use a slight delay to allow any layout shifts (like images loading)
                // to settle, though this isn't perfect.
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
