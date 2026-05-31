import { useCallback, useEffect, useMemo, useState } from 'react';
import { collection, getDocs, orderBy, query } from 'firebase/firestore';
import { useAuth } from '~/components/AuthProvider';
import { useLanguage } from '~/components/LanguageContextProvider';
import {
    callAdminRedeemTicket,
    callDeleteEventAttendee,
    callResetTicket,
    callSendTicketEmails,
    callUnvoidTicket,
    callUpdateTicketType,
    callVoidTicket,
    functionsErrorCode,
    getFirebaseDb,
} from '~/lib/firebase';
import type { UpcomingEvent } from '~/lib/upcomingEvents';
import { AttendeeAddModal } from '../AttendeeAddModal';
import { AttendeeEditModal } from '../AttendeeEditModal';
import { TicketScanner } from '../TicketScanner';
import type { ShowToast } from '../utils';
import { AttendeesSection } from './AttendeesSection';
import { ImportSection } from './ImportSection';
import { SendSection } from './SendSection';
import { StatsSection } from './StatsSection';
import { TemplateSection } from './TemplateSection';
import { mapAttendeeDoc } from './helpers';
import { type AttendeeData, type TicketsSection, type TicketType } from './types';

interface TicketsSubtabProps {
    event: UpcomingEvent;
    readOnly: boolean;
    canScan: boolean;
    showToast: ShowToast;
}

