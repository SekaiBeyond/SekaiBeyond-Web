import { useLanguage } from '~/components/LanguageContextProvider';
import type { ParsedRow } from './types';
import type { AccountLink } from './useAccountLinks';

export const MAX_PREVIEW = 50;

interface ImportPreviewTableProps {
    rows: ParsedRow[];
    accountLinks: Map<string, AccountLink>;
    timestampCol: string;
    rowActions: Record<string, 'skip' | 'override' | 'add'>;
    onRowActionChange: (email: string, action: 'skip' | 'override' | 'add') => void;
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
                        const nameChanged = r.existingName !== undefined && r.existingName !== r.name;
                        const countChanged = r.existingTicketCount !== undefined && r.existingTicketCount !== r.ticketCount;
                        const typeChanged = r.existingType !== undefined && r.existingType !== r.type;
                        const isNew = r.action === 'add';
                        const account = accountLinks.get(r.email.toLowerCase());
                        const isChanged = !isNew && (nameChanged || countChanged || typeChanged);
                        const rowClass = isChanged
                            ? 'admin-tickets-import-row-changed'
                            : isNew
                                ? 'admin-tickets-import-row-new'
                                : 'admin-tickets-import-row-unchanged';
                        return (
                            <tr key={`${r.email}-${i}`} className={rowClass}>
                                <td>{i + 1}</td>
                                <td>{r.email}</td>
                                <td className={nameChanged ? 'admin-tickets-import-cell-changed' : undefined}>
                                    {nameChanged ? (
                                        <>
                                            <span className="admin-tickets-import-diff-old">{r.existingName}</span>
                                            <span className="admin-tickets-import-diff-new">{r.name}</span>
                                        </>
                                    ) : r.name}
                                </td>
                                <td className={countChanged ? 'admin-tickets-import-cell-changed' : undefined}>
                                    {countChanged ? (
                                        <>
                                            <span
                                                className="admin-tickets-import-diff-old">{r.existingTicketCount}</span>
                                            <span className="admin-tickets-import-diff-new">{r.ticketCount}</span>
                                        </>
                                    ) : r.ticketCount}
                                </td>
                                <td className={typeChanged ? 'admin-tickets-import-cell-changed' : undefined}>
                                    {typeChanged ? (
                                        <>
                                            <span className="admin-tickets-import-diff-old">{r.existingType}</span>
                                            <span className="admin-tickets-import-diff-new">{r.type}</span>
                                        </>
                                    ) : r.type}
                                </td>
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
                                    {isNew ? (
                                        <div style={{
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: '6px',
                                            flexWrap: 'wrap',
                                        }}>
                                                <span
                                                    className="admin-tickets-import-row-badge is-new"
                                                    style={{minWidth: '85px', textAlign: 'center'}}
                                                >
                                                    {isEnglish ? 'Add New' : '新增'}
                                                </span>
                                            <select
                                                value={rowActions[r.email] || 'add'}
                                                onChange={e => onRowActionChange(r.email, e.target.value as 'skip' | 'add')}
                                                disabled={readOnly || busy}
                                                style={{
                                                    padding: '2px 4px',
                                                    borderRadius: '4px',
                                                    border: '1px solid var(--border-color, #ccc)',
                                                    width: '90px',
                                                }}
                                            >
                                                <option value="add">{isEnglish ? 'Add' : '添加'}</option>
                                                <option value="skip">{isEnglish ? 'Skip' : '跳过'}</option>
                                            </select>
                                        </div>
                                    ) : (
                                        <div style={{
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: '6px',
                                            flexWrap: 'wrap',
                                        }}>
                                                <span
                                                    className={`admin-tickets-import-row-badge ${isChanged ? 'is-changed' : 'is-same'}`}
                                                    style={{minWidth: '85px', textAlign: 'center'}}
                                                >
                                                    {isChanged
                                                        ? (isEnglish ? 'Changed' : '有变更')
                                                        : (isEnglish ? 'No Change' : '无变更')}
                                                </span>
                                            <select
                                                value={rowActions[r.email] || 'skip'}
                                                onChange={e => onRowActionChange(r.email, e.target.value as 'skip' | 'override')}
                                                disabled={readOnly || busy}
                                                style={{
                                                    padding: '2px 4px',
                                                    borderRadius: '4px',
                                                    border: '1px solid var(--border-color, #ccc)',
                                                    width: '90px',
                                                }}
                                            >
                                                <option value="skip">{isEnglish ? 'Skip' : '跳过'}</option>
                                                <option value="override">{isEnglish ? 'Override' : '覆盖'}</option>
                                            </select>
                                        </div>
                                    )}
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
