import { useEffect } from 'react';
import { useLocation } from 'react-router';

export function useHashScroll(ready: boolean = true) {
    const {hash, key} = useLocation();

    useEffect(() => {
        if (!hash || !ready) return;

        const timers: ReturnType<typeof setTimeout>[] = [];

        const scrollToHash = () => {
            const id = hash.replace('#', '');
            const element = document.getElementById(id);
            if (element) {
                timers.push(setTimeout(() => {
                    element.scrollIntoView({behavior: 'smooth'});
                }, 100));
            }
        };

        scrollToHash();

        timers.push(setTimeout(scrollToHash, 500));

        return () => timers.forEach(clearTimeout);
    }, [hash, key, ready]);
}
