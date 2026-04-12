import { GROUP_LABELS } from '~/components/AuthProvider';
import { useLanguage } from '~/components/LanguageContextProvider';
import type { UserRecord } from './types';

interface EventAttendeesListProps {
    loading: boolean;
    attendees: UserRecord[];
}

export function EventAttendeesList({loading, attendees}: EventAttendeesListProps) {
    const {isEnglish} = useLanguage();
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
                    <div>
                        <div className="admin-user-name">{u.displayName}</div>
                        <div className="admin-user-email">{u.email}</div>
                    </div>
                    <span className="admin-user-group-tag" data-group={u.group}>
                        {isEnglish ? GROUP_LABELS[u.group].en : GROUP_LABELS[u.group].zh}
                    </span>
                </div>
            ))}
        </div>
    );
}
