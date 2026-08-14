import { useEffect } from 'react';

/**
 * Guarding work that leaving the screen would destroy.
 *
 * This exists because a confirm wired to a screen's own "Back" button only
 * covers the way out that screen knows about. The admin panel swaps tabs by
 * unmounting the whole subtree, and the browser has a close button, a reload,
 * and a back gesture — all of which discard component state without asking.
 *
 * One guard is registered at a time, which is all the panel needs: the screens
 * holding unrecoverable state are full-page and mutually exclusive.
 */
let activeGuard: (() => boolean) | null = null;

/**
 * Whether it is safe to navigate away, asking the user if a guard is armed.
 * Call this before anything that would unmount guarded work.
 */
export function confirmExit(): boolean {
    return activeGuard ? activeGuard() : true;
}

/**
 * Arm a confirmation while `active`, covering both in-app navigation (via
 * {@link confirmExit}) and the browser's own exits (via `beforeunload`, which
 * shows the browser's generic wording — the message is only used in-app).
 */
export function useExitGuard(active: boolean, message: string): void {
    useEffect(() => {
        if (!active) return;

        const guard = () => window.confirm(message);
        activeGuard = guard;

        const warnOnUnload = (event: BeforeUnloadEvent) => {
            event.preventDefault();
        };
        window.addEventListener('beforeunload', warnOnUnload);

        return () => {
            // Only clear the slot if it is still ours — a newly mounted guard
            // has already claimed it, and this cleanup runs after its effect.
            if (activeGuard === guard) activeGuard = null;
            window.removeEventListener('beforeunload', warnOnUnload);
        };
    }, [active, message]);
}
