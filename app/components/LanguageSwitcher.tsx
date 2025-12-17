import React from 'react';
import { useLanguage } from './LanguageContextProvider';

export const LanguageSwitcher: React.FC = () => {
    const {currentLanguage, setLanguage} = useLanguage();

    const toggleLanguage = () => {
        setLanguage(currentLanguage === 'en' ? 'zh' : 'en');
    };

    return (
        <button
            className="language-switcher"
            onClick={toggleLanguage}
            aria-label="Switch language"
            title={currentLanguage === 'en' ? 'Switch to Chinese' : 'Switch to English'}
        >
      <span className="language-flag">
        {currentLanguage === 'en' ? '🇨🇳' : '🇺🇸'}
      </span>
            <span className="language-text">
        {currentLanguage === 'en' ? '中文' : 'EN'}
      </span>
        </button>
    );
};
