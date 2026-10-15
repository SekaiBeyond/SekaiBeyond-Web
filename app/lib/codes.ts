/**
 * Prefixed reward codes start with a letter naming their kind (B badge, S
 * staff, E event) before a CODE_BODY_LENGTH body. Mirrors
 * functions/src/utils/codes.ts.
 */
const CODE_BODY_LENGTH = 12;
const KIND_PREFIXES = 'BSE';

/**
 * A code as printed or read aloud, with the prefix set off by a dash; bare
 * codes are shown as stored. Every lookup drops the dash again, so either form
 * pastes back in.
 */
export const formatCode = (code: string): string =>
    code.length === CODE_BODY_LENGTH + 1 && KIND_PREFIXES.includes(code[0])
        ? `${code[0]}-${code.slice(1)}`
        : code;
