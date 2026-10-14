import { useState } from 'react';
import { useLanguage } from '~/components/LanguageContextProvider';
import { callSyncUwParking } from '~/lib/firebase';
import { formatSiteTime } from '~/lib/siteTime';
import { useUwParking } from '~/lib/uwParking';

interface UwParkingStatusProps {
    showToast: (message: string, type: 'success' | 'warning' | 'error') => void;
    readOnly?: boolean;
}

const WHEN: Intl.DateTimeFormatOptions = {month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'};

/**
 * Where the parking guide's UW data stands: how many lots it holds, when UW
 * generated it and when it was last synced, what the last sync could not
 * refresh, and a button to sync now instead of waiting for the nightly run.
 */
export const UwParkingStatus = ({showToast, readOnly = false}: UwParkingStatusProps) => {
    const {isEnglish} = useLanguage();
    const {parking, loading, failed, refresh} = useUwParking();
    const [syncing, setSyncing] = useState(false);

    const syncNow = async () => {
        setSyncing(true);
        try {
            const {data} = await callSyncUwParking();
            await refresh();
            if (data.errors.length > 0) {
                showToast(isEnglish
                    ? `Synced, but ${data.errors.length} source${data.errors.length === 1 ? '' : 's'} kept the previous copy. See below.`
                    : `已同步，但有 ${data.errors.length} 个数据源沿用了上一份数据。详见下方。`, 'warning');
            } else {
                showToast(isEnglish
                    ? `Synced ${data.lotCount} visitor lots and ${data.pricingDayCount} event-parking days.`
                    : `已同步 ${data.lotCount} 个访客停车场和 ${data.pricingDayCount} 个活动停车日。`, 'success');
            }
        } catch (e: any) {
            showToast(e?.message ?? (isEnglish ? 'Sync failed.' : '同步失败。'), 'error');
        } finally {
            setSyncing(false);
        }
    };

    const generatedAt = parking.lotsGeneratedAt ? new Date(parking.lotsGeneratedAt) : null;
    const nextPricing = parking.eventPricing[0];
    const venueCount = Object.keys(parking.walking).length;

    return (
        <div className="admin-section">
            <p className="admin-helper-text admin-section-intro">
                {isEnglish
                    ? 'Lot details, rates, hours and event-parking days come from UW Transportation Services, and walking times from OpenStreetMap. They sync every day at 5:30 PM PT.'
                    : '停车场信息、费率、收费时间和活动停车日来自 UW Transportation Services，步行时间来自 OpenStreetMap。每天太平洋时间下午 5:30 自动同步。'}
            </p>

            {loading ? (
                <p className="admin-helper-text">{isEnglish ? 'Loading…' : '加载中…'}</p>
            ) : failed ? (
                <div className="admin-uw-note admin-uw-note--error">
                    {isEnglish ? 'Couldn’t load the UW parking data. Refresh the page to try again.' : '无法加载 UW 停车数据。请刷新页面重试。'}
                </div>
            ) : parking.lots.length === 0 ? (
                <div className="admin-venue-lot-empty">
                    {isEnglish
                        ? 'UW parking data hasn’t synced yet. Run Sync now to fill it in.'
                        : 'UW 停车数据尚未同步。点击“立即同步”获取数据。'}
                </div>
            ) : (
                <dl className="admin-uw-status">
                    <dt>{isEnglish ? 'Visitor lots' : '访客停车场'}</dt>
                    <dd>{parking.lots.length}</dd>
                    <dt>{isEnglish ? 'UW updated its data' : 'UW 数据更新于'}</dt>
                    <dd>{generatedAt && !isNaN(generatedAt.getTime()) ? formatSiteTime(generatedAt, isEnglish, WHEN) : '—'}</dd>
                    <dt>{isEnglish ? 'Last synced' : '上次同步'}</dt>
                    <dd>{parking.lastRunAt ? formatSiteTime(parking.lastRunAt, isEnglish, WHEN) : '—'}</dd>
                    <dt>{isEnglish ? 'Event-parking days ahead' : '即将到来的活动停车日'}</dt>
                    <dd>
                        {parking.eventPricing.length}
                        {nextPricing && (isEnglish
                            ? ` · next ${nextPricing.date}: $${nextPricing.price} in ${nextPricing.allLots ? 'all campus lots' : nextPricing.lots.join(', ')}`
                            : ` · 下一个 ${nextPricing.date}：${nextPricing.allLots ? '全校停车场' : nextPricing.lots.join('、')} $${nextPricing.price}`)}
                    </dd>
                    <dt>{isEnglish ? 'Venues with walking times' : '已计算步行时间的场地'}</dt>
                    <dd>{venueCount}</dd>
                </dl>
            )}

            {parking.lastRunErrors.length > 0 && (
                <div className="admin-uw-note admin-uw-note--warning">
                    <strong>
                        {isEnglish
                            ? 'The last sync couldn’t refresh these, so the guide is using the previous copy:'
                            : '上次同步未能更新以下内容，停车指南正在使用上一份数据：'}
                    </strong>
                    <ul>
                        {parking.lastRunErrors.map(err => <li key={err}>{err}</li>)}
                    </ul>
                </div>
            )}

            {!readOnly && (
                <button
                    type="button"
                    className="admin-venue-lot-add admin-mt-12"
                    onClick={syncNow}
                    disabled={syncing}
                >
                    {syncing ? (isEnglish ? 'Syncing…' : '同步中…') : (isEnglish ? 'Sync now' : '立即同步')}
                </button>
            )}
        </div>
    );
};
