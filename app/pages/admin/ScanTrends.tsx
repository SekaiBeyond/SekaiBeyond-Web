import { useCallback, useEffect, useMemo, useState } from 'react';
import { Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis, } from 'recharts';
import { useLanguage } from '~/components/LanguageContextProvider';
import type { ScanEvent } from '~/lib/scans';
import { type SocialPlatform, socialPlatformName, useSocialPlatforms } from '~/lib/socialPlatforms';
import { advance, bucketStart, formatBucketLabel, granularityForSpan } from './timeBuckets';

/**
 * The scan history of anything scannable. QR codes and passports write the same
 * {@link ScanEvent} shape, so this lives beside the admin panel rather than
 * inside either feature's folder — the platform series below is simply empty for
 * a subject that doesn't tag its scans.
 */

// Fixed palette for platform series, assigned in platform order and never
// cycled. Validated for adjacent-pair colorblind separation on the app's white
// surface; slot 1 is the app pink so single-series charts keep their old look,
// and #6c5ce7 stays reserved for the cumulative line.
const SERIES_COLORS = [
    '#ff6b9d', '#2a78d6', '#eda100', '#008300', '#e34948',
    '#1baf7a', '#eb6834', '#4a3aa7', '#a05a2c',
];
// Untagged scans (and platforms past the last slot) go neutral so they never
// impersonate a tracked platform.
const UNTAGGED_COLOR = '#8a8987';
const CUMULATIVE_COLOR = '#6c5ce7';

interface PlatformSeries {
    /** Platform id; '' is the untagged "Direct" bucket. */
    id: string;
    /** Datum key — platform ids are user data, so they're namespaced. */
    key: string;
    name: string;
    color: string;
}

/**
 * One series per platform the code tracks (or that appears in its history —
 * removed platforms keep their scans), plus a "Direct" bucket when untagged
 * scans exist. Empty for a plain location code, which charts as one series.
 */
function buildPlatformSeries(
    scans: ScanEvent[],
    platforms: string[],
    defs: SocialPlatform[],
    isEnglish: boolean,
): PlatformSeries[] {
    const ids = [...platforms];
    for (const s of scans) {
        if (s.platform && !ids.includes(s.platform)) ids.push(s.platform);
    }
    if (ids.length === 0) return [];
    const list: PlatformSeries[] = ids.map((id, i) => ({
        id,
        key: `p:${id}`,
        name: socialPlatformName(id, isEnglish, defs),
        color: SERIES_COLORS[i] ?? UNTAGGED_COLOR,
    }));
    if (scans.some(s => !s.platform)) {
        list.push({id: '', key: 'p:', name: isEnglish ? 'Direct' : '直接访问', color: UNTAGGED_COLOR});
    }
    return list;
}

interface Datum {
    label: string;
    cumulative: number;

    /** Per-series bucket counts under `p:<platform id>` keys. */
    [seriesKey: string]: number | string;
}

// Bucket scan timestamps into hour/day/week slots (chosen by overall span),
// counted per series, and carry a running cumulative total so the chart shows
// both pace and reach.
function buildSeries(scans: ScanEvent[], seriesKeys: string[], isEnglish: boolean): Datum[] {
    if (scans.length === 0) return [];
    const sorted = [...scans].sort((a, b) => a.at.getTime() - b.at.getTime());
    const g = granularityForSpan(sorted[0].at, sorted[sorted.length - 1].at);
    const bucketOf = bucketStart[g];

    const counts = new Map<number, Map<string, number>>();
    for (const s of sorted) {
        const t = bucketOf(s.at).getTime();
        const bucket = counts.get(t) ?? new Map<string, number>();
        const key = `p:${s.platform}`;
        bucket.set(key, (bucket.get(key) ?? 0) + 1);
        counts.set(t, bucket);
    }

    const data: Datum[] = [];
    let cumulative = 0;
    const cur = bucketOf(sorted[0].at);
    const end = bucketOf(sorted[sorted.length - 1].at);
    while (cur <= end) {
        const bucket = counts.get(cur.getTime());
        const row: Datum = {label: formatBucketLabel(cur, g, isEnglish), cumulative: 0};
        for (const key of seriesKeys) {
            const n = bucket?.get(key) ?? 0;
            row[key] = n;
            cumulative += n;
        }
        row.cumulative = cumulative;
        data.push(row);
        advance[g](cur);
    }
    return data;
}

/**
 * The "Scans Over Time" panel as a detail page mounts it: loads the subject's
 * scans, offers a refresh, and hands them to {@link ScanTrends}. `fetchScans`
 * has to be a stable reference (the module-level fetchQrScans /
 * fetchPassportScans), since it is what re-triggers the load.
 */
