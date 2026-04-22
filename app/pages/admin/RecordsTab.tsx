import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import {
    collection,
    type DocumentSnapshot,
    getDocs,
    limit,
    orderBy,
    query,
    type QueryConstraint,
    startAfter,
    where,
} from 'firebase/firestore';
import { GROUP_LABELS } from '~/components/AuthProvider';
import { useLanguage } from '~/components/LanguageContextProvider';
import { getFirebaseDb } from '~/lib/firebase';
import type { PastEvent } from '~/lib/pastEvents';
import type { UpcomingEvent } from '~/lib/upcomingEvents';
import type { ActivityRecord, BadgeDef, RecordType } from './types';

const PAGE_SIZE = 20;

// Requires composite Firestore indexes: (type, timestamp) and (performedBy, timestamp)
const TYPE_CATEGORIES: Record<string, RecordType[]> = {
    role: ['group-assign', 'title-set', 'event-staff-assign', 'event-staff-remove'],
    code: ['code-create', 'badge-code-activate', 'badge-code-deactivate', 'code-delete',
        'event-code-activate', 'event-code-deactivate', 'event-code-time-window'],
    attend: ['badge-grant', 'badge-revoke', 'event-attend', 'event-unattend', 'event-claim'],
    badge: ['achievement-grant', 'achievement-revoke', 'badge-claim', 'badge-create', 'badge-edit',
        'badge-delete', 'badge-deletion-requested', 'badge-deletion-cancelled', 'badge-deleted'],
    event: ['event-create', 'event-edit', 'event-delete',
        'event-deletion-requested', 'event-deletion-cancelled', 'event-deleted',
        'past-event-publish', 'past-event-unpublish',
        'upcoming-event-create', 'upcoming-event-edit', 'upcoming-event-delete',
        'upcoming-event-deletion-requested', 'upcoming-event-deletion-cancelled', 'upcoming-event-deleted',
        'upcoming-event-archive', 'upcoming-event-publish', 'upcoming-event-unpublish',
        'upcoming-event-email-template-update'],
    ticket: ['ticket-import', 'ticket-redeem', 'ticket-void', 'ticket-attendee-delete',
        'ticket-regenerate', 'ticket-email-send'],
    tag: ['tag-create', 'tag-edit', 'tag-delete'],
    account: ['account-deletion-requested', 'account-deletion-cancelled', 'account-deleted'],
};

interface RecordsTabProps {
    pastEvents: PastEvent[];
    upcomingEvents: UpcomingEvent[];
    badgeDefs: BadgeDef[];
    onLookupUser: (uid: string) => void;
    onSelectBadge: (badgeId: string) => void;
    onSelectEvent: (eventId: string) => void;
    onSelectUpcomingEvent: (eventId: string) => void;
}

