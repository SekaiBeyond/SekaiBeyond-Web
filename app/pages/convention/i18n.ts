import { useLanguage } from '~/components/LanguageContextProvider';
import { eitherLanguage } from '~/lib/localized';

export type Localized = {en: string; zh: string};

export const useT = () => {
    const {isEnglish} = useLanguage();
    return (value: Localized) => eitherLanguage(isEnglish, value.en, value.zh);
};
