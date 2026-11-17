import { useEffect } from 'react';

let activeGuard: (() => boolean) | null = null;

export function confirmExit(): boolean {
    return activeGuard ? activeGuard() : true;
}

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
            if (activeGuard === guard) activeGuard = null;
            window.removeEventListener('beforeunload', warnOnUnload);
        };
    }, [active, message]);
}
