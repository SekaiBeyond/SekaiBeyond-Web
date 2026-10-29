import { useEffect, useState } from 'react';
import { callAssignEventStaff, callRemoveEventStaff, functionsErrorCode } from '~/lib/firebase';
import { useLanguage } from '~/components/LanguageContextProvider';
import { UserRow } from './UserRow';
import { UserSearchAdd } from './UserSearchAdd';
import { fetchEventStaff, type ShowToast } from './utils';
import type { UserRecord } from './types';

interface EventStaffSectionProps {
    eventId: string;
    showToast: ShowToast;
    readOnly?: boolean;
    onCountChange?: (count: number) => void;
    onAttendeeRemoved?: () => void;
    /**
     * Opens the user in Users Management. Left out for event staff, who can't
     * open that tab, so a row opens the public profile instead.
     */
    onLookupUser?: (uid: string) => void;
}

export function EventStaffSection({
                                      eventId,
                                      showToast,
                                      readOnly = false,
                                      onCountChange,
                                      onAttendeeRemoved,
                                      onLookupUser,
                                  }: EventStaffSectionProps) {
    const {isEnglish} = useLanguage();
    const [staffList, setStaffList] = useState<UserRecord[]>([]);
    const [loading, setLoading] = useState(true);
    const [loaded, setLoaded] = useState(false);
    const [busyUid, setBusyUid] = useState<string | null>(null);

    // From an effect, not inside a list update, where setting the parent's state
    // happens mid-render. Only a list that loaded, so a failed load leaves the
    // parent's count as it was.
    useEffect(() => {
        if (loaded) onCountChange?.(staffList.length);
    }, [loaded, staffList.length, onCountChange]);

    useEffect(() => {
        let stale = false;
        const load = async () => {
            setLoading(true);
            setLoaded(false);
            try {
                const staff = await fetchEventStaff(eventId);
                if (stale) return;
                setStaffList(staff);
                setLoaded(true);
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
        // Not keyed on isEnglish: a language toggle shouldn't refetch.
    }, [eventId, showToast]);

    const addStaff = async (user: UserRecord) => {
        setBusyUid(user.uid);
        try {
            const result = await callAssignEventStaff({targetUid: user.uid, eventId});
            const attendeeRemoved = result.data.attendeeRemoved;
            setStaffList(prev => prev.some(u => u.uid === user.uid) ? prev : [...prev, user]);
            if (attendeeRemoved) onAttendeeRemoved?.();
            showToast(
                isEnglish
                    ? attendeeRemoved
                        ? `${user.displayName} added as event staff. Removed from attendees list.`
                        : `${user.displayName} added as event staff.`
                    : attendeeRemoved
                        ? `已添加 ${user.displayName} 为工作人员，已从参加者名单中移除。`
                        : `已添加 ${user.displayName} 为工作人员。`,
                'success',
            );
        } catch (err) {
            const code = functionsErrorCode(err);
            showToast(
                isEnglish
                    ? `Failed to add staff${code ? ` (${code})` : ''}.`
                    : `添加失败${code ? `（${code}）` : ''}。`,
                'error',
            );
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
            setStaffList(prev => prev.filter(u => u.uid !== user.uid));
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

    return (
        <div className="admin-attendees-section">
            <p className="admin-title-hint">
                {isEnglish
                    ? 'Event staff get ticket-scanning + attendee access for this event, are auto-marked as attended, and see a Staff badge on the event in their profile. This is independent of their global user group.'
                    : '工作人员可扫描该活动的门票、查看参加者，自动标记为已参加，并在个人主页该活动上显示"工作人员"标签。此权限独立于全局用户组。'}
            </p>

            {loading ? (
                <div className="spinner spinner-centered"/>
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
                        <UserRow
                            key={u.uid}
                            user={u}
                            // A new tab, so the event stays open behind the profile.
                            onClick={() => onLookupUser
                                ? onLookupUser(u.uid)
                                : window.open(`/profile?uid=${u.uid}`, '_blank', 'noopener')}
                        >
                            {!readOnly && (
                                <button
                                    className="admin-toggle-btn admin-toggle-revoke"
                                    onClick={(e) => {
                                        e.stopPropagation(); // the row behind it opens the user
                                        void removeStaff(u);
                                    }}
                                    onKeyDown={(e) => e.stopPropagation()}
                                    disabled={busyUid === u.uid}
                                >
                                    {busyUid === u.uid
                                        ? (isEnglish ? 'Removing...' : '撤销中...')
                                        : (isEnglish ? 'Remove' : '撤销')}
                                </button>
                            )}
                        </UserRow>
                    ))}
                </>
            )}

            {!readOnly && (
                <UserSearchAdd
                    excludeUids={new Set(staffList.map(u => u.uid))}
                    busyUid={busyUid}
                    onAdd={addStaff}
                    addLabel={isEnglish ? 'Add as staff' : '设为工作人员'}
                    addingLabel={isEnglish ? 'Adding...' : '添加中...'}
                    noMatchMessage={isEnglish ? 'No users found.' : '未找到匹配用户。'}
                    showToast={showToast}
                />
            )}
        </div>
    );
}
