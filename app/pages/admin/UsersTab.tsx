import { forwardRef, useEffect, useImperativeHandle, useRef, useState, } from 'react';
import {
    collection,
    doc,
    getDoc,
    getDocs,
    onSnapshot,
    query,
    type QueryDocumentSnapshot,
    where,
} from 'firebase/firestore';
import type { User } from 'firebase/auth';
import {
    formatGroupWithTitle,
    GROUP_LABELS,
    USER_GROUPS,
    type UserGroup,
    type UserProfile,
} from '~/components/AuthProvider';
import { useLanguage } from '~/components/LanguageContextProvider';
import { getFirebaseDb } from '~/lib/firebase';
import type { PastEvent } from '~/lib/pastEvents';
import type { BadgeDef, UserRecord } from './types';
import { UserRow } from './UserRow';
import { buildUserListQuery, docToUserRecord, searchUsers } from './utils';
import { UserDetailView } from './UserDetailView';

const PAGE_SIZE = 10;

interface UsersTabProps {
    pastEvents: PastEvent[];
    badgeDefs: BadgeDef[];
    badgeDefsError: boolean;
    user: User;
    profile: UserProfile;
    /** Opens one of the user's passports in the Passports tab. */
    onOpenPassport: (passportId: string) => void;
    showToast: (message: string, type: 'success' | 'warning' | 'error') => void;
    readOnly?: boolean;
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
                                                                       onOpenPassport,
                                                                       showToast,
                                                                       readOnly = false,
                                                                   }, ref) => {
    const {isEnglish} = useLanguage();
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedGroup, setSelectedGroup] = useState<UserGroup | ''>('');
    const [membersOnly, setMembersOnly] = useState(false);
    const [searchResults, setSearchResults] = useState<UserRecord[]>([]);
    const [selectedUser, setSelectedUser] = useState<UserRecord | null>(null);
    const [searching, setSearching] = useState(false);
    const [hasSearched, setHasSearched] = useState(false);
    const [recentUsers, setRecentUsers] = useState<UserRecord[]>([]);
    const [lastRecentSnap, setLastRecentSnap] = useState<QueryDocumentSnapshot | null>(null);
    const [loadingRecent, setLoadingRecent] = useState(false);
    const [hasMoreRecent, setHasMoreRecent] = useState(true);
    const [pendingDeletionUids, setPendingDeletionUids] = useState<Set<string>>(new Set());

    // So a page requested under old filters is dropped when it lands.
    const recentGenRef = useRef(0);

    // Merged into each list's current copy, so two edits in flight don't undo
    // each other, and a landing edit doesn't pull the admin back into the user.
    const applyUserUpdate = (uid: string, changes: Partial<UserRecord>) => {
        const merge = (u: UserRecord) => u.uid === uid ? {...u, ...changes} : u;
        setSelectedUser(prev => prev && merge(prev));
        setSearchResults(prev => prev.map(merge));
        setRecentUsers(prev => prev.map(merge));
    };

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
            setSearchResults([]);
            setSearchQuery('');
        },
    }));

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
        const gen = ++recentGenRef.current;
        const loadRecentUsers = async () => {
            setLoadingRecent(true);
            try {
                const snapshot = await getDocs(buildUserListQuery({
                    group: selectedGroup,
                    membersOnly,
                    pageSize: PAGE_SIZE,
                }));
                if (recentGenRef.current !== gen) return;
                setRecentUsers(snapshot.docs.map(docToUserRecord));
                setLastRecentSnap(snapshot.docs[snapshot.docs.length - 1] ?? null);
                setHasMoreRecent(snapshot.docs.length === PAGE_SIZE);
            } finally {
                if (recentGenRef.current === gen) setLoadingRecent(false);
            }
        };
        loadRecentUsers().catch(err => {
            void err;
        });
    }, [selectedGroup, membersOnly]);

    const loadMoreRecentUsers = async () => {
        if (!hasMoreRecent || !lastRecentSnap) return;
        const gen = recentGenRef.current;
        setLoadingRecent(true);
        try {
            const snapshot = await getDocs(buildUserListQuery({
                group: selectedGroup,
                membersOnly,
                pageSize: PAGE_SIZE,
                cursor: lastRecentSnap,
            }));
            if (recentGenRef.current !== gen) return;
            const newUsers = snapshot.docs.map(docToUserRecord);
            setRecentUsers(prev => [...prev, ...newUsers]);
            setLastRecentSnap(snapshot.docs[snapshot.docs.length - 1] ?? lastRecentSnap);
            setHasMoreRecent(newUsers.length === PAGE_SIZE);
        } finally {
            if (recentGenRef.current === gen) setLoadingRecent(false);
        }
    };

    const runSearch = async () => {
        if (!searchQuery.trim()) return;
        setSearching(true);
        setSelectedUser(null);
        try {
            setSearchResults(await searchUsers(searchQuery, selectedGroup, membersOnly));
        } catch {
            showToast(isEnglish ? 'Search failed. Please try again.' : '搜索失败，请重试。', 'error');
        } finally {
            setSearching(false);
            setHasSearched(true);
        }
    };

    return (
        <div className="admin-section">
            <div className="admin-search">
                <select
                    value={selectedGroup}
                    onChange={(e) => {
                        setSelectedGroup(e.target.value as UserGroup | '');
                        setSearchResults([]);
                        setHasSearched(false);
                    }}
                    className="admin-input admin-select"
                >
                    <option value="">{isEnglish ? 'All Roles' : '所有角色'}</option>
                    {USER_GROUPS.map((g) => (
                        <option key={g} value={g}>
                            {isEnglish ? GROUP_LABELS[g].en : GROUP_LABELS[g].zh}
                        </option>
                    ))}
                </select>
                {/* Membership is separate from role, so it filters separately. */}
                <label className="admin-members-filter">
                    <input
                        type="checkbox"
                        checked={membersOnly}
                        onChange={(e) => {
                            setMembersOnly(e.target.checked);
                            setSearchResults([]);
                            setHasSearched(false);
                        }}
                    />
                    {isEnglish ? 'Members only' : '仅会员'}
                </label>
                <input
                    type="text"
                    placeholder={isEnglish ? 'Search by email or name...' : '输入邮箱或姓名搜索...'}
                    value={searchQuery}
                    onChange={(e) => {
                        setSearchQuery(e.target.value);
                        setHasSearched(false);
                    }}
                    onKeyDown={(e) => e.key === 'Enter' && runSearch()}
                    className="admin-input"
                />
                <button onClick={runSearch} disabled={searching} className="admin-btn admin-btn--cta">
                    {searching
                        ? (isEnglish ? 'Searching...' : '搜索中...')
                        : (isEnglish ? 'Search' : '搜索')}
                </button>
            </div>

            {searchResults.length > 0 && !selectedUser && (
                <div className="admin-results">
                    {searchResults.map((u) => (
                        <UserRow key={u.uid} user={u} onClick={() => setSelectedUser(u)}>
                            {pendingDeletionUids.has(u.uid) && (
                                <span className="admin-user-deletion-flag">
                                    {isEnglish ? 'Pending deletion' : '待删除'}
                                </span>
                            )}
                            <span className="admin-user-group-tag" data-group={u.group}>
                                {formatGroupWithTitle(u.group, u.title, u.titleCn, isEnglish)}
                            </span>
                            {u.membershipExpiresAt && u.membershipExpiresAt.getTime() > Date.now() && (
                                <span className="admin-user-member-tag">
                                    {isEnglish ? 'Member' : '会员'}
                                </span>
                            )}
                            <span className="admin-user-badge-count">
                                {u.attendedEvents.length} {isEnglish ? 'events' : '活动'}
                            </span>
                        </UserRow>
                    ))}
                </div>
            )}

            {searchResults.length === 0 && !searching && hasSearched && (
                <p className="admin-no-results">{isEnglish ? 'No users found.' : '未找到用户。'}</p>
            )}

            {!selectedUser && searchResults.length === 0 && (
                <div className="admin-recent-users">
                    <h4 className="admin-badges-title">
                        {membersOnly
                            ? (isEnglish ? 'Active Members' : '有效会员')
                            : (isEnglish ? 'Recent Users' : '最近加入的用户')}
                    </h4>
                    {recentUsers.map((u) => (
                        <UserRow key={u.uid} user={u} onClick={() => setSelectedUser(u)}>
                            {pendingDeletionUids.has(u.uid) && (
                                <span className="admin-user-deletion-flag">
                                    {isEnglish ? 'Pending deletion' : '待删除'}
                                </span>
                            )}
                            <span className="admin-user-group-tag" data-group={u.group}>
                                {formatGroupWithTitle(u.group, u.title, u.titleCn, isEnglish)}
                            </span>
                            {u.membershipExpiresAt && u.membershipExpiresAt.getTime() > Date.now() && (
                                <span className="admin-user-member-tag">
                                    {isEnglish ? 'Member' : '会员'}
                                </span>
                            )}
                            <span className="admin-detail-joined">
                                {u.joinedAt.toLocaleDateString(isEnglish ? 'en-US' : 'zh-CN', {
                                    year: 'numeric', month: 'short', day: 'numeric',
                                })}
                            </span>
                        </UserRow>
                    ))}
                    {loadingRecent && <div className="spinner spinner-centered"/>}
                    {!loadingRecent && hasMoreRecent && recentUsers.length > 0 && (
                        <button className="admin-btn admin-btn--outline" onClick={loadMoreRecentUsers}>
                            {isEnglish ? 'Load More' : '加载更多'}
                        </button>
                    )}
                </div>
            )}

            {selectedUser && (
                <UserDetailView
                    userRecord={selectedUser}
                    currentUser={user}
                    currentProfile={profile}
                    pastEvents={pastEvents}
                    badgeDefs={badgeDefs}
                    badgeDefsError={badgeDefsError}
                    readOnly={readOnly}
                    onBack={() => setSelectedUser(null)}
                    onUpdateUser={applyUserUpdate}
                    onOpenPassport={onOpenPassport}
                    showToast={showToast}
                />
            )}
        </div>
    );
});

UsersTab.displayName = 'UsersTab';
