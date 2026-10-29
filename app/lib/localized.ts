/** Text for the reader's language: the Chinese, or the English when there's no Chinese. */
export const localized = (isEnglish: boolean, en: string, cn: string | undefined): string =>
    isEnglish ? en : (cn || en);
