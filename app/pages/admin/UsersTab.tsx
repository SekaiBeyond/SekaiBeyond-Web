import { forwardRef, useEffect, useImperativeHandle, useState } from 'react';
import {
    arrayRemove,
    arrayUnion,
    collection,
    doc,
    getDoc,
    getDocs,
    limit,
    orderBy,
    query,
    serverTimestamp,
    startAfter,
    where,
    writeBatch,
} from 'firebase/firestore';
import { callChangeUserGroup, getFirebaseDb } from '~/lib/firebase';
import type { User } from 'firebase/auth';
import {
    canAssignGroup,
    canManageUser,
    GROUP_LABELS,
    USER_GROUPS,
    type UserGroup,
    type UserProfile,
} from '~/components/AuthProvider';
import { useLanguage } from '~/components/LanguageContextProvider';
import type { PastEvent } from '~/lib/pastEvents';
import type { BadgeDef, UserRecord } from './types';
import { docToUserRecord } from './utils';

const PAGE_SIZE = 10;

interface UsersTabProps {
    pastEvents: PastEvent[];
    badgeDefs: BadgeDef[];
    badgeDefsError: boolean;
    user: User;
    profile: UserProfile;
    showToast: (message: string, type: 'success' | 'error') => void;
}

export interface UsersTabHandle {
    lookupUserByUid: (uid: string) => Promise<void>;
}

