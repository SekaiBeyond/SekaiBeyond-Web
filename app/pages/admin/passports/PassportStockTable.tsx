import { useLanguage } from '~/components/LanguageContextProvider';
import { claimedElsewhere, type Passport, passportDateTime, passportStatusLabel, } from '~/lib/passports';
import type { UserRecord } from '../types';
import type { StockView } from './PassportStock';

export type SortKey = 'code' | 'status' | 'holder' | 'sentTo' | 'note' | 'generated';
export type SortDir = 'asc' | 'desc';

export interface Column {
    key: SortKey;
    label: {en: string; cn: string};
    first: SortDir;
}

const COLUMNS: Column[] = [
    {key: 'code', label: {en: 'Code', cn: '编号'}, first: 'asc'},
    {key: 'status', label: {en: 'Status', cn: '状态'}, first: 'asc'},
    {key: 'holder', label: {en: 'Holder', cn: '持有者'}, first: 'asc'},
    {key: 'sentTo', label: {en: 'Sent to', cn: '发送至'}, first: 'asc'},
    {key: 'note', label: {en: 'Note', cn: '备注'}, first: 'asc'},
    {key: 'generated', label: {en: 'Generated', cn: '生成时间'}, first: 'desc'},
];

const shortDate = (date: Date | null, isEnglish: boolean): string =>
    date
        ? date.toLocaleDateString(isEnglish ? 'en-US' : 'zh-CN', {
            year: 'numeric', month: 'short', day: 'numeric',
        })
        : '—';

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

export interface OptionalColumns {
    sentTo: boolean;
    note: boolean;
}

const StackLabel = ({children}: {children: string}) => (
    <span className="admin-passport-cell-label">{children}</span>
);

interface PassportStockTableProps {
    rows: Passport[];
    optional: OptionalColumns;
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
                                       optional,
                                       view,
                                       onSortBy,
                                       selectedSet,
                                       onToggleOne,
                                       onOpen,
                                       owners,
                                       ownersFailed,
                                   }: PassportStockTableProps) => {
    const {isEnglish} = useLanguage();
    const columns = COLUMNS.filter(column =>
        (column.key !== 'sentTo' || optional.sentTo) && (column.key !== 'note' || optional.note));

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
                    {columns.map(column => (
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
                {rows.map(passport => {
                    const elsewhere = claimedElsewhere(
                        passport, passport.ownerUid ? owners?.get(passport.ownerUid)?.email : undefined);
                    return (
                        <tr
                            key={passport.id}
                            className={`admin-data-table-row--clickable admin-passport-row--${passport.status}`}
                            tabIndex={0}
                            role="button"
                            onClick={() => onOpen(passport.id)}
                            onKeyDown={e => {
                                if (e.target !== e.currentTarget) return;
                                if (e.key === 'Enter' || e.key === ' ') {
                                    e.preventDefault();
                                    onOpen(passport.id);
                                }
                            }}
                        >
                            <td
                                className="admin-passport-cell-tick"
                                onClick={e => {
                                    if (passport.status !== 'claimed') e.stopPropagation();
                                }}
                            >
                                <input
                                    type="checkbox"
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
                            {optional.sentTo && (
                                <td className={`admin-passport-cell-sent${
                                    passport.sentTo ? '' : ' admin-passport-cell-sent--none'}`}>
                                    {passport.sentTo ? (
                                        <>
                                            <StackLabel>{isEnglish ? 'Sent to ' : '发送至 '}</StackLabel>
                                            <span className="admin-passport-cell-sent-email" title={passport.sentTo}>
                                            {passport.sentTo}
                                        </span>
                                            {passport.emailScheduled && (
                                                <span className="admin-passport-cell-by">
                                                {isEnglish ? 'Queued' : '排队中'}
                                            </span>
                                            )}
                                            {elsewhere !== null && (
                                                <span
                                                    className="admin-passport-mismatch-tag"
                                                    title={isEnglish
                                                        ? `Activated on ${elsewhere || 'an account without an email address'}`
                                                        : `激活账号：${elsewhere || '无邮箱地址的账号'}`}
                                                >
                                                {isEnglish ? 'Email mismatch' : '邮箱不符'}
                                            </span>
                                            )}
                                        </>
                                    ) : <span className="admin-passport-cell-blank">—</span>}
                                </td>
                            )}
                            {optional.note && (
                                <td
                                    className={`admin-passport-cell-note${
                                        passport.note ? '' : ' admin-passport-cell-note--none'}`}
                                    title={passport.note || undefined}
                                >
                                    {passport.note ? (
                                        <>
                                            <StackLabel>{isEnglish ? 'Note: ' : '备注：'}</StackLabel>
                                            {passport.note}
                                        </>
                                    ) : <span className="admin-passport-cell-blank">—</span>}
                                </td>
                            )}
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
                    );
                })}
                </tbody>
            </table>
        </div>
    );
};
