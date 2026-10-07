import { useLanguage } from '~/components/LanguageContextProvider';

/** A string that exists in both site languages. */
export type Localized = {en: string; zh: string};

export type ConLanguage = 'en' | 'zh';

/**
 * The con page keeps its copy in bilingual pairs (see `content.ts`), so it reads
 * the shared language context through this helper instead of writing
 * `isEnglish ? ... : ...` at every call site.
 *
 * Either half of an admin-written pair may be left blank, so a missing one falls
 * back to the other rather than leaving a gap on the page.
 */
export const useT = () => {
    const {isEnglish} = useLanguage();
    return (value: Localized) => (isEnglish ? (value.en || value.zh) : (value.zh || value.en));
};
