import { useEffect, useState } from 'react';
import { collection, endAt, getDocs, limit, orderBy, query, startAt, where, } from 'firebase/firestore';
import { callToggleAttendance, functionsErrorCode, getFirebaseDb, } from '~/lib/firebase';
import { formatGroupWithTitle } from '~/components/AuthProvider';
import { useLanguage } from '~/components/LanguageContextProvider';
import { docToUserRecord, type ShowToast } from './utils';
import type { UserRecord } from './types';

interface PastEventAttendeesSectionProps {
    eventId: string;
    attendees: UserRecord[];
    loading: boolean;
    onReload: () => void | Promise<void>;
    showToast: ShowToast;
}

const SEARCH_LIMIT = 8;

export function PastEventAttendeesSection({
                                              eventId,
                                              attendees,
                                              loading,
                                              onReload,
                                              showToast,
                                          }: PastEventAttendeesSectionProps) {
    const {isEnglish} = useLanguage();
    const [searchQuery, setSearchQuery] = useState('');
    const [searchResults, setSearchResults] = useState<UserRecord[]>([]);
    const [searching, setSearching] = useState(false);
    const [hasSearched, setHasSearched] = useState(false);
    const [busyUid, setBusyUid] = useState<string | null>(null);
    const [staffUids, setStaffUids] = useState<Set<string>>(new Set());

    // Pull staff UIDs once so we can pre-filter the search results — saves the
    // admin a round-trip to "add → rejected → remove staff first → retry".
    useEffect(() => {
        let stale = false;
        const load = async () => {
            try {
                const db = getFirebaseDb();
                const snap = await getDocs(query(
                    collection(db, 'users'),
                    where('eventStaffEvents', 'array-contains', eventId),
                ));
                if (stale) return;
                setStaffUids(new Set(snap.docs.map(d => d.id)));
            } catch {
                // Non-fatal — backend still rejects has-staff with a clear toast.
            }
        };
        void load();
        return () => {
            stale = true;
        };
    }, [eventId]);

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
                        endAt(p + ''),
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

    const addAttendee = async (user: UserRecord) => {
        setBusyUid(user.uid);
        try {
            await callToggleAttendance({targetUid: user.uid, eventId, grant: true});
            setSearchResults(prev => prev.filter(u => u.uid !== user.uid));
            await onReload();
            showToast(
                isEnglish ? `${user.displayName} added as attendee.` : `已添加 ${user.displayName} 为参加者。`,
                'success',
            );
        } catch (err) {
            const code = functionsErrorCode(err);
            const msg = code === 'has-staff'
                ? (isEnglish
                    ? `${user.displayName} is event staff for this event. Remove them as staff before adding as attendee.`
                    : `${user.displayName} 是该活动的工作人员，请先撤销其工作人员身份再添加为参加者。`)
                : (isEnglish
                    ? `Failed to add attendee${code ? ` (${code})` : ''}.`
                    : `添加失败${code ? `（${code}）` : ''}。`);
            showToast(msg, 'error');
        } finally {
            setBusyUid(null);
        }
    };

    const removeAttendee = async (user: UserRecord) => {
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

    const attendeeUids = new Set(attendees.map(u => u.uid));
    const candidates = searchResults.filter(
        u => !attendeeUids.has(u.uid) && !staffUids.has(u.uid),
    );

    return (
        <div className="admin-attendees-section">
            {loading ? (
                <div className="profile-spinner admin-spinner-center"/>
            ) : attendees.length === 0 ? (
                <p className="admin-no-results">
                    {isEnglish ? 'No attendees yet.' : '暂无参加者。'}
                </p>
            ) : (
                <>
                    <p className="admin-attendees-count">
                        {attendees.length} {isEnglish ? 'attendees' : '人参加'}
                    </p>
                    {attendees.map(u => (
                        <div key={u.uid} className="admin-user-row">
                            <img src={u.photoURL} alt="" className="admin-user-avatar"
                                 referrerPolicy="no-referrer"/>
                            <div>
                                <div className="admin-user-name">{u.displayName}</div>
                                <div className="admin-user-email">{u.email}</div>
                            </div>
                            <span className="admin-user-group-tag" data-group={u.group}>
                                {formatGroupWithTitle(u.group, u.title, isEnglish)}
                            </span>
                            <button
                                className="admin-toggle-btn admin-toggle-revoke"
                                onClick={() => removeAttendee(u)}
                                disabled={busyUid === u.uid}
                            >
                                {busyUid === u.uid
                                    ? (isEnglish ? 'Removing...' : '移除中...')
                                    : (isEnglish ? 'Remove' : '移除')}
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
                        {isEnglish
                            ? 'No matching users (already attendees or event staff are hidden).'
                            : '未找到匹配用户（已是参加者或工作人员的用户已隐藏）。'}
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
                            onClick={() => addAttendee(u)}
                            disabled={busyUid === u.uid}
                        >
                            {busyUid === u.uid
                                ? (isEnglish ? 'Adding...' : '添加中...')
                                : (isEnglish ? 'Add as attendee' : '添加为参加者')}
                        </button>
                    </div>
                ))}
            </div>
        </div>
    );
}
