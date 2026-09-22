import { useEffect, useMemo, useState } from 'react';
import { useLanguage } from '~/components/LanguageContextProvider';
import { callImportEventAttendees, callUpdateEventAttendee, functionsErrorCode } from '~/lib/firebase';
import { ModalShell } from './ModalShell';
import { type AttendeeData, TICKET_TYPES, type TicketType } from './tickets/types';
import { useAccountLinks } from './tickets/useAccountLinks';
import type { ShowToast } from './utils';

/**
 * How long typing has to settle before the address is looked up. Every callable
 * shares one rate-limit budget, so a lookup per keystroke would spend an admin's
 * whole allowance on a single email field.
 */
const LOOKUP_DEBOUNCE_MS = 600;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface AttendeeModalProps {
    eventId: string;
    /** The attendee to edit, or null to add a new one. */
    attendee: AttendeeData | null;
    /** Add mode: current attendees, for the duplicate-email check. */
    existingAttendees?: AttendeeData[];
    onClose: () => void;
    /** Add mode: called after a successful add (the modal closes itself). */
    onAdded?: () => void;
    // Name-only edit: optimistic update with the patched attendee.
    // Regenerated edit: ticket UUIDs are minted server-side, so the parent must
    // refetch instead of trusting a placeholder array.
    onSaved?: (updated: AttendeeData) => void;
    onRegenerated?: () => void;
    showToast: ShowToast;
}

export function AttendeeModal({
                                  eventId,
                                  attendee,
                                  existingAttendees = [],
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
    const [saving, setSaving] = useState(false);

    const trimmedEmail = email.trim().toLowerCase();
    const trimmedName = name.trim();
    const parsedCount = parseInt(ticketCount, 10);

    const emailValid = EMAIL_RE.test(trimmedEmail);
    const nameValid = trimmedName.length > 0 && trimmedName.length <= 100;
    const countValid = Number.isInteger(parsedCount) && parsedCount >= 1 && parsedCount <= 50;

    // Edit mode: only enable Save once something actually changed.
    const nameChanged = !!attendee && nameValid && trimmedName !== attendee.name;
    const countChanged = !!attendee && countValid && parsedCount !== attendee.ticketCount;
    const typeChanged = !!attendee && type !== originalType;

    // Which address the account lookup is currently asking about. Editing can
    // ask at once — the address is fixed and read-only — while adding waits for
    // the typing to settle.
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
    // undefined while the lookup is out or nothing has been asked; null once it
    // has come back with no account.
    const account = lookupEmail ? accountLinks.get(lookupEmail) : undefined;
    const checkingAccount = !!lookupEmail && account === undefined && !accountLookupFailed;

    // Add mode: warn when the email already has an attendee record.
    const duplicate = useMemo(() => {
        if (attendee || !emailValid) return null;
        return existingAttendees.find(a => a.email.toLowerCase() === trimmedEmail) ?? null;
    }, [attendee, existingAttendees, trimmedEmail, emailValid]);

    const canSave = !saving && nameValid && countValid && (attendee
        ? (nameChanged || countChanged || typeChanged)
        : emailValid);

    const submitAdd = async () => {
        if (duplicate) {
            const ok = window.confirm(isEnglish
                ? `An attendee with email "${trimmedEmail}" already exists. Continuing will re-issue all of their tickets — old QR codes will stop working. Continue?`
                : `邮箱 "${trimmedEmail}" 已存在。继续将重新签发该参加者的所有门票，旧二维码将立即失效。是否继续？`);
            if (!ok) return;
        }
        setSaving(true);
        try {
            const result = await callImportEventAttendees({
                eventId,
                attendees: [{email: trimmedEmail, name: trimmedName, ticketCount: parsedCount, type}],
            });
            const {added, replaced} = result.data;
            showToast(
                added > 0
                    ? (isEnglish ? 'Attendee added.' : '参加者已添加。')
                    : replaced > 0
                        ? (isEnglish ? 'Attendee updated — tickets re-issued.' : '参加者已更新，门票已重新签发。')
                        : (isEnglish ? 'No changes.' : '无更改。'),
                replaced > 0 ? 'warning' : 'success',
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
                onSaved?.({
                    ...existing,
                    name: trimmedName,
                    ticketCount: parsedCount,
                    updatedAt: new Date(),
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
        void (attendee ? submitEdit(attendee) : submitAdd());
    };

    return (
        <ModalShell
            title={attendee
                ? (isEnglish ? 'Edit Attendee' : '编辑参加者')
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
                                : (isEnglish ? 'Email' : '邮箱')}
                        </span>
                    <input
                        type="email"
                        className="admin-input"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="person@example.com"
                        readOnly={!!attendee}
                        disabled={!attendee && saving}
                        autoFocus={!attendee}
                    />
                    {/* Whether this address reaches somebody's profile. A ticket
                        sold to an address with no account still works — it is
                        credited if they sign up with it later — so this is a
                        note, never a reason not to save. */}
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
                                        ? (isEnglish
                                            ? `Registered account: ${account.displayName || account.email}. Their tickets will show on their profile.`
                                            : `已注册账户：${account.displayName || account.email}。门票会显示在其个人主页。`)
                                        : (isEnglish
                                            ? 'No account uses this email yet — the ticket still works, and counts once they sign up with it.'
                                            : '暂无账户使用该邮箱 — 门票照常可用，其以该邮箱注册后即会计入。')}
                        </span>
                    )}
                </label>

                <label className="admin-tickets-template-field">
                    <span>{isEnglish ? 'Name' : '姓名'}</span>
                    <input
                        type="text"
                        className="admin-input"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
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

                {duplicate && (
                    <p className="admin-helper-text admin-tickets-edit-warning">
                        {isEnglish
                            ? `An attendee with this email already exists (${duplicate.name}, ${duplicate.ticketCount} ticket${duplicate.ticketCount === 1 ? '' : 's'}). Saving will re-issue their tickets and reset the email-sent status.`
                            : `该邮箱已存在参加者（${duplicate.name}，${duplicate.ticketCount} 张门票）。保存将重新签发其门票并重置邮件发送状态。`}
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
                        className="admin-toggle-btn admin-toggle-save"
                        onClick={submit}
                        disabled={!canSave}
                    >
                        {attendee
                            ? (saving
                                ? (isEnglish ? 'Saving...' : '保存中...')
                                : (isEnglish ? 'Save' : '保存'))
                            : (saving
                                ? (isEnglish ? 'Adding...' : '添加中...')
                                : (isEnglish ? 'Add Attendee' : '添加参加者'))}
                    </button>
                    <button
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
