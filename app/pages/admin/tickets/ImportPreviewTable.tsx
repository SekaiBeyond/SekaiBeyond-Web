import type { ReactNode } from 'react';
import { useLanguage } from '~/components/LanguageContextProvider';
import { rowChanges } from './importValidation';
import type { ParsedRow } from './types';
import type { AccountLink } from './useAccountLinks';

export const MAX_PREVIEW = 50;

type RowAction = 'skip' | 'override' | 'add';

const ACTION_CELL_STYLE = {display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap'} as const;
const ACTION_BADGE_STYLE = {minWidth: '85px', textAlign: 'center'} as const;
const ACTION_SELECT_STYLE = {padding: '2px 4px', borderRadius: '4px', border: '1px solid #ccc', width: '90px'};

/** A field's value, or the stored one struck through beside the file's when they differ. */
const DiffCell = ({changed, before, after}: {changed: boolean; before: ReactNode; after: ReactNode}) => (
    <td className={changed ? 'admin-tickets-import-cell-changed' : undefined}>
        {changed ? (
            <>
                <span className="admin-tickets-import-diff-old">{before}</span>
                <span className="admin-tickets-import-diff-new">{after}</span>
            </>
        ) : after}
    </td>
);

interface ImportPreviewTableProps {
    rows: ParsedRow[];
    accountLinks: Map<string, AccountLink>;
    timestampCol: string;
    rowActions: Record<string, RowAction>;
    onRowActionChange: (email: string, action: RowAction) => void;
    readOnly: boolean;
    busy: boolean;
}

export function ImportPreviewTable({
                                       rows,
                                       accountLinks,
                                       timestampCol,
                                       rowActions,
                                       onRowActionChange,
                                       readOnly,
                                       busy,
                                   }: ImportPreviewTableProps) {
    const {isEnglish} = useLanguage();

    return (
        <div className="admin-tickets-import-preview">
            <div className="admin-tickets-import-preview-header">
                <strong>
                    {isEnglish
                        ? `Preview (${rows.length} row${rows.length === 1 ? '' : 's'})`
                        : `预览（${rows.length} 行）`}
                </strong>
                {rows.length > MAX_PREVIEW && (
                    <span className="admin-helper-text" style={{marginLeft: '1rem'}}>
                        {isEnglish
                            ? `Showing first ${MAX_PREVIEW}.`
                            : `仅显示前 ${MAX_PREVIEW} 行。`}
                    </span>
                )}
            </div>
            <div className="admin-data-table-wrap">
                <table className="admin-data-table">
                    <thead>
                    <tr>
                        <th>#</th>
                        <th>{isEnglish ? 'Email' : '邮箱'}</th>
                        <th>{isEnglish ? 'Name' : '姓名'}</th>
                        <th>{isEnglish ? 'Tickets' : '门票数'}</th>
                        <th>{isEnglish ? 'Type' : '类型'}</th>
                        <th>{isEnglish ? 'Account' : '账户'}</th>
                        {timestampCol && <th>{isEnglish ? 'Time' : '时间'}</th>}
                        <th>{isEnglish ? 'Action' : '操作'}</th>
                    </tr>
                    </thead>
                    <tbody>
                    {rows.slice(0, MAX_PREVIEW).map((r, i) => {
                        const changes = rowChanges(r);
                        const isNew = r.action === 'add';
                        const account = accountLinks.get(r.email.toLowerCase());
                        const isChanged = !isNew && (changes.name || changes.count || changes.type);
                        const rowClass = isChanged
                            ? 'admin-tickets-import-row-changed'
                            : isNew
                                ? 'admin-tickets-import-row-new'
                                : 'admin-tickets-import-row-unchanged';
                        // A new row is added unless skipped; an existing one skipped unless overridden.
                        const actions: [RowAction, string][] = isNew
                            ? [['add', isEnglish ? 'Add' : '添加'], ['skip', isEnglish ? 'Skip' : '跳过']]
                            : [['skip', isEnglish ? 'Skip' : '跳过'], ['override', isEnglish ? 'Override' : '覆盖']];
                        return (
                            <tr key={`${r.email}-${i}`} className={rowClass}>
                                <td>{i + 1}</td>
                                <td>{r.email}</td>
                                <DiffCell changed={changes.name} before={r.existingName} after={r.name || '-'}/>
                                <DiffCell changed={changes.count} before={r.existingTicketCount} after={r.ticketCount}/>
                                <DiffCell changed={changes.type} before={r.existingType} after={r.type}/>
                                <td>
                                    {account === undefined ? (
                                        <span className="admin-helper-text">…</span>
                                    ) : account ? (
                                        <span
                                            className="admin-tickets-tag admin-tickets-tag-linked"
                                            title={account.displayName || account.email}
                                        >
                                            {isEnglish ? 'Account' : '已注册'}
                                        </span>
                                    ) : (
                                        <span className="admin-tickets-tag admin-tickets-tag-unlinked">
                                            {isEnglish ? 'No account' : '未注册'}
                                        </span>
                                    )}
                                </td>
                                {timestampCol && (
                                    <td>{r.timestamp ? new Date(r.timestamp).toLocaleString(isEnglish ? 'en-US' : 'zh-CN') : '-'}</td>
                                )}
                                <td>
                                    <div style={ACTION_CELL_STYLE}>
                                        <span
                                            className={`admin-tickets-import-row-badge ${isNew ? 'is-new' : isChanged ? 'is-changed' : 'is-same'}`}
                                            style={ACTION_BADGE_STYLE}
                                        >
                                            {isNew
                                                ? (isEnglish ? 'Add New' : '新增')
                                                : isChanged
                                                    ? (isEnglish ? 'Changed' : '有变更')
                                                    : (isEnglish ? 'No Change' : '无变更')}
                                        </span>
                                        <select
                                            value={rowActions[r.email] || actions[0][0]}
                                            onChange={e => onRowActionChange(r.email, e.target.value as RowAction)}
                                            disabled={readOnly || busy}
                                            style={ACTION_SELECT_STYLE}
                                        >
                                            {actions.map(([value, label]) => (
                                                <option key={value} value={value}>{label}</option>
                                            ))}
                                        </select>
                                    </div>
                                </td>
                            </tr>
                        );
                    })}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
