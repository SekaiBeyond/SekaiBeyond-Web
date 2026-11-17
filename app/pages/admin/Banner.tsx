import type { ReactNode } from 'react';

export function Banner({tone, className, children}: {
    tone: 'info' | 'warning' | 'error';
    className?: string;
    children: ReactNode;
}) {
    return (
        <div
            className={`admin-tickets-send-banner admin-tickets-send-banner-${tone}${className ? ` ${className}` : ''}`}>
            {children}
        </div>
    );
}