export function TicketsSubtab({event, readOnly, canScan, showToast}: TicketsSubtabProps) {
    const {isEnglish} = useLanguage();
    const {profile} = useAuth();
    const eventId = event.id;

    const [section, setSection] = useState<TicketsSection>(canScan && readOnly ? 'scan' : 'attendees');
    const [attendees, setAttendees] = useState<AttendeeData[]>([]);
    const [loadingAttendees, setLoadingAttendees] = useState(false);
    const [attendeesError, setAttendeesError] = useState<string | null>(null);
    const [search, setSearch] = useState('');
    const [filterUnsent, setFilterUnsent] = useState(false);
    const [ticketTypeFilter, setTicketTypeFilter] = useState<TicketType | 'all'>('all');
    const [statusFilter, setStatusFilter] = useState<'all' | 'redeemed' | 'unredeemed' | 'voided'>('all');

    const [editingAttendee, setEditingAttendee] = useState<AttendeeData | null>(null);
    const [addingAttendee, setAddingAttendee] = useState(false);

    const [displayCount, setDisplayCount] = useState(10);

    const loadAttendees = useCallback(async () => {
        setLoadingAttendees(true);
        setAttendeesError(null);
        try {
            const db = getFirebaseDb();
            const col = collection(db, 'upcomingEvents', eventId, 'attendees');
            const snap = await getDocs(query(col, orderBy('createdAt', 'desc')));
            const list = snap.docs.map(d => mapAttendeeDoc(d.id, d.data()));
            setAttendees(list);
            setDisplayCount(10);
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

    useEffect(() => {
        setDisplayCount(10);
    }, [search, filterUnsent, ticketTypeFilter, statusFilter]);

    const filteredAttendees = useMemo(() => {
        const needle = search.trim().toLowerCase();
        return attendees.filter(a => {
            if (filterUnsent && a.emailSent) return false;
            if (ticketTypeFilter !== 'all') {
                const hasType = a.tickets.some(t => t.type === ticketTypeFilter);
                if (!hasType) return false;
            }
            if (statusFilter !== 'all') {
                const hasStatus = a.tickets.some(t =>
                    statusFilter === 'redeemed'
                        ? t.redeemed
                        : statusFilter === 'unredeemed'
                            ? !t.redeemed && !t.voided
                            : t.voided,
                );
                if (!hasStatus) return false;
            }
            if (!needle) return true;
            return a.email.toLowerCase().includes(needle)
                || a.name.toLowerCase().includes(needle);
        });
    }, [attendees, search, filterUnsent, ticketTypeFilter, statusFilter]);

    const totals = useMemo(() => {
        let tickets = 0;
        let used = 0;
        let voided = 0;
        let unsent = 0;
        let sendable = 0;
        let unsentSendable = 0;

        for (const a of attendees) {
            tickets += a.ticketCount;
            let activeInThisAttendee = 0;
            for (const t of a.tickets) {
                if (t.voided) voided++;
                else {
                    activeInThisAttendee++;
                    if (t.redeemed) used++;
                }
            }
            if (!a.emailSent) unsent++;

            if (activeInThisAttendee > 0) {
                sendable++;
                if (!a.emailSent) unsentSendable++;
            }
        }
        return {
            attendees: attendees.length,
            tickets, used, voided, unsent,
            sendable, unsentSendable
        };
    }, [attendees]);

    const visibleAttendees = useMemo(() => {
        return filteredAttendees.slice(0, displayCount);
    }, [filteredAttendees, displayCount]);

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

    const unvoidTicketAction = async (a: AttendeeData, ticketId: string) => {
        if (readOnly) return;
        const ok = window.confirm(isEnglish
            ? 'Unvoid this ticket? The QR will become active again.'
            : '撤销作废此门票？二维码将恢复有效。');
        if (!ok) return;
        try {
            await callUnvoidTicket({eventId, attendeeId: a.id, ticketId});
            const updatedTickets = a.tickets.map(t =>
                t.ticketId === ticketId ? {...t, voided: false} : t,
            );
            onAttendeeUpdated({...a, tickets: updatedTickets});
            showToast(isEnglish ? 'Ticket unvoided.' : '门票已撤销作废。', 'success');
        } catch {
            showToast(isEnglish ? 'Failed to unvoid ticket.' : '撤销作废门票失败。', 'error');
        }
    };

    const redeemTicketAction = async (a: AttendeeData, ticketId: string) => {
        if (readOnly) return;
        const ok = window.confirm(isEnglish
            ? 'Redeem this ticket now? It will be marked as used.'
            : '立即验证此门票？将标记为已使用。');
        if (!ok) return;
        try {
            const res = await callAdminRedeemTicket({eventId, attendeeId: a.id, ticketId});
            if (res.data.alreadyRedeemed) {
                showToast(isEnglish ? 'Ticket was already redeemed.' : '此门票此前已验证。', 'warning');
                return;
            }
            const updatedTickets = a.tickets.map(t =>
                t.ticketId === ticketId
                    ? {...t, redeemed: true, redeemedAt: new Date(), redeemedByName: profile?.displayName ?? ''}
                    : t,
            );
            onAttendeeUpdated({...a, tickets: updatedTickets});
            showToast(isEnglish ? 'Ticket redeemed.' : '门票已验证。', 'success');
        } catch {
            showToast(isEnglish ? 'Failed to redeem ticket.' : '验证门票失败。', 'error');
        }
    };

    const resetTicketAction = async (a: AttendeeData, ticketId: string) => {
        if (readOnly) return;
        const ok = window.confirm(isEnglish
            ? 'Reset this ticket? Its redeemed status will be cleared.'
            : '重置此门票？将清除已验证状态。');
        if (!ok) return;
        try {
            await callResetTicket({eventId, attendeeId: a.id, ticketId});
            const updatedTickets = a.tickets.map(t =>
                t.ticketId === ticketId
                    ? {
                        ...t,
                        redeemed: false,
                        redeemedAt: null,
                        redeemedBy: '',
                        redeemedByName: '',
                        checkedIn: false,
                        checkedInAt: null,
                    }
                    : t,
            );
            onAttendeeUpdated({...a, tickets: updatedTickets});
            showToast(isEnglish ? 'Ticket reset.' : '门票已重置。', 'success');
        } catch {
            showToast(isEnglish ? 'Failed to reset ticket.' : '重置门票失败。', 'error');
        }
    };

    const updateTicketTypeAction = async (a: AttendeeData, ticketId: string, newType: TicketType) => {
        if (readOnly) return;
        try {
            await callUpdateTicketType({eventId, attendeeId: a.id, ticketId, type: newType});
            const updatedTickets = a.tickets.map(t =>
                t.ticketId === ticketId ? {...t, type: newType} : t,
            );
            onAttendeeUpdated({...a, tickets: updatedTickets});
            showToast(isEnglish ? 'Ticket type updated.' : '门票类型已更新。', 'success');
        } catch {
            showToast(isEnglish ? 'Failed to update ticket type.' : '更新门票类型失败。', 'error');
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
            const queued = result.data.queuedCount;
            if (sent > 0) {
                onAttendeeUpdated({
                    ...a, emailSent: true, emailScheduled: false, emailSentAt: new Date(),
                });
            } else if (queued > 0) {
                onAttendeeUpdated({...a, emailSent: true, emailScheduled: true});
            }
            showToast(
                sent > 0
                    ? (isEnglish ? 'Email queued.' : '邮件已排队发送。')
                    : queued > 0
                        ? (isEnglish
                            ? 'Daily cap reached — email queued for tomorrow.'
                            : '已达每日上限，已排队明日发送。')
                        : (isEnglish ? 'No email queued.' : '未发送邮件。'),
                (sent > 0 || queued > 0) ? 'success' : 'warning',
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
        if (t === 'import' || t === 'template' || t === 'send') return !readOnly;
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
                </button>
                <button
                    className={`admin-sub-tab ${section === 'stats' ? 'admin-sub-tab-active' : ''}`}
                    onClick={() => setSection('stats')}
                >
                    {isEnglish ? 'Stats' : '统计'}
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
                    attendees={visibleAttendees}
                    search={search}
                    onSearchChange={setSearch}
                    filterUnsent={filterUnsent}
                    onFilterUnsentChange={setFilterUnsent}
                    ticketTypeFilter={ticketTypeFilter}
                    onTicketTypeFilterChange={setTicketTypeFilter}
                    statusFilter={statusFilter}
                    onStatusFilterChange={setStatusFilter}
                    readOnly={readOnly}
                    onEdit={setEditingAttendee}
                    onAdd={() => setAddingAttendee(true)}
                    onVoidTicket={voidTicketAction}
                    onUnvoidTicket={unvoidTicketAction}
                    onRedeemTicket={redeemTicketAction}
                    onResetTicket={resetTicketAction}
                    onUpdateTicketType={updateTicketTypeAction}
                    onResend={resendToAttendee}
                    onDelete={deleteAttendeeAction}
                    onRefresh={() => void loadAttendees()}
                    hasMore={displayCount < filteredAttendees.length}
                    loadingMore={false}
                    onLoadMore={() => setDisplayCount(c => c + 10)}
                />
            )}

            {section === 'stats' && (
                <StatsSection
                    loading={loadingAttendees}
                    error={attendeesError}
                    attendees={attendees}
                    onRefresh={() => void loadAttendees()}
                />
            )}

            {section === 'import' && (
                <ImportSection
                    eventId={eventId}
                    existingAttendees={attendees}
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
                    onRegenerated={() => {
                        setEditingAttendee(null);
                        void loadAttendees();
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
