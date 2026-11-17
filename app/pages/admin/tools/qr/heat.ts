export function heatColor(count: number, max: number): string {
    if (count <= 0) return '#9aa0a6';
    const ratio = max > 0 ? Math.min(1, count / max) : 0;
    const hue = Math.round(210 - 210 * ratio);
    return `hsl(${hue}, 85%, 48%)`;
}
