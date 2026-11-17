export interface ConInfo {
    year: number;
}

export function readConInfo(raw: unknown): ConInfo | null {
    if (!raw || typeof raw !== 'object') return null;
    const {year} = raw as Record<string, unknown>;
    if (typeof year !== 'number' || !Number.isInteger(year)) return null;
    return {year};
}
