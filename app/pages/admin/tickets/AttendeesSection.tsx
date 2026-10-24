import { useEffect, useState } from 'react';
import { useLanguage } from '~/components/LanguageContextProvider';
import type { ShowToast } from '../utils';
import { checkedInWalkIn, ticketStatusCounts, ticketTypeCounts } from './helpers';
import {
    anonymousAttendeeName,
    type AttendeeData,
    type AttendeeTotals,
    type StatusFilter,
    TICKET_TYPES,
    type TicketType,
    ticketTypeLabel,
} from './types';
import type { AccountLink } from './useAccountLinks';

interface AttendeesSectionProps {
    loading: boolean;
    error: string | null;
    totals: AttendeeTotals;
    attendees: AttendeeData[];
    /**
     * Lowercased email → its account, or null for none. Missing means not
     * looked up yet, so the tag waits.
     */
    accountLinks: Map<string, AccountLink>;
    search: string;
    onSearchChange: (v: string) => void;
    filterUnsent: boolean;
    onFilterUnsentChange: (v: boolean) => void;
    ticketTypeFilter: TicketType | 'all';
    onTicketTypeFilterChange: (v: TicketType | 'all') => void;
    statusFilter: StatusFilter;
    onStatusFilterChange: (v: StatusFilter) => void;
    readOnly: boolean;
    /**
     * The event is on and the viewer may take walk-ins, so Add takes walk-ins,
     * shown even when the list is otherwise read-only.
     */
    walkIn: boolean;
    onEdit: (a: AttendeeData) => void;
    onAdd: () => void;
    /** Downloads the attendees the filters match. Left out for those who may not. */
    onExport?: () => void;
    /** How many attendees the filters match, beyond the page shown. */
    matchCount: number;
    onVoidTicket: (a: AttendeeData, ticketId: string) => void;
    onUnvoidTicket: (a: AttendeeData, ticketId: string) => void;
    onRedeemTicket: (a: AttendeeData, ticketId: string) => void;
    onResetTicket: (a: AttendeeData, ticketId: string) => void;
    onUpdateTicketType: (a: AttendeeData, ticketId: string, newType: TicketType) => void;
    /** Resolves to the note as saved, or null if it wasn't. */
    onUpdateTicketNotes: (a: AttendeeData, ticketId: string, notes: string) => Promise<string | null>;
    onResend: (a: AttendeeData) => void;
    onDelete: (a: AttendeeData) => void;
    onRefresh: () => void;
    hasMore: boolean;
    onLoadMore: () => void;
    showToast: ShowToast;
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
                                     walkIn,
                                     onEdit,
                                     onAdd,
                                     onExport,
                                     matchCount,
                                     onVoidTicket,
                                     onUnvoidTicket,
                                     onRedeemTicket,
                                     onResetTicket,
                                     onUpdateTicketType,
                                     onUpdateTicketNotes,
                                     onResend,
                                     onDelete,
                                     onRefresh,
                                     hasMore,
                                     onLoadMore,
                                     showToast,
                                 }: AttendeesSectionProps) {
    const {isEnglish} = useLanguage();
    const [expanded, setExpanded] = useState<Set<string>>(new Set());
    const [copiedTicketId, setCopiedTicketId] = useState<string | null>(null);
    const filtered = !!search.trim() || filterUnsent || ticketTypeFilter !== 'all' || statusFilter !== 'all';

    useEffect(() => {
        if (!copiedTicketId) return;
        const timer = setTimeout(() => setCopiedTicketId(null), 2000);
        return () => clearTimeout(timer);
    }, [copiedTicketId]);

    // The whole ID, which is what the scanner's manual entry takes.
    const copyTicketId = async (ticketId: string) => {
        try {
            await navigator.clipboard.writeText(ticketId);
            setCopiedTicketId(ticketId);
        } catch {
            showToast(
                isEnglish ? `Couldn't copy. The ticket ID is ${ticketId}` : `复制失败。门票 ID 为 ${ticketId}`,
                'error',
            );
        }
    };

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
                {totals.walkIns > 0 && (
                    <span>
                        <strong>{totals.walkIns}</strong> {isEnglish ? 'walk-in' : '现场登记'}
                    </span>
                )}
                {totals.hometown > 0 && (
                    <span>
                        <strong>{totals.hometown}</strong> HomeTown
                        {(totals.unlisted > 0 || totals.missingFromHometown > 0) && (isEnglish
                            ? ` (${[
                                totals.unlisted > 0 && `${totals.unlisted} not on list`,
                                totals.missingFromHometown > 0 && `${totals.missingFromHometown} not in latest export`,
                            ].filter(Boolean).join(', ')})`
                            : `（${[
                                totals.unlisted > 0 && `${totals.unlisted} 张不在名单中`,
                                totals.missingFromHometown > 0 && `${totals.missingFromHometown} 张不在最新导出中`,
                            ].filter(Boolean).join('，')}）`)}
                    </span>
                )}
                {/* Read-only staff working the door still take walk-ins. */}
                {(!readOnly || walkIn) && (
                    <button
                        className="admin-toggle-btn admin-toggle-save admin-tickets-refresh"
                        onClick={onAdd}
                    >
                        {walkIn
                            ? (isEnglish ? 'Add Walk-in' : '现场登记')
                            : (isEnglish ? 'Add Attendee' : '添加参加者')}
                    </button>
                )}
                {/* Exports what the filters match, so it says how many once any is set. */}
                {onExport && (
                    <button
                        className="admin-toggle-btn admin-toggle-edit"
                        onClick={onExport}
                        disabled={loading || matchCount === 0}
                    >
                        {!filtered
                            ? (isEnglish ? 'Export All' : '导出全部')
                            : (isEnglish ? `Export ${matchCount} Filtered` : `导出筛选结果（${matchCount}）`)}
                    </button>
                )}
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
                    placeholder={isEnglish ? 'Search name, email, ticket # or note...' : '搜索姓名、邮箱、门票号或备注...'}
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
                    onChange={(e) => onStatusFilterChange(e.target.value as StatusFilter)}
                >
                    <option value="all">{isEnglish ? 'All Statuses' : '所有状态'}</option>
                    <option value="redeemed">{isEnglish ? 'Redeemed' : '已验证'}</option>
                    <option value="unredeemed">{isEnglish ? 'Not Redeemed' : '未验证'}</option>
                    <option value="voided">{isEnglish ? 'Voided' : '已作废'}</option>
                    {/* The HomeTown tickets to review: likely fakes, and likely refunds. */}
                    {totals.hometown > 0 && (
                        <>
                            <option
                                value="unlisted">{isEnglish ? 'HomeTown: not on list' : 'HomeTown：不在名单中'}</option>
                            <option value="missing">
                                {isEnglish ? 'HomeTown: not in latest export' : 'HomeTown：不在最新导出中'}
                            </option>
                        </>
                    )}
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
                // undefined while asking; null for no account.
                const account = accountLinks.get(a.email.toLowerCase());
                // Nothing to send without an address, HomeTown sends its own, and a
                // walk-in already in at the door is owed nothing.
                const emailState = !a.email || a.hometown ? null
                    : a.emailScheduled ? 'queued'
                        : a.emailSent ? 'sent'
                            : checkedInWalkIn(a) ? null : 'unsent';
                // A buyer with several HomeTown tickets has a row for each, told
                // apart by number; a nameless, emailless one already leads with it.
                const hometownNumber = a.hometown && (a.name || a.email) ? a.ticketIds[0] : '';
                return (
                    <div key={a.id} className="admin-tickets-attendee-row">
                        <div
                            className="admin-tickets-attendee-summary"
                            onClick={() => toggleExpand(a.id)}
                        >
                            <div className="admin-tickets-attendee-info">
                                {/* Whatever they gave leads, and the second line says
                                    what's missing, keeping every row the same height. */}
                                <div className="admin-user-name">
                                    {a.name || a.email || anonymousAttendeeName(a, isEnglish)}
                                </div>
                                {a.name && a.email
                                    ? (
                                        <div className="admin-user-email">
                                            {a.email}
                                            {hometownNumber && <HometownNumber number={hometownNumber}/>}
                                        </div>
                                    )
                                    : (
                                        <div className="admin-user-email admin-tickets-attendee-no-name">
                                            {a.email
                                                ? (isEnglish ? 'No name' : '未填写姓名')
                                                : a.name
                                                    ? (isEnglish ? 'No email' : '未填写邮箱')
                                                    : (isEnglish ? 'No name or email' : '未填写姓名和邮箱')}
                                            {hometownNumber && <HometownNumber number={hometownNumber}/>}
                                        </div>
                                    )}
                            </div>
                            <div className="admin-tickets-attendee-stats">
                                {a.walkIn && (
                                    <span className="admin-tickets-tag admin-tickets-tag-walk-in">
                                        {isEnglish ? 'Walk-in' : '现场'}
                                    </span>
                                )}
                                {a.hometown && (
                                    <span className="admin-tickets-tag admin-tickets-tag-hometown">HomeTown</span>
                                )}
                                {a.unlisted && (
                                    <span className="admin-tickets-tag admin-tickets-tag-unlisted">
                                        {isEnglish ? 'Not on list' : '不在名单中'}
                                    </span>
                                )}
                                {a.missingFromHometown && (
                                    <span className="admin-tickets-tag admin-tickets-tag-missing">
                                        {isEnglish ? 'Not in latest export' : '不在最新导出中'}
                                    </span>
                                )}
                                {/* An unlisted HomeTown ticket's type isn't known until an import
                                    lists it; tickets changed one by one can hold several. */}
                                {!a.unlisted && ticketTypeCounts(a).map(([type]) => (
                                    <span
                                        key={type}
                                        className={`admin-tickets-tag admin-tickets-tag-type-${type.toLowerCase().replace(/\s+/g, '-')}`}>
                                        {ticketTypeLabel(type, isEnglish)}
                                    </span>
                                ))}
                                <span className="admin-tickets-attendee-count">
                                    {a.ticketCount} {isEnglish ? (a.ticketCount === 1 ? 'ticket' : 'tickets') : '张'}
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
                                {emailState && (
                                    <span className={`admin-tickets-tag admin-tickets-tag-${emailState}`}>
                                        {emailState === 'queued'
                                            ? (isEnglish ? 'Queued' : '待发送')
                                            : emailState === 'sent'
                                                ? (isEnglish ? 'Sent' : '已发送')
                                                : (isEnglish ? 'Unsent' : '未发送')}
                                    </span>
                                )}
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
                                {a.hometown && (
                                    <p className="admin-helper-text">
                                        {a.unlisted
                                            ? (isEnglish
                                                ? 'A HomeTown ticket let in at the door while it wasn\'t on the imported list. An import that lists it fills in the buyer.'
                                                : '在不在已导入名单中时于现场放行的 HomeTown 门票。之后的导入若包含此票，会补上购票者信息。')
                                            : (isEnglish
                                                ? `Bought through HomeTown${a.hometownOrderId ? `, order #${a.hometownOrderId}` : ''}. HomeTown sent the ticket, so no email is sent from here.`
                                                : `通过 HomeTown 购买${a.hometownOrderId ? `，订单号 ${a.hometownOrderId}` : ''}。门票由 HomeTown 发送，此处不发送邮件。`)}
                                    </p>
                                )}
                                {a.missingFromHometown && (
                                    <p className="admin-helper-text admin-tickets-edit-warning">
                                        {isEnglish
                                            ? `Not in the latest HomeTown export${a.hometownSeenAt ? ` (last seen in an import on ${a.hometownSeenAt.toLocaleString('en-US', {
                                                month: 'short',
                                                day: 'numeric',
                                                hour: 'numeric',
                                                minute: '2-digit'
                                            })})` : ''}. It was probably refunded or transferred; the ticket still works until it's voided here.`
                                            : `不在最新的 HomeTown 导出中${a.hometownSeenAt ? `（最后出现于 ${a.hometownSeenAt.toLocaleString('zh-CN', {
                                                month: 'short',
                                                day: 'numeric',
                                                hour: '2-digit',
                                                minute: '2-digit'
                                            })} 的导出）` : ''}。可能已退款或转让；在此作废前门票仍然有效。`}
                                    </p>
                                )}
                                <p className="admin-helper-text admin-tickets-attendee-account">
                                    {!a.email
                                        ? a.hometown
                                            ? (isEnglish
                                                ? 'No email, so no account is credited.'
                                                : '未填写邮箱，因此不会计入任何账户。')
                                            : (isEnglish
                                                ? 'No email, so no tickets can be sent and no account is credited.'
                                                : '未填写邮箱，因此无法发送门票，也不会计入任何账户。')
                                        : account === undefined
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
                                {a.email && !a.hometown && !a.emailSent && checkedInWalkIn(a) && (
                                    <p className="admin-helper-text">
                                        {isEnglish
                                            ? 'Checked in at the door, so Send Unsent passes them by. Resend Email still sends their tickets.'
                                            : '已在现场签到，因此"发送未发送"会跳过此人。"重发邮件"仍可发送其门票。'}
                                    </p>
                                )}
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
                                            disabled={!a.email || a.hometown || a.tickets.every(t => t.voided)}
                                        >
                                            {isEnglish ? 'Resend Email' : '重发邮件'}
                                        </button>
                                        <button
                                            className="admin-toggle-btn admin-toggle-revoke"
                                            onClick={() => onDelete(a)}
                                            // Its record is what stops the number getting in again.
                                            disabled={a.hometown}
                                            title={a.hometown
                                                ? (isEnglish ? 'HomeTown tickets are voided, not removed.' : 'HomeTown 门票只能作废，不能移除。')
                                                : undefined}
                                        >
                                            {isEnglish ? 'Remove' : '移除'}
                                        </button>
                                    </div>
                                )}
                                <div className="admin-data-table-wrap">
                                    {/* On a phone each row is a card, its cells labelled from data-label. */}
                                    <table className="admin-data-table admin-tickets-table">
                                        <thead>
                                        <tr>
                                            <th>#</th>
                                            <th>{isEnglish ? 'Ticket ID' : '门票 ID'}</th>
                                            <th>{isEnglish ? 'Type' : '类型'}</th>
                                            <th>{isEnglish ? 'Status' : '状态'}</th>
                                            <th>{isEnglish ? 'Created' : '创建时间'}</th>
                                            <th>{isEnglish ? 'Redeemed By' : '验证人'}</th>
                                            <th>{isEnglish ? 'Notes' : '备注'}</th>
                                            {!readOnly && <th></th>}
                                        </tr>
                                        </thead>
                                        <tbody>
                                        {a.tickets.map((t, i) => (
                                            <tr key={t.ticketId}>
                                                <td className="admin-tickets-cell-index">{i + 1}</td>
                                                <td className="admin-tickets-cell-id">
                                                    <button
                                                        type="button"
                                                        className="admin-tickets-ticket-id"
                                                        title={t.ticketId}
                                                        aria-label={isEnglish ? `Copy ticket ID ${t.ticketId}` : `复制门票 ID ${t.ticketId}`}
                                                        onClick={() => void copyTicketId(t.ticketId)}
                                                    >
                                                        {/* A HomeTown number is short, and what's printed on
                                                            the buyer's ticket, so it shows in full. */}
                                                        {a.hometown ? t.ticketId : `${t.ticketId.slice(0, 8)}…`}
                                                        {copiedTicketId === t.ticketId ? (
                                                            <span
                                                                className="admin-tickets-ticket-id-action admin-tickets-ticket-id-action--copied">
                                                                {isEnglish ? 'Copied ✓' : '已复制 ✓'}
                                                            </span>
                                                        ) : (
                                                            <span className="admin-tickets-ticket-id-action">
                                                                {isEnglish ? 'Copy' : '复制'}
                                                            </span>
                                                        )}
                                                    </button>
                                                </td>
                                                <td className="admin-tickets-cell-type">
                                                    {a.unlisted ? '—' : readOnly ? (
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
                                                <td data-label={isEnglish ? 'Status' : '状态'}>
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
                                                <td data-label={isEnglish ? 'Created' : '创建时间'}>
                                                    {t.createdAt ? (
                                                        <span className="admin-tickets-redeemed-meta">
                                                            {t.createdAt.toLocaleString(isEnglish ? 'en-US' : 'zh-CN', {
                                                                month: 'short', day: 'numeric', year: 'numeric',
                                                                hour: '2-digit', minute: '2-digit',
                                                            })}
                                                        </span>
                                                    ) : '—'}
                                                </td>
                                                <td data-label={isEnglish ? 'Redeemed by' : '验证人'}>
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
                                                <td className="admin-tickets-cell-notes"
                                                    data-label={isEnglish ? 'Notes' : '备注'}>
                                                    {readOnly ? (
                                                        t.notes ?
                                                            <span className="admin-tickets-notes">{t.notes}</span> : '—'
                                                    ) : (
                                                        <TicketNotesInput
                                                            notes={t.notes}
                                                            onSave={(notes) => onUpdateTicketNotes(a, t.ticketId, notes)}
                                                            isEnglish={isEnglish}
                                                        />
                                                    )}
                                                </td>
                                                {/* Read-only gets no actions rather than greyed-out ones. */}
                                                {!readOnly && (
                                                    <td className="admin-tickets-cell-actions">
                                                        <div className="admin-tickets-ticket-actions">
                                                            {t.voided ? (
                                                                <button
                                                                    className="admin-toggle-btn admin-toggle-save admin-tickets-ticket-btn"
                                                                    onClick={() => onUnvoidTicket(a, t.ticketId)}
                                                                >
                                                                    {isEnglish ? 'Unvoid' : '撤销作废'}
                                                                </button>
                                                            ) : (
                                                                <>
                                                                    {t.redeemed ? (
                                                                        <button
                                                                            className="admin-toggle-btn admin-toggle-edit admin-tickets-ticket-btn"
                                                                            onClick={() => onResetTicket(a, t.ticketId)}
                                                                        >
                                                                            {isEnglish ? 'Reset' : '重置'}
                                                                        </button>
                                                                    ) : (
                                                                        <button
                                                                            className="admin-toggle-btn admin-toggle-save admin-tickets-ticket-btn"
                                                                            onClick={() => onRedeemTicket(a, t.ticketId)}
                                                                        >
                                                                            {isEnglish ? 'Redeem' : '验证'}
                                                                        </button>
                                                                    )}
                                                                    <button
                                                                        className="admin-tickets-void-btn"
                                                                        onClick={() => onVoidTicket(a, t.ticketId)}
                                                                    >
                                                                        {isEnglish ? 'Void' : '作废'}
                                                                    </button>
                                                                </>
                                                            )}
                                                        </div>
                                                    </td>
                                                )}
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
                    <button className="admin-toggle-btn admin-toggle-edit" onClick={onLoadMore}>
                        {isEnglish ? 'Load More' : '加载更多'}
                    </button>
                </div>
            )}
        </div>
    );
}

/** A HomeTown ticket's number after the row's second line, as printed on the buyer's ticket. */
const HometownNumber = ({number}: {number: string}) => (
    <span className="admin-tickets-attendee-number"> · #{number}</span>
);

/** A ticket's note, saved on Enter or leaving the field; Escape puts back the saved one. */
function TicketNotesInput({notes, onSave, isEnglish}: {
    notes: string;
    onSave: (notes: string) => Promise<string | null>;
    isEnglish: boolean;
}) {
    const [draft, setDraft] = useState(notes);
    const [saving, setSaving] = useState(false);

    // Follows a refresh that changes it.
    useEffect(() => setDraft(notes), [notes]);

    const save = async () => {
        const next = draft.trim();
        if (next === notes) {
            setDraft(notes);
            return;
        }
        setSaving(true);
        const saved = await onSave(next);
        setSaving(false);
        setDraft(saved ?? notes);
    };

    return (
        <input
            type="text"
            className="admin-input admin-input--sm admin-tickets-notes-input"
            value={draft}
            maxLength={500}
            disabled={saving}
            placeholder={isEnglish ? 'Add a note' : '添加备注'}
            aria-label={isEnglish ? 'Ticket note' : '门票备注'}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => void save()}
            onKeyDown={(e) => {
                if (e.key === 'Enter') e.currentTarget.blur();
                else if (e.key === 'Escape') setDraft(notes);
            }}
        />
    );
}
