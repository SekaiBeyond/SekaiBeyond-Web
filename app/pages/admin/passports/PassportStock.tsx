import { useEffect, useMemo, useState } from 'react';
import { useLanguage } from '~/components/LanguageContextProvider';
import { callDeletePassports } from '~/lib/firebase';
import {
    MAX_PASSPORT_DELETE,
    type Passport,
    passportDateTime,
    type PassportStatus,
    passportStatusLabel,
} from '~/lib/passports';
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
 *
 * Every action hangs off ticked rows, which is how a set of passports that share
 * nothing in the data — the ones in one envelope, the ones that came back damaged
 * — is acted on at all. A selection exports its codes and its stickers, and is
 * deleted in one call.
 *
 * Only unclaimed stock can be ticked. Everything a selection does is a
 * print-and-pack job on passports that haven't been sold — the codes CSV carries
 * no holder, and a claimed passport's sticker is already in someone's hands — so
 * a claimed row has nothing to gain from being in one, and leaving it out is what
 * makes the selection and the delete the same set. Deleting a claimed passport is
 * done on its own page, where the holder is on the screen.
 */

/** About a screenful, and few enough rows that a re-sort is instant. */
const PAGE_SIZE = 50;

type StatusFilter = 'all' | PassportStatus;
const STATUS_FILTERS: StatusFilter[] = ['all', 'unclaimed', 'claimed'];

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
const STATUS_ORDER: Record<PassportStatus, number> = {unclaimed: 0, claimed: 1};

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
    /** Ticked passport ids. Lifted for the same reason as the view — opening a
     * passport unmounts the table, and a selection built across three pages
     * shouldn't be the price of checking one of them. */
    selected: string[];
    onSelectedChange: (selected: string[]) => void;
    /** The passports a bulk delete removed, so the list drops those rows. */
    onDeleted: (passportIds: string[]) => void;
    onOpen: (id: string) => void;
    showToast: ShowToast;
    /** Staff (read-only) still export; only deleting is theirs to lose. */
    readOnly: boolean;
}

