import { useCallback, useEffect, useRef, useState } from 'react';

interface CardHighlightHandle {
    highlight: (id: string) => void;
}

export interface LocationListHandle extends CardHighlightHandle {
    openEdit: (id: string) => void;
}

export function useCardHighlight() {
    const cardRefs = useRef(new Map<string, HTMLElement>());
    const [highlightedId, setHighlightedId] = useState<string | null>(null);
    const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

    const highlight = useCallback((id: string) => {
        const el = cardRefs.current.get(id);
        if (!el) return;
        el.scrollIntoView({behavior: 'smooth', block: 'center'});
        setHighlightedId(id);
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => setHighlightedId(null), 2000);
    }, []);

    useEffect(() => () => {
        if (timer.current) clearTimeout(timer.current);
    }, []);

    const registerCard = (id: string) => (el: HTMLElement | null) => {
        if (el) cardRefs.current.set(id, el);
        else cardRefs.current.delete(id);
    };

    return {highlightedId, registerCard, highlight};
}
