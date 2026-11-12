import { useLanguage } from '~/components/LanguageContextProvider';
import { eitherLanguage } from '~/lib/localized';

/** A string that exists in both site languages. */
export type Localized = {en: string; zh: string};

/**
 * Reads the shared language context for the con page's bilingual pairs (see
 * `app/lib/conContent.ts`). A blank half falls back to the other.
 */
export const useT = () => {
    const {isEnglish} = useLanguage();
    return (value: Localized) => eitherLanguage(isEnglish, value.en, value.zh);
};
