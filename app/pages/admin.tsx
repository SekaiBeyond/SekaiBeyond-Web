import { useState } from 'react';
import {
    addDoc,
    arrayRemove,
    arrayUnion,
    collection,
    deleteDoc,
    doc,
    getDocs,
    query,
    serverTimestamp,
    updateDoc,
    where
} from 'firebase/firestore';
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
import { QRCodeSVG } from 'qrcode.react';

interface BadgeCode {
    id: string;
    code: string;
    eventTitle: string;
    active: boolean;
    activeFrom: string | null;
    activeUntil: string | null;
}

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
    const [eventAttendees, setEventAttendees] = useState<UserRecord[]>([]);
    const [searching, setSearching] = useState(false);
    const [updating, setUpdating] = useState(false);
    const [badgeCodes, setBadgeCodes] = useState<BadgeCode[]>([]);
    const [managedEvent, setManagedEvent] = useState<string | null>(null);
    const [eventSubTab, setEventSubTab] = useState<'codes' | 'attendees'>('codes');
    const [generatingCode, setGeneratingCode] = useState(false);
    const [newCodeFrom, setNewCodeFrom] = useState('');
    const [newCodeUntil, setNewCodeUntil] = useState('');

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

    const selectManagedEvent = async (eventTitle: string) => {
        setManagedEvent(eventTitle);
        setEventSubTab('codes');
        setBadgeCodes([]);
        setEventAttendees([]);
        await loadBadgeCodes(eventTitle);
    };

    const loadEventAttendees = async (eventTitle: string) => {
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

    const loadBadgeCodes = async (eventTitle: string) => {
        const db = getFirebaseDb();
        const codesRef = collection(db, 'badgeCodes');
        const q = query(codesRef, where('eventTitle', '==', eventTitle));
        const snapshot = await getDocs(q);

        const codes: BadgeCode[] = [];
        snapshot.forEach((docSnap) => {
            const data = docSnap.data();
            codes.push({
                id: docSnap.id,
                code: data.code,
                eventTitle: data.eventTitle,
                active: data.active ?? true,
                activeFrom: data.activeFrom ?? null,
                activeUntil: data.activeUntil ?? null,
            });
        });
        setBadgeCodes(codes);
    };

    const generateBadgeCode = async (eventTitle: string) => {
        if (!user) return;
        setGeneratingCode(true);

        const code = crypto.randomUUID().replace(/-/g, '').slice(0, 12);
        const activeFrom = newCodeFrom || null;
        const activeUntil = newCodeUntil || null;
        const db = getFirebaseDb();
        const docRef = await addDoc(collection(db, 'badgeCodes'), {
            code,
            eventTitle,
            createdBy: user.uid,
            createdAt: serverTimestamp(),
            active: true,
            activeFrom,
            activeUntil,
        });

        setBadgeCodes(prev => [...prev, {id: docRef.id, code, eventTitle, active: true, activeFrom, activeUntil}]);
        setNewCodeFrom('');
        setNewCodeUntil('');
        setGeneratingCode(false);
    };

    const toggleCodeActive = async (codeDoc: BadgeCode) => {
        const db = getFirebaseDb();
        await updateDoc(doc(db, 'badgeCodes', codeDoc.id), {active: !codeDoc.active});
        setBadgeCodes(prev => prev.map(c => c.id === codeDoc.id ? {...c, active: !c.active} : c));
    };

    const deleteBadgeCode = async (codeDoc: BadgeCode) => {
        const db = getFirebaseDb();
        await deleteDoc(doc(db, 'badgeCodes', codeDoc.id));
        setBadgeCodes(prev => prev.filter(c => c.id !== codeDoc.id));
    };

    const getClaimUrl = (code: string) => {
        return `${window.location.origin}/claim?code=${code}`;
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
                        {isEnglish ? 'Event Management' : '活动管理'}
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

                {/* Event Management Tab */}
                {activeTab === 'events' && (
                    <div className="admin-section">
                        {!managedEvent ? (
                            <div className="admin-event-grid">
                                {PAST_EVENTS.map((event, i) => (
                                    <button
                                        key={i}
                                        className="admin-event-card"
                                        onClick={() => selectManagedEvent(event.title)}
                                    >
                                        <img src={event.icon} alt="" className="admin-event-card-img" loading="lazy"/>
                                        <div className="admin-event-card-info">
                                            <span
                                                className="admin-event-card-title">{isEnglish ? event.title : event.titleCn}</span>
                                            <span className="admin-event-card-date">{event.date}</span>
                                        </div>
                                    </button>
                                ))}
                            </div>
                        ) : (
                            <div className="admin-event-detail">
                                <button className="admin-back-btn" onClick={() => setManagedEvent(null)}>
                                    &larr; {isEnglish ? 'All Events' : '所有活动'}
                                </button>

                                {(() => {
                                    const evt = PAST_EVENTS.find(e => e.title === managedEvent);
                                    if (!evt) return null;
                                    return (
                                        <div className="admin-event-detail-header">
                                            <img src={evt.icon} alt="" className="admin-event-detail-img"/>
                                            <div>
                                                <h3>{isEnglish ? evt.title : evt.titleCn}</h3>
                                                <p className="admin-event-detail-meta">
                                                    <span>{isEnglish ? evt.badge : evt.badgeCn}</span>
                                                    <span>{evt.date}</span>
                                                    <span>{evt.location}</span>
                                                </p>
                                            </div>
                                        </div>
                                    );
                                })()}

                                <div className="admin-sub-tabs">
                                    <button
                                        className={`admin-sub-tab ${eventSubTab === 'codes' ? 'admin-sub-tab-active' : ''}`}
                                        onClick={() => setEventSubTab('codes')}
                                    >
                                        {isEnglish ? 'Claim Codes' : '兑换码'}
                                    </button>
                                    <button
                                        className={`admin-sub-tab ${eventSubTab === 'attendees' ? 'admin-sub-tab-active' : ''}`}
                                        onClick={() => {
                                            setEventSubTab('attendees');
                                            if (eventAttendees.length === 0) loadEventAttendees(managedEvent);
                                        }}
                                    >
                                        {isEnglish ? 'Attendees' : '参加者'}
                                        {eventAttendees.length > 0 && (
                                            <span className="admin-sub-tab-count">{eventAttendees.length}</span>
                                        )}
                                    </button>
                                </div>

                                {/* Claim Codes Sub-Tab */}
                                {eventSubTab === 'codes' && (
                                    <div className="admin-codes-section">
                                        <div className="admin-code-time-inputs">
                                            <label>
                                                <span>{isEnglish ? 'Active from' : '开始时间'}</span>
                                                <input
                                                    type="datetime-local"
                                                    value={newCodeFrom}
                                                    onChange={(e) => setNewCodeFrom(e.target.value)}
                                                    className="admin-datetime-input"
                                                />
                                            </label>
                                            <label>
                                                <span>{isEnglish ? 'Active until' : '结束时间'}</span>
                                                <input
                                                    type="datetime-local"
                                                    value={newCodeUntil}
                                                    onChange={(e) => setNewCodeUntil(e.target.value)}
                                                    className="admin-datetime-input"
                                                />
                                            </label>
                                            <p className="admin-time-hint">
                                                {isEnglish ? 'Leave empty for no time limit.' : '留空表示不限时间。'}
                                            </p>
                                        </div>

                                        <button
                                            className="admin-generate-btn"
                                            onClick={() => generateBadgeCode(managedEvent)}
                                            disabled={generatingCode}
                                        >
                                            {generatingCode
                                                ? (isEnglish ? 'Generating...' : '生成中...')
                                                : (isEnglish ? '+ New Claim Code' : '+ 新建兑换码')}
                                        </button>

                                        {badgeCodes.length === 0 && (
                                            <p className="admin-no-results">
                                                {isEnglish ? 'No claim codes yet. Generate one above.' : '暂无兑换码，点击上方按钮生成。'}
                                            </p>
                                        )}

                                        {badgeCodes.map((bc) => (
                                            <div key={bc.id}
                                                 className={`admin-code-card ${bc.active ? '' : 'admin-code-inactive'}`}>
                                                <div className="admin-code-qr">
                                                    <QRCodeSVG value={getClaimUrl(bc.code)} size={160} level="M"/>
                                                </div>
                                                <div className="admin-code-details">
                                                    <div className="admin-code-url">
                                                        <input
                                                            readOnly
                                                            value={getClaimUrl(bc.code)}
                                                            onClick={(e) => (e.target as HTMLInputElement).select()}
                                                            className="admin-code-input"
                                                        />
                                                        <button
                                                            className="admin-copy-btn"
                                                            onClick={() => navigator.clipboard.writeText(getClaimUrl(bc.code))}
                                                        >
                                                            {isEnglish ? 'Copy' : '复制'}
                                                        </button>
                                                    </div>
                                                    <div className="admin-code-status">
                                                        <span
                                                            className={bc.active ? 'admin-code-active-tag' : 'admin-code-inactive-tag'}>
                                                            {bc.active
                                                                ? (isEnglish ? 'Active' : '启用')
                                                                : (isEnglish ? 'Disabled' : '已停用')}
                                                        </span>
                                                        {(bc.activeFrom || bc.activeUntil) && (
                                                            <span className="admin-code-time-range">
                                                                {bc.activeFrom && (
                                                                    <span>{isEnglish ? 'From: ' : '开始：'}{new Date(bc.activeFrom).toLocaleString()}</span>
                                                                )}
                                                                {bc.activeUntil && (
                                                                    <span>{isEnglish ? 'Until: ' : '截止：'}{new Date(bc.activeUntil).toLocaleString()}</span>
                                                                )}
                                                            </span>
                                                        )}
                                                    </div>
                                                    <div className="admin-code-actions">
                                                        <button
                                                            className="admin-toggle-btn admin-toggle-small"
                                                            onClick={() => toggleCodeActive(bc)}
                                                        >
                                                            {bc.active
                                                                ? (isEnglish ? 'Disable' : '停用')
                                                                : (isEnglish ? 'Enable' : '启用')}
                                                        </button>
                                                        <button
                                                            className="admin-toggle-btn admin-toggle-revoke admin-toggle-small"
                                                            onClick={() => deleteBadgeCode(bc)}
                                                        >
                                                            {isEnglish ? 'Delete' : '删除'}
                                                        </button>
                                                    </div>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}

                                {/* Attendees Sub-Tab */}
                                {eventSubTab === 'attendees' && (
                                    <div className="admin-attendees-section">
                                        {searching && <div className="profile-spinner" style={{margin: '20px auto'}}/>}
                                        {!searching && eventAttendees.length === 0 && (
                                            <p className="admin-no-results">{isEnglish ? 'No attendees yet.' : '暂无参加者。'}</p>
                                        )}
                                        {!searching && eventAttendees.length > 0 && (
                                            <p className="admin-attendees-count">
                                                {eventAttendees.length} {isEnglish ? 'attendees' : '人参加'}
                                            </p>
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
                )}
            </div>
        </>
    );
};
