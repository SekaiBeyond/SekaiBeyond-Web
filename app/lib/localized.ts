export const localized = (isEnglish: boolean, en: string, cn: string | undefined): string =>
    isEnglish ? en : (cn || en);

export const eitherLanguage = (isEnglish: boolean, en: string | undefined, cn: string | undefined): string =>
    (isEnglish ? en || cn : cn || en) ?? '';
