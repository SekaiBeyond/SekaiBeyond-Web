import { useEffect, useState } from 'react';
import { collection, endAt, getDocs, limit, orderBy, query, startAt, where, } from 'firebase/firestore';
import { callAssignEventStaff, callRemoveEventStaff, functionsErrorCode, getFirebaseDb, } from '~/lib/firebase';
import { useLanguage } from '~/components/LanguageContextProvider';
import { docToUserRecord, type ShowToast } from './utils';
import type { UserRecord } from './types';

interface EventStaffSectionProps {
    eventId: string;
    showToast: ShowToast;
    onCountChange?: (count: number) => void;
}

const SEARCH_LIMIT = 8;

export function EventStaffSection({eventId, showToast, onCountChange}: EventStaffSectionProps) {
    const {isEnglish} = useLanguage();
    const [staffList, setStaffList] = useState<UserRecord[]>([]);
    const [loading, setLoading] = useState(true);
    const [searchQuery, setSearchQuery] = useState('');
    const [searchResults, setSearchResults] = useState<UserRecord[]>([]);
    const [searching, setSearching] = useState(false);
    const [hasSearched, setHasSearched] = useState(false);
    const [busyUid, setBusyUid] = useState<string | null>(null);

    useEffect(() => {
        let stale = false;
        const load = async () => {
            setLoading(true);
            try {
                const db = getFirebaseDb();
                const q = query(
                    collection(db, 'users'),
                    where('eventStaffEvents', 'array-contains', eventId),
                );
                const snap = await getDocs(q);
                if (stale) return;
                setStaffList(snap.docs.map(docToUserRecord));
                onCountChange?.(snap.size);
            } catch {
                if (!stale) {
                    showToast(
                        isEnglish ? 'Failed to load event staff.' : '加载活动工作人员失败。',
                        'error',
                    );
                }
            } finally {
                if (!stale) setLoading(false);
            }
        };
        void load();
        return () => {
            stale = true;
        };
    }, [eventId, isEnglish, showToast, onCountChange]);

    const runSearch = async () => {
        const q = searchQuery.trim();
        if (!q) {
            setSearchResults([]);
            setHasSearched(false);
            return;
        }
        setSearching(true);
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
                        endAt(p + ''),
                        limit(SEARCH_LIMIT),
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

    const addStaff = async (user: UserRecord) => {
        setBusyUid(user.uid);
        try {
            await callAssignEventStaff({targetUid: user.uid, eventId});
            setStaffList(prev => {
                if (prev.some(u => u.uid === user.uid)) return prev;
                const next = [...prev, {
                    ...user,
                    eventStaffEvents: [...user.eventStaffEvents, eventId],
                    attendedEvents: user.attendedEvents.includes(eventId)
                        ? user.attendedEvents
                        : [...user.attendedEvents, eventId],
                }];
                onCountChange?.(next.length);
                return next;
            });
            setSearchResults(prev => prev.filter(u => u.uid !== user.uid));
            showToast(
                isEnglish ? `${user.displayName} added as event staff.` : `已添加 ${user.displayName} 为工作人员。`,
                'success',
            );
        } catch (err) {
            const code = functionsErrorCode(err);
            const msg = code === 'has-ticket'
                ? (isEnglish
                    ? `${user.displayName} has a ticket for this event. Delete their attendee record before assigning as staff.`
                    : `${user.displayName} 已有该活动的门票，请先删除其参加者记录再设为工作人员。`)
                : (isEnglish
                    ? `Failed to add staff${code ? ` (${code})` : ''}.`
                    : `添加失败${code ? `（${code}）` : ''}。`);
            showToast(msg, 'error');
        } finally {
            setBusyUid(null);
        }
    };

    const removeStaff = async (user: UserRecord) => {
        if (!confirm(isEnglish
            ? `Remove ${user.displayName} as event staff? Their attendance record stays.`
            : `撤销 ${user.displayName} 的工作人员权限？参加记录不会被移除。`
        )) return;
        setBusyUid(user.uid);
        try {
            await callRemoveEventStaff({targetUid: user.uid, eventId});
            setStaffList(prev => {
                const next = prev.filter(u => u.uid !== user.uid);
                onCountChange?.(next.length);
                return next;
            });
            showToast(
                isEnglish ? `${user.displayName} removed from event staff.` : `已撤销 ${user.displayName} 的权限。`,
                'warning',
            );
        } catch (err) {
            const code = functionsErrorCode(err);
            showToast(
                isEnglish
                    ? `Failed to remove staff${code ? ` (${code})` : ''}.`
                    : `撤销失败${code ? `（${code}）` : ''}。`,
                'error',
            );
        } finally {
            setBusyUid(null);
        }
    };

    const staffUids = new Set(staffList.map(u => u.uid));
    const candidates = searchResults.filter(u => !staffUids.has(u.uid));

    return (
        <div className="admin-attendees-section">
            <p className="admin-title-hint">
                {isEnglish
                    ? 'Event staff get ticket-scanning + attendee access for this event, are auto-marked as attended, and see a Staff badge on the event in their profile. This is independent of their global user group.'
                    : '工作人员可扫描该活动的门票、查看参加者，自动标记为已参加，并在个人主页该活动上显示"工作人员"标签。此权限独立于全局用户组。'}
            </p>

            {loading ? (
                <div className="profile-spinner admin-spinner-center"/>
            ) : staffList.length === 0 ? (
                <p className="admin-no-results">
                    {isEnglish ? 'No event staff yet.' : '暂无工作人员。'}
                </p>
            ) : (
                <>
                    <p className="admin-attendees-count">
                        {staffList.length} {isEnglish ? 'staff' : '位工作人员'}
                    </p>
                    {staffList.map(u => (
                        <div key={u.uid} className="admin-user-row">
                            <img src={u.photoURL} alt="" className="admin-user-avatar"
                                 referrerPolicy="no-referrer"/>
                            <div>
                                <div className="admin-user-name">{u.displayName}</div>
                                <div className="admin-user-email">{u.email}</div>
                            </div>
                            <button
                                className="admin-toggle-btn admin-toggle-revoke"
                                onClick={() => removeStaff(u)}
                                disabled={busyUid === u.uid}
                            >
                                {busyUid === u.uid
                                    ? (isEnglish ? 'Removing...' : '撤销中...')
                                    : (isEnglish ? 'Remove' : '撤销')}
                            </button>
                        </div>
                    ))}
                </>
            )}

            <div className="admin-event-staff-add"
                 style={{marginTop: 16, flexDirection: 'column', alignItems: 'stretch', gap: 8}}>
                <div className="admin-search">
                    <input
                        type="text"
                        className="admin-search-input"
                        placeholder={isEnglish ? 'Search user by email or name...' : '输入邮箱或姓名搜索用户...'}
                        value={searchQuery}
                        onChange={(e) => {
                            setSearchQuery(e.target.value);
                            setHasSearched(false);
                        }}
                        onKeyDown={(e) => e.key === 'Enter' && runSearch()}
                    />
                    <button
                        className="admin-search-btn"
                        onClick={runSearch}
                        disabled={searching || !searchQuery.trim()}
                    >
                        {searching
                            ? (isEnglish ? 'Searching...' : '搜索中...')
                            : (isEnglish ? 'Search' : '搜索')}
                    </button>
                </div>

                {hasSearched && !searching && candidates.length === 0 && (
                    <p className="admin-no-results">
                        {isEnglish ? 'No users found.' : '未找到匹配用户。'}
                    </p>
                )}

                {candidates.map(u => (
                    <div key={u.uid} className="admin-user-row">
                        <img src={u.photoURL} alt="" className="admin-user-avatar"
                             referrerPolicy="no-referrer"/>
                        <div>
                            <div className="admin-user-name">{u.displayName}</div>
                            <div className="admin-user-email">{u.email}</div>
                        </div>
                        <button
                            className="admin-toggle-btn admin-toggle-grant"
                            onClick={() => addStaff(u)}
                            disabled={busyUid === u.uid}
                        >
                            {busyUid === u.uid
                                ? (isEnglish ? 'Adding...' : '添加中...')
                                : (isEnglish ? 'Add as staff' : '设为工作人员')}
                        </button>
                    </div>
                ))}
            </div>
        </div>
    );
}
