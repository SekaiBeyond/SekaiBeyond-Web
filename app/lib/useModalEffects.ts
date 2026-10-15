import { useEffect, useRef } from 'react';

/**
 * A modal's accessibility: traps Tab focus inside, locks body scroll, and closes on
 * Escape when `onClose` is given (guard inside it to stay open, e.g. while saving). A
 * no-op while `open` is false. `containerRef` is the modal's root, containing every
 * focusable element.
 */
export function useModalEffects(
    open: boolean,
    containerRef: React.RefObject<HTMLElement | null>,
    onClose?: () => void,
) {
    const previouslyFocused = useRef<HTMLElement | null>(null);

    // So a new closure each render doesn't re-run the effect, which would re-lock
    // scroll and pull focus back.
    const onCloseRef = useRef(onClose);
    onCloseRef.current = onClose;

    useEffect(() => {
        if (!open) return;

        previouslyFocused.current = document.activeElement as HTMLElement;

        const prev = document.body.style.overflow;
        document.body.style.overflow = 'hidden';

        const container = containerRef.current;

        const focusFirst = () => {
            if (!container) return;
            const focusable = container.querySelectorAll<HTMLElement>(
                'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
            );
            if (focusable.length > 0) focusable[0].focus();
        };

        // Try focusing the first element; slight delay so the DOM is ready
        const timerId = setTimeout(focusFirst, 0);

        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                onCloseRef.current?.();
                return;
            }
            if (e.key !== 'Tab' || !container) return;

            const focusable = container.querySelectorAll<HTMLElement>(
                'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
            );
            if (focusable.length === 0) return;

            const first = focusable[0];
            const last = focusable[focusable.length - 1];

            if (e.shiftKey) {
                if (document.activeElement === first) {
                    e.preventDefault();
                    last.focus();
                }
            } else {
                if (document.activeElement === last) {
                    e.preventDefault();
                    first.focus();
                }
            }
        };

        document.addEventListener('keydown', handleKeyDown);

        return () => {
            clearTimeout(timerId);
            document.removeEventListener('keydown', handleKeyDown);
            document.body.style.overflow = prev;
            previouslyFocused.current?.focus();
        };
    }, [open, containerRef]);
}