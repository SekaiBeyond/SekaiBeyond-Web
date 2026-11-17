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
    isMembershipActive,
    USER_GROUPS,
    type UserGroup,
    type UserProfile,
} from '~/components/AuthProvider';
import { useLanguage } from '~/components/LanguageContextProvider';
import { getFirebaseDb } from '~/lib/firebase';
import type { PastEvent } from '~/lib/pastEvents';
import type { BadgeDef } from '~/lib/badges';
import { isBanActive, type UserRecord } from './types';
import { UserRow } from './UserRow';
import { buildUserListQuery, docToUserRecord, type ShowToast } from './utils';
import { UserSearchInput, useUserSearch } from './useUserSearch';
import { PhotoSourceTag, UserDetailView } from './UserDetailView';

const PAGE_SIZE = 10;

interface UsersTabProps {
    pastEvents: PastEvent[];
    badgeDefs: BadgeDef[];
    badgeDefsError: boolean;
    user: User;
    profile: UserProfile;
    onOpenPassport: (passportId: string) => void;
    showToast: ShowToast;
    readOnly?: boolean;
}

export interface UsersTabHandle {
    lookupUserByUid: (uid: string) => Promise<void>;
}

const UserTags = ({user, pendingDeletion}: {user: UserRecord; pendingDeletion: boolean}) => {
    const {isEnglish} = useLanguage();
    return (
        <>
            {isBanActive(user.ban) && (
                <span className="admin-user-deletion-flag">
                    {isEnglish ? 'Banned' : '已封禁'}
                </span>
            )}
            {pendingDeletion && (
                <span className="admin-user-deletion-flag">
                    {isEnglish ? 'Pending deletion' : '待删除'}
                </span>
            )}
            <span className="admin-user-group-tag" data-group={user.group}>
                {formatGroupWithTitle(user.group, user.title, user.titleCn, isEnglish)}
            </span>
            {isMembershipActive(user.membershipExpiresAt) && (
                <span className="admin-user-member-tag">
                    {isEnglish ? 'Member' : '会员'}
                </span>
            )}
            <PhotoSourceTag photoURL={user.photoURL}/>
        </>
    );
};

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
    const [selectedGroup, setSelectedGroup] = useState<UserGroup | ''>('');
    const [membersOnly, setMembersOnly] = useState(false);
    const [selectedUser, setSelectedUser] = useState<UserRecord | null>(null);
    const search = useUserSearch(() =>
        showToast(isEnglish ? 'Search failed. Please try again.' : '搜索失败，请重试。', 'error'));
    const [recentUsers, setRecentUsers] = useState<UserRecord[]>([]);
    const [lastRecentSnap, setLastRecentSnap] = useState<QueryDocumentSnapshot | null>(null);
    const [loadingRecent, setLoadingRecent] = useState(false);
    const [hasMoreRecent, setHasMoreRecent] = useState(true);
    const [pendingDeletionUids, setPendingDeletionUids] = useState<Set<string>>(new Set());

    const recentGenRef = useRef(0);

    const applyUserUpdate = (uid: string, changes: Partial<UserRecord>) => {
        const merge = (u: UserRecord) => u.uid === uid ? {...u, ...changes} : u;
        setSelectedUser(prev => prev && merge(prev));
        search.setResults(prev => prev.map(merge));
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
            search.clear();
            search.setQuery('');
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
        loadRecentUsers().catch(() => {
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

    const runSearch = () => {
        if (!search.query.trim()) return;
        setSelectedUser(null);
        void search.run(selectedGroup, membersOnly);
    };

    return (
        <div className="admin-section">
            <div className="admin-search">
                <select
                    value={selectedGroup}
                    onChange={(e) => {
                        setSelectedGroup(e.target.value as UserGroup | '');
                        search.clear();
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
                <label className="admin-members-filter">
                    <input
                        type="checkbox"
                        checked={membersOnly}
                        onChange={(e) => {
                            setMembersOnly(e.target.checked);
                            search.clear();
                        }}
                    />
                    {isEnglish ? 'Members only' : '仅会员'}
                </label>
                <UserSearchInput
                    search={search}
                    onSearch={runSearch}
                    placeholder={isEnglish ? 'Search by email or name...' : '输入邮箱或姓名搜索...'}
                />
            </div>

            {search.results.length > 0 && !selectedUser && (
                <div className="admin-results">
                    {search.results.map((u) => (
                        <UserRow key={u.uid} user={u} onClick={() => setSelectedUser(u)}>
                            <UserTags user={u} pendingDeletion={pendingDeletionUids.has(u.uid)}/>
                            <span className="admin-user-badge-count">
                                {u.attendedEvents.length} {isEnglish ? 'events' : '活动'}
                            </span>
                        </UserRow>
                    ))}
                </div>
            )}

            {search.results.length === 0 && !search.searching && search.hasSearched && (
                <p className="admin-no-results">{isEnglish ? 'No users found.' : '未找到用户。'}</p>
            )}

            {!selectedUser && search.results.length === 0 && (
                <div className="admin-recent-users">
                    <h4 className="admin-badges-title">
                        {membersOnly
                            ? (isEnglish ? 'Active Members' : '有效会员')
                            : (isEnglish ? 'Recent Users' : '最近加入的用户')}
                    </h4>
                    {recentUsers.map((u) => (
                        <UserRow key={u.uid} user={u} onClick={() => setSelectedUser(u)}>
                            <UserTags user={u} pendingDeletion={pendingDeletionUids.has(u.uid)}/>
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
