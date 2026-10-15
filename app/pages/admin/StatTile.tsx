/** One figure in an `admin-stats-tiles` row. */
export function StatTile({label, value, sub}: {
    label: string;
    value: number | string;
    sub?: string;
}) {
    return (
        <div className="admin-stats-tile">
            <div className="admin-stats-tile-label">{label}</div>
            <div className="admin-stats-tile-value">{value}</div>
            {sub && <div className="admin-stats-tile-sub">{sub}</div>}
        </div>
    );
}
