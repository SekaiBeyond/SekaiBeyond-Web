import { useEffect, useMemo, useState } from 'react';
import { useLanguage } from '~/components/LanguageContextProvider';
import { callDeletePassports, callExportPassportKeys } from '~/lib/firebase';
import {
    MAX_PASSPORT_DELETE,
    MAX_PASSPORT_KEY_EXPORT,
    type Passport,
    type PassportStatus,
    passportStatusLabel,
} from '~/lib/passports';
import { downloadBlob } from '~/lib/zip';
import { fetchUsersByUids, type ShowToast } from '../utils';
import type { UserRecord } from '../types';
import { buildPassportCsv, buildPassportIdCsv, fileStamp, usePassportPngExport } from './passportExport';
import { type Column, PassportStockTable, type SortDir, type SortKey } from './PassportStockTable';

/**
 * One design's passports as a sortable table: narrowed by status, sorted by the
 * clicked column, paged. All on the array the tab already holds, since a design
 * is a few hundred docs.
 *
 * Actions hang off ticked rows, the only way to act on a set that shares nothing
 * in the data (one envelope, a damaged batch): export codes, keys and stickers,
 * or delete in one call.
 *
 * Only unclaimed stock can be ticked: everything a selection does is
 * print-and-pack work on unsold passports, and it keeps the selection and the
 * delete the same set. Claimed passports are deleted from their own page.
 */

/** About a screenful, and few enough rows that a re-sort is instant. */
const PAGE_SIZE = 50;

type StatusFilter = 'all' | PassportStatus;
const STATUS_FILTERS: StatusFilter[] = ['all', 'unclaimed', 'claimed'];

/**
 * How the table is set: slice, column, direction, page. Held by the tab, since
 * opening a passport unmounts this and would otherwise lose your place.
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

/** Sorting by status walks the lifecycle rather than the alphabet. */
const STATUS_ORDER: Record<PassportStatus, number> = {unclaimed: 0, claimed: 1};

const statusFilterLabel = (filter: StatusFilter, isEnglish: boolean): string =>
    filter === 'all' ? (isEnglish ? 'All' : '全部') : passportStatusLabel(filter, isEnglish);

interface PassportStockProps {
    /** Every passport of the selected design, newest first. */
    passports: Passport[];
    /** The design's year, for naming export files. */
    year: number | undefined;
    view: StockView;
    onViewChange: (view: StockView) => void;
    /** Ticked passport ids, lifted for the same reason as the view. */
    selected: string[];
    onSelectedChange: (selected: string[]) => void;
    /** The passports a bulk delete removed, so the list drops those rows. */
    onDeleted: (passportIds: string[]) => void;
    onOpen: (id: string) => void;
    showToast: ShowToast;
    /**
     * Staff (read-only) can still export codes and stickers, but not keys or
     * deletes.
     */
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
    const [ownersFailed, setOwnersFailed] = useState(false);
    const [deleting, setDeleting] = useState(false);
    const [exportingKeys, setExportingKeys] = useState(false);
    const {request: requestPngs, progress, node: pngNode} = usePassportPngExport(
        () => showToast(isEnglish ? 'Failed to render the QR codes.' : '生成二维码失败。', 'error'),
    );

    const origin = typeof window !== 'undefined' ? window.location.origin : '';

    const counts = useMemo(() => ({
        all: passports.length,
        unclaimed: passports.filter(p => p.status === 'unclaimed').length,
        claimed: passports.filter(p => p.status === 'claimed').length,
    }), [passports]);

