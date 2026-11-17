import { type RefObject, useEffect, useRef } from 'react';

export function useDismiss(
    open: boolean,
    ref: RefObject<HTMLElement | null>,
    onDismiss: (byEscape: boolean) => void,
): void {
    const onDismissRef = useRef(onDismiss);
    onDismissRef.current = onDismiss;

    useEffect(() => {
        if (!open) return;
        const onDown = (e: MouseEvent) => {
            if (ref.current && !ref.current.contains(e.target as Node)) onDismissRef.current(false);
        };
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onDismissRef.current(true);
        };
        document.addEventListener('mousedown', onDown);
        document.addEventListener('keydown', onKey);
        return () => {
            document.removeEventListener('mousedown', onDown);
            document.removeEventListener('keydown', onKey);
        };
    }, [open, ref]);
}
