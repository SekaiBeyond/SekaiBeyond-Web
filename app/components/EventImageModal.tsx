import { type FC, useEffect, useRef } from "react";
import { useLanguage } from "~/components/LanguageContextProvider";
import { useModalEffects } from "~/lib/useModalEffects";

interface EventImageModalProps {
    imageUrl: string;
    onClose: () => void;
    altText: string;
}

export const EventImageModal: FC<EventImageModalProps> = ({imageUrl, onClose, altText}) => {
    const ref = useRef<HTMLDivElement>(null);
    const {isEnglish} = useLanguage();
    useModalEffects(true, ref);

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [onClose]);

    return (
        <div ref={ref} className="modal-overlay" onClick={onClose}>
            <div className="modal-content" onClick={(e) => e.stopPropagation()}>
                <button
                    className="modal-close"
                    onClick={onClose}
                    aria-label={isEnglish ? "Close" : "关闭"}
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
