import { type ReactNode, useMemo, useState } from 'react';
import {
    Bar,
    BarChart,
    CartesianGrid,
    Cell,
    ComposedChart,
    Legend,
    Line,
    Pie,
    PieChart,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis,
} from 'recharts';
import { useLanguage } from '~/components/LanguageContextProvider';
import { type AttendeeData, TICKET_TYPES, type TicketType, ticketTypeLabel } from './types';
import { StatTile } from '../StatTile';
import { advance, bucketStart, formatBucketLabel, granularityForSpan } from '../timeBuckets';

interface StatsSectionProps {
    loading: boolean;
    error: string | null;
    attendees: AttendeeData[];
    onRefresh: () => void;
}

const TYPE_COLORS: Record<TicketType, string> = {
    normal: '#6c757d',
    'early-bird': '#ffc107',
    vip: '#e91e63',
    'Comp Ticket': '#28a745',
    guest: '#17a2b8',
    vendor: '#fd7e14',
};

const STATUS_COLORS = {
    redeemed: '#2196f3',
    unredeemed: '#4ecb71',
    voided: '#e05555',
};

interface ChartDatum {
    name: string;
    value: number;
    color: string;
}

interface TypeStatusDatum {
    name: string;
    redeemed: number;
    unredeemed: number;
}

interface TimelineEntry {
    date: Date;
    type: TicketType;
}

// Per-bucket row: a label, the running cumulative total, and one numeric field
// per ticket type (used as the dataKey for each stacked bar segment).
type TimelineDatum = {
    label: string;
    cumulative: number;
} & Partial<Record<TicketType, number>>;

interface Timeline {
    data: TimelineDatum[];
    types: TicketType[];
}

// Bucket entries by hour, day, or week depending on the span they cover. Each
// bucket is split by ticket type and accumulates a running total for the
// cumulative line. `types` lists the types that actually appear, in canonical
// order, so the chart only draws bars that carry data.
const buildTimeline = (entries: TimelineEntry[], isEnglish: boolean): Timeline => {
    if (entries.length === 0) return {data: [], types: []};
    const sorted = [...entries].sort((a, b) => a.date.getTime() - b.date.getTime());
    const granularity = granularityForSpan(sorted[0].date, sorted[sorted.length - 1].date);
    const bucketOf = bucketStart[granularity];

    const buckets = new Map<number, Partial<Record<TicketType, number>>>();
    const seen = new Set<TicketType>();
    for (const {date, type} of entries) {
        const key = bucketOf(date).getTime();
        const rec = buckets.get(key) ?? {};
        rec[type] = (rec[type] ?? 0) + 1;
        buckets.set(key, rec);
        seen.add(type);
    }

    const types = TICKET_TYPES.map(t => t.value).filter(v => seen.has(v));

    const data: TimelineDatum[] = [];
    let cumulative = 0;
    const cur = bucketOf(sorted[0].date);
    const end = bucketOf(sorted[sorted.length - 1].date);
    while (cur <= end) {
        const rec = buckets.get(cur.getTime()) ?? {};
        const datum: TimelineDatum = {label: formatBucketLabel(cur, granularity, isEnglish), cumulative: 0};
        for (const type of types) {
            const count = rec[type] ?? 0;
            datum[type] = count;
            cumulative += count;
        }
        datum.cumulative = cumulative;
        data.push(datum);
        advance[granularity](cur);
    }
    return {data, types};
};

