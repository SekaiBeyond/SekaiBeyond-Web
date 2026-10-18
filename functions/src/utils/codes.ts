import { generateSecureCode } from "./helpers";

/**
 * Every reward code is typed into the same box, so a single-letter prefix names
 * the collection a code lives in.
 *
 * Older staff codes are bare CODE_BODY_LENGTH characters and still live, so
 * redeemCode tries a bare code as a staff code. Printed codes have to keep
 * working.
 */

const CODE_BODY_LENGTH = 12;

type CodeKind = "badge" | "staff" | "event";

// From CODE_ALPHABET, so nothing can be misread as I/1 or O/0.
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
 * The doc id for a typed code: case folded, dashes and spaces dropped. Null for
 * anything the per-kind callables would reject outright.
 */
export function normalizeCode(raw: unknown): string | null {
    if (typeof raw !== "string") return null;
    const cleaned = raw.replace(/[\s-]+/g, "").toUpperCase();
    return /^[A-Z0-9]{6,20}$/.test(cleaned) ? cleaned : null;
}

/**
 * What kind of code this is, or null for a bare one. A prefixed code is exactly
 * one character longer than a bare one, so a bare code starting with "B" is
 * never taken for a badge code; a passport id is shorter still.
 */
export function codeKind(canonical: string): CodeKind | null {
    if (canonical.length !== CODE_BODY_LENGTH + 1) return null;
    return KIND_BY_PREFIX.get(canonical[0]) ?? null;
}
