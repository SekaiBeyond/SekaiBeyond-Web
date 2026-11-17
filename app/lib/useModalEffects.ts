import { useEffect, useRef } from 'react';

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function useModalEffects(
    open: boolean,
    containerRef: React.RefObject<HTMLElement | null>,
    onClose?: () => void,
) {
    const previouslyFocused = useRef<HTMLElement | null>(null);

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
            const focusable = container.querySelectorAll<HTMLElement>(FOCUSABLE);
            if (focusable.length > 0) focusable[0].focus();
        };

        const timerId = setTimeout(focusFirst, 0);

        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                onCloseRef.current?.();
                return;
            }
            if (e.key !== 'Tab' || !container) return;

            const focusable = container.querySelectorAll<HTMLElement>(FOCUSABLE);
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