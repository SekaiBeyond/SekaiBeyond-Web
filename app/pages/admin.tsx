import { useState } from 'react';
import { arrayRemove, arrayUnion, collection, doc, getDocs, query, updateDoc, where } from 'firebase/firestore';
import {
    canAssignGroup,
    getAssignableGroups,
    GROUP_LABELS,
    hasPermission,
    useAuth,
    type UserGroup,
} from '~/components/AuthProvider';
import { LoginButton } from '~/components/LoginButton';
import { useLanguage } from '~/components/LanguageContextProvider';
import { getFirebaseDb } from '~/lib/firebase';
import { PAST_EVENTS } from '~/constants';

interface UserRecord {
    uid: string;
    displayName: string;
    email: string;
    photoURL: string;
    joinedAt: Date;
    attendedEvents: string[];
    group: UserGroup;
}

type Tab = 'users' | 'events';

export const AdminPage = () => {
    const {user, profile, loading} = useAuth();
    const {isEnglish} = useLanguage();

    const [activeTab, setActiveTab] = useState<Tab>('users');
    const [searchQuery, setSearchQuery] = useState('');
    const [searchResults, setSearchResults] = useState<UserRecord[]>([]);
    const [selectedUser, setSelectedUser] = useState<UserRecord | null>(null);
    const [selectedEvent, setSelectedEvent] = useState<string | null>(null);
    const [eventAttendees, setEventAttendees] = useState<UserRecord[]>([]);
    const [searching, setSearching] = useState(false);
    const [updating, setUpdating] = useState(false);

    if (loading) {
        return (
            <div className="profile-loading">
                <div className="profile-spinner"/>
            </div>
        );
    }

    if (!user || !profile || !hasPermission(profile.group, 'core-staff')) {
        return (
            <div className="profile-login-prompt">
                <div className="profile-login-card">
                    <h2>{isEnglish ? 'Access Denied' : '无权访问'}</h2>
                    <p>{isEnglish ? 'This page is for staff members only.' : '此页面仅限工作人员访问。'}</p>
                    <a href="/" className="profile-back-link">
                        {isEnglish ? 'Back to Home' : '返回首页'}
                    </a>
                </div>
            </div>
        );
    }

    const searchUsers = async () => {
        if (!searchQuery.trim()) return;
        setSearching(true);
        setSelectedUser(null);

        const db = getFirebaseDb();
        const usersRef = collection(db, 'users');
        const q = query(usersRef, where('email', '==', searchQuery.trim().toLowerCase()));
        const snapshot = await getDocs(q);

        const results: UserRecord[] = [];
        snapshot.forEach((docSnap) => {
            const data = docSnap.data();
            results.push({
                uid: docSnap.id,
                displayName: data.displayName ?? '',
                email: data.email ?? '',
                photoURL: data.photoURL ?? '',
                joinedAt: data.joinedAt?.toDate() ?? new Date(),
                attendedEvents: data.attendedEvents ?? [],
                group: data.group ?? 'visitor',
            });
        });

        setSearchResults(results);
        setSearching(false);
    };

    const toggleBadge = async (userRecord: UserRecord, eventTitle: string) => {
        setUpdating(true);
        const db = getFirebaseDb();
        const userRef = doc(db, 'users', userRecord.uid);
        const has = userRecord.attendedEvents.includes(eventTitle);

        await updateDoc(userRef, {
            attendedEvents: has ? arrayRemove(eventTitle) : arrayUnion(eventTitle),
        });

        const updatedEvents = has
            ? userRecord.attendedEvents.filter(e => e !== eventTitle)
            : [...userRecord.attendedEvents, eventTitle];

        const updated = {...userRecord, attendedEvents: updatedEvents};

        if (selectedUser?.uid === userRecord.uid) {
            setSelectedUser(updated);
        }
        setSearchResults(prev => prev.map(u => u.uid === userRecord.uid ? updated : u));
        setEventAttendees(prev => prev.map(u => u.uid === userRecord.uid ? updated : u));
        setUpdating(false);
    };

    const changeUserGroup = async (userRecord: UserRecord, newGroup: UserGroup) => {
        if (!canAssignGroup(profile.group, newGroup)) return;
        setUpdating(true);

        const db = getFirebaseDb();
        const userRef = doc(db, 'users', userRecord.uid);
        await updateDoc(userRef, {group: newGroup});

        const updated = {...userRecord, group: newGroup};
        if (selectedUser?.uid === userRecord.uid) {
            setSelectedUser(updated);
        }
        setSearchResults(prev => prev.map(u => u.uid === userRecord.uid ? updated : u));
        setEventAttendees(prev => prev.map(u => u.uid === userRecord.uid ? updated : u));
        setUpdating(false);
    };

    const loadEventAttendees = async (eventTitle: string) => {
        setSelectedEvent(eventTitle);
        setSearching(true);

        const db = getFirebaseDb();
        const usersRef = collection(db, 'users');
        const q = query(usersRef, where('attendedEvents', 'array-contains', eventTitle));
        const snapshot = await getDocs(q);

        const attendees: UserRecord[] = [];
        snapshot.forEach((docSnap) => {
            const data = docSnap.data();
            attendees.push({
                uid: docSnap.id,
                displayName: data.displayName ?? '',
                email: data.email ?? '',
                photoURL: data.photoURL ?? '',
                joinedAt: data.joinedAt?.toDate() ?? new Date(),
                attendedEvents: data.attendedEvents ?? [],
                group: data.group ?? 'visitor',
            });
        });

        setEventAttendees(attendees);
        setSearching(false);
    };

    const assignableGroups = getAssignableGroups(profile.group);

    return (
        <>
            <nav className="profile-nav">
                <a href="/" className="profile-nav-home">
                    {isEnglish ? 'SEKAI BEYOND' : '彼世界动漫社'}
                </a>
                <span className="admin-nav-title">{isEnglish ? 'Admin Panel' : '管理面板'}</span>
                <LoginButton/>
            </nav>
            <div className="profile-page">

                {/* Tabs */}
                <div className="admin-tabs">
                    <button
                        className={`admin-tab ${activeTab === 'users' ? 'admin-tab-active' : ''}`}
                        onClick={() => setActiveTab('users')}
                    >
                        {isEnglish ? 'User Lookup' : '用户查询'}
                    </button>
                    <button
                        className={`admin-tab ${activeTab === 'events' ? 'admin-tab-active' : ''}`}
                        onClick={() => setActiveTab('events')}
                    >
                        {isEnglish ? 'Event Attendance' : '活动出席'}
                    </button>
                </div>

                {/* User Lookup Tab */}
                {activeTab === 'users' && (
                    <div className="admin-section">
                        <div className="admin-search">
                            <input
                                type="email"
                                placeholder={isEnglish ? 'Search by email address...' : '输入邮箱地址搜索...'}
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                onKeyDown={(e) => e.key === 'Enter' && searchUsers()}
                                className="admin-search-input"
                            />
                            <button onClick={searchUsers} disabled={searching} className="admin-search-btn">
                                {searching
                                    ? (isEnglish ? 'Searching...' : '搜索中...')
                                    : (isEnglish ? 'Search' : '搜索')}
                            </button>
                        </div>

                        {searchResults.length > 0 && !selectedUser && (
                            <div className="admin-results">
                                {searchResults.map((u) => (
                                    <div key={u.uid} className="admin-user-row" onClick={() => setSelectedUser(u)}>
                                        <img src={u.photoURL} alt="" className="admin-user-avatar"
                                             referrerPolicy="no-referrer"/>
                                        <div>
                                            <div className="admin-user-name">{u.displayName}</div>
                                            <div className="admin-user-email">{u.email}</div>
                                        </div>
                                        <span className="admin-user-group-tag" data-group={u.group}>
                                            {isEnglish ? GROUP_LABELS[u.group].en : GROUP_LABELS[u.group].zh}
                                        </span>
                                        <span className="admin-user-badge-count">
                                            {u.attendedEvents.length} {isEnglish ? 'badges' : '徽章'}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        )}

                        {searchResults.length === 0 && !searching && searchQuery && (
                            <p className="admin-no-results">{isEnglish ? 'No users found.' : '未找到用户。'}</p>
                        )}

                        {/* Selected User Detail */}
                        {selectedUser && (
                            <div className="admin-user-detail">
                                <button className="admin-back-btn" onClick={() => setSelectedUser(null)}>
                                    &larr; {isEnglish ? 'Back to results' : '返回结果'}
                                </button>

                                <div className="admin-detail-header">
                                    <img src={selectedUser.photoURL} alt="" className="admin-detail-avatar"
                                         referrerPolicy="no-referrer"/>
                                    <div>
                                        <h3>{selectedUser.displayName}</h3>
                                        <p>{selectedUser.email}</p>
                                        <p className="admin-detail-joined">
                                            {isEnglish ? 'Joined: ' : '加入时间：'}
                                            {selectedUser.joinedAt.toLocaleDateString(isEnglish ? 'en-US' : 'zh-CN', {
                                                year: 'numeric', month: 'long', day: 'numeric',
                                            })}
                                        </p>
                                    </div>
                                </div>

                                {/* User Group Management */}
                                <div className="admin-group-section">
                                    <h4 className="admin-badges-title">
                                        {isEnglish ? 'User Group' : '用户组'}
                                    </h4>
                                    <div className="admin-group-current">
                                        <span className="admin-group-label">
                                            {isEnglish ? 'Current group: ' : '当前用户组：'}
                                        </span>
                                        <span className="admin-user-group-tag" data-group={selectedUser.group}>
                                            {isEnglish ? GROUP_LABELS[selectedUser.group].en : GROUP_LABELS[selectedUser.group].zh}
                                        </span>
                                    </div>
                                    {assignableGroups.length > 0 && (
                                        <div className="admin-group-actions">
                                            {assignableGroups.map((g) => (
                                                <button
                                                    key={g}
                                                    className={`admin-group-btn ${selectedUser.group === g ? 'admin-group-btn-active' : ''}`}
                                                    onClick={() => changeUserGroup(selectedUser, g)}
                                                    disabled={updating || selectedUser.group === g}
                                                >
                                                    {isEnglish ? GROUP_LABELS[g].en : GROUP_LABELS[g].zh}
                                                </button>
                                            ))}
                                        </div>
                                    )}
                                </div>

                                <h4 className="admin-badges-title">
                                    {isEnglish ? 'Event Badges' : '活动徽章'}
                                    <span className="admin-badges-count">
                                    {selectedUser.attendedEvents.length}/{PAST_EVENTS.length}
                                </span>
                                </h4>

                                <div className="admin-badge-list">
                                    {PAST_EVENTS.map((event, i) => {
                                        const has = selectedUser.attendedEvents.includes(event.title);
                                        return (
                                            <div key={i} className={`admin-badge-row ${has ? 'admin-badge-has' : ''}`}>
                                                <img src={event.icon} alt="" className="admin-badge-img"
                                                     loading="lazy"/>
                                                <div className="admin-badge-info">
                                                    <span
                                                        className="admin-badge-name">{isEnglish ? event.title : event.titleCn}</span>
                                                    <span className="admin-badge-date">{event.date}</span>
                                                </div>
                                                <button
                                                    className={`admin-toggle-btn ${has ? 'admin-toggle-revoke' : 'admin-toggle-grant'}`}
                                                    onClick={() => toggleBadge(selectedUser, event.title)}
                                                    disabled={updating}
                                                >
                                                    {has
                                                        ? (isEnglish ? 'Revoke' : '撤销')
                                                        : (isEnglish ? 'Grant' : '授予')}
                                                </button>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        )}
                    </div>
                )}

                {/* Event Attendance Tab */}
                {activeTab === 'events' && (
                    <div className="admin-section">
                        <div className="admin-event-list">
                            {PAST_EVENTS.map((event, i) => (
                                <button
                                    key={i}
                                    className={`admin-event-btn ${selectedEvent === event.title ? 'admin-event-btn-active' : ''}`}
                                    onClick={() => loadEventAttendees(event.title)}
                                >
                                    <img src={event.icon} alt="" className="admin-event-thumb" loading="lazy"/>
                                    <span>{isEnglish ? event.title : event.titleCn}</span>
                                </button>
                            ))}
                        </div>

                        {selectedEvent && (
                            <div className="admin-attendees">
                                <h3>
                                    {selectedEvent}
                                    <span className="admin-attendee-count">
                                    {eventAttendees.length} {isEnglish ? 'attendees' : '人参加'}
                                </span>
                                </h3>
                                {searching && <div className="profile-spinner" style={{margin: '20px auto'}}/>}
                                {!searching && eventAttendees.length === 0 && (
                                    <p className="admin-no-results">{isEnglish ? 'No attendees yet.' : '暂无参加者。'}</p>
                                )}
                                {!searching && eventAttendees.map((u) => (
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
                        )}
                    </div>
                )}
            </div>
        </>
    );
};