    // Holders for the whole design, not a page, because the Holder column sorts.
    // One read per claimed passport, 30 to a query.
    const ownerUids = useMemo(
        () => [...new Set(passports.flatMap(p => p.ownerUid ? [p.ownerUid] : []))],
        [passports],
    );
    // Keyed on the uids, since patching the list makes a new array without
    // changing who holds what.
    const ownerKey = ownerUids.join(',');
    useEffect(() => {
        setOwnersFailed(false);
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
                // An unreadable holder is a blank cell, never a broken table.
                if (!stale) {
                    setOwners(new Map());
                    setOwnersFailed(true);
                }
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
                    // Unheld passports sink either way, so flipping reorders the
                    // names.
                    if (!left || !right) return left ? -1 : right ? 1 : 0;
                    return left.localeCompare(right) * factor;
                }
                case 'generated':
                    return ((a.createdAt?.getTime() ?? 0) - (b.createdAt?.getTime() ?? 0)) * factor;
            }
        };
        // The id breaks ties, so equal rows don't shuffle when the list is
        // patched.
        return [...filtered].sort((a, b) => compare(a, b) || a.id.localeCompare(b.id));
    }, [filtered, view.sortKey, view.sortDir, owners]);

    const pageCount = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
    // Clamped, so deleting the final page's last row doesn't jump to the top.
    const page = Math.min(view.page, pageCount - 1);
    const from = page * PAGE_SIZE;
    const rows = sorted.slice(from, from + PAGE_SIZE);

    const selectedSet = useMemo(() => new Set(selected), [selected]);
    // Resolved against the whole design, so a selection survives switching tabs,
    // and ids deleted or claimed meanwhile drop out on their own.
    const selectedPassports = useMemo(
        () => passports.filter(p => selectedSet.has(p.id) && p.status === 'unclaimed'),
        [passports, selectedSet],
    );

    // "All" means every tickable row in view (none on the Claimed tab).
    const selectableInView = useMemo(() => sorted.filter(p => p.status === 'unclaimed'), [sorted]);
    const viewSelectedCount = selectableInView.reduce((n, p) => n + (selectedSet.has(p.id) ? 1 : 0), 0);
    const allInViewSelected = selectableInView.length > 0 && viewSelectedCount === selectableInView.length;

    const toggleOne = (id: string) => onSelectedChange(
        selectedSet.has(id) ? selected.filter(s => s !== id) : [...selected, id]);

    // The whole filtered view, not the page: the same set the exports cover.
    const toggleView = () => {
        const inView = new Set(selectableInView.map(p => p.id));
        onSelectedChange(allInViewSelected
            ? selected.filter(id => !inView.has(id))
            : [...new Set([...selected, ...inView])]);
    };

    // Every ticked row is deletable, since claimed rows can't be ticked.
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

        // Claimed or deleted since loading: skipped, so the toast says what
        // actually went.
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

    // One call per MAX_PASSPORT_KEY_EXPORT, each recorded. A passport with no key
    // on file is left out and counted in the toast.
    const exportKeys = async () => {
        const ids = selectedPassports.map(p => p.id);
        if (ids.length === 0) return;
        setExportingKeys(true);
        const rows: {passportId: string; activationCode: string}[] = [];
        let missing = 0;
        try {
            for (let i = 0; i < ids.length; i += MAX_PASSPORT_KEY_EXPORT) {
                const {data} = await callExportPassportKeys({passportIds: ids.slice(i, i + MAX_PASSPORT_KEY_EXPORT)});
                rows.push(...data.passports);
                missing += data.missing.length;
            }
        } catch (e: any) {
            showToast(e?.message ?? (isEnglish ? 'Failed to export the keys.' : '导出激活码失败。'), 'error');
            return;
        } finally {
            setExportingKeys(false);
        }
        if (rows.length === 0) {
            showToast(isEnglish
                ? 'None of these passports has a key on file.'
                : '这些通行证都没有激活码记录。', 'error');
            return;
        }
        downloadBlob(buildPassportCsv(rows, origin), `${selectionBase}-keys.csv`);
        if (missing > 0) {
            showToast(isEnglish
                ? `${missing} ${missing === 1 ? 'passport has' : 'passports have'} no key on file and ${missing === 1 ? 'was' : 'were'} left out.`
                : `${missing} 本通行证没有激活码记录，已略过。`, 'warning');
        }
    };

    const setFilter = (filter: StatusFilter) => onViewChange({...view, filter, page: 0});
    const setPage = (next: number) => onViewChange({...view, page: next});
    const sortBy = (column: Column) => onViewChange({
        ...view,
        sortKey: column.key,
        // The sorted column flips; a new one starts its usual way.
        sortDir: view.sortKey === column.key
            ? (view.sortDir === 'asc' ? 'desc' : 'asc')
            : column.first,
        page: 0,
    });

    // A selection export matches no filter, so its time tells downloads apart.
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

            {/* Always shown and always the same height, so the table doesn't jump
                on the first tick. Select-all lives here because a header box
                can't say it covers the whole view. Shown on an empty view too
                while something is ticked, since a selection spans tabs. */}
            {(sorted.length > 0 || selectedPassports.length > 0) && (
                <div className="admin-passport-bar">
                    <label className={`admin-passport-bar-all${
                        selectableInView.length === 0 ? ' admin-passport-bar-all--off' : ''}`}>
                        <input
                            type="checkbox"
                            checked={allInViewSelected}
                            // Partly ticked when the view holds some of the
                            // selection.
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
                        <span>
                            {selectableInView.length === 0
                                ? (isEnglish
                                    ? 'Claimed passports aren’t part of bulk actions — open one to delete it'
                                    : '已激活的通行证不参与批量操作 — 如需删除请打开该通行证')
                                : selectedPassports.length > 0
                                    ? (isEnglish
                                        ? `${selectedPassports.length} selected`
                                        : `已选择 ${selectedPassports.length} 本`)
                                    : (isEnglish
                                        ? `Select all ${selectableInView.length} unclaimed in this view`
                                        : `选择当前视图下的全部 ${selectableInView.length} 本未激活通行证`)}
                        </span>
                    </label>
                    {selectedPassports.length > 0 && (
                        <button
                            className="admin-passport-bar-clear"
                            onClick={() => onSelectedChange([])}
                            type="button"
                        >
                            {isEnglish ? 'Clear' : '清除'}
                        </button>
                    )}
                    {/* Disabled rather than absent, so what ticking is for is visible
                        up front. */}
                    <div className="admin-passport-bar-actions">
                        <button
                            className="admin-toggle-btn admin-toggle-edit admin-btn-sm"
                            onClick={() => downloadBlob(
                                buildPassportIdCsv(selectedPassports.map(p => p.id), origin),
                                `${selectionBase}-ids.csv`,
                            )}
                            disabled={selectedPassports.length === 0}
                            title={isEnglish
                                ? 'Public codes only — open a passport to view its activation key'
                                : '仅含公开编号 — 打开单本通行证即可查看其激活码'}
                            type="button"
                        >
                            {isEnglish ? 'Codes CSV' : '编号 CSV'}
                        </button>
                        {!readOnly && (
                            <button
                                className="admin-toggle-btn admin-toggle-edit admin-btn-sm"
                                onClick={() => void exportKeys()}
                                disabled={exportingKeys || selectedPassports.length === 0}
                                title={isEnglish
                                    ? 'Codes with their activation keys — each download is logged in Records'
                                    : '编号及其激活码 — 每次下载都会记录在操作记录中'}
                                type="button"
                            >
                                {exportingKeys
                                    ? (isEnglish ? 'Fetching keys…' : '获取激活码中…')
                                    : (isEnglish ? 'Keys CSV' : '激活码 CSV')}
                            </button>
                        )}
                        <button
                            className="admin-toggle-btn admin-toggle-edit admin-btn-sm"
                            onClick={() => requestPngs(selectedPassports.map(p => p.id), selectionBase)}
                            disabled={selectedPassports.length === 0 || !!progress}
                            title={isEnglish
                                ? 'Public codes only — open a passport to view its activation key'
                                : '仅含公开编号 — 打开单本通行证即可查看其激活码'}
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
                                disabled={deleting || selectedPassports.length === 0}
                                type="button"
                            >
                                {deleting
                                    ? (isEnglish ? 'Deleting…' : '删除中…')
                                    : selectedPassports.length > 0
                                        ? (isEnglish
                                            ? `Delete ${selectedPassports.length}`
                                            : `删除 ${selectedPassports.length} 本`)
                                        : (isEnglish ? 'Delete' : '删除')}
                            </button>
                        )}
                    </div>
                </div>
            )}

            {sorted.length === 0 ? (
                <p className="admin-no-results">
                    {isEnglish ? 'No passports with this status.' : '没有此状态的通行证。'}
                </p>
            ) : (
                <>
                    <PassportStockTable
                        rows={rows}
                        view={view}
                        onSortBy={sortBy}
                        selectedSet={selectedSet}
                        onToggleOne={toggleOne}
                        onOpen={onOpen}
                        owners={owners}
                        ownersFailed={ownersFailed}
                    />

                    <div className="admin-passport-pager">
                        <button
                            className="admin-toggle-btn admin-toggle-cancel admin-btn-sm"
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
                            className="admin-toggle-btn admin-toggle-cancel admin-btn-sm"
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
