import { useCallback, useState } from 'react';

type ToastType = 'success' | 'warning' | 'error';

interface Toast {
    id: number;
    message: string;
    type: ToastType;
}

export type ShowToast = (message: string, type: ToastType) => void;

let toastCounter = 0;

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