export function StatsSection({loading, error, attendees, onRefresh}: StatsSectionProps) {
    const {isEnglish} = useLanguage();

    const stats = useMemo(() => {
        let totalTickets = 0;
        let voidedTickets = 0;
        let redeemedTickets = 0;
        let activeTickets = 0;

        const typeCounts: Record<string, number> = {};
        const redeemedByType: Record<string, number> = {};
        const unredeemedByType: Record<string, number> = {};
        const createdEntries: TimelineEntry[] = [];
        const redeemedEntries: TimelineEntry[] = [];

        for (const a of attendees) {
            for (const t of a.tickets) {
                totalTickets++;
                if (t.voided) {
                    voidedTickets++;
                } else {
                    activeTickets++;
                    if (t.redeemed) redeemedTickets++;
                }
                const type = t.type || 'normal';
                typeCounts[type] = (typeCounts[type] || 0) + 1;
                // Split active (non-voided) tickets per type into redeemed and
                // not-yet-redeemed for the per-type status breakdown.
                if (!t.voided) {
                    if (t.redeemed) {
                        redeemedByType[type] = (redeemedByType[type] || 0) + 1;
                    } else {
                        unredeemedByType[type] = (unredeemedByType[type] || 0) + 1;
                    }
                }
                // Fall back to the attendee timestamp for legacy tickets that
                // predate per-ticket createdAt.
                createdEntries.push({date: t.createdAt ?? a.createdAt, type});
                // Only tickets with a recorded redemption time feed the
                // redemption timeline (legacy redemptions may lack redeemedAt).
                if (t.redeemed && t.redeemedAt) redeemedEntries.push({date: t.redeemedAt, type});
            }
        }

        const typeData: ChartDatum[] = TICKET_TYPES
            .map(tt => ({
                name: isEnglish ? tt.labelEn : tt.labelCn,
                value: typeCounts[tt.value] || 0,
                color: TYPE_COLORS[tt.value],
            }))
            .filter(d => d.value > 0);

        const statusData: ChartDatum[] = [
            {
                name: isEnglish ? 'Redeemed' : '已验证',
                value: redeemedTickets,
                color: STATUS_COLORS.redeemed,
            },
            {
                name: isEnglish ? 'Unredeemed' : '未验证',
                value: activeTickets - redeemedTickets,
                color: STATUS_COLORS.unredeemed,
            },
            {
                name: isEnglish ? 'Voided' : '作废',
                value: voidedTickets,
                color: STATUS_COLORS.voided,
            },
        ].filter(d => d.value > 0);

        const typeStatusData: TypeStatusDatum[] = TICKET_TYPES
            .map(tt => ({
                name: isEnglish ? tt.labelEn : tt.labelCn,
                redeemed: redeemedByType[tt.value] || 0,
                unredeemed: unredeemedByType[tt.value] || 0,
            }))
            .filter(d => d.redeemed > 0 || d.unredeemed > 0);

        const redemptionRate = activeTickets > 0
            ? Math.round((redeemedTickets / activeTickets) * 100)
            : 0;

        const timeline = buildTimeline(createdEntries, isEnglish);
        const redemptionTimeline = buildTimeline(redeemedEntries, isEnglish);

        return {
            attendees: attendees.length,
            totalTickets,
            activeTickets,
            voidedTickets,
            redeemedTickets,
            redemptionRate,
            typeData,
            statusData,
            typeStatusData,
            timeline,
            redemptionTimeline,
        };
    }, [attendees, isEnglish]);

    if (loading && attendees.length === 0) {
        return (
            <div className="admin-tickets-stats-page">
                <div className="spinner spinner-centered"/>
            </div>
        );
    }

    if (error) {
        return (
            <div className="admin-tickets-stats-page">
                <p className="admin-no-results">{error}</p>
            </div>
        );
    }

    if (stats.attendees === 0) {
        return (
            <div className="admin-tickets-stats-page">
                <p className="admin-no-results">
                    {isEnglish ? 'No attendees yet.' : '暂无参加者。'}
                </p>
            </div>
        );
    }

    return (
        <div className="admin-tickets-stats-page">
            <div className="admin-tickets-stats-page-header">
                <h3>{isEnglish ? 'Ticket Statistics' : '门票统计'}</h3>
                <button
                    className="admin-toggle-btn admin-toggle-edit"
                    onClick={onRefresh}
                    disabled={loading}
                >
                    {loading
                        ? (isEnglish ? 'Loading...' : '加载中...')
                        : (isEnglish ? 'Refresh' : '刷新')}
                </button>
            </div>

            <div className="admin-stats-tiles">
                <StatTile
                    label={isEnglish ? 'Attendees' : '参加者'}
                    value={stats.attendees}
                />
                <StatTile
                    label={isEnglish ? 'Total Tickets' : '总门票'}
                    value={stats.totalTickets}
                />
                <StatTile
                    label={isEnglish ? 'Active Tickets' : '有效门票'}
                    value={stats.activeTickets}
                    sub={stats.voidedTickets > 0
                        ? (isEnglish
                            ? `${stats.voidedTickets} voided`
                            : `${stats.voidedTickets} 张已作废`)
                        : undefined}
                />
                <StatTile
                    label={isEnglish ? 'Redemption Rate' : '验证率'}
                    value={`${stats.redemptionRate}%`}
                    sub={`${stats.redeemedTickets} / ${stats.activeTickets}`}
                />
            </div>

            <div className="admin-stats-charts">
                <ChartCard title={isEnglish ? 'Tickets by Type' : '按类型分布'}>
                    {stats.typeData.length > 0 ? (
                        <ChartPie data={stats.typeData}/>
                    ) : (
                        <p className="admin-no-results">
                            {isEnglish ? 'No data.' : '暂无数据。'}
                        </p>
                    )}
                </ChartCard>

                <ChartCard title={isEnglish ? 'Ticket Status' : '门票状态'}>
                    {stats.statusData.length > 0 ? (
                        <ChartPie data={stats.statusData} donut/>
                    ) : (
                        <p className="admin-no-results">
                            {isEnglish ? 'No data.' : '暂无数据。'}
                        </p>
                    )}
                </ChartCard>
            </div>

            <div className="admin-stats-charts">
                <ChartCard
                    title={isEnglish ? 'Redeemed vs Not Redeemed by Type' : '各类型验证情况'}
                >
                    {stats.typeStatusData.length > 0 ? (
                        <ChartTypeStatus data={stats.typeStatusData} isEnglish={isEnglish}/>
                    ) : (
                        <p className="admin-no-results">
                            {isEnglish ? 'No data.' : '暂无数据。'}
                        </p>
                    )}
                </ChartCard>
            </div>

            <div className="admin-stats-charts">
                <ChartCard title={isEnglish ? 'Tickets Created Over Time' : '出票时间趋势'}>
                    {stats.timeline.data.length > 0 ? (
                        <ChartTimeline
                            data={stats.timeline.data}
                            types={stats.timeline.types}
                            isEnglish={isEnglish}
                        />
                    ) : (
                        <p className="admin-no-results">
                            {isEnglish ? 'No data.' : '暂无数据。'}
                        </p>
                    )}
                </ChartCard>
            </div>

            <div className="admin-stats-charts">
                <ChartCard title={isEnglish ? 'Redemptions Over Time' : '验证时间趋势'}>
                    {stats.redemptionTimeline.data.length > 0 ? (
                        <ChartTimeline
                            data={stats.redemptionTimeline.data}
                            types={stats.redemptionTimeline.types}
                            isEnglish={isEnglish}
                        />
                    ) : (
                        <p className="admin-no-results">
                            {isEnglish ? 'No tickets redeemed yet.' : '暂无验证记录。'}
                        </p>
                    )}
                </ChartCard>
            </div>
        </div>
    );
}

