import { useEffect, useState } from 'react';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { callAssignEventStaff, callRemoveEventStaff, functionsErrorCode, getFirebaseDb, } from '~/lib/firebase';
import { useLanguage } from '~/components/LanguageContextProvider';
import { UserRow } from './UserRow';
import { UserSearchAdd } from './UserSearchAdd';
import { docToUserRecord, type ShowToast } from './utils';
import type { UserRecord } from './types';

interface EventStaffSectionProps {
    eventId: string;
    showToast: ShowToast;
    readOnly?: boolean;
    onCountChange?: (count: number) => void;
    onAttendeeRemoved?: () => void;
}

export function EventStaffSection({
                                      eventId,
                                      showToast,
                                      readOnly = false,
                                      onCountChange,
                                      onAttendeeRemoved,
                                  }: EventStaffSectionProps) {
    const {isEnglish} = useLanguage();
    const [staffList, setStaffList] = useState<UserRecord[]>([]);
    const [loading, setLoading] = useState(true);
    const [busyUid, setBusyUid] = useState<string | null>(null);

    useEffect(() => {
        let stale = false;
        const load = async () => {
            setLoading(true);
            try {
                const db = getFirebaseDb();
                // Staff roster — for both upcoming and past events — is derived from
                // users' eventStaffEvents arrays (the past-event id is retained on
                // archive). assignEventStaff/removeEventStaff handle past events too.
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

    const addStaff = async (user: UserRecord) => {
        setBusyUid(user.uid);
        try {
            const result = await callAssignEventStaff({targetUid: user.uid, eventId});
            const attendeeRemoved = result.data.attendeeRemoved;
            setStaffList(prev => {
                if (prev.some(u => u.uid === user.uid)) return prev;
                const next = [...prev, {
                    ...user,
                    eventStaffEvents: [...user.eventStaffEvents, eventId],
                    attendedEvents: attendeeRemoved
                        ? user.attendedEvents.filter(e => e !== eventId)
                        : user.attendedEvents.includes(eventId)
                            ? user.attendedEvents
                            : [...user.attendedEvents, eventId],
                }];
                onCountChange?.(next.length);
                return next;
            });
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
                        <UserRow key={u.uid} user={u}>
                            {!readOnly && (
                                <button
                                    className="admin-toggle-btn admin-toggle-revoke"
                                    onClick={() => removeStaff(u)}
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