export function ScanTrendsSection({id, fetchScans, platforms}: {
    id: string;
    fetchScans: (id: string) => Promise<ScanEvent[]>;
    platforms?: string[];
}) {
    const {isEnglish} = useLanguage();
    const [scans, setScans] = useState<ScanEvent[] | null>(null);
    const [failed, setFailed] = useState(false);

    const load = useCallback(() => {
        setFailed(false);
        setScans(null);
        fetchScans(id)
            .then(setScans)
            .catch(() => setFailed(true));
    }, [id, fetchScans]);
    useEffect(load, [load]);

    return (
        <div className="admin-field-section admin-qr-section">
            <div className="admin-qr-spot-header">
                <span className="admin-field-label">{isEnglish ? 'Scans Over Time' : '扫描时间趋势'}</span>
                <button className="admin-toggle-btn admin-toggle-edit admin-btn-sm" onClick={load}>
                    {isEnglish ? 'Refresh' : '刷新'}
                </button>
            </div>
            {failed ? (
                <p className="admin-no-results">{isEnglish ? 'Failed to load scans.' : '加载扫描记录失败。'}</p>
            ) : scans === null ? (
                <div className="spinner spinner-centered"/>
            ) : (
                <ScanTrends key={id} scans={scans} platforms={platforms}/>
            )}
        </div>
    );
}

interface ScanTrendsProps {
    scans: ScanEvent[];
    /** The subject's platform ids — fixes series order and colors (social codes). */
    platforms?: string[];
}

export function ScanTrends({scans, platforms = []}: ScanTrendsProps) {
    const {isEnglish} = useLanguage();
    const {platforms: platformDefs} = useSocialPlatforms();
    // Platform id being viewed ('' = the Direct bucket); null = all stacked.
    const [selected, setSelected] = useState<string | null>(null);

    const series = useMemo(
        () => buildPlatformSeries(scans, platforms, platformDefs, isEnglish),
        [scans, platforms, platformDefs, isEnglish],
    );

    // A location code has no platform series and charts as one pink bar series.
    const barSeries = useMemo<PlatformSeries[]>(() => series.length > 0
            ? (selected === null ? series : series.filter(sr => sr.id === selected))
            : [{id: '', key: 'p:', name: isEnglish ? 'Scans' : '扫描数', color: SERIES_COLORS[0]}],
        [series, selected, isEnglish]);

    const data = useMemo(() => {
        const chartScans = selected === null || series.length === 0
            ? scans
            : scans.filter(s => s.platform === selected);
        return buildSeries(chartScans, barSeries.map(sr => sr.key), isEnglish);
    }, [scans, series, selected, barSeries, isEnglish]);

    if (scans.length === 0) {
        return (
            <p className="admin-no-results">
                {isEnglish ? 'No scans recorded yet.' : '暂无扫描记录。'}
            </p>
        );
    }

    return (
        <>
            {series.length > 1 && (
                <div className="admin-qr-trend-pills">
                    <button
                        className={`admin-btn admin-btn--chip admin-btn-sm ${selected === null ? 'admin-btn--chip-active' : ''}`}
                        onClick={() => setSelected(null)}
                        type="button"
                    >
                        {isEnglish ? 'All platforms' : '全部平台'}
                    </button>
                    {series.map(sr => (
                        <button
                            key={sr.key}
                            className={`admin-btn admin-btn--chip admin-btn-sm ${selected === sr.id ? 'admin-btn--chip-active' : ''}`}
                            onClick={() => setSelected(sr.id)}
                            type="button"
                        >
                            <span className="admin-qr-trend-dot" style={{background: sr.color}}/>
                            {sr.name}
                        </button>
                    ))}
                </div>
            )}
            {data.length === 0 ? (
                <p className="admin-no-results">
                    {isEnglish ? 'No scans for this platform yet.' : '该平台暂无扫描记录。'}
                </p>
            ) : (
                <ResponsiveContainer width="100%" height={280}>
                    <ComposedChart data={data} margin={{top: 8, right: 8, left: -12, bottom: 0}}>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(0, 0, 0, 0.06)"/>
                        <XAxis dataKey="label" tick={{fontSize: 11}} interval="preserveStartEnd" minTickGap={24}/>
                        <YAxis yAxisId="left" allowDecimals={false} tick={{fontSize: 11}} width={32}/>
                        <YAxis yAxisId="right" orientation="right" allowDecimals={false} tick={{fontSize: 11}}
                               width={32}/>
                        <Tooltip/>
                        {/* Keep legend entries in series (stack) order, Cumulative last —
                            the default sorts by name, and mount order shifts as pills toggle. */}
                        <Legend verticalAlign="top" iconType="circle" wrapperStyle={{fontSize: '12px'}}
                                itemSorter={item => {
                                    const i = barSeries.findIndex(sr => sr.key === item.dataKey);
                                    return i === -1 ? barSeries.length : i;
                                }}/>
                        {barSeries.map((sr, i) => (
                            <Bar
                                key={sr.key}
                                yAxisId="left"
                                stackId="scans"
                                dataKey={sr.key}
                                name={sr.name}
                                fill={sr.color}
                                stroke={barSeries.length > 1 ? '#fff' : undefined}
                                strokeWidth={barSeries.length > 1 ? 1 : 0}
                                maxBarSize={48}
                                radius={i === barSeries.length - 1 ? [3, 3, 0, 0] : undefined}
                            />
                        ))}
                        <Line
                            yAxisId="right"
                            type="monotone"
                            dataKey="cumulative"
                            name={isEnglish ? 'Cumulative' : '累计'}
                            stroke={CUMULATIVE_COLOR}
                            strokeWidth={2}
                            dot={false}
                        />
                    </ComposedChart>
                </ResponsiveContainer>
            )}
        </>
    );
}
