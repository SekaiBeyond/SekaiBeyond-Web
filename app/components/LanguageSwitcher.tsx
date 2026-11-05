import { useEffect, useId, useRef, useState } from 'react';
import { FiCheck, FiGlobe } from 'react-icons/fi';
import { LANGUAGES, useLanguage } from './LanguageContextProvider';

/**
 * A globe button that opens a menu of the languages, the current one ticked.
 * It's an icon rather than a flag because Windows has no flag emoji, so Edge and
 * Chrome there showed the letters "CN" and "US" in their place.
 */
export const LanguageSwitcher = () => {
    const {currentLanguage, setLanguage, isEnglish} = useLanguage();
    const [isOpen, setIsOpen] = useState(false);
    const wrapperRef = useRef<HTMLDivElement>(null);
    const buttonRef = useRef<HTMLButtonElement>(null);
    const menuId = useId();
    const current = LANGUAGES.find(lang => lang.code === currentLanguage) ?? LANGUAGES[0];

    useEffect(() => {
        if (!isOpen) return;
        const handlePointerDown = (event: PointerEvent) => {
            if (!wrapperRef.current?.contains(event.target as Node)) setIsOpen(false);
        };
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key !== 'Escape') return;
            setIsOpen(false);
            buttonRef.current?.focus();
        };
        // Tabbing out of the menu closes it too.
        const handleFocusIn = (event: FocusEvent) => {
            if (!wrapperRef.current?.contains(event.target as Node)) setIsOpen(false);
        };
        document.addEventListener('pointerdown', handlePointerDown);
        document.addEventListener('keydown', handleKeyDown);
        document.addEventListener('focusin', handleFocusIn);
        return () => {
            document.removeEventListener('pointerdown', handlePointerDown);
            document.removeEventListener('keydown', handleKeyDown);
            document.removeEventListener('focusin', handleFocusIn);
        };
    }, [isOpen]);

    const label = isEnglish ? 'Language' : '语言';

    return (
        <div className={`language-switcher-wrapper${isOpen ? ' active' : ''}`} ref={wrapperRef}>
            <button
                ref={buttonRef}
                type="button"
                className="language-switcher"
                onClick={() => setIsOpen(open => !open)}
                aria-label={`${label}: ${current.name}`}
                aria-expanded={isOpen}
                aria-controls={menuId}
                title={label}
            >
                <FiGlobe className="language-icon" aria-hidden="true"/>
            </button>
            <div className="language-menu" id={menuId} hidden={!isOpen}>
                {LANGUAGES.map(lang => {
                    const selected = lang.code === currentLanguage;
                    return (
                        <button
                            key={lang.code}
                            type="button"
                            className={`language-menu-item${selected ? ' selected' : ''}`}
                            lang={lang.code}
                            aria-current={selected || undefined}
                            onClick={() => {
                                setLanguage(lang.code);
                                setIsOpen(false);
                                buttonRef.current?.focus();
                            }}
                        >
                            <span>{lang.name}</span>
                            {selected && <FiCheck className="language-menu-check" aria-hidden="true"/>}
                        </button>
                    );
                })}
            </div>
        </div>
    );
};
