import { useEffect, useState } from 'react';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { callToggleAttendance, functionsErrorCode, getFirebaseDb } from '~/lib/firebase';
import { useLanguage } from '~/components/LanguageContextProvider';
import { EventAttendeesList } from './EventAttendeesList';
import { UserSearchAdd } from './UserSearchAdd';
import type { ShowToast } from './utils';
import type { UserRecord } from './types';

interface PastEventAttendeesSectionProps {
    eventId: string;
    attendees: UserRecord[];
    loading: boolean;
    onReload: () => void | Promise<void>;
    showToast: ShowToast;
    readOnly?: boolean;
}

/** The attendee list for a past event, plus a search box to add attendees retroactively. */
export function PastEventAttendeesSection({
                                              eventId,
                                              attendees,
                                              loading,
                                              onReload,
                                              showToast,
                                              readOnly = false,
                                          }: PastEventAttendeesSectionProps) {
    const {isEnglish} = useLanguage();
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

    const addAttendee = async (user: UserRecord) => {
        setBusyUid(user.uid);
        try {
            await callToggleAttendance({targetUid: user.uid, eventId, grant: true});
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

    const excludeUids = new Set([...attendees.map(u => u.uid), ...staffUids]);

    return (
        <>
            <EventAttendeesList
                loading={loading}
                attendees={attendees}
                eventId={eventId}
                onReload={onReload}
                showToast={showToast}
                readOnly={readOnly}
            />

            {!readOnly && (
                <UserSearchAdd
                    excludeUids={excludeUids}
                    busyUid={busyUid}
                    onAdd={addAttendee}
                    addLabel={isEnglish ? 'Add as attendee' : '添加为参加者'}
                    addingLabel={isEnglish ? 'Adding...' : '添加中...'}
                    noMatchMessage={isEnglish
                        ? 'No matching users (already attendees or event staff are hidden).'
                        : '未找到匹配用户（已是参加者或工作人员的用户已隐藏）。'}
                    showToast={showToast}
                />
            )}
        </>
    );
}
