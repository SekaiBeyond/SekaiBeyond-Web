import { useEffect, useMemo, useState } from 'react';
import { useLanguage } from '~/components/LanguageContextProvider';
import {
    callAddWalkInAttendee,
    callImportEventAttendees,
    callUpdateEventAttendee,
    functionsErrorCode,
} from '~/lib/firebase';
import { ModalShell } from './ModalShell';
import { type AttendeeData, TICKET_TYPES, type TicketType } from './tickets/types';
import { useAccountLinks } from './tickets/useAccountLinks';
import type { ShowToast } from './utils';

/**
 * Typing must settle before the lookup: every callable shares one rate-limit
 * budget.
 */
const LOOKUP_DEBOUNCE_MS = 600;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface AttendeeModalProps {
    eventId: string;
    /** The attendee to edit, or null to add a new one. */
    attendee: AttendeeData | null;
    /** Add mode: current attendees, for the duplicate-email check. */
    existingAttendees?: AttendeeData[];
    /**
     * Add mode on the event's days: someone at the door, whose email is optional
     * and who can be checked in as they're added.
     */
    walkIn?: boolean;
    onClose: () => void;
    /** Add mode: called after a successful add (the modal closes itself). */
    onAdded?: () => void;
    // A name-only edit is an optimistic patch to merge. A regenerated edit
    // mints ticket ids server-side, so the parent must refetch.
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
    // On by default: a walk-in is usually standing at the door.
    const [checkIn, setCheckIn] = useState(true);
    const [saving, setSaving] = useState(false);

    const trimmedEmail = email.trim().toLowerCase();
    const trimmedName = name.trim();
    const parsedCount = parseInt(ticketCount, 10);

    const emailValid = EMAIL_RE.test(trimmedEmail);
    // Only a walk-in may go without one.
    const emailOk = emailValid || (walkIn && trimmedEmail === '');
    // Optional: a ticket only needs an email to reach someone.
    const nameValid = trimmedName.length <= 100;
    const countValid = Number.isInteger(parsedCount) && parsedCount >= 1 && parsedCount <= 50;

    // Edit mode: only enable Save once something actually changed.
    const nameChanged = !!attendee && nameValid && trimmedName !== attendee.name;
    const countChanged = !!attendee && countValid && parsedCount !== attendee.ticketCount;
    const typeChanged = !!attendee && type !== originalType;

    // The address being looked up: at once when editing (it's read-only), after
    // typing settles when adding.
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
    // undefined while asking or not asked; null for no account.
    const account = lookupEmail ? accountLinks.get(lookupEmail) : undefined;
    const checkingAccount = !!lookupEmail && account === undefined && !accountLookupFailed;

    // Add mode: warn when the email already has an attendee record.
    const duplicate = useMemo(() => {
        if (attendee || !emailValid) return null;
        return existingAttendees.find(a => a.email.toLowerCase() === trimmedEmail) ?? null;
    }, [attendee, existingAttendees, trimmedEmail, emailValid]);

    // A walk-in's email can't already be on the list: re-issuing would void the
    // tickets that person was sent.
    const canSave = !saving && nameValid && countValid && (attendee
        ? (nameChanged || countChanged || typeChanged)
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
            // Re-issue only what was confirmed above. A duplicate this list didn't
            // know about, added elsewhere since it loaded, is skipped.
            const result = await callImportEventAttendees({
                eventId,
                attendees: [{email: trimmedEmail, name: trimmedName, ticketCount: parsedCount, type}],
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
            });
            const regenerated = result.data.regenerated;
            if (regenerated) {
                onRegenerated?.();
            } else {
                onSaved?.({name: trimmedName, updatedAt: new Date()});
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
                    {/* Whether this address reaches someone's profile. A note
                        only: a ticket without an account still works, and credits
                        them if they sign up with it. */}
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
                                                {/* uid only comes back for core staff. */}
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
                        disabled={saving}
                    />
                </label>

                <label className="admin-tickets-template-field">
                    <span>{isEnglish ? 'Ticket Type' : '门票类型'}</span>
                    <select
                        className="admin-input"
                        value={type}
                        onChange={(e) => setType(e.target.value as TicketType)}
                        disabled={saving}
                    >
                        {TICKET_TYPES.map(t => (
                            <option key={t.value} value={t.value}>
                                {isEnglish ? t.labelEn : t.labelCn}
                            </option>
                        ))}
                    </select>
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
