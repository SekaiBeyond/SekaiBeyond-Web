import { forwardRef, useEffect, useImperativeHandle, useState } from 'react';
import {
    collection,
    doc,
    endAt,
    getDoc,
    getDocs,
    limit,
    onSnapshot,
    orderBy,
    query,
    type QueryDocumentSnapshot,
    startAfter,
    startAt,
    where,
} from 'firebase/firestore';
import {
    callAssignEventStaff,
    callCancelAccountDeletion,
    callChangeUserGroup,
    callRemoveEventStaff,
    callRequestAccountDeletion,
    callSetUserTitle,
    callToggleAttendance,
    callToggleUserBadge,
    functionsErrorCode,
    getFirebaseDb,
} from '~/lib/firebase';
import type { User } from 'firebase/auth';
import {
    canAssignGroup,
    canManageUser,
    formatGroupWithTitle,
    GROUP_LABELS,
    hasPermission,
    USER_GROUPS,
    type UserGroup,
    type UserProfile,
} from '~/components/AuthProvider';
import { useLanguage } from '~/components/LanguageContextProvider';
import type { PastEvent } from '~/lib/pastEvents';
import type { UpcomingEvent } from '~/lib/upcomingEvents';
import type { BadgeDef, UserRecord } from './types';
import { docToUserRecord } from './utils';

const PAGE_SIZE = 10;

interface UsersTabProps {
    pastEvents: PastEvent[];
    upcomingEvents: UpcomingEvent[];
    badgeDefs: BadgeDef[];
    badgeDefsError: boolean;
    user: User;
    profile: UserProfile;
    showToast: (message: string, type: 'success' | 'warning' | 'error') => void;
}

export interface UsersTabHandle {
    lookupUserByUid: (uid: string) => Promise<void>;
}

