import { useCallback, useEffect, useMemo, useState } from 'react';
import { collection, getDocs, orderBy, query } from 'firebase/firestore';
import { useLanguage } from '~/components/LanguageContextProvider';
import {
    callDeleteEventAttendee,
    callSendTicketEmails,
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
import { TemplateSection } from './TemplateSection';
import { mapAttendeeDoc } from './helpers';
import type { AttendeeData, TicketsSection } from './types';

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
