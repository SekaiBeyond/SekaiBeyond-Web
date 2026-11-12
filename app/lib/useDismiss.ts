import { type RefObject, useEffect, useRef } from 'react';

/**
 * While `open`, calls `onDismiss` when a click lands outside `ref`'s element or
 * Escape is pressed, saying which, so a menu or popover can close.
 */
export function useDismiss(
    open: boolean,
    ref: RefObject<HTMLElement | null>,
    onDismiss: (byEscape: boolean) => void,
): void {
    // So a new closure each render doesn't re-attach the listeners.
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
