import { useEffect } from 'react';

/**
 * Guards work that leaving the screen would destroy. A confirm on the screen's
 * own Back button misses the other ways out: the admin panel unmounts tabs on
 * switch, and the browser can close, reload or go back.
 *
 * One guard at a time, which is enough: the screens holding unrecoverable state
 * are full-page and mutually exclusive.
 */
let activeGuard: (() => boolean) | null = null;

/**
 * Whether it's safe to leave, asking if a guard is armed. Call before anything
 * that would unmount guarded work.
 */
export function confirmExit(): boolean {
    return activeGuard ? activeGuard() : true;
}

/**
 * Arm a confirmation while `active`, for in-app navigation ({@link
 * confirmExit}) and the browser's own exits (`beforeunload`, which shows the
 * browser's generic wording).
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
            // Only if still ours: a newer guard may already hold the slot.
            if (activeGuard === guard) activeGuard = null;
            window.removeEventListener('beforeunload', warnOnUnload);
        };
    }, [active, message]);
}
