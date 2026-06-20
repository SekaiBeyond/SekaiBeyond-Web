import { useMemo, useState } from 'react';
import { useLanguage } from '~/components/LanguageContextProvider';
import { type QrCode, qrHasSpot, qrIsActive } from '~/lib/qrCodes';
import type { UpcomingEvent } from '~/lib/upcomingEvents';
import { heatColor } from './heat';
import { QrSpotsMap } from './QrSpotsMap';

type EventFilter = 'all' | 'none' | string;

interface QrDashboardProps {
    codes: QrCode[];
    events: UpcomingEvent[];
    loading: boolean;
    onSelect: (id: string) => void;
    onCreate: () => void;
    onScanLink: () => void;
    onRefresh: () => Promise<void>;
    readOnly: boolean;
}

export const QrDashboard = ({
                                codes,
                                events,
                                loading,
                                onSelect,
                                onCreate,
                                onScanLink,
                                onRefresh,
                                readOnly
                            }: QrDashboardProps) => {
    const {isEnglish} = useLanguage();
    const [eventFilter, setEventFilter] = useState<EventFilter>('all');
    const [refreshing, setRefreshing] = useState(false);

    const eventEnd = useMemo(() => {
        const m = new Map<string, Date>();
        for (const e of events) m.set(e.id, e.endAt);
        return m;
    }, [events]);

    const eventTitle = (id: string): string => {
        const e = events.find(ev => ev.id === id);
        if (!e) return isEnglish ? 'Archived event' : '已归档活动';
        return isEnglish ? e.title : (e.titleCn || e.title);
    };

    // Only events actually referenced by a code appear in the filter, so the
    // dropdown stays short and meaningful.
    const usedEventIds = useMemo(() => {
        const s = new Set<string>();
        for (const c of codes) if (c.eventId) s.add(c.eventId);
        return [...s];
    }, [codes]);

    const filtered = useMemo(() => {
        const list = codes.filter(c => {
            if (eventFilter === 'all') return true;
            if (eventFilter === 'none') return !c.eventId;
            return c.eventId === eventFilter;
        });
        return [...list].sort((a, b) => b.scanCount - a.scanCount);
    }, [codes, eventFilter]);

    const maxCount = filtered.reduce((m, c) => Math.max(m, c.scanCount), 0);
    const totalScans = filtered.reduce((s, c) => s + c.scanCount, 0);
    const spotCount = filtered.filter(qrHasSpot).length;
    const activeCount = filtered.filter(c => qrIsActive(c, eventEnd.get(c.eventId) ?? null)).length;

    const doRefresh = async () => {
        setRefreshing(true);
        try {
            await onRefresh();
        } finally {
            setRefreshing(false);
        }
    };

    return (
        <div className="admin-section">
            <div className="admin-tools-header">
                <h3 className="admin-tools-title">{isEnglish ? 'QR Codes' : '二维码'}</h3>
                <div className="admin-btn-row">
                    <button className="admin-toggle-btn admin-toggle-edit" onClick={doRefresh} disabled={refreshing}>
                        {refreshing ? (isEnglish ? 'Loading...' : '加载中...') : (isEnglish ? 'Refresh' : '刷新')}
                    </button>
                    {!readOnly && (
                        <button className="admin-toggle-btn admin-toggle-save" onClick={onCreate}>
                            {isEnglish ? '+ New QR Code' : '+ 新建二维码'}
                        </button>
                    )}
                </div>
            </div>

            {!readOnly && (
                <button className="admin-qr-scan-banner admin-section-mb" onClick={onScanLink} type="button">
                    <span className="admin-qr-scan-banner-icon">📷</span>
                    <span>
                        <span className="admin-qr-scan-banner-title">
                            {isEnglish ? 'Link a code by scanning' : '扫码关联位置'}
                        </span>
                        <span className="admin-qr-scan-banner-sub">
                            {isEnglish
                                ? 'Scan a printed code on your phone to pin it to your current location.'
                                : '用手机扫描已打印的二维码，将其关联到你的当前位置。'}
                        </span>
                    </span>
                </button>
            )}

            <div className="admin-stats-tiles admin-section-mb">
                <Tile label={isEnglish ? 'QR Codes' : '二维码数'} value={filtered.length}/>
                <Tile label={isEnglish ? 'Total Scans' : '总扫描数'} value={totalScans}/>
                <Tile label={isEnglish ? 'Active' : '有效'} value={activeCount}/>
                <Tile label={isEnglish ? 'On Map' : '已定位'} value={spotCount}/>
            </div>

            <div className="admin-form-grid admin-section-mb">
                <label>
                    <span>{isEnglish ? 'Filter by Event' : '按活动筛选'}</span>
                    <select
                        value={eventFilter}
                        onChange={e => setEventFilter(e.target.value)}
                        className="admin-search-input"
                    >
                        <option value="all">{isEnglish ? 'All codes' : '全部'}</option>
                        <option value="none">{isEnglish ? 'No event linked' : '未关联活动'}</option>
                        {usedEventIds.map(id => (
                            <option key={id} value={id}>{eventTitle(id)}</option>
                        ))}
                    </select>
                </label>
            </div>

            {loading && codes.length === 0 ? (
                <div className="profile-spinner admin-spinner-center"/>
            ) : filtered.length === 0 ? (
                <p className="admin-no-results">
                    {codes.length === 0
                        ? (isEnglish ? 'No QR codes yet. Create one to start tracking scans.' : '暂无二维码。创建一个即可开始追踪扫描。')
                        : (isEnglish ? 'No QR codes match this filter.' : '没有符合筛选条件的二维码。')}
                </p>
            ) : (
                <>
                    {spotCount > 0 && (
                        <div className="admin-field-section">
                            <span className="admin-field-label">{isEnglish ? 'Scan Hotspots' : '扫描热点'}</span>
                            <QrSpotsMap codes={filtered} onSelect={onSelect}/>
                        </div>
                    )}

                    <div className="admin-qr-list">
                        {filtered.map(code => {
                            const active = qrIsActive(code, eventEnd.get(code.eventId) ?? null);
                            return (
                                <button key={code.id} className="admin-qr-row" onClick={() => onSelect(code.id)}>
                                    <span
                                        className="admin-qr-count"
                                        style={{background: heatColor(code.scanCount, maxCount)}}
                                        title={isEnglish ? `${code.scanCount} scans` : `${code.scanCount} 次扫描`}
                                    >
                                        {code.scanCount}
                                    </span>
                                    <span className="admin-qr-row-main">
                                        <span className="admin-qr-row-title">
                                            {code.label}
                                            {!active && (
                                                <span className="admin-qr-badge admin-qr-badge-expired">
                                                    {isEnglish ? 'Expired' : '已过期'}
                                                </span>
                                            )}
                                        </span>
                                        <span className="admin-qr-row-sub">{code.targetUrl}</span>
                                        <span className="admin-qr-row-tags">
                                            {code.eventId && (
                                                <span className="admin-qr-chip">{eventTitle(code.eventId)}</span>
                                            )}
                                            {qrHasSpot(code) && (
                                                <span className="admin-qr-chip admin-qr-chip-spot">
                                                    {isEnglish ? '📍 On map' : '📍 已定位'}
                                                </span>
                                            )}
                                        </span>
                                    </span>
                                </button>
                            );
                        })}
                    </div>
                </>
            )}
        </div>
    );
};

function Tile({label, value}: {label: string; value: number}) {
    return (
        <div className="admin-stats-tile">
            <div className="admin-stats-tile-label">{label}</div>
            <div className="admin-stats-tile-value">{value}</div>
        </div>
    );
}