export const UsersTab = forwardRef<UsersTabHandle, UsersTabProps>(({
                                                                       pastEvents,
                                                                       upcomingEvents,
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
    const [lastRecentSnap, setLastRecentSnap] = useState<QueryDocumentSnapshot | null>(null);
    const [loadingRecent, setLoadingRecent] = useState(false);
    const [hasMoreRecent, setHasMoreRecent] = useState(true);
    const [pendingDeletionExpiresAt, setPendingDeletionExpiresAt] = useState<Date | null>(null);
    const [deletionBusy, setDeletionBusy] = useState(false);
    const [pendingDeletionUids, setPendingDeletionUids] = useState<Set<string>>(new Set());
    const [titleInput, setTitleInput] = useState('');
    const [titleBusy, setTitleBusy] = useState(false);
    const [eventStaffBusy, setEventStaffBusy] = useState(false);
    const [eventStaffSelectId, setEventStaffSelectId] = useState('');

    useImperativeHandle(ref, () => ({
        lookupUserByUid: async (uid: string) => {
            const db = getFirebaseDb();
            const userSnap = await getDoc(doc(db, 'users', uid));
            if (!userSnap.exists()) {
                showToast(isEnglish ? 'User not found.' : '未找到该用户。', 'error');
                return;
            }
            const record = docToUserRecord(userSnap);
            setSelectedUser(record);
            setTitleInput(record.title ?? '');
            setSearchResults([]);
            setSearchQuery('');
        },
    }));

    useEffect(() => {
        if (selectedUser) {
            setTitleInput(selectedUser.title ?? '');
        }
    }, [selectedUser?.uid, selectedUser?.title]);

    useEffect(() => {
        if (!selectedUser) {
            setPendingDeletionExpiresAt(null);
            return;
        }
        const db = getFirebaseDb();
        const unsubscribe = onSnapshot(
            doc(db, 'users', selectedUser.uid),
            (snap) => {
                const data = snap.data();
                const deleteAt = data?.deleteAt?.toDate?.();
                setPendingDeletionExpiresAt(deleteAt instanceof Date ? deleteAt : null);
            },
            () => setPendingDeletionExpiresAt(null),
        );
        return () => unsubscribe();
    }, [selectedUser?.uid]);

    useEffect(() => {
        const db = getFirebaseDb();
        const q = query(
            collection(db, 'users'),
            where('deleteAt', '!=', null),
        );
        const unsubscribe = onSnapshot(
            q,
            (snapshot) => {
                setPendingDeletionUids(new Set(snapshot.docs.map(d => d.id)));
            },
            () => setPendingDeletionUids(new Set()),
        );
        return () => unsubscribe();
    }, []);

    useEffect(() => {
        const loadRecentUsers = async () => {
            setLoadingRecent(true);
            try {
                const db = getFirebaseDb();
                const q = query(collection(db, 'users'), orderBy('joinedAt', 'desc'), limit(PAGE_SIZE));
                const snapshot = await getDocs(q);
                setRecentUsers(snapshot.docs.map(docToUserRecord));
                setLastRecentSnap(snapshot.docs[snapshot.docs.length - 1] ?? null);
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
        if (!hasMoreRecent || !lastRecentSnap) return;
        setLoadingRecent(true);
        try {
            const db = getFirebaseDb();
            const q = query(
                collection(db, 'users'),
                orderBy('joinedAt', 'desc'),
                startAfter(lastRecentSnap),
                limit(PAGE_SIZE),
            );
            const snapshot = await getDocs(q);
            const newUsers = snapshot.docs.map(docToUserRecord);
            setRecentUsers(prev => [...prev, ...newUsers]);
            setLastRecentSnap(snapshot.docs[snapshot.docs.length - 1] ?? lastRecentSnap);
            setHasMoreRecent(newUsers.length === PAGE_SIZE);
        } finally {
            setLoadingRecent(false);
        }
    };

    const searchUsers = async () => {
        const q = searchQuery.trim();
        if (!q) return;
        setSearching(true);
        setSelectedUser(null);
        try {
            const db = getFirebaseDb();
            const users = collection(db, 'users');
            let records: UserRecord[];
            if (q.includes('@')) {
                const snap = await getDocs(query(users, where('email', '==', q.toLowerCase())));
                records = snap.docs.map(docToUserRecord);
            } else {
                const prefixes = new Set<string>([q]);
                const first = q.charAt(0);
                if (first && first.toLowerCase() !== first.toUpperCase()) {
                    prefixes.add(first.toUpperCase() + q.slice(1));
                    prefixes.add(first.toLowerCase() + q.slice(1));
                }
                const snaps = await Promise.all(
                    Array.from(prefixes).map(p => getDocs(query(
                        users,
                        orderBy('displayName'),
                        startAt(p),
                        endAt(p + '\uf8ff'),
                        limit(PAGE_SIZE),
                    ))),
                );
                const deduped = new Map<string, UserRecord>();
                snaps.forEach(s => s.docs.forEach(d => {
                    const r = docToUserRecord(d);
                    deduped.set(r.uid, r);
                }));
                records = Array.from(deduped.values());
            }
            setSearchResults(records);
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
            const has = userRecord.attendedEvents.includes(eventId);
            await callToggleAttendance({targetUid: userRecord.uid, eventId, grant: !has});

            const updatedEvents = has
                ? userRecord.attendedEvents.filter(e => e !== eventId)
                : [...userRecord.attendedEvents, eventId];

            const updated = {...userRecord, attendedEvents: updatedEvents};
            if (selectedUser?.uid === userRecord.uid) setSelectedUser(updated);
            setSearchResults(prev => prev.map(u => u.uid === userRecord.uid ? updated : u));
            showToast(
                has
                    ? (isEnglish ? 'Attendance revoked.' : '已取消参加记录。')
                    : (isEnglish ? 'Attendance granted.' : '已添加参加记录。'),
                has ? 'warning' : 'success',
            );
        } catch {
            showToast(isEnglish ? 'Failed to update attendance.' : '更新签到状态失败。', 'error');
        } finally {
            setUpdating(false);
        }
    };

    const toggleUserBadge = async (userRecord: UserRecord, badgeId: string) => {
        setUpdating(true);
        try {
            const has = userRecord.badges.includes(badgeId);
            await callToggleUserBadge({targetUid: userRecord.uid, badgeId, grant: !has});

            const updatedBadges = has
                ? userRecord.badges.filter(id => id !== badgeId)
                : [...userRecord.badges, badgeId];

            const updated = {...userRecord, badges: updatedBadges};
            if (selectedUser?.uid === userRecord.uid) setSelectedUser(updated);
            setSearchResults(prev => prev.map(u => u.uid === userRecord.uid ? updated : u));
            showToast(
                has
                    ? (isEnglish ? 'Badge revoked.' : '已撤销徽章。')
                    : (isEnglish ? 'Badge granted.' : '已授予徽章。'),
                has ? 'warning' : 'success',
            );
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

    const requestDeletion = async (userRecord: UserRecord) => {
        if (!confirm(isEnglish
            ? `Request deletion of ${userRecord.displayName}'s account? It will be wiped in about 48 hours unless cancelled.`
            : `申请删除 ${userRecord.displayName} 的账号？如不取消，约 48 小时后账号将被永久删除。`
        )) return;
        setDeletionBusy(true);
        try {
            await callRequestAccountDeletion({targetUid: userRecord.uid});
            showToast(
                isEnglish ? 'Deletion request submitted.' : '已提交删除申请。',
                'warning',
            );
        } catch {
            showToast(
                isEnglish
                    ? 'Failed to request deletion. You may not have permission.'
                    : '申请删除失败。你可能没有权限执行此操作。',
                'error',
            );
        } finally {
            setDeletionBusy(false);
        }
    };

    const cancelDeletion = async (userRecord: UserRecord) => {
        setDeletionBusy(true);
        try {
            await callCancelAccountDeletion({targetUid: userRecord.uid});
            showToast(
                isEnglish ? 'Deletion cancelled.' : '已取消删除。',
                'success',
            );
        } catch {
            showToast(
                isEnglish ? 'Failed to cancel deletion.' : '取消删除失败。',
                'error',
            );
        } finally {
            setDeletionBusy(false);
        }
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
            const title = ['staff', 'core-staff'].includes(newGroup) ? (userRecord.title ?? '') : '';
            await callChangeUserGroup({targetUid: userRecord.uid, newGroup, title});

            const updated = {...userRecord, group: newGroup, title};
            if (selectedUser?.uid === userRecord.uid) setSelectedUser(updated);
            setSearchResults(prev => prev.map(u => u.uid === userRecord.uid ? updated : u));
            showToast(isEnglish ? 'Group updated.' : '用户组已更新。', 'success');
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

    const assignEventStaff = async (userRecord: UserRecord, eventId: string) => {
        setEventStaffBusy(true);
        try {
            await callAssignEventStaff({targetUid: userRecord.uid, eventId});
            const updated = {
                ...userRecord,
                eventStaffEvents: userRecord.eventStaffEvents.includes(eventId)
                    ? userRecord.eventStaffEvents
                    : [...userRecord.eventStaffEvents, eventId],
            };
            if (selectedUser?.uid === userRecord.uid) setSelectedUser(updated);
            setSearchResults(prev => prev.map(u => u.uid === userRecord.uid ? updated : u));
            setEventStaffSelectId('');
            showToast(isEnglish ? 'Event staff access granted.' : '已授予活动工作人员权限。', 'success');
        } catch (err) {
            const code = functionsErrorCode(err);
            showToast(
                isEnglish
                    ? `Failed to assign event staff${code ? ` (${code})` : ''}.`
                    : `授予失败${code ? `（${code}）` : ''}。`,
                'error',
            );
        } finally {
            setEventStaffBusy(false);
        }
    };

    const removeEventStaff = async (userRecord: UserRecord, eventId: string) => {
        setEventStaffBusy(true);
        try {
            await callRemoveEventStaff({targetUid: userRecord.uid, eventId});
            const updated = {
                ...userRecord,
                eventStaffEvents: userRecord.eventStaffEvents.filter(id => id !== eventId),
            };
            if (selectedUser?.uid === userRecord.uid) setSelectedUser(updated);
            setSearchResults(prev => prev.map(u => u.uid === userRecord.uid ? updated : u));
            showToast(isEnglish ? 'Event staff access removed.' : '已撤销活动工作人员权限。', 'warning');
        } catch (err) {
            const code = functionsErrorCode(err);
            showToast(
                isEnglish
                    ? `Failed to remove event staff${code ? ` (${code})` : ''}.`
                    : `撤销失败${code ? `（${code}）` : ''}。`,
                'error',
            );
        } finally {
            setEventStaffBusy(false);
        }
    };

    const setTitle = async (userRecord: UserRecord) => {
        setTitleBusy(true);
        try {
            const newTitle = titleInput.trim();
            await callSetUserTitle({targetUid: userRecord.uid, title: newTitle || undefined});

            const updated = {...userRecord, title: newTitle};
            if (selectedUser?.uid === userRecord.uid) setSelectedUser(updated);
            setSearchResults(prev => prev.map(u => u.uid === userRecord.uid ? updated : u));
            showToast(
                newTitle
                    ? (isEnglish ? 'Title updated.' : '头衔已更新。')
                    : (isEnglish ? 'Title removed.' : '头衔已清除。'),
                newTitle ? 'success' : 'warning',
            );
        } catch {
            showToast(
                isEnglish
                    ? 'Failed to update title. You may not have permission.'
                    : '更新头衔失败。你可能没有权限执行此操作。',
                'error',
            );
        } finally {
            setTitleBusy(false);
        }
    };

    return (
        <div className="admin-section">
            <div className="admin-search">
                <input
                    type="text"
                    placeholder={isEnglish ? 'Search by email or name...' : '输入邮箱或姓名搜索...'}
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
                            {pendingDeletionUids.has(u.uid) && (
                                <span className="admin-user-deletion-flag">
                                    {isEnglish ? 'Pending deletion' : '待删除'}
                                </span>
                            )}
                            <span className="admin-user-group-tag" data-group={u.group}>
                                {formatGroupWithTitle(u.group, u.title, isEnglish)}
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
                            {pendingDeletionUids.has(u.uid) && (
                                <span className="admin-user-deletion-flag">
                                    {isEnglish ? 'Pending deletion' : '待删除'}
                                </span>
                            )}
                            <span className="admin-user-group-tag" data-group={u.group}>
                                {formatGroupWithTitle(u.group, u.title, isEnglish)}
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
                                {formatGroupWithTitle(selectedUser.group, selectedUser.title, isEnglish)}
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

                        {canManage && ['staff', 'core-staff'].includes(selectedUser.group) && (
                            <div className="admin-group-section">
                                <h4 className="admin-badges-title">
                                    {isEnglish ? 'Title' : '头衔'}
                                </h4>
                                <div className="admin-title-input-row">
                                    <input
                                        type="text"
                                        className="admin-title-input"
                                        placeholder={isEnglish ? 'e.g. Tech Lead, Event Coordinator...' : '例如：技术负责人、活动策划...'}
                                        value={titleInput}
                                        onChange={(e) => setTitleInput(e.target.value)}
                                        maxLength={100}
                                        disabled={titleBusy}
                                    />
                                    <button
                                        className="admin-title-save-btn"
                                        onClick={() => setTitle(selectedUser)}
                                        disabled={titleBusy || titleInput === (selectedUser.title ?? '')}
                                    >
                                        {titleBusy
                                            ? (isEnglish ? 'Saving...' : '保存中...')
                                            : (isEnglish ? 'Save' : '保存')}
                                    </button>
                                </div>
                                <p className="admin-title-hint">
                                    {isEnglish
                                        ? 'Leave empty to remove title. Title is shown alongside role (e.g., "Core Staff - Tech Lead").'
                                        : '留空则清除头衔。头衔会与角色一同显示（例如："核心成员 - 技术负责人"）。'}
                                </p>
                            </div>
                        )}

                        {canManage && hasPermission(selectedUser.group, 'staff') && (() => {
                            const eventsById = new Map(upcomingEvents.map(e => [e.id, e]));
                            const assigned = selectedUser.eventStaffEvents
                                .map(id => eventsById.get(id) ?? {
                                    id, title: id, titleCn: id,
                                } as Pick<UpcomingEvent, 'id' | 'title' | 'titleCn'>);
                            const unassigned = upcomingEvents.filter(
                                e => !selectedUser.eventStaffEvents.includes(e.id),
                            );
                            return (
                                <div className="admin-group-section">
                                    <h4 className="admin-badges-title">
                                        {isEnglish ? 'Event Staff Access' : '活动工作人员权限'}
                                    </h4>
                                    <p className="admin-title-hint">
                                        {isEnglish
                                            ? 'Grants this user ticket-scanning and attendee-viewing access for specific upcoming events.'
                                            : '授予此用户对特定活动的门票扫描与参加者查看权限。'}
                                    </p>
                                    {assigned.length > 0 ? (
                                        <div className="admin-event-staff-list">
                                            {assigned.map((e) => (
                                                <div key={e.id} className="admin-event-staff-row">
                                                    <span className="admin-event-staff-name">
                                                        {isEnglish ? (e.title || e.id) : (e.titleCn || e.title || e.id)}
                                                    </span>
                                                    <button
                                                        className="admin-toggle-btn admin-toggle-revoke"
                                                        onClick={() => removeEventStaff(selectedUser, e.id)}
                                                        disabled={eventStaffBusy}
                                                    >
                                                        {isEnglish ? 'Remove' : '撤销'}
                                                    </button>
                                                </div>
                                            ))}
                                        </div>
                                    ) : (
                                        <p className="admin-no-results">
                                            {isEnglish ? 'No event-specific access yet.' : '尚未授予任何活动权限。'}
                                        </p>
                                    )}
                                    {unassigned.length > 0 && (
                                        <div className="admin-event-staff-add">
                                            <select
                                                className="admin-search-input"
                                                value={eventStaffSelectId}
                                                onChange={(e) => setEventStaffSelectId(e.target.value)}
                                                disabled={eventStaffBusy}
                                            >
                                                <option value="">
                                                    {isEnglish ? 'Select an event...' : '选择一个活动...'}
                                                </option>
                                                {unassigned.map((e) => (
                                                    <option key={e.id} value={e.id}>
                                                        {isEnglish ? (e.title || e.id) : (e.titleCn || e.title || e.id)}
                                                    </option>
                                                ))}
                                            </select>
                                            <button
                                                className="admin-toggle-btn admin-toggle-grant"
                                                onClick={() => assignEventStaff(selectedUser, eventStaffSelectId)}
                                                disabled={eventStaffBusy || !eventStaffSelectId}
                                            >
                                                {isEnglish ? 'Add' : '添加'}
                                            </button>
                                        </div>
                                    )}
                                </div>
                            );
                        })()}

                        <div className="admin-deletion-section">
                            <h4 className="admin-badges-title">
                                {isEnglish ? 'Account Deletion' : '账号删除'}
                            </h4>
                            {pendingDeletionExpiresAt ? (
                                <div className="admin-deletion-pending">
                                    <p>
                                        {isEnglish
                                            ? `Pending — scheduled around ${pendingDeletionExpiresAt.toLocaleString('en-US', {
                                                month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
                                            })}.`
                                            : `待删除 — 预计于 ${pendingDeletionExpiresAt.toLocaleString('zh-CN', {
                                                month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
                                            })} 前后执行。`}
                                    </p>
                                    <button
                                        className="admin-deletion-cancel-btn"
                                        onClick={() => cancelDeletion(selectedUser)}
                                        disabled={deletionBusy || !canManage}
                                        title={manageTooltip}
                                    >
                                        {isEnglish ? 'Cancel deletion' : '取消删除'}
                                    </button>
                                </div>
                            ) : (
                                <button
                                    className="admin-deletion-request-btn"
                                    onClick={() => requestDeletion(selectedUser)}
                                    disabled={deletionBusy || !canManage || selectedUser.uid === user.uid}
                                    title={
                                        selectedUser.uid === user.uid
                                            ? (isEnglish ? 'Use the Danger Zone on your own profile' : '请在个人主页的危险操作区删除自己')
                                            : manageTooltip
                                    }
                                >
                                    {isEnglish ? 'Request account deletion' : '申请删除账号'}
                                </button>
                            )}
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
                                                    onClick={() => toggleUserBadge(selectedUser, bd.id)}
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
