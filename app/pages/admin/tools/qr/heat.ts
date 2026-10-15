/**
 * A scan count as a heat colour, cool blue to hot red, relative to the busiest
 * code in view. Zero is grey, so "never scanned" reads as absent.
 */
export function heatColor(count: number, max: number): string {
    if (count <= 0) return '#9aa0a6';
    const ratio = max > 0 ? Math.min(1, count / max) : 0;
    const hue = Math.round(210 - 210 * ratio); // 210 = blue, 0 = red
    return `hsl(${hue}, 85%, 48%)`;
}
