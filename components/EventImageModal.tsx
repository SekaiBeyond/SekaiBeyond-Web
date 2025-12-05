import React from "react";

interface EventImageModalProps {
    imageUrl: string;
    onClose: () => void;
    altText: string;
}

export const EventImageModal: React.FC<EventImageModalProps> = ({imageUrl, onClose, altText}) => {
    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal-content" onClick={(e) => e.stopPropagation()}>
                <button
                    className="modal-close"
                    onClick={onClose}
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
