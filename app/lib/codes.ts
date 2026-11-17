const CODE_BODY_LENGTH = 12;
const KIND_PREFIXES = 'BSE';

export const formatCode = (code: string): string =>
    code.length === CODE_BODY_LENGTH + 1 && KIND_PREFIXES.includes(code[0])
        ? `${code[0]}-${code.slice(1)}`
        : code;
