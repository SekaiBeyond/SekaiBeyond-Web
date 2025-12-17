import React, { createContext, type ReactNode, useContext, useEffect, useState } from 'react';

export type Language = 'en' | 'zh';

interface LanguageContextType {
    currentLanguage: Language;
    setLanguage: (lang: Language) => void;
    isEnglish: boolean;
    isChinese: boolean;
}

const LanguageContext = createContext<LanguageContextType | undefined>(undefined);

export const useLanguage = () => {
    const context = useContext(LanguageContext);
    if (!context) {
        throw new Error('useLanguage must be used within a LanguageProvider');
    }
    return context;
};

interface LanguageProviderProps {
    children: ReactNode;
}

export const LanguageProvider: React.FC<LanguageProviderProps> = ({children}) => {
    const [currentLanguage, setCurrentLanguage] = useState<Language>('en');

    useEffect(() => {
        // Load saved language from localStorage
        const savedLanguage = localStorage.getItem('language') as Language;
        if (savedLanguage && (savedLanguage === 'en' || savedLanguage === 'zh')) {
            setCurrentLanguage(savedLanguage);
        } else {
            // Auto-detect browser language
            const browserLanguage = navigator.language.toLowerCase();
            if (browserLanguage.startsWith('zh')) {
                setCurrentLanguage('zh');
            }
        }
    }, []);

    const setLanguage = (lang: Language) => {
        setCurrentLanguage(lang);
        localStorage.setItem('language', lang);
    };

    const value: LanguageContextType = {
        currentLanguage,
        setLanguage,
        isEnglish: currentLanguage === 'en',
        isChinese: currentLanguage === 'zh'
    };

    return (
        <LanguageContext.Provider value={value}>
            {children}
        </LanguageContext.Provider>
    );
};
