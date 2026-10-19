import { useEffect, useMemo, useState } from 'react';
import { useLanguage } from '~/components/LanguageContextProvider';
import {
    callAddWalkInAttendee,
    callImportEventAttendees,
    callUpdateEventAttendee,
    functionsErrorCode,
} from '~/lib/firebase';
import { ModalShell } from './ModalShell';
import { EMAIL_RE } from './tickets/helpers';
import { type AttendeeData, TICKET_TYPES, type TicketType } from './tickets/types';
import { useAccountLinks } from './tickets/useAccountLinks';
import type { ShowToast } from './utils';

const LOOKUP_DEBOUNCE_MS = 600;

interface AttendeeModalProps {
    eventId: string;
    attendee: AttendeeData | null;
    existingAttendees?: AttendeeData[];
    walkIn?: boolean;
    onClose: () => void;
    onAdded?: () => void;
    onSaved?: (changes: Partial<AttendeeData>) => void;
    onRegenerated?: () => void;
    showToast: ShowToast;
}

export function AttendeeModal({
                                  eventId,
                                  attendee,
                                  existingAttendees = [],
                                  walkIn = false,
                                  onClose,
                                  onAdded,
                                  onSaved,
                                  onRegenerated,
                                  showToast,
                              }: AttendeeModalProps) {
    const {isEnglish} = useLanguage();
    const [email, setEmail] = useState(attendee?.email ?? '');
    const [name, setName] = useState(attendee?.name ?? '');
    const [ticketCount, setTicketCount] = useState(attendee ? String(attendee.ticketCount) : '1');
    const originalType: TicketType = attendee?.tickets[0]?.type || 'normal';
    const [type, setType] = useState<TicketType>(originalType);
    const ticketNotes = new Set(attendee?.tickets.map(t => t.notes));
    // The note every ticket has, or null when they differ.
    const originalNotes = ticketNotes.size > 1 ? null : ([...ticketNotes][0] ?? '');
    const [notes, setNotes] = useState(originalNotes ?? '');
    const [checkIn, setCheckIn] = useState(true);
    const [saving, setSaving] = useState(false);

    const trimmedEmail = email.trim().toLowerCase();
    const trimmedName = name.trim();
    const trimmedNotes = notes.trim();
    const parsedCount = parseInt(ticketCount, 10);

    const emailValid = EMAIL_RE.test(trimmedEmail);
    const emailOk = emailValid || (walkIn && trimmedEmail === '');
    const nameValid = trimmedName.length <= 100;
    const countValid = Number.isInteger(parsedCount) && parsedCount >= 1 && parsedCount <= 50;

    const nameChanged = !!attendee && nameValid && trimmedName !== attendee.name;
    const countChanged = !!attendee && countValid && parsedCount !== attendee.ticketCount;
    const typeChanged = !!attendee && type !== originalType;
    // Left blank over differing notes, each ticket keeps its own.
    const notesChanged = !!attendee && (originalNotes === null ? trimmedNotes !== '' : trimmedNotes !== originalNotes);

    const [lookupEmail, setLookupEmail] = useState(attendee?.email.trim().toLowerCase() ?? '');
    useEffect(() => {
        if (attendee) return;
        if (!emailValid) {
            setLookupEmail('');
            return;
        }
        const timer = setTimeout(() => setLookupEmail(trimmedEmail), LOOKUP_DEBOUNCE_MS);
        return () => clearTimeout(timer);
    }, [attendee, emailValid, trimmedEmail]);

    const lookupEmails = useMemo(() => lookupEmail ? [lookupEmail] : [], [lookupEmail]);
    const {links: accountLinks, failed: accountLookupFailed} = useAccountLinks(eventId, lookupEmails);
    const account = lookupEmail ? accountLinks.get(lookupEmail) : undefined;
    const checkingAccount = !!lookupEmail && account === undefined && !accountLookupFailed;

    // HomeTown tickets aren't re-issued by email, so only warn about HomeTown matches for walk-ins.
    const duplicate = useMemo(() => {
        if (attendee || !emailValid) return null;
        const matches = existingAttendees.filter(a => a.email.toLowerCase() === trimmedEmail && (walkIn || !a.hometown));
        if (matches.length === 0) return null;
        return {
            name: matches.find(a => a.name)?.name ?? '',
            ticketCount: matches.reduce((sum, a) => sum + a.ticketCount, 0),
        };
    }, [attendee, existingAttendees, trimmedEmail, emailValid, walkIn]);

    const hometownLocked = !!attendee?.hometown;

    const canSave = !saving && nameValid && countValid && (attendee
        ? (nameChanged || countChanged || typeChanged || notesChanged)
        : emailOk && !(walkIn && duplicate));

    const submitWalkIn = async () => {
        setSaving(true);
        try {
            const result = await callAddWalkInAttendee({
                eventId,
                email: trimmedEmail,
                name: trimmedName,
                ticketCount: parsedCount,
                type,
                notes: trimmedNotes,
                checkIn,
            });
            showToast(
                result.data.checkedIn
                    ? (isEnglish
                        ? `Added and checked in ${parsedCount} ticket${parsedCount === 1 ? '' : 's'}.`
                        : `已添加并签到 ${parsedCount} 张门票。`)
                    : (isEnglish ? 'Walk-in added.' : '现场来宾已添加。'),
                'success',
            );
            onAdded?.();
            onClose();
        } catch (err) {
            const code = functionsErrorCode(err);
            showToast(
                code === 'attendee-exists'
                    ? (isEnglish
                        ? 'This email is already on the list. Check them in from Attendees.'
                        : '该邮箱已在名单中，请在参加者列表中为其签到。')
                    : code === 'not-event-day'
                        ? (isEnglish
                            ? 'Walk-ins can only be added on the day of the event.'
                            : '仅可在活动当天现场登记。')
                        : (isEnglish ? 'Failed to add walk-in.' : '现场登记失败。'),
                'error',
            );
        } finally {
            setSaving(false);
        }
    };

    const submitAdd = async () => {
        if (duplicate) {
            const ok = window.confirm(isEnglish
                ? `An attendee with email "${trimmedEmail}" already exists. Continuing will re-issue all of their tickets — old QR codes will stop working. Continue?`
                : `邮箱 "${trimmedEmail}" 已存在。继续将重新签发该参加者的所有门票，旧二维码将立即失效。是否继续？`);
            if (!ok) return;
        }
        setSaving(true);
        try {
            // Only override a duplicate confirmed above; one added elsewhere since load is skipped.
            const result = await callImportEventAttendees({
                eventId,
                attendees: [{
                    email: trimmedEmail,
                    name: trimmedName,
                    ticketCount: parsedCount,
                    type,
                    notes: trimmedNotes
                }],
                onDuplicate: duplicate ? 'override' : 'skip',
            });
            const {added, replaced, skipped} = result.data;
            showToast(
                added > 0
                    ? (isEnglish ? 'Attendee added.' : '参加者已添加。')
                    : replaced > 0
                        ? (isEnglish ? 'Attendee updated — tickets re-issued.' : '参加者已更新，门票已重新签发。')
                        : skipped > 0
                            ? (isEnglish
                                ? 'This email was added since the list loaded, so nothing changed. The list is refreshed.'
                                : '该邮箱在列表加载后已被添加，未作更改。列表已刷新。')
                            : (isEnglish ? 'No changes.' : '无更改。'),
                added > 0 ? 'success' : 'warning',
            );
            onAdded?.();
            onClose();
        } catch (err) {
            const code = functionsErrorCode(err);
            const msg = isEnglish
                ? `Failed to add attendee${code ? ` (${code})` : ''}.`
                : `添加参加者失败${code ? `（${code}）` : ''}。`;
            showToast(msg, 'error');
        } finally {
            setSaving(false);
        }
    };

    const submitEdit = async (existing: AttendeeData) => {
        if (countChanged || typeChanged) {
            const ok = window.confirm(isEnglish
                ? 'Changing ticket count or type will re-issue ALL tickets for this attendee. Old QR codes will stop working. Continue?'
                : '修改门票数量或类型会重新签发该参加者的全部门票，旧二维码将立即失效。是否继续？');
            if (!ok) return;
        }
        setSaving(true);
        try {
            const result = await callUpdateEventAttendee({
                eventId,
                attendeeId: existing.id,
                name: trimmedName,
                ticketCount: parsedCount,
                type,
                // Every ticket gets it, re-issued ones too, unless it's blank over
                // differing notes, which each ticket keeps.
                ...(originalNotes !== null || trimmedNotes !== '' ? {notes: trimmedNotes} : {}),
            });
            const {regenerated, notes: savedNotes} = result.data;
            if (regenerated) {
                onRegenerated?.();
            } else {
                onSaved?.({
                    name: trimmedName,
                    ...(savedNotes !== undefined
                        ? {tickets: existing.tickets.map(t => ({...t, notes: savedNotes}))}
                        : {}),
                });
            }
            showToast(
                regenerated
                    ? (isEnglish ? 'Attendee updated — tickets re-issued.' : '参加者已更新，门票已重新签发。')
                    : (isEnglish ? 'Attendee updated.' : '参加者已更新。'),
                regenerated ? 'warning' : 'success',
            );
        } catch (err) {
            const code = functionsErrorCode(err);
            showToast(
                isEnglish
                    ? `Update failed${code ? ` (${code})` : ''}.`
                    : `更新失败${code ? `（${code}）` : ''}。`,
                'error',
            );
        } finally {
            setSaving(false);
        }
    };

    const submit = () => {
        if (!canSave) return;
        void (attendee ? submitEdit(attendee) : walkIn ? submitWalkIn() : submitAdd());
    };

    return (
        <ModalShell
            title={attendee
                ? (isEnglish ? 'Edit Attendee' : '编辑参加者')
                : walkIn
                    ? (isEnglish ? 'Add Walk-in' : '现场登记')
                    : (isEnglish ? 'Add Attendee' : '添加参加者')}
            onClose={onClose}
            closeDisabled={saving}
        >
            <form className="admin-tickets-attendee-edit" onSubmit={(e) => {
                e.preventDefault();
                submit();
            }}>
                <label className="admin-tickets-template-field">
                        <span>
                            {attendee
                                ? (isEnglish ? 'Email (read-only)' : '邮箱（不可修改）')
                                : walkIn
                                    ? (isEnglish ? 'Email (optional)' : '邮箱（可选）')
                                    : (isEnglish ? 'Email' : '邮箱')}
                        </span>
                    <input
                        type="email"
                        className="admin-input"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder={attendee ? (isEnglish ? 'No email' : '无邮箱') : 'person@example.com'}
                        readOnly={!!attendee}
                        disabled={!attendee && saving}
                        autoFocus={!attendee}
                    />
                    {walkIn && trimmedEmail === '' && (
                        <span className="admin-helper-text">
                            {isEnglish
                                ? 'Without an email, no tickets are sent and no account is credited.'
                                : '不填写邮箱则不会发送门票，也不会计入任何账户。'}
                        </span>
                    )}
                    {emailValid && (
                        <span className={`admin-helper-text admin-tickets-account-note${
                            account ? ' admin-tickets-account-note--linked' : ''}`}>
                            {accountLookupFailed
                                ? (isEnglish
                                    ? 'Could not check whether this email has an account.'
                                    : '无法查询该邮箱是否已注册。')
                                : checkingAccount
                                    ? (isEnglish ? 'Checking for an account…' : '正在查询账户…')
                                    : account
                                        ? (
                                            <>
                                                {isEnglish ? 'Registered account: ' : '已注册账户：'}
                                                {account.uid
                                                    ? (
                                                        <a
                                                            href={`/profile?uid=${account.uid}`}
                                                            target="_blank"
                                                            rel="noopener noreferrer"
                                                            className="admin-tickets-attendee-account-link"
                                                        >
                                                            {account.displayName || account.email}
                                                        </a>
                                                    )
                                                    : account.displayName || account.email}
                                                {isEnglish
                                                    ? '. Their tickets will show on their profile.'
                                                    : '。门票会显示在其个人主页。'}
                                            </>
                                        )
                                        : (isEnglish
                                            ? 'No account uses this email yet — the ticket still works, and counts once they sign up with it.'
                                            : '暂无账户使用该邮箱 — 门票照常可用，其以该邮箱注册后即会计入。')}
                        </span>
                    )}
                </label>

                <label className="admin-tickets-template-field">
                    <span>{isEnglish ? 'Name (optional)' : '姓名（可选）'}</span>
                    <input
                        type="text"
                        className="admin-input"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder={walkIn && trimmedEmail === ''
                            ? undefined
                            : (isEnglish ? 'Leave blank to use the email' : '留空则使用邮箱')}
                        maxLength={100}
                        disabled={saving}
                    />
                </label>

                <label className="admin-tickets-template-field">
                    <span>{isEnglish ? 'Ticket count (1–50)' : '门票数量（1–50）'}</span>
                    <input
                        type="number"
                        className="admin-input"
                        value={ticketCount}
                        onChange={(e) => setTicketCount(e.target.value)}
                        min={1}
                        max={50}
                        disabled={saving || hometownLocked}
                    />
                </label>

                {!attendee?.unlisted && (
                    <label className="admin-tickets-template-field">
                        <span>{isEnglish ? 'Ticket Type' : '门票类型'}</span>
                        <select
                            className="admin-input"
                            value={type}
                            onChange={(e) => setType(e.target.value as TicketType)}
                            disabled={saving || hometownLocked}
                        >
                            {TICKET_TYPES.map(t => (
                                <option key={t.value} value={t.value}>
                                    {isEnglish ? t.labelEn : t.labelCn}
                                </option>
                            ))}
                        </select>
                    </label>
                )}

                <label className="admin-tickets-template-field">
                    <span>{isEnglish ? 'Notes (optional)' : '备注（可选）'}</span>
                    <input
                        type="text"
                        className="admin-input"
                        value={notes}
                        onChange={(e) => setNotes(e.target.value)}
                        placeholder={isEnglish ? 'Only staff see this' : '仅工作人员可见'}
                        maxLength={500}
                        disabled={saving}
                    />
                    {originalNotes === null ? (
                        <span className="admin-helper-text">
                            {isEnglish
                                ? 'These tickets have different notes. A note here replaces them all; leave it blank to keep them.'
                                : '这些门票的备注各不相同。在此填写会替换全部备注；留空则保留原备注。'}
                        </span>
                    ) : countValid && parsedCount > 1 && (
                        <span className="admin-helper-text">
                            {isEnglish
                                ? 'Goes on every ticket. To note just one, edit it in the ticket list.'
                                : '将应用于每张门票。如只需备注其中一张，请在门票列表中修改。'}
                        </span>
                    )}
                </label>

                {walkIn && (
                    <label className="admin-checkbox-label admin-tickets-walk-in-check">
                        <input
                            type="checkbox"
                            checked={checkIn}
                            onChange={(e) => setCheckIn(e.target.checked)}
                            disabled={saving}
                        />
                        <span>
                            {isEnglish
                                ? `Check in now (marks ${countValid && parsedCount > 1 ? `all ${parsedCount} tickets` : 'the ticket'} redeemed)`
                                : `立即签到（将${countValid && parsedCount > 1 ? `全部 ${parsedCount} 张门票` : '门票'}标记为已验证）`}
                        </span>
                    </label>
                )}

                {duplicate && walkIn && (
                    <p className="admin-helper-text admin-tickets-edit-warning">
                        {isEnglish
                            ? `This email is already on the list (${duplicate.ticketCount} ticket${duplicate.ticketCount === 1 ? '' : 's'}). Find them under Attendees to check them in.`
                            : `该邮箱已在名单中（${duplicate.ticketCount} 张门票）。请在参加者列表中为其签到。`}
                    </p>
                )}

                {duplicate && !walkIn && (
                    <p className="admin-helper-text admin-tickets-edit-warning">
                        {isEnglish
                            ? `An attendee with this email already exists (${duplicate.name ? `${duplicate.name}, ` : ''}${duplicate.ticketCount} ticket${duplicate.ticketCount === 1 ? '' : 's'}). Saving will re-issue their tickets and reset the email-sent status.`
                            : `该邮箱已存在参加者（${duplicate.name ? `${duplicate.name}，` : ''}${duplicate.ticketCount} 张门票）。保存将重新签发其门票并重置邮件发送状态。`}
                    </p>
                )}

                {hometownLocked && (
                    <p className="admin-helper-text">
                        {attendee?.unlisted
                            ? (isEnglish
                                ? 'A HomeTown ticket keeps its HomeTown number, so it can\'t be re-issued. An import that lists it fills in its type.'
                                : 'HomeTown 门票沿用其 HomeTown 门票号，无法重新签发。之后的导入若包含此票，会补上其类型。')
                            : (isEnglish
                                ? 'A HomeTown ticket keeps its HomeTown number, so it can\'t be re-issued. Change its type from the ticket list.'
                                : 'HomeTown 门票沿用其 HomeTown 门票号，无法重新签发。可在门票列表中修改类型。')}
                    </p>
                )}

                {(countChanged || typeChanged) && (
                    <p className="admin-helper-text admin-tickets-edit-warning">
                        {isEnglish
                            ? 'Changing the count or type will re-issue ALL tickets and reset the email-sent status.'
                            : '修改数量或类型会重新签发所有门票，并重置邮件发送状态。'}
                    </p>
                )}

                <div className="admin-btn-row">
                    <button
                        type="submit"
                        className="admin-toggle-btn admin-toggle-save"
                        disabled={!canSave}
                    >
                        {attendee
                            ? (saving
                                ? (isEnglish ? 'Saving...' : '保存中...')
                                : (isEnglish ? 'Save' : '保存'))
                            : saving
                                ? (isEnglish ? 'Adding...' : '添加中...')
                                : walkIn
                                    ? (checkIn
                                        ? (isEnglish ? 'Add & Check In' : '添加并签到')
                                        : (isEnglish ? 'Add Walk-in' : '添加'))
                                    : (isEnglish ? 'Add Attendee' : '添加参加者')}
                    </button>
                    <button
                        type="button"
                        className="admin-toggle-btn admin-toggle-cancel"
                        onClick={onClose}
                        disabled={saving}
                    >
                        {isEnglish ? 'Cancel' : '取消'}
                    </button>
                </div>
            </form>
        </ModalShell>
    );
}
