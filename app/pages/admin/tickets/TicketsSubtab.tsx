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
import { AttendeeModal } from '../AttendeeModal';
import { TicketScanner } from '../TicketScanner';
import type { ShowToast } from '../utils';
import { AttendeesSection } from './AttendeesSection';
import { ImportSection } from './ImportSection';
import { SendSection } from './SendSection';
import { StatsSection } from './StatsSection';
import { TemplateSection } from './TemplateSection';
import { mapAttendeeDoc } from './helpers';
import { useAccountLinks } from './useAccountLinks';
import { type AttendeeData, type TicketData, type TicketsSection, type TicketType } from './types';

interface TicketsSubtabProps {
    event: UpcomingEvent;
    readOnly: boolean;
    canScan: boolean;
    showToast: ShowToast;
    // Where ticket attendees live. Archived events keep them under `pastEvents`
    // (migrated on archive); live events under `upcomingEvents`.
    collectionRoot?: 'upcomingEvents' | 'pastEvents';
}

export function TicketsSubtab({
                                  event,
                                  readOnly,
                                  canScan,
                                  showToast,
                                  collectionRoot = 'upcomingEvents'
                              }: TicketsSubtabProps) {
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
            const col = collection(db, collectionRoot, eventId, 'attendees');
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
    }, [eventId, isEnglish, collectionRoot]);

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

    // Whether each attendee's address has an account behind it — which is what
    // decides, when their ticket is scanned, whether the event reaches anybody's
    // profile. Asked for the whole list rather than the page on show, so the
    // answer is already there as more rows are revealed.
    const attendeeEmails = useMemo(() => attendees.map(a => a.email), [attendees]);
    const {links: accountLinks} = useAccountLinks(eventId, attendeeEmails);

    // Merged into the attendee as it stands when the call returns, not as it was
    // when the button was pressed: actions on two of someone's tickets can be in
    // flight together, and the second to land would otherwise undo the first on
    // screen.
    const updateAttendee = (attendeeId: string, changes: Partial<AttendeeData>) => {
        setAttendees(prev => prev.map(a => a.id === attendeeId ? {...a, ...changes} : a));
    };

    const updateTicket = (attendeeId: string, ticketId: string, changes: Partial<TicketData>) => {
        setAttendees(prev => prev.map(a => a.id !== attendeeId ? a : {
            ...a,
            tickets: a.tickets.map(t => t.ticketId === ticketId ? {...t, ...changes} : t),
        }));
    };

    const voidTicketAction = async (a: AttendeeData, ticketId: string) => {
        if (readOnly) return;
        const ok = window.confirm(isEnglish
            ? 'Void this ticket? The QR will stop working immediately.'
            : '作废此门票？二维码将立即失效。');
        if (!ok) return;
        try {
            await callVoidTicket({eventId, attendeeId: a.id, ticketId});
            updateTicket(a.id, ticketId, {voided: true});
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
            updateTicket(a.id, ticketId, {voided: false});
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
            updateTicket(a.id, ticketId, {
                redeemed: true,
                redeemedAt: new Date(),
                redeemedByName: profile?.displayName ?? '',
            });
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
            updateTicket(a.id, ticketId, {
                redeemed: false,
                redeemedAt: null,
                redeemedBy: '',
                redeemedByName: '',
                checkedIn: false,
                checkedInAt: null,
            });
            showToast(isEnglish ? 'Ticket reset.' : '门票已重置。', 'success');
        } catch {
            showToast(isEnglish ? 'Failed to reset ticket.' : '重置门票失败。', 'error');
        }
    };

    const updateTicketTypeAction = async (a: AttendeeData, ticketId: string, newType: TicketType) => {
        if (readOnly) return;
        try {
            await callUpdateTicketType({eventId, attendeeId: a.id, ticketId, type: newType});
            updateTicket(a.id, ticketId, {type: newType});
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
            setAttendees(prev => prev.filter(x => x.id !== a.id));
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
                updateAttendee(a.id, {emailSent: true, emailScheduled: false, emailSentAt: new Date()});
            } else if (queued > 0) {
                updateAttendee(a.id, {emailSent: true, emailScheduled: true});
            }
            showToast(
                sent > 0
                    ? (isEnglish ? 'Email queued.' : '邮件已排队发送。')
                    : queued > 0
                        ? (isEnglish
                            ? 'Daily cap reached — email queued, will send as capacity frees up.'
                            : '已达每日上限，邮件已排队，待额度恢复后发送。')
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
            } else if (code === 'no-contact-email') {
                showToast(
                    isEnglish
                        ? 'The template uses {{ contactEmail }}. Set a Contact Email in Site Config before sending.'
                        : '模板使用了 {{ contactEmail }}，请先在网站设置中填写联系邮箱再发送。',
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
                    accountLinks={accountLinks}
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
                <AttendeeModal
                    eventId={eventId}
                    attendee={editingAttendee}
                    onClose={() => setEditingAttendee(null)}
                    onSaved={(changes) => {
                        updateAttendee(editingAttendee.id, changes);
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
                <AttendeeModal
                    eventId={eventId}
                    attendee={null}
                    existingAttendees={attendees}
                    onClose={() => setAddingAttendee(false)}
                    onAdded={() => void loadAttendees()}
                    showToast={showToast}
                />
            )}
        </div>
    );
}
