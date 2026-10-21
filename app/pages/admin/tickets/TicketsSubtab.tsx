import { useCallback, useEffect, useMemo, useState } from 'react';
import { collection, doc, getDocs, onSnapshot, orderBy, query } from 'firebase/firestore';
import { hasPermission, useAuth } from '~/components/AuthProvider';
import { useLanguage } from '~/components/LanguageContextProvider';
import {
    callAdminRedeemTicket,
    callDeleteEventAttendee,
    callResetTicket,
    callSendTicketEmails,
    callUnvoidTicket,
    callUpdateTicketNotes,
    callUpdateTicketType,
    callVoidTicket,
    functionsErrorCode,
    getFirebaseDb,
} from '~/lib/firebase';
import { fileStamp } from '~/lib/csv';
import { eventDayStatus, formatEventDays } from '~/lib/eventDays';
import type { UpcomingEvent } from '~/lib/upcomingEvents';
import { downloadBlob } from '~/lib/zip';
import { AttendeeModal } from '../AttendeeModal';
import { TicketScanner } from '../TicketScanner';
import type { ShowToast } from '../utils';
import { AttendeesSection } from './AttendeesSection';
import { EmailsSection } from './EmailsSection';
import { HometownSection } from './HometownSection';
import { ImportSection } from './ImportSection';
import { SettingsSection } from './SettingsSection';
import { StatsSection } from './StatsSection';
import { attendeeLabel, buildAttendeeCsv, checkedInWalkIn, mapAttendeeDoc } from './helpers';
import { useAccountLinks } from './useAccountLinks';
import { type AttendeeData, type StatusFilter, type TicketData, type TicketsSection, type TicketType } from './types';

interface TicketsSubtabProps {
    event: UpcomingEvent;
    readOnly: boolean;
    scanAccess: 'always' | 'event-days' | 'none';
    showToast: ShowToast;
    collectionRoot?: 'upcomingEvents' | 'pastEvents';
}