export const PassportStock = ({
                                  passports,
                                  year,
                                  view,
                                  onViewChange,
                                  selected,
                                  onSelectedChange,
                                  onDeleted,
                                  onOpen,
                                  showToast,
                                  readOnly,
                              }: PassportStockProps) => {
    const {isEnglish} = useLanguage();
    const [owners, setOwners] = useState<Map<string, UserRecord> | null>(null);
    const [deleting, setDeleting] = useState(false);
    const {request: requestPngs, progress, node: pngNode} = usePassportPngExport(
        () => showToast(isEnglish ? 'Failed to render the QR codes.' : '生成二维码失败。', 'error'),
    );

    const origin = typeof window !== 'undefined' ? window.location.origin : '';

    const counts = useMemo(() => ({
        all: passports.length,
        unclaimed: passports.filter(p => p.status === 'unclaimed').length,
        claimed: passports.filter(p => p.status === 'claimed').length,
    }), [passports]);

    // Holders are resolved for the whole design rather than a page at a time,
    // because the Holder column is sortable — a page's worth of names can't order
    // a list the rest of which has no names yet. It is one read per claimed
    // passport, 30 to a query, and only claimed passports have a holder at all.
    const ownerUids = useMemo(
        () => [...new Set(passports.flatMap(p => p.ownerUid ? [p.ownerUid] : []))],
        [passports],
    );
    // Keyed on the uids themselves: patching the list (a key reissue, a deleted
    // passport dropping out) hands back a new array every time, and who holds
    // what hasn't changed unless a uid has.
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
    // Clamped rather than reset: deleting the last passport on the final page
    // shouldn't throw the admin back to the top of the list.
    const page = Math.min(view.page, pageCount - 1);
    const from = page * PAGE_SIZE;
    const rows = sorted.slice(from, from + PAGE_SIZE);

    const selectedSet = useMemo(() => new Set(selected), [selected]);
    // Resolved against the whole design rather than the current filter, so a
    // selection survives switching tabs to look at something else, and so an id
    // left over from a row someone else deleted drops out on its own. A passport
    // claimed under the open table drops out the same way: it was ticked as stock
    // and has stopped being stock, and nothing here acts on a claimed passport.
    const selectedPassports = useMemo(
        () => passports.filter(p => selectedSet.has(p.id) && p.status === 'unclaimed'),
        [passports, selectedSet],
    );

    // What the header box and its partial state are measured against: ticking
    // "all" can only mean all of the rows that can be ticked, which on the Claimed
    // tab is none of them.
    const selectableInView = useMemo(() => sorted.filter(p => p.status === 'unclaimed'), [sorted]);
    const viewSelectedCount = selectableInView.reduce((n, p) => n + (selectedSet.has(p.id) ? 1 : 0), 0);
    const allInViewSelected = selectableInView.length > 0 && viewSelectedCount === selectableInView.length;

    const toggleOne = (id: string) => onSelectedChange(
        selectedSet.has(id) ? selected.filter(s => s !== id) : [...selected, id]);

    // The header box takes the whole filtered view, not the page on screen — the
    // same set the exports below cover, so "all" means one thing on this screen.
    const toggleView = () => {
        const inView = new Set(selectableInView.map(p => p.id));
        onSelectedChange(allInViewSelected
            ? selected.filter(id => !inView.has(id))
            : [...new Set([...selected, ...inView])]);
    };

    // Everything ticked is deletable — claimed rows can't be ticked — so this
    // deletes the selection, with no subset to explain and no count that disagrees
    // with the one beside it.
    const deleteSelected = async () => {
        const count = selectedPassports.length;
        if (count === 0) return;
        if (count > MAX_PASSPORT_DELETE) {
            showToast(isEnglish
                ? `Select at most ${MAX_PASSPORT_DELETE} passports to delete at once.`
                : `一次最多只能删除 ${MAX_PASSPORT_DELETE} 本通行证。`, 'error');
            return;
        }
        if (!window.confirm(isEnglish
            ? `Delete ${count} ${count === 1 ? 'passport' : 'passports'}? Their activation keys go with them and their stickers stop working. This can't be undone.`
            : `删除 ${count} 本通行证？其激活码将一并移除，贴纸随之失效。此操作无法撤销。`)) return;

        setDeleting(true);
        let result;
        try {
            result = (await callDeletePassports({passportIds: selectedPassports.map(p => p.id)})).data;
        } catch (e: any) {
            showToast(e?.message ?? (isEnglish ? 'Failed to delete passports.' : '删除通行证失败。'), 'error');
            setDeleting(false);
            return;
        }
        setDeleting(false);

        // A passport claimed or already deleted since the table was loaded is
        // skipped rather than failing the call, so the toast reports what actually
        // went instead of implying the whole selection did.
        const skipped = result.claimed.length + result.missing.length;
        if (result.deleted.length === 0) {
            showToast(isEnglish
                ? 'Nothing was deleted — those passports have changed since this list was loaded.'
                : '未删除任何通行证 — 自本列表加载以来，这些通行证已发生变化。', 'error');
        } else {
            showToast(isEnglish
                ? `Deleted ${result.deleted.length} ${result.deleted.length === 1 ? 'passport' : 'passports'}.${skipped > 0 ? ` ${skipped} skipped.` : ''}`
                : `已删除 ${result.deleted.length} 本通行证。${skipped > 0 ? `已跳过 ${skipped} 本。` : ''}`, 'warning');
        }
        onDeleted(result.deleted);
    };

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

    // An export covers what was ticked and nothing else, so no filter describes
    // it and the time it was taken is what tells two downloads apart.
    const selectionBase = `passports-${year ?? ''}-selected-${fileStamp()}`;

    return (
        <div className="admin-field-section">
            <span className="admin-field-label">{isEnglish ? 'Stock' : '库存'}</span>

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

            {selectedPassports.length > 0 && (
                <div className="admin-passport-selection">
                    <span className="admin-passport-selection-count">
                        {isEnglish
                            ? `${selectedPassports.length} selected`
                            : `已选择 ${selectedPassports.length} 本`}
                    </span>
                    <div className="admin-tag-actions">
                        <button
                            className="admin-toggle-btn admin-toggle-edit admin-btn-sm"
                            onClick={() => downloadBlob(
                                buildPassportIdCsv(selectedPassports.map(p => p.id), origin),
                                `${selectionBase}-ids.csv`,
                            )}
                            type="button"
                        >
                            {isEnglish ? 'Codes CSV' : '编号 CSV'}
                        </button>
                        <button
                            className="admin-toggle-btn admin-toggle-edit admin-btn-sm"
                            onClick={() => requestPngs(selectedPassports.map(p => p.id), selectionBase)}
                            disabled={!!progress}
                            type="button"
                        >
                            {progress
                                ? (isEnglish ? `Rendering ${progress.done}/${progress.total}…` : `生成中 ${progress.done}/${progress.total}…`)
                                : (isEnglish ? 'Stickers ZIP' : '贴纸 ZIP')}
                        </button>
                        {!readOnly && (
                            <button
                                className="admin-toggle-btn admin-toggle-revoke admin-btn-sm"
                                onClick={() => void deleteSelected()}
                                disabled={deleting}
                                type="button"
                            >
                                {deleting
                                    ? (isEnglish ? 'Deleting…' : '删除中…')
                                    : (isEnglish
                                        ? `Delete ${selectedPassports.length}`
                                        : `删除 ${selectedPassports.length} 本`)}
                            </button>
                        )}
                    </div>
                </div>
            )}

            <p className="admin-helper-text admin-field-hint">
                {selectableInView.length === 0
                    ? (isEnglish
                        ? 'Nothing in this view can be ticked: claimed passports aren’t part of bulk actions. Open one to download its sticker or delete it.'
                        : '当前视图下没有可勾选的通行证：已激活的通行证不参与批量操作。如需下载贴纸或删除，请打开该通行证。')
                    : (isEnglish
                        ? `Tick rows to export or delete them; the box in the header takes all ${selectableInView.length} unclaimed passports in this view, not just the page shown. Claimed passports can’t be ticked — open one to delete it. Exports carry public codes only, so open a passport to view its activation key.`
                        : `勾选行即可导出或删除；表头的复选框会选中当前视图下的全部 ${selectableInView.length} 本未激活通行证（不限于本页）。已激活的通行证无法勾选 — 如需删除请打开该通行证。导出内容仅含公开编号 — 打开单本通行证即可查看其激活码。`)}
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
                                <th className="admin-passport-cell-tick">
                                    <input
                                        type="checkbox"
                                        checked={allInViewSelected}
                                        // Partly ticked whenever the view holds
                                        // some of the selection but not all of it.
                                        ref={el => {
                                            if (el) el.indeterminate = viewSelectedCount > 0 && !allInViewSelected;
                                        }}
                                        onChange={toggleView}
                                        // Nothing to take on the Claimed tab.
                                        disabled={selectableInView.length === 0}
                                        aria-label={selectableInView.length === 0
                                            ? (isEnglish
                                                ? 'Nothing in this view can be selected'
                                                : '当前视图下没有可选择的通行证')
                                            : (isEnglish
                                                ? `Select all ${selectableInView.length} unclaimed passports in this view`
                                                : `选择当前视图下的全部 ${selectableInView.length} 本未激活通行证`)}
                                    />
                                </th>
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
                                        // Only the row's own keys open it: space on
                                        // the tick box below ticks the box.
                                        if (e.target !== e.currentTarget) return;
                                        if (e.key === 'Enter' || e.key === ' ') {
                                            e.preventDefault();
                                            onOpen(passport.id);
                                        }
                                    }}
                                >
                                    <td
                                        className="admin-passport-cell-tick"
                                        // The tick cell swallows the click that
                                        // would open the row — except on a claimed
                                        // one, where there is no box to hit and
                                        // opening the passport is exactly where
                                        // whoever clicked it needs to go.
                                        onClick={e => {
                                            if (passport.status !== 'claimed') e.stopPropagation();
                                        }}
                                    >
                                        <input
                                            type="checkbox"
                                            // A row ticked as stock and claimed
                                            // since shows unticked, because it has
                                            // already dropped out of the selection
                                            // everything below acts on.
                                            checked={passport.status !== 'claimed' && selectedSet.has(passport.id)}
                                            onChange={() => toggleOne(passport.id)}
                                            disabled={passport.status === 'claimed'}
                                            title={passport.status === 'claimed'
                                                ? (isEnglish
                                                    ? 'Claimed passports aren’t part of bulk actions — open this one to delete it'
                                                    : '已激活的通行证不参与批量操作 — 如需删除请打开该通行证')
                                                : undefined}
                                            aria-label={passport.status === 'claimed'
                                                ? (isEnglish
                                                    ? `Passport ${passport.id} is claimed and can’t be selected`
                                                    : `通行证 ${passport.id} 已激活，无法选择`)
                                                : (isEnglish
                                                    ? `Select passport ${passport.id}`
                                                    : `选择通行证 ${passport.id}`)}
                                        />
                                    </td>
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
