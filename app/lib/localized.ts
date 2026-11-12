/** Text for the reader's language: the Chinese, or the English when there's no Chinese. */
export const localized = (isEnglish: boolean, en: string, cn: string | undefined): string =>
    isEnglish ? en : (cn || en);

/** Like `localized`, but either language stands in for the other when it's missing. */
export const eitherLanguage = (isEnglish: boolean, en: string | undefined, cn: string | undefined): string =>
    (isEnglish ? en || cn : cn || en) ?? '';
