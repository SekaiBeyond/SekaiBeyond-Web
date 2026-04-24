import { useState } from 'react';
import { useLanguage } from '~/components/LanguageContextProvider';
import { callUpdateEventAttendee, functionsErrorCode } from '~/lib/firebase';
import type { AttendeeData } from './tickets/types';
import type { ShowToast } from './utils';

interface AttendeeEditModalProps {
    eventId: string;
    attendee: AttendeeData;
    onClose: () => void;
    onSaved: (updated: AttendeeData) => void;
    showToast: ShowToast;
}

export function AttendeeEditModal({eventId, attendee, onClose, onSaved, showToast}: AttendeeEditModalProps) {
    const {isEnglish} = useLanguage();
    const [name, setName] = useState(attendee.name);
    const [ticketCount, setTicketCount] = useState(String(attendee.ticketCount));
    const [saving, setSaving] = useState(false);

    const newCount = parseInt(ticketCount, 10);
    const countValid = Number.isInteger(newCount) && newCount >= 1 && newCount <= 50;
    const nameValid = name.trim().length > 0 && name.trim().length <= 100;
    const countChanged = countValid && newCount !== attendee.ticketCount;
    const nameChanged = nameValid && name.trim() !== attendee.name;
    const canSave = !saving && nameValid && countValid && (nameChanged || countChanged);

    const save = async () => {
        if (!canSave) return;
        if (countChanged) {
            const ok = window.confirm(isEnglish
                ? 'Changing ticket count will re-issue ALL tickets for this attendee. Old QR codes will stop working. Continue?'
                : '修改门票数量会重新签发该参加者的全部门票，旧二维码将立即失效。是否继续？');
            if (!ok) return;
        }
        setSaving(true);
        try {
            const result = await callUpdateEventAttendee({
                eventId,
                attendeeId: attendee.id,
                name: name.trim(),
                ticketCount: newCount,
            });
            const regenerated = result.data.regenerated;
            const updated: AttendeeData = {
                ...attendee,
                name: name.trim(),
                ticketCount: newCount,
                ...(regenerated ? {
                    tickets: Array.from({length: newCount}, () => ({
                        ticketId: '',
                        redeemed: false,
                        redeemedAt: null,
                        redeemedBy: '',
                        redeemedByName: '',
                        checkedIn: false,
                        checkedInAt: null,
                        voided: false,
                    })),
                    ticketIds: [],
                    emailSent: false,
                    emailSentAt: null,
                } : {}),
                updatedAt: new Date(),
            };
            onSaved(updated);
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

    return (
        <div className="admin-tickets-preview-modal" onClick={onClose}>
            <div
                className="admin-tickets-preview-content"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="admin-tickets-preview-header">
                    <strong>{isEnglish ? 'Edit Attendee' : '编辑参加者'}</strong>
                    <button className="admin-tickets-preview-close" onClick={onClose}>×</button>
                </div>

                <div className="admin-tickets-attendee-edit">
                    <label className="admin-tickets-template-field">
                        <span>{isEnglish ? 'Email (read-only)' : '邮箱（不可修改）'}</span>
                        <input
                            type="email"
                            className="admin-search-input"
                            value={attendee.email}
                            readOnly
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

                    {countChanged && (
                        <p className="admin-helper-text admin-tickets-edit-warning">
                            {isEnglish
                                ? 'Changing the count will re-issue ALL tickets and reset the email-sent status.'
                                : '修改数量会重新签发所有门票，并重置邮件发送状态。'}
                        </p>
                    )}

                    <div className="admin-btn-row">
                        <button
                            className="admin-toggle-btn admin-toggle-save"
                            onClick={save}
                            disabled={!canSave}
                        >
                            {saving
                                ? (isEnglish ? 'Saving...' : '保存中...')
                                : (isEnglish ? 'Save' : '保存')}
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
