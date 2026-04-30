import { useEffect, useRef, useState } from 'react';
import { useLanguage } from '~/components/LanguageContextProvider';
import { callUpdateEventAttendee, functionsErrorCode } from '~/lib/firebase';
import { useModalEffects } from '~/lib/useModalEffects';
import { type AttendeeData, TICKET_TYPES, type TicketType } from './tickets/types';
import type { ShowToast } from './utils';

interface AttendeeEditModalProps {
    eventId: string;
    attendee: AttendeeData;
    onClose: () => void;
    // Name-only edit: optimistic update with the patched attendee.
    // Regenerated edit: ticket UUIDs are minted server-side, so the parent must
    // refetch instead of trusting a placeholder array.
    onSaved: (updated: AttendeeData) => void;
    onRegenerated: () => void;
    showToast: ShowToast;
}

export function AttendeeEditModal({
                                      eventId,
                                      attendee,
                                      onClose,
                                      onSaved,
                                      onRegenerated,
                                      showToast
                                  }: AttendeeEditModalProps) {
    const {isEnglish} = useLanguage();
    const overlayRef = useRef<HTMLDivElement>(null);
    useModalEffects(true, overlayRef);
    const [name, setName] = useState(attendee.name);
    const [ticketCount, setTicketCount] = useState(String(attendee.ticketCount));
    const [type, setType] = useState<TicketType>(attendee.tickets[0]?.type || 'normal');
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape' && !saving) onClose();
        };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, [saving, onClose]);

    const newCount = parseInt(ticketCount, 10);
    const countValid = Number.isInteger(newCount) && newCount >= 1 && newCount <= 50;
    const nameValid = name.trim().length > 0 && name.trim().length <= 100;
    const countChanged = countValid && newCount !== attendee.ticketCount;
    const nameChanged = nameValid && name.trim() !== attendee.name;
    const typeChanged = type !== (attendee.tickets[0]?.type || 'normal');
    const canSave = !saving && nameValid && countValid && (nameChanged || countChanged || typeChanged);

    const save = async () => {
        if (!canSave) return;
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
                attendeeId: attendee.id,
                name: name.trim(),
                ticketCount: newCount,
                type,
            });
            const regenerated = result.data.regenerated;
            if (regenerated) {
                onRegenerated();
            } else {
                onSaved({
                    ...attendee,
                    name: name.trim(),
                    ticketCount: newCount,
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

    return (
        <div ref={overlayRef} className="admin-tickets-preview-modal" onClick={onClose}>
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

                    <label className="admin-tickets-template-field">
                        <span>{isEnglish ? 'Ticket Type' : '门票类型'}</span>
                        <select
                            className="admin-search-input"
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
