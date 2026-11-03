/* An event marked as a year's Sekai Beyond Con: upcoming while it's ahead,
   then a past event, which keeps the mark on archive. The home page's Con
   section shows one edition per year from these. */

/** Mirrors ConInfo in functions/src/utils/events.ts. */
export interface ConInfo {
    year: number;
}

/** A stored `con`: null for an event that isn't a Con. */
export function readConInfo(raw: unknown): ConInfo | null {
    if (!raw || typeof raw !== 'object') return null;
    const {year} = raw as Record<string, unknown>;
    if (typeof year !== 'number' || !Number.isInteger(year)) return null;
    return {year};
}
