import { type ChangeEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { collection, doc, getDoc, getDocs, orderBy, query, Timestamp } from 'firebase/firestore';
import { useLanguage } from '~/components/LanguageContextProvider';
import {
    callDeleteEventAttendee,
    callGetTicketEmailQuota,
    callImportEventAttendees,
    callSendTicketEmails,
    callUpdateEventEmailTemplate,
    callVoidTicket,
    functionsErrorCode,
    getFirebaseDb,
} from '~/lib/firebase';
import type { UpcomingEvent } from '~/lib/upcomingEvents';
import { AttendeeAddModal } from './AttendeeAddModal';
import { AttendeeEditModal } from './AttendeeEditModal';
import { TicketScanner } from './TicketScanner';
import type { ShowToast } from './utils';

type TicketsSection = 'scan' | 'attendees' | 'import' | 'template' | 'send';

interface TicketData {
    ticketId: string;
    redeemed: boolean;
    redeemedAt: Date | null;
    redeemedBy: string;
    redeemedByName: string;
    checkedIn: boolean;
    checkedInAt: Date | null;
    voided: boolean;
}

export interface AttendeeData {
    id: string;
    email: string;
    name: string;
    ticketCount: number;
    emailSent: boolean;
    emailSentAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
    tickets: TicketData[];
    ticketIds: string[];
}

interface EmailTemplate {
    subject: string;
    bodyHtml: string;
    bodyCnHtml: string;
    updatedAt: Date | null;
    updatedBy: string;
}

interface ParsedRow {
    email: string;
    name: string;
    ticketCount: number;
}

interface ParseError {
    row: number;
    message: string;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const DEFAULT_TEMPLATE_SUBJECT = 'Your tickets for {{ eventTitle }}';

const DEFAULT_TEMPLATE_BODY_EN = `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;max-width:600px;margin:0 auto;color:#2a2a2a;line-height:1.6;">
  <h2 style="margin:0 0 16px;color:#ff6b9d;font-weight:600;">Hi {{ attendeeName }},</h2>

  <p>You're confirmed for <strong>{{ eventTitle }}</strong>. We can't wait to see you there!</p>

  <table style="width:100%;border-collapse:collapse;margin:20px 0;background:#fff0f6;border:1px solid #ffd9e6;border-radius:10px;">
    <tr>
      <td style="padding:12px 18px;font-size:14px;color:#777;width:90px;">Date</td>
      <td style="padding:12px 18px;font-size:14px;"><strong>{{ eventDate }}</strong></td>
    </tr>
    <tr>
      <td style="padding:12px 18px;font-size:14px;color:#777;border-top:1px solid #ffd9e6;">Tickets</td>
      <td style="padding:12px 18px;font-size:14px;border-top:1px solid #ffd9e6;"><strong>{{ ticketCount }}</strong></td>
    </tr>
  </table>

  <p>Please show the QR code(s) below at the door &mdash; one scan per ticket.</p>

  {{ ticketIds[] }}

  <p style="font-size:13px;color:#666;margin-top:28px;"><strong>A few reminders:</strong></p>
  <ul style="font-size:13px;color:#666;padding-left:20px;margin:8px 0;">
    <li>Each QR code is valid for one entry only &mdash; please don't share or post them publicly.</li>
    <li>Screenshots work fine; just keep your phone charged.</li>
    <li>Trouble at the door? Just reply to this email and we'll sort it out.</li>
  </ul>

  <p style="margin-top:28px;">See you soon,<br/><strong>The Sekai Beyond team</strong></p>
</div>`;

const tsToDate = (t: unknown): Date | null => {
    if (!t) return null;
    if (t instanceof Timestamp) return t.toDate();
    if (t instanceof Date) return t;
    return null;
};

const mapAttendeeDoc = (
    id: string,
    data: Record<string, unknown>,
): AttendeeData => {
    const rawTickets = Array.isArray(data.tickets) ? data.tickets : [];
    const tickets: TicketData[] = rawTickets.map((t) => {
        const tk = t as Record<string, unknown>;
        return {
            ticketId: (tk.ticketId as string) ?? '',
            redeemed: (tk.redeemed as boolean) ?? false,
            redeemedAt: tsToDate(tk.redeemedAt),
            redeemedBy: (tk.redeemedBy as string) ?? '',
            redeemedByName: (tk.redeemedByName as string) ?? '',
            checkedIn: (tk.checkedIn as boolean) ?? false,
            checkedInAt: tsToDate(tk.checkedInAt),
            voided: (tk.voided as boolean) ?? false,
        };
    });
    return {
        id,
        email: (data.email as string) ?? '',
        name: (data.name as string) ?? '',
        ticketCount: (data.ticketCount as number) ?? 0,
        emailSent: (data.emailSent as boolean) ?? false,
        emailSentAt: tsToDate(data.emailSentAt),
        createdAt: tsToDate(data.createdAt) ?? new Date(),
        updatedAt: tsToDate(data.updatedAt) ?? new Date(),
        tickets,
        ticketIds: Array.isArray(data.ticketIds) ? (data.ticketIds as string[]) : [],
    };
};

const ticketStatusCounts = (a: AttendeeData) => {
    let used = 0;
    let voided = 0;
    for (const t of a.tickets) {
        if (t.voided) voided++;
        else if (t.redeemed) used++;
    }
    return {used, voided, remaining: a.ticketCount - used - voided};
};

const renderSamplePreview = (template: EmailTemplate, event: UpcomingEvent): string => {
    const sampleData = {
        attendeeEmail: 'sample@example.com',
        attendeeName: 'Sample Attendee',
        eventTitle: event.title,
        eventTitleCn: event.titleCn,
        eventDate: event.startAt.toLocaleString('en-US', {
            year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit',
        }),
        ticketCount: 2,
    };
    const ticketBlock = `<div style="padding:16px;border:1px dashed #aaa;text-align:center;margin:12px 0;">` +
        `<strong>[QR for each ticket rendered here at send time]</strong><br/>` +
        `<code>ticket-uuid-1</code><br/><code>ticket-uuid-2</code></div>`;
    const render = (tpl: string) => tpl
        .replace(/{{\s*attendeeEmail\s*}}/g, sampleData.attendeeEmail)
        .replace(/{{\s*attendeeName\s*}}/g, sampleData.attendeeName)
        .replace(/{{\s*eventTitle\s*}}/g, sampleData.eventTitle)
        .replace(/{{\s*eventTitleCn\s*}}/g, sampleData.eventTitleCn)
        .replace(/{{\s*eventDate\s*}}/g, sampleData.eventDate)
        .replace(/{{\s*ticketCount\s*}}/g, String(sampleData.ticketCount))
        .replace(/(<p>\s*|<div>\s*)?{{\s*ticketIds\[\]\s*}}(\s*<\/p>|\s*<\/div>)?/g, ticketBlock);
    const en = render(template.bodyHtml);
    const cn = render(template.bodyCnHtml);
    const hr = `<hr style="border:none;border-top:1px solid #ddd;margin:24px 0;"/>`;
    return cn ? `${en}${hr}${cn}` : en;
};

interface TicketsSubtabProps {
    event: UpcomingEvent;
    readOnly: boolean;
    canScan: boolean;
    showToast: ShowToast;
}

export function TicketsSubtab({event, readOnly, canScan, showToast}: TicketsSubtabProps) {
    const {isEnglish} = useLanguage();
    const eventId = event.id;

    const [section, setSection] = useState<TicketsSection>(canScan && readOnly ? 'scan' : 'attendees');
    const [attendees, setAttendees] = useState<AttendeeData[]>([]);
    const [loadingAttendees, setLoadingAttendees] = useState(false);
    const [attendeesError, setAttendeesError] = useState<string | null>(null);
    const [search, setSearch] = useState('');
    const [filterUnsent, setFilterUnsent] = useState(false);

    const [editingAttendee, setEditingAttendee] = useState<AttendeeData | null>(null);
    const [addingAttendee, setAddingAttendee] = useState(false);

    const loadAttendees = useCallback(async () => {
        setLoadingAttendees(true);
        setAttendeesError(null);
        try {
            const db = getFirebaseDb();
            const col = collection(db, 'upcomingEvents', eventId, 'attendees');
            const snap = await getDocs(query(col, orderBy('createdAt', 'asc')));
            const list = snap.docs.map(d => mapAttendeeDoc(d.id, d.data()));
            setAttendees(list);
        } catch (err) {
            console.error('[TicketsSubtab] loadAttendees', err);
            setAttendeesError(isEnglish ? 'Failed to load attendees.' : '加载参加者失败。');
        } finally {
            setLoadingAttendees(false);
        }
    }, [eventId, isEnglish]);

    useEffect(() => {
        void loadAttendees();
    }, [loadAttendees]);

    const filteredAttendees = useMemo(() => {
        const needle = search.trim().toLowerCase();
        return attendees.filter(a => {
            if (filterUnsent && a.emailSent) return false;
            if (!needle) return true;
            return a.email.toLowerCase().includes(needle)
                || a.name.toLowerCase().includes(needle);
        });
    }, [attendees, search, filterUnsent]);

    const totals = useMemo(() => {
        let tickets = 0;
        let used = 0;
        let voided = 0;
        let unsent = 0;
        for (const a of attendees) {
            tickets += a.ticketCount;
            for (const t of a.tickets) {
                if (t.voided) voided++;
                else if (t.redeemed) used++;
            }
            if (!a.emailSent) unsent++;
        }
        return {attendees: attendees.length, tickets, used, voided, unsent};
    }, [attendees]);

    const onAttendeeUpdated = (updated: AttendeeData) => {
        setAttendees(prev => prev.map(a => a.id === updated.id ? updated : a));
    };

    const onAttendeeDeleted = (attendeeId: string) => {
        setAttendees(prev => prev.filter(a => a.id !== attendeeId));
    };

    const voidTicketAction = async (a: AttendeeData, ticketId: string) => {
        if (readOnly) return;
        const ok = window.confirm(isEnglish
            ? 'Void this ticket? The QR will stop working immediately.'
            : '作废此门票？二维码将立即失效。');
        if (!ok) return;
        try {
            await callVoidTicket({eventId, attendeeId: a.id, ticketId});
            const updatedTickets = a.tickets.map(t =>
                t.ticketId === ticketId ? {...t, voided: true} : t,
            );
            onAttendeeUpdated({...a, tickets: updatedTickets});
            showToast(isEnglish ? 'Ticket voided.' : '门票已作废。', 'warning');
        } catch {
            showToast(isEnglish ? 'Failed to void ticket.' : '作废门票失败。', 'error');
        }
    };

    const deleteAttendeeAction = async (a: AttendeeData) => {
        if (readOnly) return;
        const ok = window.confirm(isEnglish
            ? `Remove ${a.name} (${a.email}) and void all ${a.ticketCount} ticket(s)?`
            : `移除 ${a.name}（${a.email}）并作废全部 ${a.ticketCount} 张门票？`);
        if (!ok) return;
        try {
            await callDeleteEventAttendee({eventId, attendeeId: a.id});
            onAttendeeDeleted(a.id);
            showToast(isEnglish ? 'Attendee removed.' : '参加者已移除。', 'warning');
        } catch {
            showToast(isEnglish ? 'Failed to remove attendee.' : '移除失败。', 'error');
        }
    };

    const resendToAttendee = async (a: AttendeeData) => {
        if (readOnly) return;
        try {
            const result = await callSendTicketEmails({
                eventId, mode: 'all', attendeeIds: [a.id],
            });
            const sent = result.data.sentCount;
            if (sent > 0) {
                onAttendeeUpdated({...a, emailSent: true, emailSentAt: new Date()});
            }
            showToast(
                sent > 0
                    ? (isEnglish ? 'Email queued.' : '邮件已排队发送。')
                    : (isEnglish ? 'No email queued.' : '未发送邮件。'),
                sent > 0 ? 'success' : 'warning',
            );
        } catch (err) {
            const code = functionsErrorCode(err);
            if (code === 'no-template') {
                showToast(
                    isEnglish
                        ? 'Save the email template before sending.'
                        : '请先保存邮件模板再发送。',
                    'warning',
                );
            } else {
                showToast(isEnglish ? 'Failed to send email.' : '发送邮件失败。', 'error');
            }
        }
    };

    const tabVisible = (t: TicketsSection) => {
        if (t === 'scan') return canScan;
        return true;
    };

    return (
        <div className="admin-tickets-section">
            <div className="admin-tickets-inner-tabs">
                {canScan && (
                    <button
                        className={`admin-sub-tab ${section === 'scan' ? 'admin-sub-tab-active' : ''}`}
                        onClick={() => setSection('scan')}
                    >
                        {isEnglish ? 'Scan' : '扫码'}
                    </button>
                )}
                <button
                    className={`admin-sub-tab ${section === 'attendees' ? 'admin-sub-tab-active' : ''}`}
                    onClick={() => setSection('attendees')}
                >
                    {isEnglish ? 'Attendees' : '参加者'}
                    {attendees.length > 0 && (
                        <span className="admin-sub-tab-count">{attendees.length}</span>
                    )}
                </button>
                {tabVisible('import') && (
                    <button
                        className={`admin-sub-tab ${section === 'import' ? 'admin-sub-tab-active' : ''}`}
                        onClick={() => setSection('import')}
                    >
                        {isEnglish ? 'Import' : '导入'}
                    </button>
                )}
                {tabVisible('template') && (
                    <button
                        className={`admin-sub-tab ${section === 'template' ? 'admin-sub-tab-active' : ''}`}
                        onClick={() => setSection('template')}
                    >
                        {isEnglish ? 'Email Template' : '邮件模板'}
                    </button>
                )}
                {tabVisible('send') && (
                    <button
                        className={`admin-sub-tab ${section === 'send' ? 'admin-sub-tab-active' : ''}`}
                        onClick={() => setSection('send')}
                    >
                        {isEnglish ? 'Send Emails' : '发送邮件'}
                    </button>
                )}
            </div>

            {section === 'scan' && canScan && (
                <TicketScanner
                    eventId={eventId}
                    eventTitle={isEnglish ? event.title : event.titleCn}
                    onRedeemed={() => void loadAttendees()}
                />
            )}

            {section === 'attendees' && (
                <AttendeesSection
                    loading={loadingAttendees}
                    error={attendeesError}
                    totals={totals}
                    attendees={filteredAttendees}
                    search={search}
                    onSearchChange={setSearch}
                    filterUnsent={filterUnsent}
                    onFilterUnsentChange={setFilterUnsent}
                    readOnly={readOnly}
                    onEdit={setEditingAttendee}
                    onAdd={() => setAddingAttendee(true)}
                    onVoidTicket={voidTicketAction}
                    onResend={resendToAttendee}
                    onDelete={deleteAttendeeAction}
                    onRefresh={() => void loadAttendees()}
                />
            )}

            {section === 'import' && (
                <ImportSection
                    eventId={eventId}
                    readOnly={readOnly}
                    showToast={showToast}
                    onImported={() => void loadAttendees()}
                />
            )}

            {section === 'template' && (
                <TemplateSection
                    event={event}
                    readOnly={readOnly}
                    showToast={showToast}
                />
            )}

            {section === 'send' && (
                <SendSection
                    eventId={eventId}
                    totals={totals}
                    readOnly={readOnly}
                    showToast={showToast}
                    onSent={() => void loadAttendees()}
                    onOpenTemplate={() => setSection('template')}
                />
            )}

            {editingAttendee && (
                <AttendeeEditModal
                    eventId={eventId}
                    attendee={editingAttendee}
                    onClose={() => setEditingAttendee(null)}
                    onSaved={(updated) => {
                        onAttendeeUpdated(updated);
                        setEditingAttendee(null);
                    }}
                    showToast={showToast}
                />
            )}

            {addingAttendee && (
                <AttendeeAddModal
                    eventId={eventId}
                    existingAttendees={attendees}
                    onClose={() => setAddingAttendee(false)}
                    onAdded={() => void loadAttendees()}
                    showToast={showToast}
                />
            )}
        </div>
    );
}

// ------------------------ Attendees section ------------------------

interface AttendeesSectionProps {
    loading: boolean;
    error: string | null;
    totals: {attendees: number; tickets: number; used: number; voided: number; unsent: number};
    attendees: AttendeeData[];
    search: string;
    onSearchChange: (v: string) => void;
    filterUnsent: boolean;
    onFilterUnsentChange: (v: boolean) => void;
    readOnly: boolean;
    onEdit: (a: AttendeeData) => void;
    onAdd: () => void;
    onVoidTicket: (a: AttendeeData, ticketId: string) => void;
    onResend: (a: AttendeeData) => void;
    onDelete: (a: AttendeeData) => void;
    onRefresh: () => void;
}

function AttendeesSection({
                              loading, error, totals, attendees,
                              search, onSearchChange, filterUnsent, onFilterUnsentChange,
                              readOnly, onEdit, onAdd, onVoidTicket, onResend, onDelete, onRefresh,
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
                    <strong>{totals.attendees}</strong> {isEnglish ? 'attendees' : '参加者'}
                </span>
                <span>
                    <strong>{totals.tickets}</strong> {isEnglish ? 'tickets' : '门票'}
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
                    className="admin-toggle-btn admin-toggle-edit admin-tickets-refresh"
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
                    className="admin-search-input"
                    placeholder={isEnglish ? 'Search name or email...' : '搜索姓名或邮箱...'}
                    value={search}
                    onChange={(e) => onSearchChange(e.target.value)}
                />
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
                <div className="profile-spinner admin-spinner-center"/>
            )}

            {!loading && attendees.length === 0 && !error && (
                <p className="admin-no-results">
                    {isEnglish ? 'No attendees match.' : '暂无符合条件的参加者。'}
                </p>
            )}

            {attendees.map((a) => {
                const {used, voided, remaining} = ticketStatusCounts(a);
                const isExpanded = expanded.has(a.id);
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
                                    a.emailSent
                                        ? 'admin-tickets-tag admin-tickets-tag-sent'
                                        : 'admin-tickets-tag admin-tickets-tag-unsent'
                                }>
                                    {a.emailSent
                                        ? (isEnglish ? 'Sent' : '已发送')
                                        : (isEnglish ? 'Unsent' : '未发送')}
                                </span>
                            </div>
                            <div className="admin-tickets-attendee-expand">
                                {isExpanded ? '▾' : '▸'}
                            </div>
                        </div>

                        {isExpanded && (
                            <div className="admin-tickets-attendee-detail">
                                <div className="admin-tickets-attendee-actions">
                                    <button
                                        className="admin-toggle-btn admin-toggle-edit"
                                        onClick={() => onEdit(a)}
                                        disabled={readOnly}
                                    >
                                        {isEnglish ? 'Edit' : '编辑'}
                                    </button>
                                    <button
                                        className="admin-toggle-btn admin-toggle-save"
                                        onClick={() => onResend(a)}
                                        disabled={readOnly}
                                    >
                                        {isEnglish ? 'Resend Email' : '重发邮件'}
                                    </button>
                                    <button
                                        className="admin-toggle-btn admin-toggle-revoke"
                                        onClick={() => onDelete(a)}
                                        disabled={readOnly}
                                    >
                                        {isEnglish ? 'Remove' : '移除'}
                                    </button>
                                </div>
                                <table className="admin-tickets-table">
                                    <thead>
                                    <tr>
                                        <th>#</th>
                                        <th>{isEnglish ? 'Ticket ID' : '门票 ID'}</th>
                                        <th>{isEnglish ? 'Status' : '状态'}</th>
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
                                                {!t.voided && (
                                                    <button
                                                        className="admin-tickets-void-btn"
                                                        onClick={() => onVoidTicket(a, t.ticketId)}
                                                        disabled={readOnly}
                                                    >
                                                        {isEnglish ? 'Void' : '作废'}
                                                    </button>
                                                )}
                                            </td>
                                        </tr>
                                    ))}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>
                );
            })}
        </div>
    );
}

