import { useEffect, useMemo, useState } from 'react';
import { useLanguage } from '~/components/LanguageContextProvider';
import { type Passport, passportDateTime, type PassportStatus, passportStatusLabel, } from '~/lib/passports';
import { downloadBlob } from '~/lib/zip';
import { fetchUsersByUids, type ShowToast } from '../utils';
import type { UserRecord } from '../types';
import { buildPassportIdCsv, fileStamp, usePassportPngExport } from './passportExport';

/**
 * One design's passports, as a sortable table.
 *
 * Nothing groups passports any more, so the whole of a design's stock is one
 * list: narrowed by status, ordered by whichever column was clicked, and walked
 * a page at a time. Everything happens on the array the tab already holds — a
 * design is a few hundred documents, and re-querying to sort would be slower
 * than sorting them here.
 */

/** About a screenful, and few enough rows that a re-sort is instant. */
const PAGE_SIZE = 50;

type StatusFilter = 'all' | PassportStatus;
const STATUS_FILTERS: StatusFilter[] = ['all', 'unclaimed', 'claimed', 'void'];

type SortKey = 'code' | 'status' | 'holder' | 'generated';
type SortDir = 'asc' | 'desc';

/**
 * How the table is set: which slice, which column, which way, which page.
 *
 * It lives in the tab above rather than in this component because opening a
 * passport swaps the whole dashboard out — without lifting it, coming back from
 * row 43 of page 2 would land on page 1 of an unsorted list.
 */
export interface StockView {
    filter: StatusFilter;
    sortKey: SortKey;
    sortDir: SortDir;
    page: number;
}

/** Newest first: the order stock is printed in, and the one an admin expects. */
export const INITIAL_STOCK_VIEW: StockView = {
    filter: 'all',
    sortKey: 'generated',
    sortDir: 'desc',
    page: 0,
};

interface Column {
    key: SortKey;
    label: {en: string; cn: string};
    /** Which way the first click sorts: text reads A–Z, dates read newest
     * first, because that is what each is usually being looked for. */
    first: SortDir;
}

const COLUMNS: Column[] = [
    {key: 'code', label: {en: 'Code', cn: '编号'}, first: 'asc'},
    {key: 'status', label: {en: 'Status', cn: '状态'}, first: 'asc'},
    {key: 'holder', label: {en: 'Holder', cn: '持有者'}, first: 'asc'},
    {key: 'generated', label: {en: 'Generated', cn: '生成时间'}, first: 'desc'},
];

/** Sorting by status walks the lifecycle rather than the alphabet. */
const STATUS_ORDER: Record<PassportStatus, number> = {unclaimed: 0, claimed: 1, void: 2};

const statusFilterLabel = (filter: StatusFilter, isEnglish: boolean): string =>
    filter === 'all' ? (isEnglish ? 'All' : '全部') : passportStatusLabel(filter, isEnglish);

/** Date without the time, which only the tooltip and the detail page need. */
const shortDate = (date: Date | null, isEnglish: boolean): string =>
    date
        ? date.toLocaleDateString(isEnglish ? 'en-US' : 'zh-CN', {
            year: 'numeric', month: 'short', day: 'numeric',
        })
        : '—';

interface PassportStockProps {
    /** Every passport of the selected design, newest first. */
    passports: Passport[];
    /** The design's year, for naming export files. */
    year: number | undefined;
    view: StockView;
    onViewChange: (view: StockView) => void;
    onOpen: (id: string) => void;
    showToast: ShowToast;
}

