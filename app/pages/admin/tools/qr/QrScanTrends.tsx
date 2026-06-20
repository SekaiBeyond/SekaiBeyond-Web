import { useMemo } from 'react';
import { Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis, } from 'recharts';
import { useLanguage } from '~/components/LanguageContextProvider';

type Granularity = 'hour' | 'day' | 'week';

const startOfHour = (d: Date): Date =>
    new Date(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours());
const startOfDay = (d: Date): Date => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const startOfWeek = (d: Date): Date => {
    const s = startOfDay(d);
    s.setDate(s.getDate() - s.getDay());
    return s;
};

const bucketStart: Record<Granularity, (d: Date) => Date> = {
    hour: startOfHour,
    day: startOfDay,
    week: startOfWeek,
};
const advance: Record<Granularity, (d: Date) => void> = {
    hour: d => d.setHours(d.getHours() + 1),
    day: d => d.setDate(d.getDate() + 1),
    week: d => d.setDate(d.getDate() + 7),
};

const formatLabel = (d: Date, g: Granularity, isEnglish: boolean): string => {
    if (g === 'hour') {
        return isEnglish
            ? d.toLocaleString('en-US', {month: 'short', day: 'numeric', hour: 'numeric'})
            : `${d.getMonth() + 1}月${d.getDate()}日 ${d.getHours()}时`;
    }
    return isEnglish
        ? `${d.toLocaleDateString('en-US', {month: 'short'})} ${d.getDate()}`
        : `${d.getMonth() + 1}月${d.getDate()}日`;
};

interface Datum {
    label: string;
    scans: number;
    cumulative: number;
}

// Bucket scan timestamps into hour/day/week slots (chosen by overall span) and
// carry a running cumulative total so the chart shows both pace and reach.
function buildSeries(scans: Date[], isEnglish: boolean): Datum[] {
    if (scans.length === 0) return [];
    const sorted = [...scans].sort((a, b) => a.getTime() - b.getTime());
    const spanDays = (sorted[sorted.length - 1].getTime() - sorted[0].getTime()) / 86_400_000;
    const g: Granularity = spanDays <= 2 ? 'hour' : spanDays > 92 ? 'week' : 'day';
    const bucketOf = bucketStart[g];

    const counts = new Map<number, number>();
    for (const d of scans) {
        const key = bucketOf(d).getTime();
        counts.set(key, (counts.get(key) ?? 0) + 1);
    }

    const data: Datum[] = [];
    let cumulative = 0;
    const cur = bucketOf(sorted[0]);
    const end = bucketOf(sorted[sorted.length - 1]);
    while (cur <= end) {
        const n = counts.get(cur.getTime()) ?? 0;
        cumulative += n;
        data.push({label: formatLabel(cur, g, isEnglish), scans: n, cumulative});
        advance[g](cur);
    }
    return data;
}

export function QrScanTrends({scans}: {scans: Date[]}) {
    const {isEnglish} = useLanguage();
    const data = useMemo(() => buildSeries(scans, isEnglish), [scans, isEnglish]);

    if (data.length === 0) {
        return (
            <p className="admin-no-results">
                {isEnglish ? 'No scans recorded yet.' : '暂无扫描记录。'}
            </p>
        );
    }

    return (
        <ResponsiveContainer width="100%" height={280}>
            <ComposedChart data={data} margin={{top: 8, right: 8, left: -12, bottom: 0}}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(0, 0, 0, 0.06)"/>
                <XAxis dataKey="label" tick={{fontSize: 11}} interval="preserveStartEnd" minTickGap={24}/>
                <YAxis yAxisId="left" allowDecimals={false} tick={{fontSize: 11}} width={32}/>
                <YAxis yAxisId="right" orientation="right" allowDecimals={false} tick={{fontSize: 11}} width={32}/>
                <Tooltip/>
                <Legend verticalAlign="top" iconType="circle" wrapperStyle={{fontSize: '12px'}}/>
                <Bar
                    yAxisId="left"
                    dataKey="scans"
                    name={isEnglish ? 'Scans' : '扫描数'}
                    fill="#ff6b9d"
                    maxBarSize={48}
                    radius={[3, 3, 0, 0]}
                />
                <Line
                    yAxisId="right"
                    type="monotone"
                    dataKey="cumulative"
                    name={isEnglish ? 'Cumulative' : '累计'}
                    stroke="#6c5ce7"
                    strokeWidth={2}
                    dot={false}
                />
            </ComposedChart>
        </ResponsiveContainer>
    );
}