// ------------------------ Import section ------------------------

interface ImportSectionProps {
    eventId: string;
    readOnly: boolean;
    showToast: ShowToast;
    onImported: () => void;
}

const MAX_PREVIEW = 50;
const MAX_IMPORT_ROWS = 1000;

function ImportSection({eventId, readOnly, showToast, onImported}: ImportSectionProps) {
    const {isEnglish} = useLanguage();
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [rows, setRows] = useState<ParsedRow[]>([]);
    const [errors, setErrors] = useState<ParseError[]>([]);
    const [fileName, setFileName] = useState<string>('');
    const [importing, setImporting] = useState(false);
    const [busy, setBusy] = useState(false);

    const validateRows = (fields: string[], records: Record<string, string>[]) => {
        const parsedRows: ParsedRow[] = [];
        const errs: ParseError[] = [];
        const seen = new Map<string, number>();

        const fieldName = (keys: string[], ...candidates: string[]) => {
            const lower = keys.map(k => k.toLowerCase().trim());
            for (const c of candidates) {
                const idx = lower.indexOf(c);
                if (idx >= 0) return keys[idx];
            }
            return null;
        };

        const emailKey = fieldName(fields, 'email', 'e-mail');
        const nameKey = fieldName(fields, 'name', 'full name', 'display name');
        const countKey = fieldName(fields, 'ticketcount', 'ticket count',
            'ticket_count', 'tickets', 'quantity', 'count');

        if (!emailKey || !nameKey || !countKey) {
            return {
                rows: [],
                errors: [{
                    row: 0,
                    message: isEnglish
                        ? 'File must have columns: email, name, ticketCount (or "tickets").'
                        : '文件需要包含列：email、name、ticketCount（或"tickets"）。',
                }],
            };
        }

        records.forEach((row, i) => {
            const rowNum = i + 2;
            const email = (row[emailKey] ?? '').trim().toLowerCase();
            const name = (row[nameKey] ?? '').trim();
            const countRaw = (row[countKey] ?? '').trim();

            if (!email && !name && !countRaw) return;

            if (!EMAIL_RE.test(email)) {
                errs.push({
                    row: rowNum,
                    message: isEnglish ? `Invalid email: "${email}"` : `邮箱无效："${email}"`,
                });
                return;
            }
            if (!name) {
                errs.push({
                    row: rowNum,
                    message: isEnglish ? 'Name is empty.' : '姓名为空。',
                });
                return;
            }
            if (name.length > 100) {
                errs.push({
                    row: rowNum,
                    message: isEnglish ? 'Name exceeds 100 characters.' : '姓名超过 100 字符。',
                });
                return;
            }
            const count = parseInt(countRaw, 10);
            if (!Number.isInteger(count) || count < 1 || count > 50) {
                errs.push({
                    row: rowNum,
                    message: isEnglish
                        ? `ticketCount must be 1–50 (got "${countRaw}").`
                        : `门票数量需为 1–50（当前为"${countRaw}"）。`,
                });
                return;
            }
            if (seen.has(email)) {
                errs.push({
                    row: rowNum,
                    message: isEnglish
                        ? `Duplicate email "${email}" — later row will win.`
                        : `邮箱"${email}"重复，将以后一行为准。`,
                });
            }
            seen.set(email, parsedRows.length);
            parsedRows.push({email, name, ticketCount: count});
        });

        const deduped = new Map<string, ParsedRow>();
        for (const r of parsedRows) deduped.set(r.email, r);
        const finalRows = Array.from(deduped.values());

        if (finalRows.length > MAX_IMPORT_ROWS) {
            errs.push({
                row: 0,
                message: isEnglish
                    ? `Too many rows (${finalRows.length}). Max ${MAX_IMPORT_ROWS}.`
                    : `行数过多（${finalRows.length}）。最多 ${MAX_IMPORT_ROWS}。`,
            });
        }

        return {rows: finalRows, errors: errs};
    };

    const parseExcel = async (file: File) => {
        const ExcelJS = (await import('exceljs')).default;
        const buffer = await file.arrayBuffer();
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.load(buffer);
        const sheet = workbook.worksheets[0];
        if (!sheet) {
            return {
                fields: [] as string[],
                records: [] as Record<string, string>[],
            };
        }
        const headerRow = sheet.getRow(1);
        const fields: string[] = [];
        headerRow.eachCell({includeEmpty: false}, (cell) => {
            fields.push(String(cell.value ?? '').trim());
        });
        const records: Record<string, string>[] = [];
        sheet.eachRow({includeEmpty: false}, (row, rowIdx) => {
            if (rowIdx === 1) return;
            const rec: Record<string, string> = {};
            fields.forEach((field, i) => {
                const cell = row.getCell(i + 1);
                const v = cell.value;
                let str = '';
                if (v == null) str = '';
                else if (typeof v === 'object' && 'text' in v && typeof (v as {text: unknown}).text === 'string') {
                    str = (v as {text: string}).text;
                } else if (typeof v === 'object' && 'result' in v) {
                    str = String((v as {result: unknown}).result ?? '');
                } else if (v instanceof Date) {
                    str = v.toISOString();
                } else {
                    str = String(v);
                }
                rec[field] = str;
            });
            records.push(rec);
        });
        return {fields, records};
    };

    const handleFile = async (e: ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        setBusy(true);
        setFileName(file.name);
        setRows([]);
        setErrors([]);
        try {
            const ext = file.name.toLowerCase().split('.').pop() ?? '';
            const isExcel = ext === 'xlsx' || ext === 'xls' ||
                file.type === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
                file.type === 'application/vnd.ms-excel';

            if (isExcel) {
                try {
                    const {fields, records} = await parseExcel(file);
                    const {rows: finalRows, errors: errs} = validateRows(fields, records);
                    setRows(finalRows);
                    setErrors(errs);
                } catch (err) {
                    console.error('[import] excel parse error', err);
                    setErrors([{
                        row: 0,
                        message: isEnglish ? 'Failed to parse Excel file.' : '解析 Excel 文件失败。',
                    }]);
                }
            } else {
                const Papa = (await import('papaparse')).default;
                await new Promise<void>((resolve) => {
                    Papa.parse<Record<string, string>>(file, {
                        header: true,
                        skipEmptyLines: 'greedy',
                        complete: (res) => {
                            const fields = res.meta.fields ?? [];
                            const {rows: finalRows, errors: errs} = validateRows(fields, res.data);
                            setRows(finalRows);
                            setErrors(errs);
                            resolve();
                        },
                        error: (err: Error) => {
                            setErrors([{row: 0, message: err.message}]);
                            resolve();
                        },
                    });
                });
            }
        } catch (err) {
            console.error('[import] parse error', err);
            setErrors([{
                row: 0,
                message: isEnglish ? 'Failed to parse file.' : '解析文件失败。',
            }]);
        } finally {
            setBusy(false);
        }
    };

    const confirmImport = async () => {
        if (readOnly) return;
        if (rows.length === 0) return;
        const ok = window.confirm(isEnglish
            ? `Import ${rows.length} attendees? Existing emails will have their tickets re-issued.`
            : `导入 ${rows.length} 位参加者？已存在的邮箱将重新签发门票。`);
        if (!ok) return;
        setImporting(true);
        try {
            const result = await callImportEventAttendees({eventId, attendees: rows});
            const {added, replaced, total} = result.data;
            showToast(
                isEnglish
                    ? `Imported ${total}: ${added} new, ${replaced} replaced.`
                    : `已导入 ${total} 位：新增 ${added}，替换 ${replaced}。`,
                'success',
            );
            setRows([]);
            setErrors([]);
            setFileName('');
            if (fileInputRef.current) fileInputRef.current.value = '';
            onImported();
        } catch (err) {
            const code = functionsErrorCode(err);
            showToast(
                isEnglish
                    ? `Import failed${code ? ` (${code})` : ''}.`
                    : `导入失败${code ? `（${code}）` : ''}。`,
                'error',
            );
        } finally {
            setImporting(false);
        }
    };

    const canImport = !readOnly && !importing && rows.length > 0 && errors.filter(e => e.row === 0).length === 0;

    return (
        <div className="admin-tickets-import">
            <p className="admin-helper-text">
                {isEnglish
                    ? 'Upload a CSV or Excel file with columns: email, name, ticketCount (or "tickets"). Re-importing an existing email re-issues their tickets.'
                    : '上传 CSV 或 Excel 文件，需包含列：email、name、ticketCount（或"tickets"）。重复导入相同邮箱会重新签发该人的门票。'}
            </p>
            <div className="admin-tickets-import-file-row">
                <input
                    ref={fileInputRef}
                    type="file"
                    accept=".csv,text/csv,.xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
                    onChange={handleFile}
                    disabled={readOnly || busy}
                />
                {fileName && <span className="admin-tickets-import-filename">{fileName}</span>}
            </div>

            {errors.length > 0 && (
                <div className="admin-tickets-import-errors">
                    <strong>{isEnglish ? 'Issues' : '问题'}</strong>
                    <ul>
                        {errors.slice(0, 20).map((e, i) => (
                            <li key={i}>
                                {e.row > 0 && (
                                    <span className="admin-tickets-import-rownum">
                                        {isEnglish ? `Row ${e.row}:` : `第 ${e.row} 行：`}
                                    </span>
                                )}{' '}
                                {e.message}
                            </li>
                        ))}
                        {errors.length > 20 && (
                            <li>
                                {isEnglish
                                    ? `…and ${errors.length - 20} more.`
                                    : `…还有 ${errors.length - 20} 条。`}
                            </li>
                        )}
                    </ul>
                </div>
            )}

            {rows.length > 0 && (
                <>
                    <div className="admin-tickets-import-preview">
                        <div className="admin-tickets-import-preview-header">
                            <strong>
                                {isEnglish
                                    ? `Preview (${rows.length} row${rows.length === 1 ? '' : 's'})`
                                    : `预览（${rows.length} 行）`}
                            </strong>
                            {rows.length > MAX_PREVIEW && (
                                <span className="admin-helper-text">
                                    {isEnglish
                                        ? `Showing first ${MAX_PREVIEW}.`
                                        : `仅显示前 ${MAX_PREVIEW} 行。`}
                                </span>
                            )}
                        </div>
                        <table className="admin-tickets-table">
                            <thead>
                            <tr>
                                <th>#</th>
                                <th>{isEnglish ? 'Email' : '邮箱'}</th>
                                <th>{isEnglish ? 'Name' : '姓名'}</th>
                                <th>{isEnglish ? 'Tickets' : '门票数'}</th>
                            </tr>
                            </thead>
                            <tbody>
                            {rows.slice(0, MAX_PREVIEW).map((r, i) => (
                                <tr key={`${r.email}-${i}`}>
                                    <td>{i + 1}</td>
                                    <td>{r.email}</td>
                                    <td>{r.name}</td>
                                    <td>{r.ticketCount}</td>
                                </tr>
                            ))}
                            </tbody>
                        </table>
                    </div>
                    <div className="admin-btn-row">
                        <button
                            className="admin-toggle-btn admin-toggle-save"
                            onClick={confirmImport}
                            disabled={!canImport}
                        >
                            {importing
                                ? (isEnglish ? 'Importing...' : '导入中...')
                                : (isEnglish ? 'Confirm Import' : '确认导入')}
                        </button>
                        <button
                            className="admin-toggle-btn admin-toggle-cancel"
                            onClick={() => {
                                setRows([]);
                                setErrors([]);
                                setFileName('');
                                if (fileInputRef.current) fileInputRef.current.value = '';
                            }}
                            disabled={importing}
                        >
                            {isEnglish ? 'Clear' : '清空'}
                        </button>
                    </div>
                </>
            )}
        </div>
    );
}

