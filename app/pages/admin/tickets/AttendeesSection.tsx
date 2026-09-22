import { useState } from 'react';
import { useLanguage } from '~/components/LanguageContextProvider';
import { ticketStatusCounts } from './helpers';
import { type AttendeeData, type AttendeeTotals, TICKET_TYPES, type TicketType, ticketTypeLabel } from './types';
import type { AccountLink } from './useAccountLinks';

interface AttendeesSectionProps {
    loading: boolean;
    error: string | null;
    totals: AttendeeTotals;
    attendees: AttendeeData[];
    /**
     * Lowercased email -> the account behind it, or null for none. An address
     * missing from the map has not been looked up yet, which is why the tag
     * waits rather than claiming there is no account.
     */
    accountLinks: Map<string, AccountLink>;
    search: string;
    onSearchChange: (v: string) => void;
    filterUnsent: boolean;
    onFilterUnsentChange: (v: boolean) => void;
    ticketTypeFilter: TicketType | 'all';
    onTicketTypeFilterChange: (v: TicketType | 'all') => void;
    statusFilter: 'all' | 'redeemed' | 'unredeemed' | 'voided';
    onStatusFilterChange: (v: 'all' | 'redeemed' | 'unredeemed' | 'voided') => void;
    readOnly: boolean;
    onEdit: (a: AttendeeData) => void;
    onAdd: () => void;
    onVoidTicket: (a: AttendeeData, ticketId: string) => void;
    onUnvoidTicket: (a: AttendeeData, ticketId: string) => void;
    onRedeemTicket: (a: AttendeeData, ticketId: string) => void;
    onResetTicket: (a: AttendeeData, ticketId: string) => void;
    onUpdateTicketType: (a: AttendeeData, ticketId: string, newType: TicketType) => void;
    onResend: (a: AttendeeData) => void;
    onDelete: (a: AttendeeData) => void;
    onRefresh: () => void;
    hasMore: boolean;
    loadingMore: boolean;
    onLoadMore: () => void;
}

