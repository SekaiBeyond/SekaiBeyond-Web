import { generateSecureCode } from "./helpers";

/**
 * Every reward code is typed into the same box, so the box has to work out what
 * kind of code it was handed. Codes issued from here say so themselves: a
 * single-letter prefix names the collection the code lives in.
 *
 * Codes issued before the prefix are bare CODE_BODY_LENGTH characters and name
 * nothing, so redeemCode still has to try them against each collection in turn.
 * Nothing is reissued — a code already printed on a flyer has to keep working.
 */

export const CODE_BODY_LENGTH = 12;

export type CodeKind = "badge" | "staff" | "event";

// Drawn from CODE_ALPHABET so the prefix survives the same transcription as the
// body it precedes: nothing here can be misread as I/1 or O/0.
const PREFIX_BY_KIND: Record<CodeKind, string> = {
    badge: "B",
    staff: "S",
    event: "E",
};

const KIND_BY_PREFIX = new Map<string, CodeKind>(
    Object.entries(PREFIX_BY_KIND).map(([kind, prefix]) => [prefix, kind as CodeKind]),
);

/** A fresh code of `kind`: its prefix, then CODE_BODY_LENGTH random characters. */
export function issueCode(kind: CodeKind): string {
    return PREFIX_BY_KIND[kind] + generateSecureCode(CODE_BODY_LENGTH);
}

/**
 * The document id for a code someone typed: case folded, with the dashes we
 * print for legibility (and any spaces the reader adds) dropped. Null for
 * anything the per-kind callables would have rejected outright.
 */
export function normalizeCode(raw: unknown): string | null {
    if (typeof raw !== "string") return null;
    const cleaned = raw.replace(/[\s-]+/g, "").toUpperCase();
    return /^[A-Z0-9]{6,20}$/.test(cleaned) ? cleaned : null;
}

/**
 * What kind of code this is, or null when it predates the prefix.
 *
 * Length is what separates the two generations: a prefixed code is exactly one
 * character longer than the bare ones it sits alongside, so a legacy code that
 * merely starts with a "B" is never mistaken for a badge code. A passport id is
 * shorter still, and so never claims a kind here either.
 */
export function codeKind(canonical: string): CodeKind | null {
    if (canonical.length !== CODE_BODY_LENGTH + 1) return null;
    return KIND_BY_PREFIX.get(canonical[0]) ?? null;
}
