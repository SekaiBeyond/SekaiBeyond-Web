/**
 * Map a scan count to a heat color (cool blue → hot red) relative to the
 * busiest code in view. Zero scans render as a neutral grey so "never scanned"
 * reads as absent rather than merely cool.
 */
export function heatColor(count: number, max: number): string {
    if (count <= 0) return '#9aa0a6';
    const ratio = max > 0 ? Math.min(1, count / max) : 0;
    const hue = Math.round(210 - 210 * ratio); // 210 = blue, 0 = red
    return `hsl(${hue}, 85%, 48%)`;
}