export const RecordsTab = ({
                               pastEvents,
                               upcomingEvents,
                               badgeDefs,
                               onLookupUser,
                               onSelectBadge,
                               onSelectEvent,
                               onSelectUpcomingEvent,
                           }: RecordsTabProps) => {
    const {isEnglish} = useLanguage();
    const [records, setRecords] = useState<ActivityRecord[]>([]);
    const [loadingRecords, setLoadingRecords] = useState(false);
    const [lastDoc, setLastDoc] = useState<DocumentSnapshot | null>(null);
    const [hasMore, setHasMore] = useState(true);
    const [recordFilterType, setRecordFilterType] = useState<string>('');
    const [recordFilterActor, setRecordFilterActor] = useState('');
    const [knownActors, setKnownActors] = useState<{uid: string; name: string}[]>([]);
    const activeFilterRef = useRef({type: '', actor: ''});

    const parseRecordDocs = (snapshot: {docs: DocumentSnapshot[]}): ActivityRecord[] =>
        snapshot.docs.map(docSnap => {
            const data = docSnap.data()!;
            return {
                id: docSnap.id,
                type: data.type,
                performedBy: data.performedBy,
                performedByName: data.performedByName ?? '',
                targetUid: data.targetUid,
                targetName: data.targetName,
                targetEmail: data.targetEmail,
                eventTitle: data.eventTitle,
                eventId: data.eventId,
                badgeId: data.badgeId,
                badgeName: data.badgeName,
                tagName: data.tagName,
                code: data.code,
                oldGroup: data.oldGroup,
                newGroup: data.newGroup,
                oldTitle: data.oldTitle,
                newTitle: data.newTitle,
                addedCount: data.addedCount,
                replacedCount: data.replacedCount,
                sentCount: data.sentCount,
                timestamp: data.timestamp?.toDate() ?? new Date(),
            };
        });

    const buildRecordsQuery = (typeFilter: string, actorFilter: string, after?: DocumentSnapshot) => {
        const constraints: QueryConstraint[] = [];
        if (typeFilter && TYPE_CATEGORIES[typeFilter]) {
            constraints.push(where('type', 'in', TYPE_CATEGORIES[typeFilter]));
        }
        if (actorFilter) {
            constraints.push(where('performedBy', '==', actorFilter));
        }
        constraints.push(orderBy('timestamp', 'desc'));
        if (after) constraints.push(startAfter(after));
        constraints.push(limit(PAGE_SIZE));
        return query(collection(getFirebaseDb(), 'records'), ...constraints);
    };

    const loadRecords = useCallback(async (typeFilter: string, actorFilter: string, after?: DocumentSnapshot) => {
        setLoadingRecords(true);
        try {
            const snapshot = await getDocs(buildRecordsQuery(typeFilter, actorFilter, after));
            const items = parseRecordDocs(snapshot);

            if (after) {
                setRecords(prev => [...prev, ...items]);
            } else {
                setRecords(items);
            }
            setLastDoc(snapshot.docs[snapshot.docs.length - 1] ?? null);
            setHasMore(snapshot.docs.length === PAGE_SIZE);

            // Track unique actors for the dropdown
            setKnownActors(prev => {
                const merged = [...prev];
                for (const item of items) {
                    if (!merged.some(a => a.uid === item.performedBy)) {
                        merged.push({uid: item.performedBy, name: item.performedByName});
                    }
                }
                return merged;
            });
        } finally {
            setLoadingRecords(false);
        }
    }, []);

    useEffect(() => {
        loadRecords('', '').catch(console.error);
    }, [loadRecords]);

    const applyFilters = (type: string, actor: string) => {
        activeFilterRef.current = {type, actor};
        setRecords([]);
        setLastDoc(null);
        setHasMore(true);
        loadRecords(type, actor).catch(console.error);
    };

    const loadMore = () => {
        const {type, actor} = activeFilterRef.current;
        if (lastDoc && hasMore) loadRecords(type, actor, lastDoc).catch(console.error);
    };

    const clickableName = (uid: string, name: string): ReactNode => (
        <span className="record-clickable-name" onClick={() => onLookupUser(uid)}>{name}</span>
    );

    const clickableBadge = (badgeId: string, badgeName?: string): ReactNode => {
        const bd = badgeDefs.find(d => d.id === badgeId);
        const name = badgeName ?? (bd ? (isEnglish ? bd.name : bd.nameCn) : badgeId);
        if (!bd) return <span>{name}</span>;
        return <span className="record-clickable-name" onClick={() => onSelectBadge(bd.id)}>{name}</span>;
    };

    const clickableEvent = (eventId: string, eventTitle?: string): ReactNode => {
        const evt = pastEvents.find(e => e.id === eventId);
        const title = evt ? (isEnglish ? evt.title : evt.titleCn) : (eventTitle ?? eventId);
        if (!evt) return <span>{title}</span>;
        return <span className="record-clickable-name" onClick={() => onSelectEvent(evt.id)}>{title}</span>;
    };

    const clickableUpcomingEvent = (eventId: string | undefined, eventTitle?: string): ReactNode => {
        const title = eventTitle ?? eventId ?? '';
        if (!eventId) return <span>{title}</span>;
        if (upcomingEvents.some(e => e.id === eventId)) {
            return <span className="record-clickable-name"
                         onClick={() => onSelectUpcomingEvent(eventId)}>{title}</span>;
        }
        if (pastEvents.some(e => e.id === eventId)) {
            return <span className="record-clickable-name" onClick={() => onSelectEvent(eventId)}>{title}</span>;
        }
        return <span>{title}</span>;
    };

    const getRecordLabel = (r: ActivityRecord): ReactNode => {
        const target = r.targetUid ? clickableName(r.targetUid, r.targetName ?? '') : r.targetName;
        switch (r.type) {
            case 'group-assign':
                return isEnglish
                    ? <>assigned {target} from {GROUP_LABELS[r.oldGroup!].en} to {GROUP_LABELS[r.newGroup!].en}</>
                    : <>将 {target} 从 {GROUP_LABELS[r.oldGroup!].zh} 改为 {GROUP_LABELS[r.newGroup!].zh}</>;
            case 'title-set': {
                const oldT = r.oldTitle ?? '';
                const newT = r.newTitle ?? '';
                if (!oldT && newT) {
                    return isEnglish
                        ? <>set {target}'s title to "{newT}"</>
                        : <>将 {target} 的头衔设为"{newT}"</>;
                }
                if (oldT && !newT) {
                    return isEnglish
                        ? <>cleared {target}'s title ("{oldT}")</>
                        : <>清除了 {target} 的头衔（"{oldT}"）</>;
                }
                if (oldT && newT) {
                    return isEnglish
                        ? <>changed {target}'s title from "{oldT}" to "{newT}"</>
                        : <>将 {target} 的头衔从"{oldT}"改为"{newT}"</>;
                }
                return isEnglish ? <>updated {target}'s title</> : <>更新了 {target} 的头衔</>;
            }
            case 'code-create': {
                if (r.eventId) {
                    const isPast = pastEvents.some(e => e.id === r.eventId);
                    const event = isPast
                        ? clickableEvent(r.eventId, r.eventTitle)
                        : clickableUpcomingEvent(r.eventId, r.eventTitle);
                    return isEnglish ? <>created check-in code for {event}</> : <>为 {event} 创建了签到码</>;
                }
                const badge = r.badgeId ? clickableBadge(r.badgeId) : r.badgeName;
                return isEnglish ? <>created claim code for {badge}</> : <>为 {badge} 创建了兑换码</>;
            }
            case 'badge-grant':  // legacy type — same as event-attend
            case 'event-attend':
                return isEnglish
                    ? <>marked {target} as
                        attended {r.eventId ? clickableEvent(r.eventId, r.eventTitle) : (r.eventTitle ? clickableEvent(r.eventTitle) : '')}</>
                    : <>标记 {target} 参加了 {r.eventId ? clickableEvent(r.eventId, r.eventTitle) : (r.eventTitle ? clickableEvent(r.eventTitle) : '')}</>;
            case 'badge-revoke':  // legacy type — same as event-unattend
            case 'event-unattend':
                return isEnglish
                    ? <>revoked {target}'s attendance
                        for {r.eventId ? clickableEvent(r.eventId, r.eventTitle) : (r.eventTitle ? clickableEvent(r.eventTitle) : '')}</>
                    : <>撤销了 {target} 的 {r.eventId ? clickableEvent(r.eventId, r.eventTitle) : (r.eventTitle ? clickableEvent(r.eventTitle) : '')} 签到</>;
            case 'event-claim':
                return isEnglish
                    ? <>checked in to {r.eventId ? clickableEvent(r.eventId, r.eventTitle) : (r.eventTitle ?? '')} with
                        code</>
                    : <>使用兑换码签到 {r.eventId ? clickableEvent(r.eventId, r.eventTitle) : (r.eventTitle ?? '')}</>;
            case 'badge-claim': {
                const badge = r.badgeId ? clickableBadge(r.badgeId, r.badgeName ?? undefined) : r.badgeName;
                return isEnglish ? <>claimed {badge} badge with code</> : <>使用兑换码获得 {badge} 徽章</>;
            }
            case 'badge-code-activate': {
                const badge = r.badgeId ? clickableBadge(r.badgeId, r.badgeName ?? undefined) : r.badgeName;
                return isEnglish ? <>activated code for {badge}</> : <>激活了 {badge} 的兑换码</>;
            }
            case 'badge-code-deactivate': {
                const badge = r.badgeId ? clickableBadge(r.badgeId, r.badgeName ?? undefined) : r.badgeName;
                return isEnglish ? <>deactivated code for {badge}</> : <>停用了 {badge} 的兑换码</>;
            }
            case 'code-delete': {
                const badge = r.badgeId ? clickableBadge(r.badgeId, r.badgeName ?? undefined) : r.badgeName;
                return isEnglish ? <>deleted code for {badge}</> : <>删除了 {badge} 的兑换码</>;
            }
            case 'achievement-grant': {
                const badge = r.badgeId ? clickableBadge(r.badgeId, r.badgeName ?? undefined) : r.badgeName;
                return isEnglish ? <>granted {badge} badge to {target}</> : <>授予 {target} {badge} 徽章</>;
            }
            case 'achievement-revoke': {
                const badge = r.badgeId ? clickableBadge(r.badgeId, r.badgeName ?? undefined) : r.badgeName;
                return isEnglish ? <>revoked {badge} badge from {target}</> : <>撤销了 {target} 的 {badge} 徽章</>;
            }
            case 'badge-create': {
                const badge = r.badgeId ? clickableBadge(r.badgeId, r.badgeName ?? undefined) : r.badgeName;
                return isEnglish ? <>created badge {badge}</> : <>创建了徽章 {badge}</>;
            }
            case 'badge-edit': {
                const badge = r.badgeId ? clickableBadge(r.badgeId, r.badgeName ?? undefined) : r.badgeName;
                return isEnglish ? <>edited badge {badge}</> : <>编辑了徽章 {badge}</>;
            }
            case 'badge-delete':
                return isEnglish ? <>deleted badge {r.badgeName ?? ''}</> : <>删除了徽章 {r.badgeName ?? ''}</>;
            case 'badge-deletion-requested': {
                const badge = r.badgeId ? clickableBadge(r.badgeId, r.badgeName ?? undefined) : r.badgeName;
                return isEnglish
                    ? <>requested deletion of badge {badge}</>
                    : <>申请删除徽章 {badge}</>;
            }
            case 'badge-deletion-cancelled': {
                const badge = r.badgeId ? clickableBadge(r.badgeId, r.badgeName ?? undefined) : r.badgeName;
                return isEnglish
                    ? <>cancelled deletion of badge {badge}</>
                    : <>取消了徽章 {badge} 的删除</>;
            }
            case 'badge-deleted':
                return isEnglish ? <>deleted badge {r.badgeName ?? ''}</> : <>删除了徽章 {r.badgeName ?? ''}</>;
            case 'event-create':
                return isEnglish
                    ? <>created
                        event {r.eventId ? clickableEvent(r.eventId, r.eventTitle) : (r.eventTitle ? clickableEvent(r.eventTitle) : '')}</>
                    : <>创建了活动 {r.eventId ? clickableEvent(r.eventId, r.eventTitle) : (r.eventTitle ? clickableEvent(r.eventTitle) : '')}</>;
            case 'event-edit':
                return isEnglish
                    ? <>edited
                        event {r.eventId ? clickableEvent(r.eventId, r.eventTitle) : (r.eventTitle ? clickableEvent(r.eventTitle) : '')}</>
                    : <>编辑了活动 {r.eventId ? clickableEvent(r.eventId, r.eventTitle) : (r.eventTitle ? clickableEvent(r.eventTitle) : '')}</>;
            case 'event-delete':
                return isEnglish
                    ? <>deleted event {r.eventTitle ?? r.eventId ?? ''}</>
                    : <>删除了活动 {r.eventTitle ?? r.eventId ?? ''}</>;
            case 'event-deletion-requested':
                return isEnglish
                    ? <>requested deletion of
                        event {r.eventId ? clickableEvent(r.eventId, r.eventTitle) : (r.eventTitle ?? '')}</>
                    : <>申请删除活动 {r.eventId ? clickableEvent(r.eventId, r.eventTitle) : (r.eventTitle ?? '')}</>;
            case 'event-deletion-cancelled':
                return isEnglish
                    ? <>cancelled deletion of
                        event {r.eventId ? clickableEvent(r.eventId, r.eventTitle) : (r.eventTitle ?? '')}</>
                    : <>取消了活动 {r.eventId ? clickableEvent(r.eventId, r.eventTitle) : (r.eventTitle ?? '')} 的删除</>;
            case 'event-deleted':
                return isEnglish
                    ? <>deleted event {r.eventTitle ?? r.eventId ?? ''}</>
                    : <>删除了活动 {r.eventTitle ?? r.eventId ?? ''}</>;
            case 'past-event-publish':
                return isEnglish
                    ? <>published
                        event {r.eventId ? clickableEvent(r.eventId, r.eventTitle) : (r.eventTitle ?? '')}</>
                    : <>发布了活动 {r.eventId ? clickableEvent(r.eventId, r.eventTitle) : (r.eventTitle ?? '')}</>;
            case 'past-event-unpublish':
                return isEnglish
                    ? <>unpublished
                        event {r.eventId ? clickableEvent(r.eventId, r.eventTitle) : (r.eventTitle ?? '')}</>
                    : <>取消发布了活动 {r.eventId ? clickableEvent(r.eventId, r.eventTitle) : (r.eventTitle ?? '')}</>;
            case 'upcoming-event-create':
                return isEnglish
                    ? <>created upcoming event {clickableUpcomingEvent(r.eventId, r.eventTitle)}</>
                    : <>创建了活动预告 {clickableUpcomingEvent(r.eventId, r.eventTitle)}</>;
            case 'upcoming-event-edit':
                return isEnglish
                    ? <>edited upcoming event {clickableUpcomingEvent(r.eventId, r.eventTitle)}</>
                    : <>编辑了活动预告 {clickableUpcomingEvent(r.eventId, r.eventTitle)}</>;
            case 'upcoming-event-delete':
                return isEnglish
                    ? <>deleted upcoming event {r.eventTitle ?? ''}</>
                    : <>删除了活动预告 {r.eventTitle ?? ''}</>;
            case 'upcoming-event-deletion-requested':
                return isEnglish
                    ? <>requested deletion of upcoming event {clickableUpcomingEvent(r.eventId, r.eventTitle)}</>
                    : <>申请删除活动预告 {clickableUpcomingEvent(r.eventId, r.eventTitle)}</>;
            case 'upcoming-event-deletion-cancelled':
                return isEnglish
                    ? <>cancelled deletion of upcoming event {clickableUpcomingEvent(r.eventId, r.eventTitle)}</>
                    : <>取消了活动预告 {clickableUpcomingEvent(r.eventId, r.eventTitle)} 的删除</>;
            case 'upcoming-event-deleted':
                return isEnglish
                    ? <>deleted upcoming event {r.eventTitle ?? ''}</>
                    : <>删除了活动预告 {r.eventTitle ?? ''}</>;
            case 'upcoming-event-archive':
                return isEnglish
                    ? <>archived {r.eventTitle ?? ''} to past events</>
                    : <>将 {r.eventTitle ?? ''} 归档到往期活动</>;
            case 'upcoming-event-publish':
                return isEnglish
                    ? <>published upcoming event {clickableUpcomingEvent(r.eventId, r.eventTitle)}</>
                    : <>发布了活动预告 {clickableUpcomingEvent(r.eventId, r.eventTitle)}</>;
            case 'upcoming-event-unpublish':
                return isEnglish
                    ? <>unpublished upcoming event {clickableUpcomingEvent(r.eventId, r.eventTitle)}</>
                    : <>取消发布了活动预告 {clickableUpcomingEvent(r.eventId, r.eventTitle)}</>;
            case 'event-code-activate':
                return isEnglish
                    ? <>activated check-in code
                        for {r.eventId ? clickableEvent(r.eventId, r.eventTitle) : (r.eventTitle ?? '')}</>
                    : <>激活了 {r.eventId ? clickableEvent(r.eventId, r.eventTitle) : (r.eventTitle ?? '')} 的签到码</>;
            case 'event-code-deactivate':
                return isEnglish
                    ? <>deactivated check-in code
                        for {r.eventId ? clickableEvent(r.eventId, r.eventTitle) : (r.eventTitle ?? '')}</>
                    : <>停用了 {r.eventId ? clickableEvent(r.eventId, r.eventTitle) : (r.eventTitle ?? '')} 的签到码</>;
            case 'event-code-time-window':
                return isEnglish
                    ? <>updated time window for check-in code
                        of {r.eventId ? clickableEvent(r.eventId, r.eventTitle) : (r.eventTitle ?? '')}</>
                    : <>更新了 {r.eventId ? clickableEvent(r.eventId, r.eventTitle) : (r.eventTitle ?? '')} 签到码的时间窗口</>;
            case 'tag-create':
                return isEnglish
                    ? <>created tag {r.tagName ?? ''}</>
                    : <>创建了标签 {r.tagName ?? ''}</>;
            case 'tag-edit':
                return isEnglish
                    ? <>edited tag {r.tagName ?? ''}</>
                    : <>编辑了标签 {r.tagName ?? ''}</>;
            case 'tag-delete':
                return isEnglish
                    ? <>deleted tag {r.tagName ?? ''}</>
                    : <>删除了标签 {r.tagName ?? ''}</>;
            case 'account-deletion-requested': {
                const selfRequest = r.performedBy && r.targetUid && r.performedBy === r.targetUid;
                if (selfRequest) {
                    return isEnglish
                        ? <>requested account deletion</>
                        : <>申请删除账号</>;
                }
                return isEnglish
                    ? <>requested deletion of {target}'s account</>
                    : <>申请删除 {target} 的账号</>;
            }
            case 'account-deletion-cancelled': {
                const selfCancel = r.performedBy && r.targetUid && r.performedBy === r.targetUid;
                if (selfCancel) {
                    return isEnglish
                        ? <>cancelled their account deletion</>
                        : <>取消了账号删除</>;
                }
                return isEnglish
                    ? <>cancelled deletion of {target}'s account</>
                    : <>取消了 {target} 的账号删除</>;
            }
            case 'account-deleted': {
                const name = r.targetName || r.targetEmail || r.targetUid || '';
                return isEnglish
                    ? <>deleted account {name}</>
                    : <>删除了账号 {name}</>;
            }
            case 'ticket-import': {
                const event = clickableUpcomingEvent(r.eventId, r.eventTitle);
                const added = r.addedCount ?? 0;
                const replaced = r.replacedCount ?? 0;
                return isEnglish
                    ? <>imported attendees for {event} ({added} added, {replaced} replaced)</>
                    : <>导入了 {event} 的参加者（新增 {added}，替换 {replaced}）</>;
            }
            case 'ticket-redeem': {
                const event = clickableUpcomingEvent(r.eventId, r.eventTitle);
                return isEnglish
                    ? <>redeemed a ticket for {r.targetName ?? r.targetEmail ?? ''} at {event}</>
                    : <>为 {r.targetName ?? r.targetEmail ?? ''} 在 {event} 验证了门票</>;
            }
            case 'ticket-void': {
                const event = clickableUpcomingEvent(r.eventId, r.eventTitle);
                return isEnglish
                    ? <>voided a ticket for {r.targetName ?? r.targetEmail ?? ''} at {event}</>
                    : <>作废了 {r.targetName ?? r.targetEmail ?? ''} 在 {event} 的一张门票</>;
            }
            case 'ticket-attendee-delete': {
                const event = clickableUpcomingEvent(r.eventId, r.eventTitle);
                return isEnglish
                    ? <>removed attendee {r.targetName ?? r.targetEmail ?? ''} from {event}</>
                    : <>将 {r.targetName ?? r.targetEmail ?? ''} 从 {event} 的名单中移除</>;
            }
            case 'ticket-regenerate': {
                const event = clickableUpcomingEvent(r.eventId, r.eventTitle);
                return isEnglish
                    ? <>re-issued tickets for {r.targetName ?? r.targetEmail ?? ''} at {event}</>
                    : <>为 {r.targetName ?? r.targetEmail ?? ''} 在 {event} 重新签发门票</>;
            }
            case 'ticket-email-send': {
                const event = clickableUpcomingEvent(r.eventId, r.eventTitle);
                const sent = r.sentCount ?? 0;
                return isEnglish
                    ? <>sent {sent} ticket email{sent === 1 ? '' : 's'} for {event}</>
                    : <>为 {event} 发送了 {sent} 封门票邮件</>;
            }
            case 'upcoming-event-email-template-update':
                return isEnglish
                    ? <>updated the ticket email template
                        for {clickableUpcomingEvent(r.eventId, r.eventTitle)}</>
                    : <>更新了 {clickableUpcomingEvent(r.eventId, r.eventTitle)} 的门票邮件模板</>;
            case 'event-staff-assign': {
                const event = clickableUpcomingEvent(r.eventId, r.eventTitle);
                return isEnglish
                    ? <>granted {target} event-staff access to {event}</>
                    : <>授予 {target} {event} 的活动工作人员权限</>;
            }
            case 'event-staff-remove': {
                const event = clickableUpcomingEvent(r.eventId, r.eventTitle);
                return isEnglish
                    ? <>revoked {target}'s event-staff access to {event}</>
                    : <>撤销了 {target} 对 {event} 的活动工作人员权限</>;
            }
        }
    };

    const getRecordTypeTag = (type: RecordType) => {
        switch (type) {
            case 'group-assign':
            case 'title-set':
            case 'event-staff-assign':
            case 'event-staff-remove':
                return isEnglish ? 'Role' : '角色';
            case 'code-create':
            case 'badge-code-activate':
            case 'badge-code-deactivate':
            case 'code-delete':
            case 'event-code-activate':
            case 'event-code-deactivate':
            case 'event-code-time-window':
                return isEnglish ? 'Code' : '兑换码';
            case 'badge-grant':
            case 'badge-revoke':
            case 'event-attend':
            case 'event-unattend':
            case 'event-claim':
                return isEnglish ? 'Attend' : '签到';
            case 'achievement-grant':
            case 'achievement-revoke':
            case 'badge-claim':
            case 'badge-create':
            case 'badge-edit':
            case 'badge-delete':
            case 'badge-deletion-requested':
            case 'badge-deletion-cancelled':
            case 'badge-deleted':
                return isEnglish ? 'Badge' : '徽章';
            case 'event-create':
            case 'event-edit':
            case 'event-delete':
            case 'event-deletion-requested':
            case 'event-deletion-cancelled':
            case 'event-deleted':
            case 'past-event-publish':
            case 'past-event-unpublish':
            case 'upcoming-event-create':
            case 'upcoming-event-edit':
            case 'upcoming-event-delete':
            case 'upcoming-event-deletion-requested':
            case 'upcoming-event-deletion-cancelled':
            case 'upcoming-event-deleted':
            case 'upcoming-event-archive':
            case 'upcoming-event-publish':
            case 'upcoming-event-unpublish':
            case 'upcoming-event-email-template-update':
                return isEnglish ? 'Event' : '活动';
            case 'ticket-import':
            case 'ticket-redeem':
            case 'ticket-void':
            case 'ticket-attendee-delete':
            case 'ticket-regenerate':
            case 'ticket-email-send':
                return isEnglish ? 'Ticket' : '门票';
            case 'tag-create':
            case 'tag-edit':
            case 'tag-delete':
                return isEnglish ? 'Tag' : '标签';
            case 'account-deletion-requested':
            case 'account-deletion-cancelled':
            case 'account-deleted':
                return isEnglish ? 'Account' : '账号';
            default:
                return type;
        }
    };

    return (
        <div className="admin-section">
            <div className="record-filter-bar">
                <span className="record-filter-label">{isEnglish ? 'Filter' : '筛选'}</span>
                <select
                    className="record-filter-select"
                    value={recordFilterType}
                    onChange={e => {
                        const val = e.target.value;
                        setRecordFilterType(val);
                        applyFilters(val, recordFilterActor);
                    }}
                >
                    <option value="">{isEnglish ? 'All Types' : '所有类型'}</option>
                    <option value="role">{isEnglish ? 'Role' : '角色'}</option>
                    <option value="code">{isEnglish ? 'Code' : '兑换码'}</option>
                    <option value="attend">{isEnglish ? 'Attend' : '签到'}</option>
                    <option value="badge">{isEnglish ? 'Badge' : '徽章'}</option>
                    <option value="event">{isEnglish ? 'Event' : '活动'}</option>
                    <option value="ticket">{isEnglish ? 'Ticket' : '门票'}</option>
                    <option value="tag">{isEnglish ? 'Tag' : '标签'}</option>
                    <option value="account">{isEnglish ? 'Account' : '账号'}</option>
                </select>
                <select
                    className="record-filter-select"
                    value={recordFilterActor}
                    onChange={e => {
                        const val = e.target.value;
                        setRecordFilterActor(val);
                        applyFilters(recordFilterType, val);
                    }}
                >
                    <option value="">{isEnglish ? 'All Actors' : '所有操作人'}</option>
                    {knownActors.map(a => (
                        <option key={a.uid} value={a.uid}>{a.name}</option>
                    ))}
                </select>
                {(recordFilterType || recordFilterActor) && (
                    <button
                        className="record-filter-reset"
                        onClick={() => {
                            setRecordFilterType('');
                            setRecordFilterActor('');
                            applyFilters('', '');
                        }}
                    >
                        {isEnglish ? 'Reset' : '重置'}
                    </button>
                )}
            </div>

            {loadingRecords && records.length === 0 && (
                <div className="profile-spinner admin-spinner-center"/>
            )}

            {!loadingRecords && records.length === 0 && (
                <p className="admin-no-results">{isEnglish ? 'No records yet.' : '暂无记录。'}</p>
            )}

            {records.map(r => (
                <div key={r.id} className="record-row">
                    <span className={`record-type-tag record-type-${r.type}`}>
                        {getRecordTypeTag(r.type)}
                    </span>
                    <div className="record-content">
                        <span className="record-actor">
                            {r.performedBy
                                ? clickableName(r.performedBy, r.performedByName)
                                : (isEnglish ? 'System' : '系统')}
                        </span>
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

            {hasMore && records.length > 0 && (
                <button
                    className="admin-load-more-btn"
                    onClick={loadMore}
                    disabled={loadingRecords}
                >
                    {loadingRecords
                        ? (isEnglish ? 'Loading...' : '加载中...')
                        : (isEnglish ? 'Load More' : '加载更多')}
                </button>
            )}
        </div>
    );
};
