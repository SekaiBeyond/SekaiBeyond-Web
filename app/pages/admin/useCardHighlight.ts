import { type Ref, useEffect, useImperativeHandle, useRef, useState } from 'react';

export interface CardHighlightHandle {
    /** Scroll the card for `id` into view and briefly highlight it. */
    highlight: (id: string) => void;
}

/**
 * Shared "jump to this card" behavior for the admin location lists. Each list
 * exposes this handle so a location record can send the reader straight to the
 * matching venue / lot / rate card after switching to the Locations tab.
 */
export function useCardHighlight(ref: Ref<CardHighlightHandle>) {
    const cardRefs = useRef(new Map<string, HTMLElement>());
    const [highlightedId, setHighlightedId] = useState<string | null>(null);
    const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

    useImperativeHandle(ref, () => ({
        highlight: (id: string) => {
            const el = cardRefs.current.get(id);
            if (!el) return;
            el.scrollIntoView({behavior: 'smooth', block: 'center'});
            setHighlightedId(id);
            if (timer.current) clearTimeout(timer.current);
            timer.current = setTimeout(() => setHighlightedId(null), 2000);
        },
    }));

    useEffect(() => () => {
        if (timer.current) clearTimeout(timer.current);
    }, []);

    /** Callback ref that tracks each card's DOM node by its item id. */
    const registerCard = (id: string) => (el: HTMLElement | null) => {
        if (el) cardRefs.current.set(id, el);
        else cardRefs.current.delete(id);
    };

    return {highlightedId, registerCard};
}