function ChartCard({title, children}: {title: string; children: ReactNode}) {
    return (
        <div className="admin-stats-card">
            <div className="admin-stats-card-title">{title}</div>
            <div className="admin-stats-card-body">{children}</div>
        </div>
    );
}

function ChartPie({data, donut}: {data: ChartDatum[]; donut?: boolean}) {
    return (
        <ResponsiveContainer width="100%" height={260}>
            <PieChart>
                <Pie
                    data={data}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    innerRadius={donut ? 50 : 0}
                    outerRadius={90}
                    paddingAngle={data.length > 1 ? 2 : 0}
                    label={(entry: {percent?: number}) => {
                        const pct = Math.round((entry.percent ?? 0) * 100);
                        return pct >= 5 ? `${pct}%` : '';
                    }}
                    labelLine={false}
                >
                    {data.map((d) => (
                        <Cell key={d.name} fill={d.color}/>
                    ))}
                </Pie>
                <Tooltip/>
                <Legend
                    verticalAlign="bottom"
                    iconType="circle"
                    wrapperStyle={{fontSize: '12px'}}
                />
            </PieChart>
        </ResponsiveContainer>
    );
}

function ChartTypeStatus(
    {data, isEnglish}: {data: TypeStatusDatum[]; isEnglish: boolean},
) {
    return (
        <ResponsiveContainer width="100%" height={260}>
            <BarChart data={data} margin={{top: 8, right: 8, left: -12, bottom: 0}}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(0, 0, 0, 0.06)"/>
                <XAxis dataKey="name" tick={{fontSize: 11}} interval={0}/>
                <YAxis allowDecimals={false} tick={{fontSize: 11}} width={32}/>
                <Tooltip/>
                <Legend
                    verticalAlign="bottom"
                    iconType="circle"
                    wrapperStyle={{fontSize: '12px'}}
                />
                <Bar
                    stackId="status"
                    dataKey="redeemed"
                    name={isEnglish ? 'Redeemed' : '已验证'}
                    fill={STATUS_COLORS.redeemed}
                    maxBarSize={56}
                />
                <Bar
                    stackId="status"
                    dataKey="unredeemed"
                    name={isEnglish ? 'Not Redeemed' : '未验证'}
                    fill={STATUS_COLORS.unredeemed}
                    maxBarSize={56}
                    radius={[3, 3, 0, 0]}
                />
            </BarChart>
        </ResponsiveContainer>
    );
}

