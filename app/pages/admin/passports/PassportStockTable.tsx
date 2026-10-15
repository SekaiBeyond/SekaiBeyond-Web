import { useLanguage } from '~/components/LanguageContextProvider';
import { type Passport, passportDateTime, passportStatusLabel, } from '~/lib/passports';
import type { UserRecord } from '../types';
import type { StockView } from './PassportStock';

export type SortKey = 'code' | 'status' | 'holder' | 'generated';
export type SortDir = 'asc' | 'desc';

export interface Column {
    key: SortKey;
    label: {en: string; cn: string};
    /** Which way the first click sorts: text A–Z, dates newest first. */
    first: SortDir;
}

export const COLUMNS: Column[] = [
    {key: 'code', label: {en: 'Code', cn: '编号'}, first: 'asc'},
    {key: 'status', label: {en: 'Status', cn: '状态'}, first: 'asc'},
    {key: 'holder', label: {en: 'Holder', cn: '持有者'}, first: 'asc'},
    {key: 'generated', label: {en: 'Generated', cn: '生成时间'}, first: 'desc'},
];

/** Date without the time, which only the tooltip and the detail page need. */
const shortDate = (date: Date | null, isEnglish: boolean): string =>
    date
        ? date.toLocaleDateString(isEnglish ? 'en-US' : 'zh-CN', {
            year: 'numeric', month: 'short', day: 'numeric',
        })
        : '—';

/**
 * The Holder cell. A holder whose account was deleted says so, since a blank
 * would read as "nobody"; when holders couldn't be read at all, it stays blank.
 */
const Holder = ({
                    passport,
                    owners,
                    ownersFailed,
                    isEnglish,
                }: {
    passport: Passport;
    owners: Map<string, UserRecord> | null;
    ownersFailed: boolean;
    isEnglish: boolean;
}) => {
    if (passport.status !== 'claimed' || !passport.ownerUid) {
        return <span className="admin-passport-cell-blank">—</span>;
    }
    if (owners === null) return <span className="admin-passport-cell-blank">…</span>;

    const owner = owners.get(passport.ownerUid);
    if (!owner && ownersFailed) return <span className="admin-passport-cell-blank">—</span>;
    if (!owner) {
        return (
            <span className="admin-passport-cell-blank">
                {isEnglish ? 'Account deleted' : '账号已删除'}
            </span>
        );
    }
    return (
        <span className="admin-passport-holder">
            {owner.photoURL ? (
                <img
                    src={owner.photoURL}
                    alt=""
                    className="admin-passport-holder-face"
                    referrerPolicy="no-referrer"
                />
            ) : (
                // No photo: a blank face rather than a broken image.
                <span className="admin-passport-holder-face admin-passport-holder-face--blank">
                    {Array.from(owner.displayName.trim())[0]?.toUpperCase() ?? '?'}
                </span>
            )}
            <span className="admin-passport-holder-text">
                <span className="admin-passport-holder-name">{owner.displayName}</span>
                <span className="admin-passport-holder-email">{owner.email}</span>
            </span>
        </span>
    );
};

interface PassportStockTableProps {
    rows: Passport[];
    view: StockView;
    onSortBy: (column: Column) => void;
    selectedSet: Set<string>;
    onToggleOne: (id: string) => void;
    onOpen: (id: string) => void;
    owners: Map<string, UserRecord> | null;
    ownersFailed: boolean;
}

export const PassportStockTable = ({
                                       rows,
                                       view,
                                       onSortBy,
                                       selectedSet,
                                       onToggleOne,
                                       onOpen,
                                       owners,
                                       ownersFailed,
                                   }: PassportStockTableProps) => {
    const {isEnglish} = useLanguage();

    return (
        <div className="admin-data-table-wrap">
            <table className="admin-data-table admin-passport-table">
                <thead>
                <tr>
                    <th className="admin-passport-cell-tick">
                            <span className="admin-sr-only">
                                {isEnglish ? 'Selected' : '已选择'}
                            </span>
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
                                onClick={() => onSortBy(column)}
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
                        className={`admin-data-table-row--clickable admin-passport-row admin-passport-row--${passport.status}`}
                        tabIndex={0}
                        role="button"
                        onClick={() => onOpen(passport.id)}
                        onKeyDown={e => {
                            // Only the row's own keys; space on the tick box
                            // ticks it.
                            if (e.target !== e.currentTarget) return;
                            if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                onOpen(passport.id);
                            }
                        }}
                    >
                        <td
                            className="admin-passport-cell-tick"
                            // The tick cell swallows the open, except on a
                            // claimed row, which has no box.
                            onClick={e => {
                                if (passport.status !== 'claimed') e.stopPropagation();
                            }}
                        >
                            <input
                                type="checkbox"
                                // Claimed since being ticked: shown unticked,
                                // as it has left the selection.
                                checked={passport.status !== 'claimed' && selectedSet.has(passport.id)}
                                onChange={() => onToggleOne(passport.id)}
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
                        <td className="admin-passport-cell-status">
                                <span className={`admin-passport-status admin-passport-status--${passport.status}`}>
                                    <span className="admin-passport-status-dot" aria-hidden="true"/>
                                    {passportStatusLabel(passport.status, isEnglish)}
                                </span>
                        </td>
                        {/* Flagged when empty, so the stacked layout drops the
                            line. */}
                        <td className={`admin-passport-cell-holder${
                            passport.status === 'claimed' && passport.ownerUid
                                ? '' : ' admin-passport-cell-holder--none'}`}>
                            <Holder
                                passport={passport}
                                owners={owners}
                                ownersFailed={ownersFailed}
                                isEnglish={isEnglish}
                            />
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
    );
};