export const PassportStock = ({
                                  passports,
                                  year,
                                  view,
                                  onViewChange,
                                  onOpen,
                                  showToast,
                              }: PassportStockProps) => {
    const {isEnglish} = useLanguage();
    const [owners, setOwners] = useState<Map<string, UserRecord> | null>(null);
    const {request: requestPngs, progress, node: pngNode} = usePassportPngExport(
        () => showToast(isEnglish ? 'Failed to render the QR codes.' : '生成二维码失败。', 'error'),
    );

    const origin = typeof window !== 'undefined' ? window.location.origin : '';

    const counts = useMemo(() => ({
        all: passports.length,
        unclaimed: passports.filter(p => p.status === 'unclaimed').length,
        claimed: passports.filter(p => p.status === 'claimed').length,
        void: passports.filter(p => p.status === 'void').length,
    }), [passports]);

    // Holders are resolved for the whole design rather than a page at a time,
    // because the Holder column is sortable — a page's worth of names can't order
    // a list the rest of which has no names yet. It is one read per claimed
    // passport, 30 to a query, and only claimed passports have a holder at all.
    const ownerUids = useMemo(
        () => [...new Set(passports.flatMap(p => p.ownerUid ? [p.ownerUid] : []))],
        [passports],
    );
    // Keyed on the uids themselves: patching one passport in the list (a void, a
    // key reissue) hands back a new array every time, and who holds what hasn't
    // changed unless a uid has.
    const ownerKey = ownerUids.join(',');
    useEffect(() => {
        if (ownerUids.length === 0) {
            setOwners(new Map());
            return;
        }
        let stale = false;
        setOwners(null);
        fetchUsersByUids(ownerUids)
            .then(map => {
                if (!stale) setOwners(map);
            })
            .catch(() => {
                // An unreadable holder is a blank cell, never a broken table: the
                // codes, statuses and dates are all still worth showing.
                if (!stale) setOwners(new Map());
            });
        return () => {
            stale = true;
        };
    }, [ownerKey]);

    const holderName = (passport: Passport): string =>
        (passport.ownerUid && owners?.get(passport.ownerUid)?.displayName) || '';

    const filtered = useMemo(
        () => passports.filter(p => view.filter === 'all' || p.status === view.filter),
        [passports, view.filter],
    );

    const sorted = useMemo(() => {
        const factor = view.sortDir === 'asc' ? 1 : -1;
        const compare = (a: Passport, b: Passport): number => {
            switch (view.sortKey) {
                case 'code':
                    return a.id.localeCompare(b.id) * factor;
                case 'status':
                    return (STATUS_ORDER[a.status] - STATUS_ORDER[b.status]) * factor;
                case 'holder': {
                    const [left, right] = [holderName(a), holderName(b)];
                    // A passport nobody holds sinks to the bottom either way:
                    // flipping the column should reorder the names, not bury them
                    // under a hundred blanks.
                    if (!left || !right) return left ? -1 : right ? 1 : 0;
                    return left.localeCompare(right) * factor;
                }
                case 'generated':
                    return ((a.createdAt?.getTime() ?? 0) - (b.createdAt?.getTime() ?? 0)) * factor;
            }
        };
        // The id breaks every tie, so equal rows keep one stable order instead of
        // shuffling whenever the list is patched.
        return [...filtered].sort((a, b) => compare(a, b) || a.id.localeCompare(b.id));
    }, [filtered, view.sortKey, view.sortDir, owners]);

    const pageCount = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
    // Clamped rather than reset: voiding the last passport on the final page
    // shouldn't throw the admin back to the top of the list.
    const page = Math.min(view.page, pageCount - 1);
    const from = page * PAGE_SIZE;
    const rows = sorted.slice(from, from + PAGE_SIZE);

    const setFilter = (filter: StatusFilter) => onViewChange({...view, filter, page: 0});
    const setPage = (next: number) => onViewChange({...view, page: next});
    const sortBy = (column: Column) => onViewChange({
        ...view,
        sortKey: column.key,
        // Clicking the column already sorted flips it; a new column starts the way
        // that column is usually read.
        sortDir: view.sortKey === column.key
            ? (view.sortDir === 'asc' ? 'desc' : 'asc')
            : column.first,
        page: 0,
    });

    // Exports cover the filter, not the page — the print shop wants every
    // unclaimed sticker, not the fifty currently on screen.
    const exportBase = `passports-${year ?? ''}-${view.filter}-${fileStamp()}`;

    return (
        <div className="admin-field-section">
            <div className="admin-passport-stock-head">
                <span className="admin-field-label">{isEnglish ? 'Stock' : '库存'}</span>
                <div className="admin-tag-actions">
                    <button
                        className="admin-toggle-btn admin-toggle-edit admin-btn-sm"
                        onClick={() => downloadBlob(
                            buildPassportIdCsv(sorted.map(p => p.id), origin),
                            `${exportBase}-ids.csv`,
                        )}
                        disabled={sorted.length === 0}
                        type="button"
                    >
                        {isEnglish ? 'Codes CSV' : '编号 CSV'}
                    </button>
                    <button
                        className="admin-toggle-btn admin-toggle-edit admin-btn-sm"
                        onClick={() => requestPngs(sorted.map(p => p.id), exportBase)}
                        disabled={!!progress || sorted.length === 0}
                        type="button"
                    >
                        {progress
                            ? (isEnglish ? `Rendering ${progress.done}/${progress.total}…` : `生成中 ${progress.done}/${progress.total}…`)
                            : (isEnglish ? 'Stickers ZIP' : '贴纸 ZIP')}
                    </button>
                </div>
            </div>

            <div className="admin-passport-tabs" role="tablist">
                {STATUS_FILTERS.map(filter => (
                    <button
                        key={filter}
                        role="tab"
                        aria-selected={filter === view.filter}
                        className={`admin-passport-tab${filter === view.filter ? ' admin-passport-tab--on' : ''}`}
                        onClick={() => setFilter(filter)}
                        type="button"
                    >
                        {statusFilterLabel(filter, isEnglish)}
                        <span className="admin-passport-tab-count">{counts[filter]}</span>
                    </button>
                ))}
            </div>

            <p className="admin-helper-text admin-field-hint">
                {isEnglish
                    ? `Both exports cover all ${sorted.length} passports in this view, not just the page shown, and carry public codes only — open a passport to view its activation key.`
                    : `两项导出均包含当前视图下的全部 ${sorted.length} 本通行证（不限于本页），且仅含公开编号 — 打开单本通行证即可查看其激活码。`}
            </p>

            {sorted.length === 0 ? (
                <p className="admin-no-results">
                    {isEnglish ? 'No passports with this status.' : '没有此状态的通行证。'}
                </p>
            ) : (
                <>
                    <div className="admin-data-table-wrap">
                        <table className="admin-data-table admin-passport-table">
                            <thead>
                            <tr>
                                {COLUMNS.map(column => (
                                    <th
                                        key={column.key}
                                        aria-sort={view.sortKey !== column.key
                                            ? 'none'
                                            : view.sortDir === 'asc' ? 'ascending' : 'descending'}
                                    >
                                        <button
                                            className={`admin-data-table-sort${
                                                view.sortKey === column.key ? ' admin-data-table-sort--on' : ''}`}
                                            onClick={() => sortBy(column)}
                                            type="button"
                                        >
                                            {isEnglish ? column.label.en : column.label.cn}
                                            <span className="admin-data-table-caret" aria-hidden="true">
                                                {view.sortKey === column.key
                                                    ? (view.sortDir === 'asc' ? '▲' : '▼')
                                                    : '↕'}
                                            </span>
                                        </button>
                                    </th>
                                ))}
                            </tr>
                            </thead>
                            <tbody>
                            {rows.map(passport => (
                                <tr
                                    key={passport.id}
                                    className="admin-data-table-row--clickable"
                                    tabIndex={0}
                                    role="button"
                                    onClick={() => onOpen(passport.id)}
                                    onKeyDown={e => {
                                        if (e.key === 'Enter' || e.key === ' ') {
                                            e.preventDefault();
                                            onOpen(passport.id);
                                        }
                                    }}
                                >
                                    <td className="admin-passport-cell-code">{passport.id}</td>
                                    <td>
                                        <span
                                            className={`admin-passport-status admin-passport-status--${passport.status}`}>
                                            <span className="admin-passport-status-dot" aria-hidden="true"/>
                                            {passportStatusLabel(passport.status, isEnglish)}
                                        </span>
                                    </td>
                                    <td className="admin-passport-cell-holder">
                                        <Holder passport={passport} owners={owners} isEnglish={isEnglish}/>
                                    </td>
                                    <td
                                        className="admin-passport-cell-date"
                                        title={passportDateTime(passport.createdAt, isEnglish, '—')}
                                    >
                                        {shortDate(passport.createdAt, isEnglish)}
                                        {passport.createdByName && (
                                            <span className="admin-passport-cell-by">{passport.createdByName}</span>
                                        )}
                                    </td>
                                </tr>
                            ))}
                            </tbody>
                        </table>
                    </div>

                    <div className="admin-passport-pager">
                        <button
                            className="admin-btn admin-btn--outline admin-btn-sm"
                            onClick={() => setPage(page - 1)}
                            disabled={page === 0}
                            type="button"
                        >
                            {isEnglish ? '‹ Prev' : '‹ 上一页'}
                        </button>
                        <span className="admin-passport-pager-range">
                            {isEnglish
                                ? `${from + 1}–${from + rows.length} of ${sorted.length}`
                                : `第 ${from + 1}–${from + rows.length} 本，共 ${sorted.length} 本`}
                        </span>
                        <button
                            className="admin-btn admin-btn--outline admin-btn-sm"
                            onClick={() => setPage(page + 1)}
                            disabled={page >= pageCount - 1}
                            type="button"
                        >
                            {isEnglish ? 'Next ›' : '下一页 ›'}
                        </button>
                    </div>
                </>
            )}
            {pngNode}
        </div>
    );
};

/**
 * The Holder cell. A claimed passport whose account has since been deleted says
 * so rather than showing a blank — the passport stays bound either way, and that
 * is the one case where an empty cell would be misread as "nobody".
 */
const Holder = ({passport, owners, isEnglish}: {
    passport: Passport;
    owners: Map<string, UserRecord> | null;
    isEnglish: boolean;
}) => {
    if (passport.status !== 'claimed' || !passport.ownerUid) {
        return <span className="admin-passport-cell-blank">—</span>;
    }
    if (owners === null) return <span className="admin-passport-cell-blank">…</span>;

    const owner = owners.get(passport.ownerUid);
    if (!owner) {
        return (
            <span className="admin-passport-cell-blank">
                {isEnglish ? 'Account deleted' : '账号已删除'}
            </span>
        );
    }
    return (
        <>
            <span className="admin-passport-holder-name">{owner.displayName}</span>
            <span className="admin-passport-holder-email">{owner.email}</span>
        </>
    );
};
