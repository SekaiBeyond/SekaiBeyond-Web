import { useEffect, useState } from 'react';
import {
    addDoc,
    arrayRemove,
    arrayUnion,
    collection,
    deleteDoc,
    doc,
    getDoc,
    getDocs,
    limit,
    orderBy,
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
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import { getFirebaseDb, getFirebaseStorage } from '~/lib/firebase';
import { LanguageSwitcher } from '~/components/LanguageSwitcher';
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

interface BadgeDef {
    id: string;
    name: string;
    nameCn: string;
    description: string;
    descriptionCn: string;
    imageUrl: string;
    createdBy: string;
    createdAt: Date;
}

interface UserRecord {
    uid: string;
    displayName: string;
    email: string;
    photoURL: string;
    joinedAt: Date;
    attendedEvents: string[];
    badges: string[];
    group: UserGroup;
}

type Tab = 'users' | 'events' | 'badges' | 'records';

type RecordType = 'group-assign' | 'code-create' | 'badge-grant' | 'badge-revoke' | 'achievement-grant' | 'achievement-revoke';

interface ActivityRecord {
    id: string;
    type: RecordType;
    performedBy: string;
    performedByName: string;
    targetUid?: string;
    targetName?: string;
    eventTitle?: string;
    badgeId?: string;
    badgeName?: string;
    code?: string;
    oldGroup?: UserGroup;
    newGroup?: UserGroup;
    timestamp: Date;
}

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
    const [recentUsers, setRecentUsers] = useState<UserRecord[]>([]);
    const [loadingRecent, setLoadingRecent] = useState(false);
    const [records, setRecords] = useState<ActivityRecord[]>([]);
    const [loadingRecords, setLoadingRecords] = useState(false);
    const [badgeDefs, setBadgeDefs] = useState<BadgeDef[]>([]);
    const [loadingBadgeDefs, setLoadingBadgeDefs] = useState(false);
    const [selectedBadgeDef, setSelectedBadgeDef] = useState<BadgeDef | null>(null);
    const [badgeHolders, setBadgeHolders] = useState<UserRecord[]>([]);
    const [loadingBadgeHolders, setLoadingBadgeHolders] = useState(false);
    const [showCreateBadge, setShowCreateBadge] = useState(false);
    const [newBadgeName, setNewBadgeName] = useState('');
    const [newBadgeNameCn, setNewBadgeNameCn] = useState('');
    const [newBadgeDesc, setNewBadgeDesc] = useState('');
    const [newBadgeDescCn, setNewBadgeDescCn] = useState('');
    const [newBadgeImage, setNewBadgeImage] = useState<File | null>(null);
    const [newBadgeImagePreview, setNewBadgeImagePreview] = useState<string | null>(null);
    const [creatingBadgeDef, setCreatingBadgeDef] = useState(false);

    useEffect(() => {
        if (loading || !user || !profile || !hasPermission(profile.group, 'core-staff')) return;
        const loadRecentUsers = async () => {
            setLoadingRecent(true);
            const db = getFirebaseDb();
            const usersRef = collection(db, 'users');
            const q = query(usersRef, orderBy('joinedAt', 'desc'), limit(10));
            const snapshot = await getDocs(q);

            const users: UserRecord[] = [];
            snapshot.forEach((docSnap) => {
                const data = docSnap.data();
                users.push({
                    uid: docSnap.id,
                    displayName: data.displayName ?? '',
                    email: data.email ?? '',
                    photoURL: data.photoURL ?? '',
                    joinedAt: data.joinedAt?.toDate() ?? new Date(),
                    attendedEvents: data.attendedEvents ?? [],
                    badges: data.badges ?? [],
                    group: data.group ?? 'visitor',
                });
            });
            setRecentUsers(users);
            setLoadingRecent(false);
        };
        const loadBadgeDefinitions = async () => {
            setLoadingBadgeDefs(true);
            const db = getFirebaseDb();
            const snapshot = await getDocs(collection(db, 'badges'));
            const defs: BadgeDef[] = [];
            snapshot.forEach(docSnap => {
                const data = docSnap.data();
                defs.push({
                    id: docSnap.id,
                    name: data.name ?? '',
                    nameCn: data.nameCn ?? '',
                    description: data.description ?? '',
                    descriptionCn: data.descriptionCn ?? '',
                    imageUrl: data.imageUrl ?? '',
                    createdBy: data.createdBy ?? '',
                    createdAt: data.createdAt?.toDate() ?? new Date(),
                });
            });
            setBadgeDefs(defs);
            setLoadingBadgeDefs(false);
        };
        loadRecentUsers();
        loadBadgeDefinitions();
    }, [loading, user, profile]);

    const loadRecords = async () => {
        setLoadingRecords(true);
        const db = getFirebaseDb();
        const q = query(collection(db, 'records'), orderBy('timestamp', 'desc'), limit(20));
        const snapshot = await getDocs(q);

        const items: ActivityRecord[] = [];
        snapshot.forEach((docSnap) => {
            const data = docSnap.data();
            items.push({
                id: docSnap.id,
                type: data.type,
                performedBy: data.performedBy,
                performedByName: data.performedByName ?? '',
                targetUid: data.targetUid,
                targetName: data.targetName,
                eventTitle: data.eventTitle,
                badgeId: data.badgeId,
                badgeName: data.badgeName,
                code: data.code,
                oldGroup: data.oldGroup,
                newGroup: data.newGroup,
                timestamp: data.timestamp?.toDate() ?? new Date(),
            });
        });
        setRecords(items);
        setLoadingRecords(false);
    };

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

    const lookupUserByUid = async (uid: string) => {
        const db = getFirebaseDb();
        const userSnap = await getDoc(doc(db, 'users', uid));
        if (!userSnap.exists()) return;
        const data = userSnap.data();
        const userRecord: UserRecord = {
            uid: userSnap.id,
            displayName: data.displayName ?? '',
            email: data.email ?? '',
            photoURL: data.photoURL ?? '',
            joinedAt: data.joinedAt?.toDate() ?? new Date(),
            attendedEvents: data.attendedEvents ?? [],
            badges: data.badges ?? [],
            group: data.group ?? 'visitor',
        };
        setSelectedUser(userRecord);
        setSearchResults([]);
        setSearchQuery('');
        setActiveTab('users');
    };

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
                badges: data.badges ?? [],
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

        await addDoc(collection(db, 'records'), {
            type: has ? 'badge-revoke' : 'badge-grant',
            performedBy: user.uid,
            performedByName: profile.displayName,
            targetUid: userRecord.uid,
            targetName: userRecord.displayName,
            eventTitle,
            timestamp: serverTimestamp(),
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

        await addDoc(collection(db, 'records'), {
            type: 'group-assign',
            performedBy: user.uid,
            performedByName: profile.displayName,
            targetUid: userRecord.uid,
            targetName: userRecord.displayName,
            oldGroup: userRecord.group,
            newGroup,
            timestamp: serverTimestamp(),
        });

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
                badges: data.badges ?? [],
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

        await addDoc(collection(db, 'records'), {
            type: 'code-create',
            performedBy: user.uid,
            performedByName: profile.displayName,
            eventTitle,
            code,
            timestamp: serverTimestamp(),
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

    const updateBadgeImage = async (bd: BadgeDef, file: File) => {
        setUpdating(true);
        const imageId = crypto.randomUUID();
        const storageRef = ref(getFirebaseStorage(), `badges/${imageId}`);
        await uploadBytes(storageRef, file);
        const imageUrl = await getDownloadURL(storageRef);

        const db = getFirebaseDb();
        await updateDoc(doc(db, 'badges', bd.id), { imageUrl });

        const updated = { ...bd, imageUrl };
        setBadgeDefs(prev => prev.map(d => d.id === bd.id ? updated : d));
        if (selectedBadgeDef?.id === bd.id) {
            setSelectedBadgeDef(updated);
        }
        setUpdating(false);
    };

    const createBadgeDef = async () => {
        if (!user) return;
        setCreatingBadgeDef(true);

        let imageUrl = '/images/mika.png';
        if (newBadgeImage) {
            const imageId = crypto.randomUUID();
            const storageRef = ref(getFirebaseStorage(), `badges/${imageId}`);
            await uploadBytes(storageRef, newBadgeImage);
            imageUrl = await getDownloadURL(storageRef);
        }

        const db = getFirebaseDb();
        const docRef = await addDoc(collection(db, 'badges'), {
            name: newBadgeName.trim(),
            nameCn: newBadgeNameCn.trim(),
            description: newBadgeDesc.trim(),
            descriptionCn: newBadgeDescCn.trim(),
            imageUrl,
            createdBy: user.uid,
            createdAt: serverTimestamp(),
        });

        setBadgeDefs(prev => [...prev, {
            id: docRef.id,
            name: newBadgeName.trim(),
            nameCn: newBadgeNameCn.trim(),
            description: newBadgeDesc.trim(),
            descriptionCn: newBadgeDescCn.trim(),
            imageUrl,
            createdBy: user.uid,
            createdAt: new Date(),
        }]);

        setNewBadgeName('');
        setNewBadgeNameCn('');
        setNewBadgeDesc('');
        setNewBadgeDescCn('');
        setNewBadgeImage(null);
        setNewBadgeImagePreview(null);
        setShowCreateBadge(false);
        setCreatingBadgeDef(false);
    };

    const deleteBadgeDef = async (bd: BadgeDef) => {
        const db = getFirebaseDb();
        await deleteDoc(doc(db, 'badges', bd.id));
        setBadgeDefs(prev => prev.filter(d => d.id !== bd.id));
        setSelectedBadgeDef(null);
    };

    const selectBadgeDef = async (bd: BadgeDef) => {
        setSelectedBadgeDef(bd);
        setLoadingBadgeHolders(true);
        const db = getFirebaseDb();
        const usersRef = collection(db, 'users');
        const q = query(usersRef, where('badges', 'array-contains', bd.id));
        const snapshot = await getDocs(q);

        const holders: UserRecord[] = [];
        snapshot.forEach(docSnap => {
            const data = docSnap.data();
            holders.push({
                uid: docSnap.id,
                displayName: data.displayName ?? '',
                email: data.email ?? '',
                photoURL: data.photoURL ?? '',
                joinedAt: data.joinedAt?.toDate() ?? new Date(),
                attendedEvents: data.attendedEvents ?? [],
                badges: data.badges ?? [],
                group: data.group ?? 'visitor',
            });
        });
        setBadgeHolders(holders);
        setLoadingBadgeHolders(false);
    };

    const toggleUserBadge = async (userRecord: UserRecord, badgeId: string, badgeName: string) => {
        setUpdating(true);
        const db = getFirebaseDb();
        const userRef = doc(db, 'users', userRecord.uid);
        const has = userRecord.badges.includes(badgeId);

        await updateDoc(userRef, {
            badges: has ? arrayRemove(badgeId) : arrayUnion(badgeId),
        });

        await addDoc(collection(db, 'records'), {
            type: has ? 'achievement-revoke' : 'achievement-grant',
            performedBy: user.uid,
            performedByName: profile.displayName,
            targetUid: userRecord.uid,
            targetName: userRecord.displayName,
            badgeId,
            badgeName,
            timestamp: serverTimestamp(),
        });

        const updatedBadges = has
            ? userRecord.badges.filter(id => id !== badgeId)
            : [...userRecord.badges, badgeId];

        const updated = {...userRecord, badges: updatedBadges};

        if (selectedUser?.uid === userRecord.uid) {
            setSelectedUser(updated);
        }
        setSearchResults(prev => prev.map(u => u.uid === userRecord.uid ? updated : u));
        setUpdating(false);
    };

    const assignableGroups = getAssignableGroups(profile.group);

    const clickableName = (uid: string, name: string) => (
        <span className="record-clickable-name" onClick={() => lookupUserByUid(uid)}>{name}</span>
    );

    const clickableBadge = (badgeId: string, badgeName: string) => {
        const bd = badgeDefs.find(d => d.id === badgeId);
        if (!bd) return <span>{badgeName}</span>;
        return (
            <span className="record-clickable-name" onClick={() => {
                setActiveTab('badges');
                selectBadgeDef(bd);
            }}>{badgeName}</span>
        );
    };

    const getRecordLabel = (r: ActivityRecord) => {
        const target = r.targetUid ? clickableName(r.targetUid, r.targetName ?? '') : r.targetName;
        switch (r.type) {
            case 'group-assign':
                return isEnglish
                    ? <>assigned {target} from {GROUP_LABELS[r.oldGroup!].en} to {GROUP_LABELS[r.newGroup!].en}</>
                    : <>将 {target} 从 {GROUP_LABELS[r.oldGroup!].zh} 改为 {GROUP_LABELS[r.newGroup!].zh}</>;
            case 'code-create':
                return isEnglish
                    ? <>created claim code for {r.eventTitle}</>
                    : <>为 {r.eventTitle} 创建了兑换码</>;
            case 'badge-grant':
                return isEnglish
                    ? <>marked {target} as attended {r.eventTitle}</>
                    : <>标记 {target} 参加了 {r.eventTitle}</>;
            case 'badge-revoke':
                return isEnglish
                    ? <>revoked {target}'s attendance for {r.eventTitle}</>
                    : <>撤销了 {target} 的 {r.eventTitle} 签到</>;
            case 'achievement-grant': {
                const badge = r.badgeId ? clickableBadge(r.badgeId, r.badgeName ?? '') : r.badgeName;
                return isEnglish
                    ? <>granted {badge} badge to {target}</>
                    : <>授予 {target} {badge} 徽章</>;
            }
            case 'achievement-revoke': {
                const badge = r.badgeId ? clickableBadge(r.badgeId, r.badgeName ?? '') : r.badgeName;
                return isEnglish
                    ? <>revoked {badge} badge from {target}</>
                    : <>撤销了 {target} 的 {badge} 徽章</>;
            }
        }
    };

    const getRecordTypeTag = (type: RecordType) => {
        switch (type) {
            case 'group-assign':
                return isEnglish ? 'Group' : '用户组';
            case 'code-create':
                return isEnglish ? 'Code' : '兑换码';
            case 'badge-grant':
                return isEnglish ? 'Attend' : '签到';
            case 'badge-revoke':
                return isEnglish ? 'Attend' : '签到';
            case 'achievement-grant':
                return isEnglish ? 'Badge' : '徽章';
            case 'achievement-revoke':
                return isEnglish ? 'Badge' : '徽章';
        }
    };

    return (
        <>
            <nav className="profile-nav">
                <a href="/" className="profile-nav-home">
                    {isEnglish ? 'SEKAI BEYOND' : '彼世界动漫社'}
                </a>
                <span className="admin-nav-title">{isEnglish ? 'Admin Panel' : '管理面板'}</span>
                <div className="nav-actions">
                    <LanguageSwitcher/>
                    <LoginButton/>
                </div>
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
                    <button
                        className={`admin-tab ${activeTab === 'badges' ? 'admin-tab-active' : ''}`}
                        onClick={() => setActiveTab('badges')}
                    >
                        {isEnglish ? 'Badges' : '徽章'}
                    </button>
                    <button
                        className={`admin-tab ${activeTab === 'records' ? 'admin-tab-active' : ''}`}
                        onClick={() => {
                            setActiveTab('records');
                            loadRecords();
                        }}
                    >
                        {isEnglish ? 'Records' : '操作记录'}
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
                                            {u.attendedEvents.length} {isEnglish ? 'events' : '活动'}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        )}

                        {searchResults.length === 0 && !searching && searchQuery && (
                            <p className="admin-no-results">{isEnglish ? 'No users found.' : '未找到用户。'}</p>
                        )}

                        {/* Recent Users */}
                        {!selectedUser && searchResults.length === 0 && (
                            <div className="admin-recent-users">
                                <h4 className="admin-badges-title">
                                    {isEnglish ? 'Recent Users' : '最近加入的用户'}
                                </h4>
                                {loadingRecent && <div className="profile-spinner" style={{margin: '20px auto'}}/>}
                                {!loadingRecent && recentUsers.map((u) => (
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
                                        <span className="admin-detail-joined">
                                            {u.joinedAt.toLocaleDateString(isEnglish ? 'en-US' : 'zh-CN', {
                                                year: 'numeric', month: 'short', day: 'numeric',
                                            })}
                                        </span>
                                    </div>
                                ))}
                            </div>
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

                                {badgeDefs.length > 0 && (
                                    <>
                                        <h4 className="admin-badges-title">
                                            {isEnglish ? 'Badges' : '徽章'}
                                            <span className="admin-badges-count">
                                                {selectedUser.badges.filter(id => badgeDefs.some(bd => bd.id === id)).length}/{badgeDefs.length}
                                            </span>
                                        </h4>

                                        <div className="admin-badge-list">
                                            {badgeDefs.map((bd) => {
                                                const has = selectedUser.badges.includes(bd.id);
                                                return (
                                                    <div key={bd.id}
                                                         className={`admin-badge-row ${has ? 'admin-badge-has' : ''}`}>
                                                        <img src={bd.imageUrl} alt="" className="admin-badge-img"
                                                             loading="lazy"/>
                                                        <div className="admin-badge-info">
                                                            <span
                                                                className="admin-badge-name">{isEnglish ? bd.name : bd.nameCn}</span>
                                                            <span
                                                                className="admin-badge-date">{isEnglish ? bd.description : bd.descriptionCn}</span>
                                                        </div>
                                                        <button
                                                            className={`admin-toggle-btn ${has ? 'admin-toggle-revoke' : 'admin-toggle-grant'}`}
                                                            onClick={() => toggleUserBadge(selectedUser, bd.id, isEnglish ? bd.name : bd.nameCn)}
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
                                    </>
                                )}

                                <h4 className="admin-badges-title">
                                    {isEnglish ? 'Events Attended' : '参与活动'}
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
                                        {searching &&
                                            <div className="profile-spinner" style={{margin: '20px auto'}}/>}
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

                {/* Badges Tab */}
                {activeTab === 'badges' && (
                    <div className="admin-section">
                        {!selectedBadgeDef ? (
                            <>
                                {showCreateBadge ? (
                                    <div className="admin-create-badge-form">
                                        <h4 className="admin-badges-title">
                                            {isEnglish ? 'Create New Badge' : '创建新徽章'}
                                        </h4>
                                        <div className="admin-form-grid">
                                            <label>
                                                <span>{isEnglish ? 'Name (English)' : '名称（英文）'}</span>
                                                <input
                                                    value={newBadgeName}
                                                    onChange={(e) => setNewBadgeName(e.target.value)}
                                                    className="admin-search-input"
                                                    placeholder={isEnglish ? 'Badge name' : '徽章名称'}
                                                />
                                            </label>
                                            <label>
                                                <span>{isEnglish ? 'Name (Chinese)' : '名称（中文）'}</span>
                                                <input
                                                    value={newBadgeNameCn}
                                                    onChange={(e) => setNewBadgeNameCn(e.target.value)}
                                                    className="admin-search-input"
                                                    placeholder={isEnglish ? 'Badge name in Chinese' : '徽章中文名称'}
                                                />
                                            </label>
                                            <label>
                                                <span>{isEnglish ? 'Description (English)' : '描述（英文）'}</span>
                                                <textarea
                                                    value={newBadgeDesc}
                                                    onChange={(e) => setNewBadgeDesc(e.target.value)}
                                                    className="admin-search-input admin-textarea"
                                                    placeholder={isEnglish ? 'Badge description' : '徽章描述'}
                                                />
                                            </label>
                                            <label>
                                                <span>{isEnglish ? 'Description (Chinese)' : '描述（中文）'}</span>
                                                <textarea
                                                    value={newBadgeDescCn}
                                                    onChange={(e) => setNewBadgeDescCn(e.target.value)}
                                                    className="admin-search-input admin-textarea"
                                                    placeholder={isEnglish ? 'Badge description in Chinese' : '徽章中文描述'}
                                                />
                                            </label>
                                            <label>
                                                <span>{isEnglish ? 'Badge Image' : '徽章图片'}</span>
                                                <input
                                                    type="file"
                                                    accept="image/*"
                                                    onChange={(e) => {
                                                        const file = e.target.files?.[0];
                                                        if (!file) return;
                                                        setNewBadgeImage(file);
                                                        setNewBadgeImagePreview(URL.createObjectURL(file));
                                                    }}
                                                />
                                                {newBadgeImagePreview && (
                                                    <img src={newBadgeImagePreview} alt="" className="admin-badge-image-preview"/>
                                                )}
                                            </label>
                                        </div>
                                        <div className="admin-form-actions">
                                            <button
                                                className="admin-generate-btn"
                                                onClick={createBadgeDef}
                                                disabled={creatingBadgeDef || !newBadgeName.trim()}
                                            >
                                                {creatingBadgeDef
                                                    ? (isEnglish ? 'Creating...' : '创建中...')
                                                    : (isEnglish ? 'Create Badge' : '创建徽章')}
                                            </button>
                                            <button
                                                className="admin-back-btn"
                                                onClick={() => {
                                                    setShowCreateBadge(false);
                                                    setNewBadgeName('');
                                                    setNewBadgeNameCn('');
                                                    setNewBadgeDesc('');
                                                    setNewBadgeDescCn('');
                                                    setNewBadgeImage(null);
                                                    setNewBadgeImagePreview(null);
                                                }}
                                            >
                                                {isEnglish ? 'Cancel' : '取消'}
                                            </button>
                                        </div>
                                    </div>
                                ) : (
                                    <button className="admin-generate-btn" onClick={() => setShowCreateBadge(true)}>
                                        {isEnglish ? '+ Create Badge' : '+ 创建徽章'}
                                    </button>
                                )}

                                {loadingBadgeDefs && <div className="profile-spinner" style={{margin: '20px auto'}}/>}
                                {!loadingBadgeDefs && badgeDefs.length === 0 && !showCreateBadge && (
                                    <p className="admin-no-results">
                                        {isEnglish ? 'No badges yet. Create one above.' : '暂无徽章，点击上方按钮创建。'}
                                    </p>
                                )}
                                {!loadingBadgeDefs && badgeDefs.length > 0 && (
                                    <div className="admin-event-grid">
                                        {badgeDefs.map(bd => (
                                            <button
                                                key={bd.id}
                                                className="admin-event-card"
                                                onClick={() => selectBadgeDef(bd)}
                                            >
                                                <img src={bd.imageUrl} alt="" className="admin-event-card-img" loading="lazy"/>
                                                <div className="admin-event-card-info">
                                                    <span className="admin-event-card-title">
                                                        {isEnglish ? bd.name : bd.nameCn}
                                                    </span>
                                                    <span className="admin-event-card-date">
                                                        {isEnglish ? bd.description : bd.descriptionCn}
                                                    </span>
                                                </div>
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </>
                        ) : (
                            <div className="admin-event-detail">
                                <button className="admin-back-btn" onClick={() => {
                                    setSelectedBadgeDef(null);
                                    setBadgeHolders([]);
                                }}>
                                    &larr; {isEnglish ? 'All Badges' : '所有徽章'}
                                </button>

                                <div className="admin-event-detail-header">
                                    <img src={selectedBadgeDef.imageUrl} alt="" className="admin-event-detail-img"/>
                                    <div>
                                        <h3>{isEnglish ? selectedBadgeDef.name : selectedBadgeDef.nameCn}</h3>
                                        <p className="admin-event-detail-meta">
                                            {isEnglish ? selectedBadgeDef.description : selectedBadgeDef.descriptionCn}
                                        </p>
                                    </div>
                                </div>

                                <div className="admin-form-actions" style={{marginBottom: '20px'}}>
                                    <label className="admin-generate-btn" style={{cursor: 'pointer'}}>
                                        {updating
                                            ? (isEnglish ? 'Uploading...' : '上传中...')
                                            : (isEnglish ? 'Update Image' : '更换图片')}
                                        <input
                                            type="file"
                                            accept="image/*"
                                            hidden
                                            disabled={updating}
                                            onChange={(e) => {
                                                const file = e.target.files?.[0];
                                                if (file) updateBadgeImage(selectedBadgeDef, file);
                                            }}
                                        />
                                    </label>
                                    <button
                                        className="admin-toggle-btn admin-toggle-revoke"
                                        onClick={() => deleteBadgeDef(selectedBadgeDef)}
                                    >
                                        {isEnglish ? 'Delete Badge' : '删除徽章'}
                                    </button>
                                </div>

                                <h4 className="admin-badges-title">
                                    {isEnglish ? 'Badge Holders' : '徽章持有者'}
                                    {badgeHolders.length > 0 && (
                                        <span className="admin-badges-count">{badgeHolders.length}</span>
                                    )}
                                </h4>

                                {loadingBadgeHolders && <div className="profile-spinner" style={{margin: '20px auto'}}/>}
                                {!loadingBadgeHolders && badgeHolders.length === 0 && (
                                    <p className="admin-no-results">
                                        {isEnglish ? 'No one has this badge yet.' : '暂无人持有此徽章。'}
                                    </p>
                                )}
                                {!loadingBadgeHolders && badgeHolders.map((u) => (
                                    <div key={u.uid} className="admin-user-row" onClick={() => {
                                        setSelectedUser(u);
                                        setSelectedBadgeDef(null);
                                        setActiveTab('users');
                                    }}>
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

                {/* Records Tab */}
                {activeTab === 'records' && (
                    <div className="admin-section">
                        {loadingRecords && <div className="profile-spinner" style={{margin: '20px auto'}}/>}

                        {!loadingRecords && records.length === 0 && (
                            <p className="admin-no-results">{isEnglish ? 'No records yet.' : '暂无记录。'}</p>
                        )}

                        {!loadingRecords && records.map((r) => (
                            <div key={r.id} className="record-row">
                                <span className={`record-type-tag record-type-${r.type}`}>
                                    {getRecordTypeTag(r.type)}
                                </span>
                                <div className="record-content">
                                    <span
                                        className="record-actor">{clickableName(r.performedBy, r.performedByName)}</span>
                                    {' '}
                                    <span className="record-description">{getRecordLabel(r)}</span>
                                </div>
                                <span className="record-time">
                                    {r.timestamp.toLocaleString(isEnglish ? 'en-US' : 'zh-CN', {
                                        month: 'short', day: 'numeric',
                                        hour: '2-digit', minute: '2-digit',
                                    })}
                                </span>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </>
    );
};
