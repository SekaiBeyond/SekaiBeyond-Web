import { generateSecureCode } from "./helpers";

const CODE_BODY_LENGTH = 12;

export type CodeKind = "badge" | "staff" | "event";

const PREFIX_BY_KIND: Record<CodeKind, string> = {
    badge: "B",
    staff: "S",
    event: "E",
};

const KIND_BY_PREFIX = new Map<string, CodeKind>(
    Object.entries(PREFIX_BY_KIND).map(([kind, prefix]) => [prefix, kind as CodeKind]),
);

export function issueCode(kind: CodeKind): string {
    return PREFIX_BY_KIND[kind] + generateSecureCode(CODE_BODY_LENGTH);
}

export function normalizeCode(raw: unknown): string | null {
    if (typeof raw !== "string") return null;
    const cleaned = raw.replace(/[\s-]+/g, "").toUpperCase();
    return /^[A-Z0-9]{6,20}$/.test(cleaned) ? cleaned : null;
}

export function codeKind(canonical: string): CodeKind | null {
    if (canonical.length !== CODE_BODY_LENGTH + 1) return null;
    return KIND_BY_PREFIX.get(canonical[0]) ?? null;
}