const CUMULATIVE_KEY = 'cumulative';

function ChartTimeline(
    {data, types, isEnglish}: {data: TimelineDatum[]; types: TicketType[]; isEnglish: boolean},
) {
    // dataKeys the user has toggled off via the legend (ticket types and/or
    // the cumulative line).
    const [hidden, setHidden] = useState<Set<string>>(new Set());

    const toggle = (key?: string) => {
        if (!key) return;
        setHidden(prev => {
            const next = new Set(prev);
            if (next.has(key)) {
                next.delete(key);
            } else {
                next.add(key);
            }
            return next;
        });
    };

    // Round only the top segment of each bar — i.e. the last visible type.
    const topVisibleType = [...types].reverse().find(t => !hidden.has(t));

    return (
        <ResponsiveContainer width="100%" height={300}>
            <ComposedChart data={data} margin={{top: 8, right: 8, left: -12, bottom: 0}}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(0, 0, 0, 0.06)"/>
                <XAxis
                    dataKey="label"
                    tick={{fontSize: 11}}
                    interval="preserveStartEnd"
                    minTickGap={24}
                />
                <YAxis yAxisId="left" allowDecimals={false} tick={{fontSize: 11}} width={32}/>
                <YAxis
                    yAxisId="right"
                    orientation="right"
                    allowDecimals={false}
                    tick={{fontSize: 11}}
                    width={32}
                />
                <Tooltip/>
                <Legend
                    verticalAlign="top"
                    iconType="circle"
                    wrapperStyle={{fontSize: '12px', cursor: 'pointer'}}
                    onClick={(e) => toggle((e as {dataKey?: string}).dataKey)}
                    formatter={(value, entry) => {
                        const key = (entry as {dataKey?: string} | undefined)?.dataKey;
                        return (
                            <span style={{color: key && hidden.has(key) ? '#bbb' : 'inherit'}}>
                                {value}
                            </span>
                        );
                    }}
                />
                {types.map((type) => (
                    <Bar
                        key={type}
                        yAxisId="left"
                        stackId="created"
                        dataKey={type}
                        name={ticketTypeLabel(type, isEnglish)}
                        fill={TYPE_COLORS[type]}
                        maxBarSize={48}
                        hide={hidden.has(type)}
                        radius={type === topVisibleType ? [3, 3, 0, 0] : undefined}
                    />
                ))}
                <Line
                    yAxisId="right"
                    type="monotone"
                    dataKey={CUMULATIVE_KEY}
                    name={isEnglish ? 'Cumulative' : '累计'}
                    stroke="#6c5ce7"
                    strokeWidth={2}
                    dot={false}
                    hide={hidden.has(CUMULATIVE_KEY)}
                />
            </ComposedChart>
        </ResponsiveContainer>
    );
}
