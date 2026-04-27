import { useState } from 'react';
import { callToggleAttendance, functionsErrorCode } from '~/lib/firebase';
import { formatGroupWithTitle } from '~/components/AuthProvider';
import { useLanguage } from '~/components/LanguageContextProvider';
import type { ShowToast } from './utils';
import type { UserRecord } from './types';

interface EventAttendeesListProps {
    loading: boolean;
    attendees: UserRecord[];
    eventId?: string;
    onReload?: () => void | Promise<void>;
    showToast?: ShowToast;
    readOnly?: boolean;
}

export function EventAttendeesList({
                                       loading,
                                       attendees,
                                       eventId,
                                       onReload,
                                       showToast,
                                       readOnly = false,
                                   }: EventAttendeesListProps) {
    const {isEnglish} = useLanguage();
    const [busyUid, setBusyUid] = useState<string | null>(null);
    const canRemove = !readOnly && !!(eventId && onReload && showToast);

    const removeAttendee = async (user: UserRecord) => {
        if (!eventId || !onReload || !showToast) return;
        if (!confirm(isEnglish
            ? `Remove ${user.displayName} from attendees?`
            : `将 ${user.displayName} 从参加者名单中移除？`
        )) return;
        setBusyUid(user.uid);
        try {
            await callToggleAttendance({targetUid: user.uid, eventId, grant: false});
            await onReload();
            showToast(
                isEnglish ? `${user.displayName} removed from attendees.` : `已将 ${user.displayName} 从参加者名单中移除。`,
                'warning',
            );
        } catch (err) {
            const code = functionsErrorCode(err);
            showToast(
                isEnglish
                    ? `Failed to remove attendee${code ? ` (${code})` : ''}.`
                    : `移除失败${code ? `（${code}）` : ''}。`,
                'error',
            );
        } finally {
            setBusyUid(null);
        }
    };

    return (
        <div className="admin-attendees-section">
            {loading && <div className="profile-spinner admin-spinner-center"/>}
            {!loading && attendees.length === 0 && (
                <p className="admin-no-results">{isEnglish ? 'No attendees yet.' : '暂无参加者。'}</p>
            )}
            {!loading && attendees.length > 0 && (
                <p className="admin-attendees-count">
                    {attendees.length} {isEnglish ? 'attendees' : '人参加'}
                </p>
            )}
            {!loading && attendees.map((u) => (
                <div key={u.uid} className="admin-user-row">
                    <img src={u.photoURL} alt="" className="admin-user-avatar"
                         referrerPolicy="no-referrer"/>
                    <div className="admin-user-info">
                        <div className="admin-user-name">{u.displayName}</div>
                        <div className="admin-user-email">{u.email}</div>
                    </div>
                    <span className="admin-user-group-tag" data-group={u.group}>
                        {formatGroupWithTitle(u.group, u.title, isEnglish)}
                    </span>
                    {canRemove && (
                        <button
                            className="admin-toggle-btn admin-toggle-revoke"
                            onClick={() => removeAttendee(u)}
                            disabled={busyUid === u.uid}
                        >
                            {busyUid === u.uid
                                ? (isEnglish ? 'Removing...' : '移除中...')
                                : (isEnglish ? 'Remove' : '移除')}
                        </button>
                    )}
                </div>
            ))}
        </div>
    );
}