export function AttendeesSection({
                                     loading,
                                     error,
                                     totals,
                                     attendees,
                                     accountLinks,
                                     search,
                                     onSearchChange,
                                     filterUnsent,
                                     onFilterUnsentChange,
                                     ticketTypeFilter,
                                     onTicketTypeFilterChange,
                                     statusFilter,
                                     onStatusFilterChange,
                                     readOnly,
                                     onEdit,
                                     onAdd,
                                     onVoidTicket,
                                     onUnvoidTicket,
                                     onRedeemTicket,
                                     onResetTicket,
                                     onUpdateTicketType,
                                     onResend,
                                     onDelete,
                                     onRefresh,
                                     hasMore,
                                     loadingMore,
                                     onLoadMore,
                                 }: AttendeesSectionProps) {
    const {isEnglish} = useLanguage();
    const [expanded, setExpanded] = useState<Set<string>>(new Set());

    const toggleExpand = (id: string) => {
        setExpanded(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    return (
        <div className="admin-tickets-attendees">
            <div className="admin-tickets-stats">
                <span>
                    <strong>{totals.tickets}</strong> {isEnglish ? 'total tickets' : '总门票'}
                </span>
                <span>
                    <strong>{totals.used}</strong> {isEnglish ? 'redeemed' : '已使用'}
                </span>
                <span>
                    <strong>{totals.voided}</strong> {isEnglish ? 'voided' : '已作废'}
                </span>
                <span>
                    <strong>{totals.unsent}</strong> {isEnglish ? 'unsent' : '未发送'}
                </span>
                <button
                    className="admin-toggle-btn admin-toggle-save admin-tickets-refresh"
                    onClick={onAdd}
                    disabled={readOnly}
                >
                    {isEnglish ? 'Add Attendee' : '添加参加者'}
                </button>
                <button
                    className="admin-toggle-btn admin-toggle-edit"
                    onClick={onRefresh}
                    disabled={loading}
                >
                    {loading
                        ? (isEnglish ? 'Loading...' : '加载中...')
                        : (isEnglish ? 'Refresh' : '刷新')}
                </button>
            </div>

            <div className="admin-tickets-filters">
                <input
                    type="text"
                    className="admin-input"
                    placeholder={isEnglish ? 'Search name or email...' : '搜索姓名或邮箱...'}
                    value={search}
                    onChange={(e) => onSearchChange(e.target.value)}
                />
                <select
                    className="admin-input"
                    style={{width: 'auto', minWidth: '120px'}}
                    value={ticketTypeFilter}
                    onChange={(e) => onTicketTypeFilterChange(e.target.value as TicketType | 'all')}
                >
                    <option value="all">{isEnglish ? 'All Types' : '所有类型'}</option>
                    {TICKET_TYPES.map(tt => (
                        <option key={tt.value} value={tt.value}>
                            {isEnglish ? tt.labelEn : tt.labelCn}
                        </option>
                    ))}
                </select>
                <select
                    className="admin-input"
                    style={{width: 'auto', minWidth: '120px'}}
                    value={statusFilter}
                    onChange={(e) => onStatusFilterChange(e.target.value as 'all' | 'redeemed' | 'unredeemed' | 'voided')}
                >
                    <option value="all">{isEnglish ? 'All Statuses' : '所有状态'}</option>
                    <option value="redeemed">{isEnglish ? 'Redeemed' : '已验证'}</option>
                    <option value="unredeemed">{isEnglish ? 'Not Redeemed' : '未验证'}</option>
                    <option value="voided">{isEnglish ? 'Voided' : '已作废'}</option>
                </select>
                <label className="admin-checkbox-label admin-tickets-filter-checkbox">
                    <input
                        type="checkbox"
                        checked={filterUnsent}
                        onChange={(e) => onFilterUnsentChange(e.target.checked)}
                    />
                    <span>{isEnglish ? 'Unsent only' : '仅未发送'}</span>
                </label>
            </div>

            {error && <p className="admin-no-results">{error}</p>}

            {loading && attendees.length === 0 && (
                <div className="spinner spinner-centered"/>
            )}

            {!loading && attendees.length === 0 && !error && (
                <p className="admin-no-results">
                    {isEnglish ? 'No attendees match.' : '暂无符合条件的参加者。'}
                </p>
            )}

            {attendees.map((a) => {
                const {used, voided, remaining} = ticketStatusCounts(a);
                const isExpanded = expanded.has(a.id);
                const ticketType = a.tickets[0]?.type || 'normal';
                // undefined while the lookup is still out; null once it has come
                // back with nothing.
                const account = accountLinks.get(a.email.toLowerCase());
                return (
                    <div key={a.id} className="admin-tickets-attendee-row">
                        <div
                            className="admin-tickets-attendee-summary"
                            onClick={() => toggleExpand(a.id)}
                        >
                            <div className="admin-tickets-attendee-info">
                                <div className="admin-user-name">{a.name}</div>
                                <div className="admin-user-email">{a.email}</div>
                            </div>
                            <div className="admin-tickets-attendee-stats">
                                <span
                                    className={`admin-tickets-tag admin-tickets-tag-type-${ticketType.toLowerCase().replace(/\s+/g, '-')}`}>
                                    {ticketTypeLabel(ticketType, isEnglish)}
                                </span>
                                <span className="admin-tickets-attendee-count">
                                    {a.ticketCount} {isEnglish ? 'tickets' : '张'}
                                </span>
                                {used > 0 && (
                                    <span className="admin-tickets-tag admin-tickets-tag-used">
                                        {used} {isEnglish ? 'used' : '已用'}
                                    </span>
                                )}
                                {voided > 0 && (
                                    <span className="admin-tickets-tag admin-tickets-tag-voided">
                                        {voided} {isEnglish ? 'voided' : '作废'}
                                    </span>
                                )}
                                {remaining > 0 && used === 0 && voided === 0 && (
                                    <span className="admin-tickets-tag admin-tickets-tag-fresh">
                                        {isEnglish ? 'Fresh' : '未使用'}
                                    </span>
                                )}
                                <span className={
                                          a.emailScheduled
                                              ? 'admin-tickets-tag admin-tickets-tag-queued'
                                              : a.emailSent
                                                  ? 'admin-tickets-tag admin-tickets-tag-sent'
                                                  : 'admin-tickets-tag admin-tickets-tag-unsent'
                                      }>
                                    {a.emailScheduled
                                        ? (isEnglish ? 'Queued' : '待发送')
                                        : a.emailSent
                                            ? (isEnglish ? 'Sent' : '已发送')
                                            : (isEnglish ? 'Unsent' : '未发送')}
                                </span>
                                {account !== undefined && (
                                    <span className={account
                                        ? 'admin-tickets-tag admin-tickets-tag-linked'
                                        : 'admin-tickets-tag admin-tickets-tag-unlinked'}>
                                        {account
                                            ? (isEnglish ? 'Account' : '已注册')
                                            : (isEnglish ? 'No account' : '未注册')}
                                    </span>
                                )}
                            </div>
                            <div className="admin-tickets-attendee-expand">
                                {isExpanded ? '▾' : '▸'}
                            </div>
                        </div>

                        {isExpanded && (
                            <div className="admin-tickets-attendee-detail">
                                <p className="admin-helper-text admin-tickets-attendee-account">
                                    {account === undefined
                                        ? (isEnglish ? 'Checking for an account…' : '正在查询账户…')
                                        : account
                                            ? (isEnglish
                                                ? 'Scanning a ticket will mark this event attended on '
                                                : '扫描门票时，将在以下账户标记参加本活动：')
                                            : (isEnglish
                                                ? 'No account uses this email yet. Tickets still work — attendance is credited if they sign up with it later.'
                                                : '暂无账户使用该邮箱。门票照常可用 — 若其日后以该邮箱注册，参加记录会被补上。')}
                                    {account && (account.uid
                                        ? (
                                            <a
                                                href={`/profile?uid=${account.uid}`}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="admin-tickets-attendee-account-link"
                                            >
                                                {account.displayName || a.email}
                                            </a>
                                        )
                                        : (isEnglish ? 'their profile.' : '该用户主页。'))}
                                </p>
                                {!readOnly && (
                                    <div className="admin-tickets-attendee-actions">
                                        <button
                                            className="admin-toggle-btn admin-toggle-edit"
                                            onClick={() => onEdit(a)}
                                        >
                                            {isEnglish ? 'Edit' : '编辑'}
                                        </button>
                                        <button
                                            className="admin-toggle-btn admin-toggle-save"
                                            onClick={() => onResend(a)}
                                            disabled={a.tickets.every(t => t.voided)}
                                        >
                                            {isEnglish ? 'Resend Email' : '重发邮件'}
                                        </button>
                                        <button
                                            className="admin-toggle-btn admin-toggle-revoke"
                                            onClick={() => onDelete(a)}
                                        >
                                            {isEnglish ? 'Remove' : '移除'}
                                        </button>
                                    </div>
                                )}
                                <div className="admin-data-table-wrap">
                                    <table className="admin-data-table">
                                        <thead>
                                        <tr>
                                            <th>#</th>
                                            <th>{isEnglish ? 'Ticket ID' : '门票 ID'}</th>
                                            <th>{isEnglish ? 'Type' : '类型'}</th>
                                            <th>{isEnglish ? 'Status' : '状态'}</th>
                                            <th>{isEnglish ? 'Created' : '创建时间'}</th>
                                            <th>{isEnglish ? 'Redeemed By' : '验证人'}</th>
                                            <th></th>
                                        </tr>
                                        </thead>
                                        <tbody>
                                        {a.tickets.map((t, i) => (
                                            <tr key={t.ticketId}>
                                                <td>{i + 1}</td>
                                                <td className="admin-tickets-ticket-id" title={t.ticketId}>
                                                    {t.ticketId.slice(0, 8)}…
                                                </td>
                                                <td>
                                                    {readOnly ? (
                                                        <span
                                                            className={`admin-tickets-tag admin-tickets-tag-type-${(t.type || 'normal').toLowerCase().replace(/\s+/g, '-')}`}>
                                                            {ticketTypeLabel(t.type || 'normal', isEnglish)}
                                                        </span>
                                                    ) : (
                                                        <select
                                                            className={`admin-tickets-tag admin-tickets-tag-type-${(t.type || 'normal').toLowerCase().replace(/\s+/g, '-')}`}
                                                            value={t.type || 'normal'}
                                                            onChange={(e) => onUpdateTicketType(a, t.ticketId, e.target.value as TicketType)}
                                                            style={{
                                                                cursor: 'pointer',
                                                                border: '1px solid transparent',
                                                                appearance: 'none',
                                                                WebkitAppearance: 'none',
                                                                textAlign: 'center',
                                                            }}
                                                        >
                                                            {TICKET_TYPES.map(tt => (
                                                                <option key={tt.value} value={tt.value}>
                                                                    {isEnglish ? tt.labelEn : tt.labelCn}
                                                                </option>
                                                            ))}
                                                        </select>
                                                    )}
                                                </td>
                                                <td>
                                                    {t.voided ? (
                                                        <span className="admin-tickets-tag admin-tickets-tag-voided">
                                                        {isEnglish ? 'Voided' : '作废'}
                                                    </span>
                                                    ) : t.redeemed ? (
                                                        <span className="admin-tickets-tag admin-tickets-tag-used">
                                                        {isEnglish ? 'Redeemed' : '已验证'}
                                                    </span>
                                                    ) : (
                                                        <span className="admin-tickets-tag admin-tickets-tag-fresh">
                                                        {isEnglish ? 'Valid' : '有效'}
                                                    </span>
                                                    )}
                                                </td>
                                                <td>
                                                    {t.createdAt ? (
                                                        <span className="admin-tickets-redeemed-meta">
                                                            {t.createdAt.toLocaleString(isEnglish ? 'en-US' : 'zh-CN', {
                                                                month: 'short', day: 'numeric', year: 'numeric',
                                                                hour: '2-digit', minute: '2-digit',
                                                            })}
                                                        </span>
                                                    ) : '—'}
                                                </td>
                                                <td>
                                                    {t.redeemed ? (
                                                        <span className="admin-tickets-redeemed-meta">
                                                        {t.redeemedByName || '—'}
                                                            {t.redeemedAt && (
                                                                <><br/>
                                                                    <small>
                                                                        {t.redeemedAt.toLocaleString(isEnglish ? 'en-US' : 'zh-CN', {
                                                                            month: 'short', day: 'numeric',
                                                                            hour: '2-digit', minute: '2-digit',
                                                                        })}
                                                                    </small>
                                                                </>
                                                            )}
                                                    </span>
                                                    ) : '—'}
                                                </td>
                                                <td>
                                                    {t.voided ? (
                                                        <button
                                                            className="admin-toggle-btn admin-toggle-save"
                                                            onClick={() => onUnvoidTicket(a, t.ticketId)}
                                                            disabled={readOnly}
                                                            style={{padding: '2px 8px', fontSize: '12px'}}
                                                        >
                                                            {isEnglish ? 'Unvoid' : '撤销作废'}
                                                        </button>
                                                    ) : (
                                                        <div className="admin-tickets-ticket-actions"
                                                             style={{
                                                                 display: 'flex',
                                                                 gap: '6px',
                                                                 justifyContent: 'flex-end',
                                                                 flexWrap: 'wrap',
                                                             }}>
                                                            {t.redeemed ? (
                                                                <button
                                                                    className="admin-toggle-btn admin-toggle-edit"
                                                                    onClick={() => onResetTicket(a, t.ticketId)}
                                                                    disabled={readOnly}
                                                                    style={{padding: '2px 8px', fontSize: '12px'}}
                                                                >
                                                                    {isEnglish ? 'Reset' : '重置'}
                                                                </button>
                                                            ) : (
                                                                <button
                                                                    className="admin-toggle-btn admin-toggle-save"
                                                                    onClick={() => onRedeemTicket(a, t.ticketId)}
                                                                    disabled={readOnly}
                                                                    style={{padding: '2px 8px', fontSize: '12px'}}
                                                                >
                                                                    {isEnglish ? 'Redeem' : '验证'}
                                                                </button>
                                                            )}
                                                            <button
                                                                className="admin-tickets-void-btn"
                                                                onClick={() => onVoidTicket(a, t.ticketId)}
                                                                disabled={readOnly}
                                                            >
                                                                {isEnglish ? 'Void' : '作废'}
                                                            </button>
                                                        </div>
                                                    )}
                                                </td>
                                            </tr>
                                        ))}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        )}
                    </div>
                );
            })}

            {hasMore && (
                <div style={{textAlign: 'center', marginTop: '20px'}}>
                    <button
                        className="admin-toggle-btn admin-toggle-edit"
                        onClick={onLoadMore}
                        disabled={loadingMore}
                    >
                        {loadingMore
                            ? (isEnglish ? 'Loading...' : '加载中...')
                            : (isEnglish ? 'Load More' : '加载更多')}
                    </button>
                </div>
            )}
        </div>
    );
}
