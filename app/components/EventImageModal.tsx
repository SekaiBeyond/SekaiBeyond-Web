import React, { useEffect } from "react";

interface EventImageModalProps {
    imageUrl: string;
    onClose: () => void;
    altText: string;
}

export const EventImageModal: React.FC<EventImageModalProps> = ({imageUrl, onClose, altText}) => {
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [onClose]);

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal-content" onClick={(e) => e.stopPropagation()}>
                <button
                    className="modal-close"
                    onClick={onClose}
                    aria-label="Close"
                >
                    ×
                </button>
                <div className="modal-body">
                    <img
                        src={imageUrl}
                        alt={altText}
                    />
                </div>
            </div>
        </div>
    );
};
