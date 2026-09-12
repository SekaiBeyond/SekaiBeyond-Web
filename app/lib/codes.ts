/**
 * Reward codes issued since the prefix exists carry a letter naming their kind
 * — B badge, S staff, E event — ahead of a body of CODE_BODY_LENGTH. Mirrors
 * functions/src/utils/codes.ts, which issues them and reads them back.
 */
const CODE_BODY_LENGTH = 12;
const KIND_PREFIXES = 'BSE';

/**
 * A code the way it should be printed or read aloud, with the prefix set off
 * from the body. Codes that predate the prefix are shown exactly as stored.
 *
 * The dash is legibility only — every path that looks a code up drops it again,
 * so the dashed form pastes back in as readily as the bare one.
 */
export const formatCode = (code: string): string =>
    code.length === CODE_BODY_LENGTH + 1 && KIND_PREFIXES.includes(code[0])
        ? `${code[0]}-${code.slice(1)}`
        : code;
