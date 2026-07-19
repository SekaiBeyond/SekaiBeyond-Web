import { useCallback, useState } from 'react';

export type ToastType = 'success' | 'warning' | 'error';

export interface Toast {
    id: number;
    message: string;
    type: ToastType;
}

// Module-level so ids stay unique even if several toast hosts mount over a session.
let toastCounter = 0;

/** Self-expiring toast list. Render the returned `toasts` with {@link ToastContainer}. */
export function useToasts() {
    const [toasts, setToasts] = useState<Toast[]>([]);

    const showToast = useCallback((message: string, type: ToastType) => {
        const id = ++toastCounter;
        setToasts(prev => [...prev, {id, message, type}]);
        setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 3000);
    }, []);

    return {toasts, showToast};
}

export function ToastContainer({toasts}: {toasts: Toast[]}) {
    return (
        <div className="admin-toast-container">
            {toasts.map(t => (
                <div key={t.id} className={`admin-toast admin-toast-${t.type}`}>
                    {t.message}
                </div>
            ))}
        </div>
    );
}
