/**
 * One figure in an `admin-stats-tiles` row.
 *
 * `small` is for a value that is text rather than a count — a date, a term —
 * which would otherwise overflow the tile at the headline size.
 */
export function StatTile({label, value, sub, small}: {
    label: string;
    value: number | string;
    sub?: string;
    small?: boolean;
}) {
    return (
        <div className="admin-stats-tile">
            <div className="admin-stats-tile-label">{label}</div>
            <div className={`admin-stats-tile-value${small ? ' admin-stats-tile-value--sm' : ''}`}>{value}</div>
            {sub && <div className="admin-stats-tile-sub">{sub}</div>}
        </div>
    );
}
