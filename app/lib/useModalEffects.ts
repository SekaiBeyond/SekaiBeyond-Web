import { useEffect, useRef } from 'react';

/**
 * Handles three modal accessibility concerns:
 * 1. Traps keyboard focus within the modal (Tab / Shift+Tab cycle inside).
 * 2. Locks body scroll while the modal is open.
 * 3. Closes on Escape, when an `onClose` is given. Guard inside the callback to
 *    keep the modal open conditionally (e.g. `() => {if (!saving) onClose()}`).
 *
 * Pass `open: true` when the modal is visible. The hook is a no-op when `open` is false.
 *
 * `containerRef` should point to the modal's root element (the overlay or the
 * modal-content div — as long as all focusable elements are descendants).
 */
export function useModalEffects(
    open: boolean,
    containerRef: React.RefObject<HTMLElement | null>,
    onClose?: () => void,
) {
    const previouslyFocused = useRef<HTMLElement | null>(null);

    // Latest-callback ref, so a new closure each render doesn't re-run the main
    // effect (which would re-lock scroll and yank focus back to the first field).
    const onCloseRef = useRef(onClose);
    onCloseRef.current = onClose;

    useEffect(() => {
        if (!open) return;

        // Save the element that had focus before the modal opened
        previouslyFocused.current = document.activeElement as HTMLElement;

        // Lock body scroll
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
            // Restore focus to the previously focused element
            previouslyFocused.current?.focus();
        };
    }, [open, containerRef]);
}