// ------------------------ Template section ------------------------

interface TemplateSectionProps {
    event: UpcomingEvent;
    readOnly: boolean;
    showToast: ShowToast;
}

function TemplateSection({event, readOnly, showToast}: TemplateSectionProps) {
    const {isEnglish} = useLanguage();
    const [template, setTemplate] = useState<EmailTemplate>({
        subject: '', bodyHtml: '', bodyCnHtml: '', updatedAt: null, updatedBy: '',
    });
    const [initialTemplate, setInitialTemplate] = useState<EmailTemplate>({
        subject: '', bodyHtml: '', bodyCnHtml: '', updatedAt: null, updatedBy: '',
    });
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [showPreview, setShowPreview] = useState(false);

    useEffect(() => {
        let cancelled = false;
        const load = async () => {
            setLoading(true);
            try {
                const db = getFirebaseDb();
                const snap = await getDoc(
                    doc(db, 'upcomingEvents', event.id, 'emailTemplate', 'default'),
                );
                if (cancelled) return;
                if (snap.exists()) {
                    const data = snap.data();
                    // bodyCnHtml is intentionally dropped from the editor — the
                    // template UI is English-only. Any legacy CN content is
                    // cleared on the next save (see save() below).
                    const t: EmailTemplate = {
                        subject: (data.subject as string) ?? '',
                        bodyHtml: (data.bodyHtml as string) ?? '',
                        bodyCnHtml: '',
                        updatedAt: tsToDate(data.updatedAt),
                        updatedBy: (data.updatedBy as string) ?? '',
                    };
                    setTemplate(t);
                    setInitialTemplate(t);
                } else {
                    // No saved template yet: pre-fill the editor with defaults so
                    // the admin can save-as-is or tweak. initialTemplate stays
                    // empty so isDirty=true and Save is enabled.
                    setTemplate({
                        subject: DEFAULT_TEMPLATE_SUBJECT,
                        bodyHtml: DEFAULT_TEMPLATE_BODY_EN,
                        bodyCnHtml: '',
                        updatedAt: null,
                        updatedBy: '',
                    });
                    setInitialTemplate({
                        subject: '', bodyHtml: '', bodyCnHtml: '', updatedAt: null, updatedBy: '',
                    });
                }
            } catch (err) {
                console.error('[template] load', err);
                showToast(
                    isEnglish ? 'Failed to load template.' : '加载模板失败。',
                    'error',
                );
            } finally {
                if (!cancelled) setLoading(false);
            }
        };
        void load();
        return () => {
            cancelled = true;
        };
    }, [event.id, isEnglish, showToast]);

    const isDirty = template.subject !== initialTemplate.subject
        || template.bodyHtml !== initialTemplate.bodyHtml;

    const isAtDefault = template.subject === DEFAULT_TEMPLATE_SUBJECT
        && template.bodyHtml === DEFAULT_TEMPLATE_BODY_EN;

    const resetToDefault = () => {
        if (readOnly) return;
        if (isAtDefault) return;
        const ok = window.confirm(isEnglish
            ? 'Reset the template fields to the default content? Unsaved changes will be lost. (You still need to click Save to persist.)'
            : '将模板内容恢复为默认值？未保存的修改将丢失。（仍需点击保存才会生效。）');
        if (!ok) return;
        setTemplate(t => ({
            ...t,
            subject: DEFAULT_TEMPLATE_SUBJECT,
            bodyHtml: DEFAULT_TEMPLATE_BODY_EN,
        }));
    };

    const save = async () => {
        if (readOnly || !isDirty) return;
        if (!template.subject.trim()) {
            showToast(isEnglish ? 'Subject is required.' : '邮件主题必填。', 'error');
            return;
        }
        setSaving(true);
        try {
            await callUpdateEventEmailTemplate({
                eventId: event.id,
                subject: template.subject,
                bodyHtml: template.bodyHtml,
                bodyCnHtml: '',
            });
            setInitialTemplate({...template, updatedAt: new Date()});
            showToast(isEnglish ? 'Template saved.' : '模板已保存。', 'success');
        } catch {
            showToast(isEnglish ? 'Failed to save template.' : '保存模板失败。', 'error');
        } finally {
            setSaving(false);
        }
    };

    if (loading) {
        return <div className="profile-spinner admin-spinner-center"/>;
    }

    return (
        <div className="admin-tickets-template">
            <p className="admin-helper-text">
                {isEnglish
                    ? 'Supported placeholders: {{ attendeeName }}, {{ attendeeEmail }}, {{ eventTitle }}, {{ eventDate }}, {{ ticketCount }}, {{ ticketIds[] }} (renders one QR per ticket).'
                    : '可用占位符：{{ attendeeName }}、{{ attendeeEmail }}、{{ eventTitle }}、{{ eventDate }}、{{ ticketCount }}、{{ ticketIds[] }}（为每张门票渲染一个二维码）。'}
            </p>

            <label className="admin-tickets-template-field">
                <span>{isEnglish ? 'Subject' : '邮件主题'}</span>
                <input
                    type="text"
                    className="admin-search-input"
                    value={template.subject}
                    onChange={(e) => setTemplate(t => ({...t, subject: e.target.value}))}
                    maxLength={500}
                    readOnly={readOnly}
                />
            </label>

            <label className="admin-tickets-template-field">
                <span>{isEnglish ? 'Body (HTML)' : '正文（HTML）'}</span>
                <textarea
                    className="admin-tickets-template-textarea"
                    value={template.bodyHtml}
                    onChange={(e) => setTemplate(t => ({...t, bodyHtml: e.target.value}))}
                    maxLength={20000}
                    readOnly={readOnly}
                    rows={10}
                />
            </label>

            <div className="admin-btn-row">
                <button
                    className="admin-toggle-btn admin-toggle-save"
                    onClick={save}
                    disabled={readOnly || saving || !isDirty}
                >
                    {saving
                        ? (isEnglish ? 'Saving...' : '保存中...')
                        : (isEnglish ? 'Save Template' : '保存模板')}
                </button>
                <button
                    className="admin-toggle-btn admin-toggle-edit"
                    onClick={() => setShowPreview(true)}
                >
                    {isEnglish ? 'Preview' : '预览'}
                </button>
                <button
                    className="admin-toggle-btn admin-toggle-cancel"
                    onClick={resetToDefault}
                    disabled={readOnly || saving || isAtDefault}
                    title={isEnglish ? 'Restore the default template content' : '恢复默认模板内容'}
                >
                    {isEnglish ? 'Reset to Default' : '恢复默认'}
                </button>
            </div>

            {initialTemplate.updatedAt && (
                <p className="admin-helper-text">
                    {isEnglish ? 'Last saved: ' : '上次保存：'}
                    {initialTemplate.updatedAt.toLocaleString(isEnglish ? 'en-US' : 'zh-CN', {
                        year: 'numeric', month: 'short', day: 'numeric',
                        hour: '2-digit', minute: '2-digit',
                    })}
                </p>
            )}

            {showPreview && (
                <div className="admin-tickets-preview-modal" onClick={() => setShowPreview(false)}>
                    <div
                        className="admin-tickets-preview-content"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="admin-tickets-preview-header">
                            <strong>{isEnglish ? 'Preview' : '预览'}</strong>
                            <button
                                className="admin-tickets-preview-close"
                                onClick={() => setShowPreview(false)}
                            >
                                ×
                            </button>
                        </div>
                        <div className="admin-tickets-preview-subject">
                            <strong>{isEnglish ? 'Subject: ' : '主题：'}</strong>
                            {template.subject.replace(/{{\s*eventTitle\s*}}/g, event.title)
                                .replace(/{{\s*eventTitleCn\s*}}/g, event.titleCn)
                                .replace(/{{\s*attendeeName\s*}}/g, 'Sample Attendee')}
                        </div>
                        <div
                            className="admin-tickets-preview-body"
                            dangerouslySetInnerHTML={{__html: renderSamplePreview(template, event)}}
                        />
                    </div>
                </div>
            )}
        </div>
    );
}

