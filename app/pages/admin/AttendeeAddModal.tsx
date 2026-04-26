import { useMemo, useState } from 'react';
import { useLanguage } from '~/components/LanguageContextProvider';
import { callImportEventAttendees, functionsErrorCode } from '~/lib/firebase';
import type { AttendeeData } from './tickets/types';
import type { ShowToast } from './utils';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface AttendeeAddModalProps {
    eventId: string;
    existingAttendees: AttendeeData[];
    onClose: () => void;
    onAdded: () => void;
    showToast: ShowToast;
}

export function AttendeeAddModal({
                                     eventId, existingAttendees, onClose, onAdded, showToast,
                                 }: AttendeeAddModalProps) {
    const {isEnglish} = useLanguage();
    const [email, setEmail] = useState('');
    const [name, setName] = useState('');
    const [ticketCount, setTicketCount] = useState('1');
    const [saving, setSaving] = useState(false);

    const trimmedEmail = email.trim().toLowerCase();
    const trimmedName = name.trim();
    const parsedCount = parseInt(ticketCount, 10);

    const emailValid = EMAIL_RE.test(trimmedEmail);
    const nameValid = trimmedName.length > 0 && trimmedName.length <= 100;
    const countValid = Number.isInteger(parsedCount) && parsedCount >= 1 && parsedCount <= 50;

    const duplicate = useMemo(() => {
        if (!emailValid) return null;
        return existingAttendees.find(a => a.email.toLowerCase() === trimmedEmail) ?? null;
    }, [existingAttendees, trimmedEmail, emailValid]);

    const canSave = !saving && emailValid && nameValid && countValid;

    const submit = async () => {
        if (!canSave) return;
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
                attendees: [{email: trimmedEmail, name: trimmedName, ticketCount: parsedCount}],
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
            onAdded();
            onClose();
        } catch (err) {
            const code = functionsErrorCode(err);
            const msg = code === 'has-staff'
                ? (isEnglish
                    ? `${trimmedEmail} is event staff for this event. Remove them as staff before adding as an attendee.`
                    : `${trimmedEmail} 是该活动的工作人员，请先撤销其工作人员身份再添加为参加者。`)
                : (isEnglish
                    ? `Failed to add attendee${code ? ` (${code})` : ''}.`
                    : `添加参加者失败${code ? `（${code}）` : ''}。`);
            showToast(msg, 'error');
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="admin-tickets-preview-modal" onClick={onClose}>
            <div
                className="admin-tickets-preview-content"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="admin-tickets-preview-header">
                    <strong>{isEnglish ? 'Add Attendee' : '添加参加者'}</strong>
                    <button className="admin-tickets-preview-close" onClick={onClose}>×</button>
                </div>

                <div className="admin-tickets-attendee-edit">
                    <label className="admin-tickets-template-field">
                        <span>{isEnglish ? 'Email' : '邮箱'}</span>
                        <input
                            type="email"
                            className="admin-search-input"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            placeholder="person@example.com"
                            disabled={saving}
                            autoFocus
                        />
                    </label>

                    <label className="admin-tickets-template-field">
                        <span>{isEnglish ? 'Name' : '姓名'}</span>
                        <input
                            type="text"
                            className="admin-search-input"
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
                            className="admin-search-input"
                            value={ticketCount}
                            onChange={(e) => setTicketCount(e.target.value)}
                            min={1}
                            max={50}
                            disabled={saving}
                        />
                    </label>

                    {duplicate && (
                        <p className="admin-helper-text admin-tickets-edit-warning">
                            {isEnglish
                                ? `An attendee with this email already exists (${duplicate.name}, ${duplicate.ticketCount} ticket${duplicate.ticketCount === 1 ? '' : 's'}). Saving will re-issue their tickets and reset the email-sent status.`
                                : `该邮箱已存在参加者（${duplicate.name}，${duplicate.ticketCount} 张门票）。保存将重新签发其门票并重置邮件发送状态。`}
                        </p>
                    )}

                    <div className="admin-btn-row">
                        <button
                            className="admin-toggle-btn admin-toggle-save"
                            onClick={submit}
                            disabled={!canSave}
                        >
                            {saving
                                ? (isEnglish ? 'Adding...' : '添加中...')
                                : (isEnglish ? 'Add Attendee' : '添加参加者')}
                        </button>
                        <button
                            className="admin-toggle-btn admin-toggle-cancel"
                            onClick={onClose}
                            disabled={saving}
                        >
                            {isEnglish ? 'Cancel' : '取消'}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
