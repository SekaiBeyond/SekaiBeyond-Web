import { type ReactNode, useMemo } from 'react';
import { Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import { useLanguage } from '~/components/LanguageContextProvider';
import { type AttendeeData, TICKET_TYPES, type TicketType } from './types';

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

export function StatsSection({loading, error, attendees, onRefresh}: StatsSectionProps) {
    const {isEnglish} = useLanguage();

    const stats = useMemo(() => {
        let totalTickets = 0;
        let voidedTickets = 0;
        let redeemedTickets = 0;
        let activeTickets = 0;

        const typeCounts: Record<string, number> = {};

        for (const a of attendees) {
            for (const t of a.tickets) {
                totalTickets++;
                if (t.voided) {
                    voidedTickets++;
                } else {
                    activeTickets++;
                    if (t.redeemed) redeemedTickets++;
                }
                const key = t.type || 'normal';
                typeCounts[key] = (typeCounts[key] || 0) + 1;
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

        const redemptionRate = activeTickets > 0
            ? Math.round((redeemedTickets / activeTickets) * 100)
            : 0;

        return {
            attendees: attendees.length,
            totalTickets,
            activeTickets,
            voidedTickets,
            redeemedTickets,
            redemptionRate,
            typeData,
            statusData,
        };
    }, [attendees, isEnglish]);

    if (loading && attendees.length === 0) {
        return (
            <div className="admin-tickets-stats-page">
                <div className="profile-spinner admin-spinner-center"/>
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
        </div>
    );
}

function StatTile({label, value, sub}: {label: string; value: number | string; sub?: string}) {
    return (
        <div className="admin-stats-tile">
            <div className="admin-stats-tile-label">{label}</div>
            <div className="admin-stats-tile-value">{value}</div>
            {sub && <div className="admin-stats-tile-sub">{sub}</div>}
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