export function TicketsSubtab({
                                  event,
                                  readOnly,
                                  scanAccess,
                                  showToast,
                                  collectionRoot = 'upcomingEvents'
                              }: TicketsSubtabProps) {
    const {isEnglish} = useLanguage();
    const {profile} = useAuth();
    // By group, not readOnly: an archived event's list is read-only for everyone,
    // and that's when it's exported most.
    const canExport = !!profile && hasPermission(profile.group, 'core-staff');
    const eventId = event.id;
    const startMs = event.startAt.getTime();
    const endMs = event.endAt.getTime();

    const [eventDay, setEventDay] = useState(() => eventDayStatus(event.startAt, event.endAt));
    useEffect(() => {
        const check = () => setEventDay(eventDayStatus(new Date(startMs), new Date(endMs)));
        check();
        const timer = setInterval(check, 60_000);
        return () => clearInterval(timer);
    }, [startMs, endMs]);

    const canScan = scanAccess !== 'none';
    const scanOpen = scanAccess === 'always' || (scanAccess === 'event-days' && eventDay === 'during');
    const canAddWalkIn = !readOnly && eventDay === 'during';

    const [section, setSection] = useState<TicketsSection>(scanOpen && readOnly ? 'scan' : 'attendees');
    const [attendees, setAttendees] = useState<AttendeeData[]>([]);
    const [loadingAttendees, setLoadingAttendees] = useState(false);
    const [attendeesFailed, setAttendeesFailed] = useState(false);
    const [search, setSearch] = useState('');
    const [filterUnsent, setFilterUnsent] = useState(false);
    const [ticketTypeFilter, setTicketTypeFilter] = useState<TicketType | 'all'>('all');
    const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');

    const [editingAttendee, setEditingAttendee] = useState<AttendeeData | null>(null);
    const [addingAttendee, setAddingAttendee] = useState(false);

    const [displayCount, setDisplayCount] = useState(10);

    // Load attendees lazily so a scanner-only session doesn't fetch the full list.
    const listKey = `${collectionRoot}/${eventId}`;
    const [loadedFor, setLoadedFor] = useState<string | null>(null);

    const loadAttendees = useCallback(async () => {
        setLoadingAttendees(true);
        setAttendeesFailed(false);
        try {
            const db = getFirebaseDb();
            const col = collection(db, collectionRoot, eventId, 'attendees');
            const snap = await getDocs(query(col, orderBy('createdAt', 'desc')));
            const list = snap.docs.map(d => mapAttendeeDoc(d.id, d.data()));
            setAttendees(list);
            setDisplayCount(10);
            setLoadedFor(`${collectionRoot}/${eventId}`);
        } catch (err) {
            console.error('[TicketsSubtab] loadAttendees', err);
            setAttendeesFailed(true);
        } finally {
            setLoadingAttendees(false);
        }
    }, [eventId, collectionRoot]);

    const listShown = (section !== 'scan' && section !== 'settings') || addingAttendee;
    const listCurrent = loadedFor === listKey;
    useEffect(() => {
        if (listShown && !listCurrent) void loadAttendees();
    }, [listShown, listCurrent, loadAttendees]);

    const [admitUnlisted, setAdmitUnlisted] = useState<boolean | null>(null);
    useEffect(() => {
        if (collectionRoot !== 'upcomingEvents') return;
        return onSnapshot(
            doc(getFirebaseDb(), 'upcomingEvents', eventId, 'settings', 'hometown'),
            snap => setAdmitUnlisted(snap.data()?.admitUnlisted === true),
            err => console.error('[TicketsSubtab] hometown settings', err),
        );
    }, [eventId, collectionRoot]);

    useEffect(() => {
        setDisplayCount(10);
    }, [search, filterUnsent, ticketTypeFilter, statusFilter]);

    const filteredAttendees = useMemo(() => {
        const needle = search.trim().toLowerCase();
        return attendees.filter(a => {
            if (filterUnsent && (a.emailSent || checkedInWalkIn(a))) return false;
            if (ticketTypeFilter !== 'all') {
                // An unlisted HomeTown ticket's type isn't known yet.
                if (a.unlisted || !a.tickets.some(t => t.type === ticketTypeFilter)) return false;
            }
            if (statusFilter === 'unlisted') {
                if (!a.unlisted) return false;
            } else if (statusFilter === 'missing') {
                if (!a.missingFromHometown) return false;
            } else if (statusFilter !== 'all') {
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
            // Part of a HomeTown number, which is all digits, but only the whole
            // of one of ours: a few letters would match half the UUIDs.
            return a.email.toLowerCase().includes(needle)
                || a.name.toLowerCase().includes(needle)
                || a.ticketIds.some(id => a.hometown ? id.includes(needle) : id.toLowerCase() === needle)
                || a.tickets.some(t => t.notes.toLowerCase().includes(needle));
        });
    }, [attendees, search, filterUnsent, ticketTypeFilter, statusFilter]);

    const totals = useMemo(() => {
        let tickets = 0;
        let used = 0;
        let voided = 0;
        let unsent = 0;
        let sendable = 0;
        let unsentSendable = 0;
        let walkIns = 0;
        let hometown = 0;
        let unlisted = 0;
        let missingFromHometown = 0;

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
            // A walk-in already in at the door is owed no email.
            const owed = !a.emailSent && !checkedInWalkIn(a);
            if (owed) unsent++;
            if (a.walkIn) walkIns++;
            if (a.hometown) hometown++;
            if (a.unlisted) unlisted++;
            if (a.missingFromHometown) missingFromHometown++;

            // Emailless walk-ins can't be sent to, and HomeTown sends its own.
            if (activeInThisAttendee > 0 && a.email && !a.hometown) {
                sendable++;
                if (owed) unsentSendable++;
            }
        }
        return {
            attendees: attendees.length,
            tickets, used, voided, unsent,
            sendable, unsentSendable, walkIns, hometown, unlisted, missingFromHometown,
        };
    }, [attendees]);

    useEffect(() => {
        if (totals.hometown === 0 && (statusFilter === 'unlisted' || statusFilter === 'missing')) {
            setStatusFilter('all');
        }
    }, [totals.hometown, statusFilter]);

    const visibleAttendees = useMemo(() => {
        return filteredAttendees.slice(0, displayCount);
    }, [filteredAttendees, displayCount]);

    const attendeeEmails = useMemo(() => attendees.map(a => a.email), [attendees]);
    const {links: accountLinks} = useAccountLinks(eventId, attendeeEmails);

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
                redeemedByName: '',
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

    // The note as saved, which the server may have trimmed, or null if it wasn't.
    const updateTicketNotesAction = async (a: AttendeeData, ticketId: string, notes: string): Promise<string | null> => {
        if (readOnly) return null;
        try {
            const res = await callUpdateTicketNotes({eventId, attendeeId: a.id, ticketId, notes});
            updateTicket(a.id, ticketId, {notes: res.data.notes});
            if (res.data.updated) showToast(isEnglish ? 'Note saved.' : '备注已保存。', 'success');
            return res.data.notes;
        } catch {
            showToast(isEnglish ? 'Failed to save note.' : '保存备注失败。', 'error');
            return null;
        }
    };

    const exportAttendees = () => {
        if (!canExport) return;
        const base = event.title.replace(/[\\/:*?"<>|]+/g, ' ').trim() || eventId;
        downloadBlob(buildAttendeeCsv(attendees), `${base}-attendees-${fileStamp()}.csv`);
    };

    const deleteAttendeeAction = async (a: AttendeeData) => {
        if (readOnly) return;
        const ok = window.confirm(isEnglish
            ? `Remove ${attendeeLabel(a, true)} and void all ${a.ticketCount} ticket(s)?`
            : `移除 ${attendeeLabel(a, false)} 并作废全部 ${a.ticketCount} 张门票？`);
        if (!ok) return;
        try {
            await callDeleteEventAttendee({eventId, attendeeId: a.id});
            setAttendees(prev => prev.filter(x => x.id !== a.id));
            showToast(isEnglish ? 'Attendee removed.' : '参加者已移除。', 'warning');
        } catch (err) {
            showToast(functionsErrorCode(err) === 'hometown-ticket'
                    ? (isEnglish ? 'HomeTown tickets can\'t be removed. Void the ticket instead.' : 'HomeTown 门票不能移除，请改为作废。')
                    : (isEnglish ? 'Failed to remove attendee.' : '移除失败。'),
                'error');
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

    const attendeesError = attendeesFailed
        ? (isEnglish ? 'Failed to load attendees.' : '加载参加者失败。')
        : null;

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
                {!readOnly && (
                    <button
                        className={`admin-sub-tab ${section === 'import' ? 'admin-sub-tab-active' : ''}`}
                        onClick={() => setSection('import')}
                    >
                        {isEnglish ? 'Import' : '导入'}
                    </button>
                )}
                {!readOnly && (
                    <button
                        className={`admin-sub-tab ${section === 'emails' ? 'admin-sub-tab-active' : ''}`}
                        onClick={() => setSection('emails')}
                    >
                        {isEnglish ? 'Emails' : '邮件'}
                    </button>
                )}
                {!readOnly && collectionRoot === 'upcomingEvents' && (
                    <button
                        className={`admin-sub-tab ${section === 'settings' ? 'admin-sub-tab-active' : ''}`}
                        onClick={() => setSection('settings')}
                    >
                        {isEnglish ? 'Settings' : '设置'}
                    </button>
                )}
            </div>

            {section === 'scan' && scanOpen && (
                <TicketScanner
                    eventId={eventId}
                    eventTitle={isEnglish ? event.title : (event.titleCn || event.title)}
                    admitUnlistedHometown={admitUnlisted}
                    canManage={!readOnly}
                    onRedeemed={() => setLoadedFor(null)}
                />
            )}

            {section === 'scan' && scanOpen && canAddWalkIn && (
                <div className="admin-tickets-walk-in-card">
                    <p className="admin-helper-text">
                        {isEnglish
                            ? 'No ticket? Add them as a walk-in and check them in at once. Their email is optional.'
                            : '没有门票？现场登记并立即签到，邮箱可不填。'}
                    </p>
                    <button
                        className="admin-toggle-btn admin-toggle-save"
                        onClick={() => setAddingAttendee(true)}
                    >
                        {isEnglish ? 'Add Walk-in' : '现场登记'}
                    </button>
                </div>
            )}

            {section === 'scan' && canScan && !scanOpen && (
                <p className="admin-no-results">
                    {eventDay === 'before'
                        ? (isEnglish
                            ? `Ticket scanning opens on the day of the event, and is open all day ${formatEventDays(event.startAt, event.endAt, true)} (Pacific time).`
                            : `门票扫码将于活动当天开放，开放时间为 ${formatEventDays(event.startAt, event.endAt, false)} 全天（太平洋时间）。`)
                        : (isEnglish
                            ? `Ticket scanning has closed. It was open all day ${formatEventDays(event.startAt, event.endAt, true)} (Pacific time).`
                            : `门票扫码已关闭，开放时间为 ${formatEventDays(event.startAt, event.endAt, false)} 全天（太平洋时间）。`)}
                </p>
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
                    walkIn={canAddWalkIn}
                    onEdit={setEditingAttendee}
                    onAdd={() => setAddingAttendee(true)}
                    onExport={canExport ? exportAttendees : undefined}
                    onVoidTicket={voidTicketAction}
                    onUnvoidTicket={unvoidTicketAction}
                    onRedeemTicket={redeemTicketAction}
                    onResetTicket={resetTicketAction}
                    onUpdateTicketType={updateTicketTypeAction}
                    onUpdateTicketNotes={updateTicketNotesAction}
                    onResend={resendToAttendee}
                    onDelete={deleteAttendeeAction}
                    onRefresh={() => void loadAttendees()}
                    hasMore={displayCount < filteredAttendees.length}
                    onLoadMore={() => setDisplayCount(c => c + 10)}
                    showToast={showToast}
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
                    // HomeTown tickets aren't re-issued by email, so they're no duplicate.
                    existingAttendees={attendees.filter(a => !a.hometown)}
                    readOnly={readOnly}
                    showToast={showToast}
                    onImported={() => void loadAttendees()}
                />
            )}

            {section === 'import' && collectionRoot === 'upcomingEvents' && (
                <HometownSection
                    eventId={eventId}
                    attendees={attendees}
                    readOnly={readOnly}
                    showToast={showToast}
                    onImported={() => void loadAttendees()}
                />
            )}

            {section === 'settings' && collectionRoot === 'upcomingEvents' && (
                <SettingsSection
                    eventId={eventId}
                    admitUnlisted={admitUnlisted}
                    onAdmitUnlistedChange={setAdmitUnlisted}
                    readOnly={readOnly}
                    showToast={showToast}
                />
            )}

            {section === 'emails' && (
                <EmailsSection
                    event={event}
                    totals={totals}
                    readOnly={readOnly}
                    showToast={showToast}
                    onSent={() => void loadAttendees()}
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
                    walkIn={canAddWalkIn}
                    onClose={() => setAddingAttendee(false)}
                    onAdded={() => setLoadedFor(null)}
                    showToast={showToast}
                />
            )}
        </div>
    );
}