export const UsersTab = forwardRef<UsersTabHandle, UsersTabProps>(({
                                                                       pastEvents,
                                                                       badgeDefs,
                                                                       badgeDefsError,
                                                                       user,
                                                                       profile,
                                                                       showToast,
                                                                   }, ref) => {
    const {isEnglish} = useLanguage();
    const [searchQuery, setSearchQuery] = useState('');
    const [searchResults, setSearchResults] = useState<UserRecord[]>([]);
    const [selectedUser, setSelectedUser] = useState<UserRecord | null>(null);
    const [searching, setSearching] = useState(false);
    const [hasSearched, setHasSearched] = useState(false);
    const [updating, setUpdating] = useState(false);
    const [recentUsers, setRecentUsers] = useState<UserRecord[]>([]);
    const [loadingRecent, setLoadingRecent] = useState(false);
    const [hasMoreRecent, setHasMoreRecent] = useState(true);

    useImperativeHandle(ref, () => ({
        lookupUserByUid: async (uid: string) => {
            const db = getFirebaseDb();
            const userSnap = await getDoc(doc(db, 'users', uid));
            if (!userSnap.exists()) return;
            setSelectedUser(docToUserRecord(userSnap));
            setSearchResults([]);
            setSearchQuery('');
        },
    }));

    useEffect(() => {
        const loadRecentUsers = async () => {
            setLoadingRecent(true);
            try {
                const db = getFirebaseDb();
                const q = query(collection(db, 'users'), orderBy('joinedAt', 'desc'), limit(PAGE_SIZE));
                const snapshot = await getDocs(q);
                setRecentUsers(snapshot.docs.map(docToUserRecord));
                setHasMoreRecent(snapshot.docs.length === PAGE_SIZE);
            } finally {
                setLoadingRecent(false);
            }
        };
        loadRecentUsers().catch(err => {
            void err;
        });
    }, []);

    const loadMoreRecentUsers = async () => {
        if (!hasMoreRecent || recentUsers.length === 0) return;
        setLoadingRecent(true);
        try {
            const db = getFirebaseDb();
            const lastUser = recentUsers[recentUsers.length - 1];
            const q = query(
                collection(db, 'users'),
                orderBy('joinedAt', 'desc'),
                startAfter(lastUser.joinedAt),
                limit(PAGE_SIZE),
            );
            const snapshot = await getDocs(q);
            const newUsers = snapshot.docs.map(docToUserRecord);
            setRecentUsers(prev => [...prev, ...newUsers]);
            setHasMoreRecent(newUsers.length === PAGE_SIZE);
        } finally {
            setLoadingRecent(false);
        }
    };

    const searchUsers = async () => {
        if (!searchQuery.trim()) return;
        setSearching(true);
        setSelectedUser(null);
        try {
            const db = getFirebaseDb();
            const q = query(collection(db, 'users'), where('email', '==', searchQuery.trim().toLowerCase()));
            const snapshot = await getDocs(q);
            setSearchResults(snapshot.docs.map(docToUserRecord));
        } catch {
            showToast(isEnglish ? 'Search failed. Please try again.' : '搜索失败，请重试。', 'error');
        } finally {
            setSearching(false);
            setHasSearched(true);
        }
    };

    const toggleAttendance = async (userRecord: UserRecord, eventId: string) => {
        setUpdating(true);
        try {
            const db = getFirebaseDb();
            const userRef = doc(db, 'users', userRecord.uid);
            const has = userRecord.attendedEvents.includes(eventId);
            const evt = pastEvents.find(e => e.id === eventId);

            const batch = writeBatch(db);
            batch.update(userRef, {
                attendedEvents: has ? arrayRemove(eventId) : arrayUnion(eventId),
            });
            batch.set(doc(collection(db, 'records')), {
                type: has ? 'event-unattend' : 'event-attend',
                performedBy: user.uid,
                performedByName: profile.displayName,
                targetUid: userRecord.uid,
                targetName: userRecord.displayName,
                eventTitle: evt?.title ?? eventId,
                eventId,
                timestamp: serverTimestamp(),
            });
            await batch.commit();

            const updatedEvents = has
                ? userRecord.attendedEvents.filter(e => e !== eventId)
                : [...userRecord.attendedEvents, eventId];

            const updated = {...userRecord, attendedEvents: updatedEvents};
            if (selectedUser?.uid === userRecord.uid) setSelectedUser(updated);
            setSearchResults(prev => prev.map(u => u.uid === userRecord.uid ? updated : u));
        } catch {
            showToast(isEnglish ? 'Failed to update attendance.' : '更新签到状态失败。', 'error');
        } finally {
            setUpdating(false);
        }
    };

    const toggleUserBadge = async (userRecord: UserRecord, badgeId: string, badgeName: string) => {
        setUpdating(true);
        try {
            const db = getFirebaseDb();
            const userRef = doc(db, 'users', userRecord.uid);
            const has = userRecord.badges.includes(badgeId);

            const batch = writeBatch(db);
            batch.update(userRef, {
                badges: has ? arrayRemove(badgeId) : arrayUnion(badgeId),
            });
            batch.set(doc(collection(db, 'records')), {
                type: has ? 'achievement-revoke' : 'achievement-grant',
                performedBy: user.uid,
                performedByName: profile.displayName,
                targetUid: userRecord.uid,
                targetName: userRecord.displayName,
                badgeId,
                badgeName,
                timestamp: serverTimestamp(),
            });
            await batch.commit();

            const updatedBadges = has
                ? userRecord.badges.filter(id => id !== badgeId)
                : [...userRecord.badges, badgeId];

            const updated = {...userRecord, badges: updatedBadges};
            if (selectedUser?.uid === userRecord.uid) setSelectedUser(updated);
            setSearchResults(prev => prev.map(u => u.uid === userRecord.uid ? updated : u));
        } catch {
            showToast(isEnglish ? 'Failed to update badge.' : '更新徽章失败。', 'error');
        } finally {
            setUpdating(false);
        }
    };

    const getGroupDisabledReason = (userRecord: UserRecord, targetGroup: UserGroup): string | null => {
        if (userRecord.group === targetGroup) return null;
        if (userRecord.uid === user.uid) {
            return isEnglish ? 'You cannot change your own group' : '你不能更改自己的用户组';
        }
        if (!canManageUser(profile.group, userRecord.group)) {
            return isEnglish
                ? 'You cannot change the group of a user at or above your level'
                : '你不能更改同级或更高级别用户的用户组';
        }
        if (!canAssignGroup(profile.group, targetGroup)) {
            return isEnglish
                ? 'Only the president can assign this group'
                : '只有社长可以分配此用户组';
        }
        return null;
    };

    const changeUserGroup = async (userRecord: UserRecord, newGroup: UserGroup) => {
        const oldLabel = isEnglish ? GROUP_LABELS[userRecord.group].en : GROUP_LABELS[userRecord.group].zh;
        const newLabel = isEnglish ? GROUP_LABELS[newGroup].en : GROUP_LABELS[newGroup].zh;
        if (!confirm(isEnglish
            ? `Change ${userRecord.displayName}'s group from "${oldLabel}" to "${newLabel}"?`
            : `将 ${userRecord.displayName} 的用户组从"${oldLabel}"改为"${newLabel}"？`
        )) return;
        setUpdating(true);
        try {
            await callChangeUserGroup({targetUid: userRecord.uid, newGroup});

            const updated = {...userRecord, group: newGroup};
            if (selectedUser?.uid === userRecord.uid) setSelectedUser(updated);
            setSearchResults(prev => prev.map(u => u.uid === userRecord.uid ? updated : u));
        } catch {
            showToast(
                isEnglish
                    ? 'Failed to update group. You may not have permission for this action.'
                    : '更新用户组失败。你可能没有权限执行此操作。',
                'error',
            );
        } finally {
            setUpdating(false);
        }
    };

    return (
        <div className="admin-section">
            <div className="admin-search">
                <input
                    type="email"
                    placeholder={isEnglish ? 'Search by email address...' : '输入邮箱地址搜索...'}
                    value={searchQuery}
                    onChange={(e) => {
                        setSearchQuery(e.target.value);
                        setHasSearched(false);
                    }}
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
                            <img src={u.photoURL} alt="" className="admin-user-avatar" referrerPolicy="no-referrer"/>
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

            {searchResults.length === 0 && !searching && hasSearched && (
                <p className="admin-no-results">{isEnglish ? 'No users found.' : '未找到用户。'}</p>
            )}

            {!selectedUser && searchResults.length === 0 && (
                <div className="admin-recent-users">
                    <h4 className="admin-badges-title">
                        {isEnglish ? 'Recent Users' : '最近加入的用户'}
                    </h4>
                    {recentUsers.map((u) => (
                        <div key={u.uid} className="admin-user-row" onClick={() => setSelectedUser(u)}>
                            <img src={u.photoURL} alt="" className="admin-user-avatar" referrerPolicy="no-referrer"/>
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
                    {loadingRecent && <div className="profile-spinner admin-spinner-center"/>}
                    {!loadingRecent && hasMoreRecent && recentUsers.length > 0 && (
                        <button className="admin-load-more-btn" onClick={loadMoreRecentUsers}>
                            {isEnglish ? 'Load More' : '加载更多'}
                        </button>
                    )}
                </div>
            )}

            {selectedUser && (() => {
                const canManage = canManageUser(profile.group, selectedUser.group);
                const manageTooltip = !canManage
                    ? (isEnglish ? 'You cannot manage a user at or above your level' : '你不能管理同级或更高级别的用户')
                    : undefined;
                return (
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
                            <div className="admin-group-actions">
                                {USER_GROUPS.map((g) => {
                                    const isCurrent = selectedUser.group === g;
                                    const reason = getGroupDisabledReason(selectedUser, g);
                                    const isDisabled = updating || isCurrent || reason !== null;
                                    return (
                                        <button
                                            key={g}
                                            className={`admin-group-btn ${isCurrent ? 'admin-group-btn-active' : ''}`}
                                            onClick={() => changeUserGroup(selectedUser, g)}
                                            disabled={isDisabled}
                                            title={reason ?? undefined}
                                        >
                                            {isEnglish ? GROUP_LABELS[g].en : GROUP_LABELS[g].zh}
                                        </button>
                                    );
                                })}
                            </div>
                        </div>

                        {badgeDefsError && (
                            <p className="admin-no-results">
                                {isEnglish ? 'Failed to load badges.' : '加载徽章失败。'}
                            </p>
                        )}

                        {!badgeDefsError && badgeDefs.length > 0 && (
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
                                                <img src={bd.imageUrl} alt="" className="admin-badge-img"/>
                                                <div className="admin-badge-info">
                                                <span
                                                    className="admin-badge-name">{isEnglish ? bd.name : bd.nameCn}</span>
                                                    <span
                                                        className="admin-badge-date">{isEnglish ? bd.description : bd.descriptionCn}</span>
                                                </div>
                                                <button
                                                    className={`admin-toggle-btn ${has ? 'admin-toggle-revoke' : 'admin-toggle-grant'}`}
                                                    onClick={() => toggleUserBadge(selectedUser, bd.id, isEnglish ? bd.name : bd.nameCn)}
                                                    disabled={updating || !canManage}
                                                    title={manageTooltip}
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
                            {selectedUser.attendedEvents.length}/{pastEvents.length}
                        </span>
                        </h4>

                        <div className="admin-badge-list">
                            {pastEvents.map((event) => {
                                const has = selectedUser.attendedEvents.includes(event.id);
                                return (
                                    <div key={event.id} className={`admin-badge-row ${has ? 'admin-badge-has' : ''}`}>
                                        <img src={event.icon} alt="" className="admin-badge-img"/>
                                        <div className="admin-badge-info">
                                        <span
                                            className="admin-badge-name">{isEnglish ? event.title : event.titleCn}</span>
                                            <span className="admin-badge-date">{event.date}</span>
                                        </div>
                                        <button
                                            className={`admin-toggle-btn ${has ? 'admin-toggle-revoke' : 'admin-toggle-grant'}`}
                                            onClick={() => toggleAttendance(selectedUser, event.id)}
                                            disabled={updating || !canManage}
                                            title={manageTooltip}
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
                );
            })()}
        </div>
    );
});

UsersTab.displayName = 'UsersTab';
