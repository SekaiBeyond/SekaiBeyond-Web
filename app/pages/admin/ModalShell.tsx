import { type ReactNode, useRef } from 'react';
import { useModalEffects } from '~/lib/useModalEffects';

interface ModalShellProps {
    title: ReactNode;
    onClose: () => void;
    /** Blocks every close path (overlay click, ×, Escape) while true (e.g. mid-save). */
    closeDisabled?: boolean;
    children: ReactNode;
}

/**
 * The admin modal chrome: dimmed overlay, centered content box, title header
 * with a × button, focus trap + scroll lock + Escape-to-close. Mount it only
 * while the modal is open.
 */
export function ModalShell({title, onClose, closeDisabled = false, children}: ModalShellProps) {
    const overlayRef = useRef<HTMLDivElement>(null);
    const close = () => {
        if (!closeDisabled) onClose();
    };
    useModalEffects(true, overlayRef, close);

    return (
        <div ref={overlayRef} className="admin-tickets-preview-modal" onClick={close}>
            <div className="admin-tickets-preview-content" onClick={(e) => e.stopPropagation()}>
                <div className="admin-tickets-preview-header">
                    <strong>{title}</strong>
                    <button className="admin-tickets-preview-close" onClick={close} disabled={closeDisabled}>×</button>
                </div>
                {children}
            </div>
        </div>
    );
}
