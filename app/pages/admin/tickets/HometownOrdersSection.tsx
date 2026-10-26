import { type ChangeEvent, useMemo, useRef, useState } from 'react';
import { useLanguage } from '~/components/LanguageContextProvider';
import { callSyncHometownOrderTimes, errorSuffix } from '~/lib/firebase';
import type { ShowToast } from '../utils';
import { type HometownOrderRow, parseHometownOrderFile, retryRateLimited } from './hometown';
import type { AttendeeData, ParseError } from './types';

/** Orders per sync call, well under the server's row cap. */
const SYNC_CHUNK = 500;
/** Issues listed before the rest are summed up. */
const MAX_ISSUES = 20;
/** Order numbers with no ticket here named before the rest are summed up. */
const MAX_UNMATCHED = 20;

interface HometownOrdersSectionProps {
    eventId: string;
    attendees: AttendeeData[];
    readOnly: boolean;
    showToast: ShowToast;
    onSynced: () => void;
}

/**
 * When each HomeTown ticket was bought, from HomeTown's order list export: the
 * guest list has no times, so imported tickets otherwise carry the import's.
 * Matched to tickets by HomeTown order number.
 */
export function HometownOrdersSection({
                                          eventId,
                                          attendees,
                                          readOnly,
                                          showToast,
                                          onSynced,
                                      }: HometownOrdersSectionProps) {
    const {isEnglish} = useLanguage();
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [orders, setOrders] = useState<HometownOrderRow[]>([]);
    const [errors, setErrors] = useState<ParseError[]>([]);
    const [warnings, setWarnings] = useState<ParseError[]>([]);
    const [busy, setBusy] = useState(false);
    const [syncing, setSyncing] = useState(false);

    // What the sync will do, by the list as last loaded; the server decides
    // again from what's there when it runs.
    const preview = useMemo(() => {
        const times = new Map(orders.map(o => [o.orderId, Date.parse(o.orderedAt)]));
        const matchedOrders = new Set<string>();
        let matched = 0;
        let toSync = 0;
        let notInFile = 0;
        for (const a of attendees) {
            if (!a.hometown) continue;
            const ms = times.get(a.hometownOrderId);
            if (ms === undefined) {
                // An unlisted ticket has no order number to look up.
                if (!a.unlisted) notInFile++;
                continue;
            }
            matchedOrders.add(a.hometownOrderId);
            matched++;
            if (a.createdAt.getTime() !== ms || a.tickets.some(t => t.createdAt?.getTime() !== ms)) toSync++;
        }
        return {
            matched,
            toSync,
            unchanged: matched - toSync,
            unmatched: orders.filter(o => !matchedOrders.has(o.orderId)).map(o => o.orderId),
            notInFile,
        };
    }, [attendees, orders]);

    const clearForm = () => {
        setOrders([]);
        setErrors([]);
        setWarnings([]);
        if (fileInputRef.current) fileInputRef.current.value = '';
    };

    const handleFile = async (e: ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        setBusy(true);
        setOrders([]);
        setErrors([]);
        setWarnings([]);
        try {
            const parsed = await parseHometownOrderFile(file, isEnglish);
            setOrders(parsed.orders);
            setErrors(parsed.errors);
            setWarnings(parsed.warnings);
        } catch (err) {
            console.error('[HometownOrdersSection] parse error', err);
            setErrors([{row: 0, message: isEnglish ? 'Failed to parse file.' : '解析文件失败。'}]);
        } finally {
            setBusy(false);
        }
    };

    const confirmSync = async () => {
        if (readOnly || orders.length === 0) return;
        const ok = window.confirm(isEnglish
            ? `Set the purchase time of about ${preview.toSync} HomeTown ${preview.toSync === 1 ? 'ticket' : 'tickets'} from this order list? Their created times are replaced with when their order was placed.`
            : `用此订单列表设置约 ${preview.toSync} 张 HomeTown 门票的购票时间？其创建时间将替换为下单时间。`);
        if (!ok) return;

        setSyncing(true);
        const totals = {synced: 0, unchanged: 0, unmatched: 0};
        const syncId = crypto.randomUUID();
        try {
            for (let i = 0; i < orders.length; i += SYNC_CHUNK) {
                const chunk = orders.slice(i, i + SYNC_CHUNK);
                const data = await retryRateLimited(async () =>
                    (await callSyncHometownOrderTimes({eventId, syncId, orders: chunk})).data);
                totals.synced += data.synced;
                totals.unchanged += data.unchanged;
                totals.unmatched += data.unmatched;
            }
            const parts = isEnglish
                ? [
                    `${totals.synced} ${totals.synced === 1 ? 'ticket' : 'tickets'} updated`,
                    `${totals.unchanged} already right`,
                    totals.unmatched > 0
                    && `${totals.unmatched} ${totals.unmatched === 1 ? 'order' : 'orders'} with no ticket here`,
                ]
                : [
                    `更新 ${totals.synced} 张门票`,
                    `${totals.unchanged} 张已是正确时间`,
                    totals.unmatched > 0 && `${totals.unmatched} 个订单在此没有门票`,
                ];
            showToast(isEnglish
                    ? `Purchase times synced: ${parts.filter(Boolean).join(', ')}.`
                    : `购票时间已同步：${parts.filter(Boolean).join('，')}。`,
                'success');
            clearForm();
        } catch (err) {
            console.error('[HometownOrdersSection] sync failed', err);
            // Earlier chunks may have landed; syncing the file again finishes it.
            showToast(isEnglish
                    ? `Purchase time sync failed partway${errorSuffix(err, true)}. Sync the same file again to finish it.`
                    : `购票时间同步中途失败${errorSuffix(err, false)}。请再次同步同一文件以完成。`,
                'error');
        } finally {
            setSyncing(false);
            onSynced();
        }
    };

    const issues = [...errors, ...warnings];
    const unmatchedList = preview.unmatched.slice(0, MAX_UNMATCHED).map(id => `#${id}`).join(', ')
        + (preview.unmatched.length > MAX_UNMATCHED
            ? (isEnglish
                ? ` and ${preview.unmatched.length - MAX_UNMATCHED} more`
                : ` 等 ${preview.unmatched.length} 个`)
            : '');
    const canSync = !readOnly && !busy && !syncing && orders.length > 0 && !errors.some(e => e.row === 0);

    return (
        <div className="admin-tickets-import admin-tickets-hometown">
            <h3>{isEnglish ? 'HomeTown purchase times' : 'HomeTown 购票时间'}</h3>
            <p className="admin-helper-text">
                {isEnglish
                    ? 'The guest list has no purchase times, so HomeTown tickets show when they were imported. Upload the order list exported from HomeTown (Order List) to give each ticket the time its order was placed, matched by order number, for the sales timeline in Stats, the attendee list and the CSV export. Import the guest list first, and sync again after importing a newer one, since newly added tickets start with the import\'s time.'
                    : '来宾名单不含购票时间，因此 HomeTown 门票显示的是导入时间。上传从 HomeTown 导出的订单列表（Order List），按订单号为每张门票设置下单时间，用于统计中的销售时间线、参加者列表和 CSV 导出。请先导入来宾名单；导入更新的名单后请再次同步，因为新添加的门票以导入时间开始。'}
            </p>
            <div className="admin-tickets-import-file-row">
                <input
                    ref={fileInputRef}
                    type="file"
                    accept=".csv,text/csv,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                    onChange={handleFile}
                    disabled={readOnly || busy || syncing}
                />
            </div>

            {issues.length > 0 && (
                <div className="admin-tickets-import-errors">
                    <strong>{isEnglish ? 'Issues' : '问题'}</strong>
                    <ul>
                        {issues.slice(0, MAX_ISSUES).map((e, i) => (
                            <li key={i}>
                                {e.row > 0 && (
                                    <span className="admin-tickets-import-rownum">
                                        {isEnglish ? `Row ${e.row}:` : `第 ${e.row} 行：`}
                                    </span>
                                )}{' '}
                                {e.message}
                            </li>
                        ))}
                        {issues.length > MAX_ISSUES && (
                            <li>
                                {isEnglish
                                    ? `…and ${issues.length - MAX_ISSUES} more.`
                                    : `…还有 ${issues.length - MAX_ISSUES} 条。`}
                            </li>
                        )}
                    </ul>
                </div>
            )}

            {orders.length > 0 && (
                <>
                    <div className="admin-tickets-stats">
                        <span>
                            <strong>{orders.length}</strong> {isEnglish
                            ? `${orders.length === 1 ? 'order' : 'orders'} in file`
                            : '个订单在文件中'}
                        </span>
                        <span>
                            <strong>{preview.matched}</strong> {isEnglish
                            ? `${preview.matched === 1 ? 'ticket' : 'tickets'} matched`
                            : '张门票匹配'}
                        </span>
                        <span><strong>{preview.toSync}</strong> {isEnglish ? 'to update' : '将更新'}</span>
                        <span><strong>{preview.unchanged}</strong> {isEnglish ? 'already right' : '已是正确时间'}</span>
                        {preview.unmatched.length > 0 && (
                            <span>
                                <strong>{preview.unmatched.length}</strong> {isEnglish
                                ? `${preview.unmatched.length === 1 ? 'order' : 'orders'} with no ticket here`
                                : '个订单在此没有门票'}
                            </span>
                        )}
                        {preview.notInFile > 0 && (
                            <span>
                                <strong>{preview.notInFile}</strong> {isEnglish
                                ? `${preview.notInFile === 1 ? 'ticket' : 'tickets'} not in file`
                                : '张门票不在文件中'}
                            </span>
                        )}
                    </div>
                    {preview.matched === 0 && (
                        <p className="admin-helper-text admin-tickets-edit-warning">
                            {isEnglish
                                ? 'None of these orders match a HomeTown ticket here. Import the guest list first, or check this is the order list for this event.'
                                : '这些订单都不匹配此处的 HomeTown 门票。请先导入来宾名单，或确认这是本活动的订单列表。'}
                        </p>
                    )}
                    {preview.unmatched.length > 0 && preview.matched > 0 && (
                        <p className="admin-helper-text">
                            {isEnglish
                                ? `Orders with no ticket here are left out: another event's orders, or ones whose tickets aren't imported yet. ${preview.unmatched.length === 1 ? 'Order' : 'Orders'} ${unmatchedList}.`
                                : `在此没有门票的订单将被跳过：可能是其他活动的订单，或其门票尚未导入。订单 ${unmatchedList}。`}
                        </p>
                    )}
                    <div className="admin-btn-row">
                        <button
                            className="admin-toggle-btn admin-toggle-save"
                            onClick={() => void confirmSync()}
                            disabled={!canSync}
                        >
                            {syncing
                                ? (isEnglish ? 'Syncing...' : '同步中...')
                                : (isEnglish ? 'Sync Purchase Times' : '同步购票时间')}
                        </button>
                        <button
                            className="admin-toggle-btn admin-toggle-cancel"
                            onClick={clearForm}
                            disabled={syncing}
                        >
                            {isEnglish ? 'Clear' : '清空'}
                        </button>
                    </div>
                </>
            )}
        </div>
    );
}
