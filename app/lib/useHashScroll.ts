import { useEffect } from 'react';
import { useLocation } from 'react-router';

/**
 * A hook that handles scrolling to hash anchors (e.g., #upcoming) on page load
 * and when the hash changes. It includes a small delay to ensure that
 * content is rendered before scrolling.
 */
export function useHashScroll() {
    const {hash, key} = useLocation();

    useEffect(() => {
        if (!hash) return;

        // Function to perform the scroll
        const scrollToHash = () => {
            const id = hash.replace('#', '');
            const element = document.getElementById(id);
            if (element) {
                // We use a slight delay to allow any layout shifts (like images loading)
                // to settle, though this isn't perfect.
                setTimeout(() => {
                    element.scrollIntoView({behavior: 'smooth'});
                }, 100);
            }
        };

        // Try immediately
        scrollToHash();

        // Also try after a short delay to account for async content rendering
        const timer = setTimeout(scrollToHash, 500);

        return () => clearTimeout(timer);
    }, [hash, key]); // Re-run on hash change or route change (key)
}