// ------------------------ Send section ------------------------

// Server-side per-invocation cap. Must match SEND_CHUNK_SIZE in functions/src/index.ts.
const SEND_CHUNK_SIZE = 100;

interface SendSectionProps {
    eventId: string;
    totals: {attendees: number; tickets: number; used: number; voided: number; unsent: number};
    readOnly: boolean;
    showToast: ShowToast;
    onSent: () => void;
    onOpenTemplate: () => void;
}

interface SendProgress {
    mode: 'unsent' | 'all';
    sent: number;
    target: number;
}

function SendSection({
                         eventId, totals, readOnly, showToast, onSent, onOpenTemplate,
                     }: SendSectionProps) {
    const {isEnglish} = useLanguage();
    const [sending, setSending] = useState(false);
    const [progress, setProgress] = useState<SendProgress | null>(null);
    const [noTemplate, setNoTemplate] = useState(false);
    const [quota, setQuota] = useState<{sentToday: number; dailyCap: number} | null>(null);
    const [quotaError, setQuotaError] = useState(false);
    const cancelRef = useRef(false);

    const loadQuota = useCallback(async () => {
        try {
            const res = await callGetTicketEmailQuota();
            setQuota(res.data);
            setQuotaError(false);
        } catch (err) {
            console.error('[SendSection] quota load', err);
            setQuotaError(true);
        }
    }, []);

    useEffect(() => {
        void loadQuota();
    }, [loadQuota]);

    const remainingToday = quota
        ? Math.max(0, quota.dailyCap - quota.sentToday)
        : null;
    const quotaNearCap = remainingToday !== null && remainingToday <= 10;
    const quotaAtCap = remainingToday === 0;

    const send = async (mode: 'unsent' | 'all') => {
        if (readOnly || sending) return;
        const target = mode === 'unsent' ? totals.unsent : totals.attendees;
        if (target === 0) {
            showToast(isEnglish ? 'No recipients.' : '没有收件人。', 'warning');
            return;
        }
        if (quotaAtCap) {
            showToast(
                isEnglish
                    ? 'Daily Resend cap reached. Try again after midnight (America/Los_Angeles).'
                    : '已达到每日 Resend 发送上限，请在太平洋时区午夜后重试。',
                'warning',
            );
            return;
        }
        const willExceed = remainingToday !== null && target > remainingToday;
        const ok = window.confirm([
            mode === 'unsent'
                ? (isEnglish
                    ? `Send ticket emails to ${target} attendee(s) who haven't been sent yet?`
                    : `向 ${target} 位尚未收到邮件的参加者发送门票邮件？`)
                : (isEnglish
                    ? `Resend ticket emails to ALL ${target} attendee(s)? (Already-sent will receive a duplicate.)`
                    : `向全部 ${target} 位参加者重新发送门票邮件？（已发送的会收到重复邮件。）`),
            willExceed
                ? (isEnglish
                    ? `\n\nWarning: ${target} > ${remainingToday} remaining in today's Resend free-tier quota. The send will stop when the cap is hit; unsent attendees can be resumed tomorrow.`
                    : `\n\n警告：${target} 超过今日 Resend 免费额度剩余 ${remainingToday} 封。达到上限后发送将中止，剩余参加者可明日继续。`)
                : '',
            target > SEND_CHUNK_SIZE
                ? (isEnglish
                    ? `\n\nThis will send in chunks of ${SEND_CHUNK_SIZE}. You can cancel between chunks.`
                    : `\n\n将以 ${SEND_CHUNK_SIZE} 封为一批发送，可在批次间取消。`)
                : '',
        ].join(''));
        if (!ok) return;

        cancelRef.current = false;
        setSending(true);
        setNoTemplate(false);
        setProgress({mode, sent: 0, target});

        let totalSent = 0;
        let cursor: string | undefined;
        try {
            while (!cancelRef.current && totalSent < target) {
                const result = await callSendTicketEmails({
                    eventId,
                    mode,
                    ...(cursor ? {cursor} : {}),
                });
                const {sentCount, hasMore, nextCursor} = result.data;
                totalSent += sentCount;
                setProgress({mode, sent: totalSent, target});
                if (!hasMore) break;
                cursor = nextCursor;
                if (!cursor && mode === 'all') {
                    // Safety: mode='all' with hasMore should always return a cursor.
                    break;
                }
            }
            if (cancelRef.current) {
                showToast(
                    isEnglish
                        ? `Stopped — sent ${totalSent} of ${target}.`
                        : `已停止 — 已发送 ${totalSent} / ${target}。`,
                    'warning',
                );
            } else {
                showToast(
                    isEnglish
                        ? `Queued ${totalSent} email${totalSent === 1 ? '' : 's'}.`
                        : `已排队发送 ${totalSent} 封邮件。`,
                    totalSent > 0 ? 'success' : 'warning',
                );
            }
            onSent();
        } catch (err) {
            const code = functionsErrorCode(err);
            if (code === 'no-template') {
                setNoTemplate(true);
                showToast(
                    isEnglish
                        ? 'Save the email template before sending.'
                        : '请先保存邮件模板再发送。',
                    'warning',
                );
            } else {
                showToast(
                    isEnglish
                        ? `Send failed${code ? ` (${code})` : ''}.`
                        : `发送失败${code ? `（${code}）` : ''}。`,
                    'error',
                );
            }
        } finally {
            setSending(false);
            setProgress(null);
            cancelRef.current = false;
            void loadQuota();
        }
    };

    const cancel = () => {
        cancelRef.current = true;
    };

    return (
        <div className="admin-tickets-send">
            <p className="admin-helper-text">
                {isEnglish
                    ? 'Sends ticket QRs via the Firebase Trigger Email extension. Each email contains one QR per ticket for that attendee.'
                    : '通过 Firebase Trigger Email 扩展发送门票二维码。每封邮件为对应参加者的每张门票包含一个二维码。'}
            </p>

            {noTemplate && (
                <div className="admin-tickets-send-banner admin-tickets-send-banner-warning">
                    <strong>
                        {isEnglish ? 'Email template not saved.' : '邮件模板尚未保存。'}
                    </strong>
                    <p>
                        {isEnglish
                            ? 'Save the template for this event before sending.'
                            : '发送前请先保存此活动的邮件模板。'}
                    </p>
                    <button
                        className="admin-toggle-btn admin-toggle-edit"
                        onClick={onOpenTemplate}
                    >
                        {isEnglish ? 'Open Template Editor' : '打开模板编辑器'}
                    </button>
                </div>
            )}

            <div className={`admin-tickets-send-banner ${
                quotaError ? 'admin-tickets-send-banner-warning'
                    : quotaAtCap ? 'admin-tickets-send-banner-error'
                        : quotaNearCap ? 'admin-tickets-send-banner-warning'
                            : 'admin-tickets-send-banner-info'}`}>
                {quotaError ? (
                    <span>
                        {isEnglish
                            ? 'Could not load Resend quota. Sending still works.'
                            : '无法加载 Resend 额度。发送功能仍可使用。'}
                    </span>
                ) : quota ? (
                    <span>
                        {isEnglish
                            ? `Resend free tier: ${quota.sentToday} / ${quota.dailyCap} emails sent today (${remainingToday} remaining). Resets at midnight America/Los_Angeles.`
                            : `Resend 免费额度：今日已发送 ${quota.sentToday} / ${quota.dailyCap} 封（剩余 ${remainingToday} 封）。太平洋时区午夜重置。`}
                    </span>
                ) : (
                    <span>
                        {isEnglish ? 'Loading quota...' : '加载额度中...'}
                    </span>
                )}
            </div>

            <div className="admin-tickets-send-stats">
                <p>
                    <strong>{totals.attendees}</strong> {isEnglish ? 'total attendees' : '位参加者'},{' '}
                    <strong>{totals.unsent}</strong> {isEnglish ? 'not yet sent' : '尚未发送'}.
                </p>
            </div>

            {progress && (
                <div className="admin-tickets-send-progress">
                    <div className="admin-tickets-send-progress-label">
                        {isEnglish
                            ? `Sending ${progress.sent} / ${progress.target}...`
                            : `发送中 ${progress.sent} / ${progress.target}...`}
                        {cancelRef.current && (
                            <span> {isEnglish ? '(cancelling after current chunk)' : '（将在本批后停止）'}</span>
                        )}
                    </div>
                    <div className="admin-tickets-send-progress-track">
                        <div
                            className="admin-tickets-send-progress-fill"
                            style={{width: `${Math.min(100, (progress.sent / Math.max(1, progress.target)) * 100)}%`}}
                        />
                    </div>
                </div>
            )}

            <div className="admin-btn-row">
                <button
                    className="admin-toggle-btn admin-toggle-save"
                    onClick={() => send('unsent')}
                    disabled={readOnly || sending || totals.unsent === 0 || quotaAtCap}
                >
                    {sending && progress?.mode === 'unsent'
                        ? (isEnglish ? 'Sending...' : '发送中...')
                        : (isEnglish ? `Send Unsent (${totals.unsent})` : `发送未发送（${totals.unsent}）`)}
                </button>
                <button
                    className="admin-toggle-btn admin-toggle-revoke"
                    onClick={() => send('all')}
                    disabled={readOnly || sending || totals.attendees === 0 || quotaAtCap}
                >
                    {sending && progress?.mode === 'all'
                        ? (isEnglish ? 'Sending...' : '发送中...')
                        : (isEnglish ? `Resend All (${totals.attendees})` : `全部重发（${totals.attendees}）`)}
                </button>
                {sending && (
                    <button
                        className="admin-toggle-btn admin-toggle-cancel"
                        onClick={cancel}
                        disabled={cancelRef.current}
                    >
                        {isEnglish ? 'Cancel' : '取消'}
                    </button>
                )}
            </div>
        </div>
    );
}
