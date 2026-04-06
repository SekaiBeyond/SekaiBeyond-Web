import { type ReactNode, useCallback, useEffect, useMemo, useState } from 'react';
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
import type { ActivityRecord, BadgeDef, RecordType } from './types';

const PAGE_SIZE = 20;

const getTypeConstraint = (filter: string): QueryConstraint | null => {
    switch (filter) {
        case '':
            return null;
        case 'attend':
            return where('type', 'in', ['badge-grant', 'event-attend']);
        case 'unattend':
            return where('type', 'in', ['badge-revoke', 'event-unattend']);
        default:
            return where('type', '==', filter);
    }
};

interface RecordsTabProps {
    pastEvents: PastEvent[];
    badgeDefs: BadgeDef[];
    onLookupUser: (uid: string) => void;
    onSelectBadge: (badgeId: string) => void;
    onSelectEvent: (eventId: string) => void;
}

export const RecordsTab = ({
                               pastEvents,
                               badgeDefs,
                               onLookupUser,
                               onSelectBadge,
                               onSelectEvent,
                           }: RecordsTabProps) => {
    const {isEnglish} = useLanguage();
    const [records, setRecords] = useState<ActivityRecord[]>([]);
    const [loadingRecords, setLoadingRecords] = useState(false);
    const [lastDoc, setLastDoc] = useState<DocumentSnapshot | null>(null);
    const [hasMore, setHasMore] = useState(true);
    const [recordFilterType, setRecordFilterType] = useState<string>('');
    const [recordFilterActor, setRecordFilterActor] = useState('');

    const loadRecords = useCallback(async (after?: DocumentSnapshot, typeFilter?: string, actorFilter?: string) => {
        setLoadingRecords(true);
        try {
            const db = getFirebaseDb();
            const constraints: QueryConstraint[] = [];
            const typeConstraint = getTypeConstraint(typeFilter ?? '');
            if (typeConstraint) constraints.push(typeConstraint);
            if (actorFilter) constraints.push(where('performedBy', '==', actorFilter));
            constraints.push(orderBy('timestamp', 'desc'));
            if (after) constraints.push(startAfter(after));
            constraints.push(limit(PAGE_SIZE));
            const q = query(collection(db, 'records'), ...constraints);
            const snapshot = await getDocs(q);

            const items: ActivityRecord[] = snapshot.docs.map(docSnap => {
                const data = docSnap.data();
                return {
                    id: docSnap.id,
                    type: data.type,
                    performedBy: data.performedBy,
                    performedByName: data.performedByName ?? '',
                    targetUid: data.targetUid,
                    targetName: data.targetName,
                    eventTitle: data.eventTitle,
                    eventId: data.eventId,
                    badgeId: data.badgeId,
                    badgeName: data.badgeName,
                    code: data.code,
                    oldGroup: data.oldGroup,
                    newGroup: data.newGroup,
                    timestamp: data.timestamp?.toDate() ?? new Date(),
                };
            });

            if (after) {
                setRecords(prev => [...prev, ...items]);
            } else {
                setRecords(items);
            }
            setLastDoc(snapshot.docs[snapshot.docs.length - 1] ?? null);
            setHasMore(snapshot.docs.length === PAGE_SIZE);
        } finally {
            setLoadingRecords(false);
        }
    }, []);

    useEffect(() => {
        setRecords([]);
        setLastDoc(null);
        setHasMore(true);
        loadRecords(undefined, recordFilterType, recordFilterActor).catch(() => {
        });
    }, [loadRecords, recordFilterType, recordFilterActor]);

    const loadMore = () => {
        if (lastDoc && hasMore) loadRecords(lastDoc, recordFilterType, recordFilterActor).then();
    };

    const uniqueActors = useMemo(() => records.reduce<{uid: string; name: string}[]>((acc, r) => {
        if (!acc.some(a => a.uid === r.performedBy)) {
            acc.push({uid: r.performedBy, name: r.performedByName});
        }
        return acc;
    }, []), [records]);

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

    const getRecordLabel = (r: ActivityRecord): ReactNode => {
        const target = r.targetUid ? clickableName(r.targetUid, r.targetName ?? '') : r.targetName;
        switch (r.type) {
            case 'group-assign':
                return isEnglish
                    ? <>assigned {target} from {GROUP_LABELS[r.oldGroup!].en} to {GROUP_LABELS[r.newGroup!].en}</>
                    : <>将 {target} 从 {GROUP_LABELS[r.oldGroup!].zh} 改为 {GROUP_LABELS[r.newGroup!].zh}</>;
            case 'code-create': {
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
            case 'code-activate': {
                const badge = r.badgeId ? clickableBadge(r.badgeId, r.badgeName ?? undefined) : r.badgeName;
                return isEnglish ? <>activated code for {badge}</> : <>激活了 {badge} 的兑换码</>;
            }
            case 'code-deactivate': {
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
        }
    };

    const getRecordTypeTag = (type: RecordType) => {
        switch (type) {
            case 'group-assign':
                return isEnglish ? 'Group' : '用户组';
            case 'code-create':
            case 'code-activate':
            case 'code-deactivate':
            case 'code-delete':
                return isEnglish ? 'Code' : '兑换码';
            case 'badge-grant':
            case 'badge-revoke':
            case 'event-attend':
            case 'event-unattend':
                return isEnglish ? 'Attend' : '签到';
            case 'achievement-grant':
            case 'achievement-revoke':
            case 'badge-create':
            case 'badge-edit':
            case 'badge-delete':
                return isEnglish ? 'Badge' : '徽章';
            case 'event-create':
            case 'event-edit':
            case 'event-delete':
                return isEnglish ? 'Event' : '活动';
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
                    onChange={e => setRecordFilterType(e.target.value)}
                >
                    <option value="">{isEnglish ? 'All Types' : '所有类型'}</option>
                    <option value="group-assign">{isEnglish ? 'Group' : '用户组'}</option>
                    <option value="code-create">{isEnglish ? 'Code Create' : '创建兑换码'}</option>
                    <option value="code-activate">{isEnglish ? 'Code Activate' : '激活兑换码'}</option>
                    <option value="code-deactivate">{isEnglish ? 'Code Deactivate' : '停用兑换码'}</option>
                    <option value="code-delete">{isEnglish ? 'Code Delete' : '删除兑换码'}</option>
                    <option value="attend">{isEnglish ? 'Event Attend' : '签到'}</option>
                    <option value="unattend">{isEnglish ? 'Event Revoke' : '取消签到'}</option>
                    <option value="achievement-grant">{isEnglish ? 'Badge Grant' : '授予徽章'}</option>
                    <option value="achievement-revoke">{isEnglish ? 'Badge Revoke' : '撤销徽章'}</option>
                    <option value="badge-create">{isEnglish ? 'Badge Create' : '创建徽章'}</option>
                    <option value="badge-edit">{isEnglish ? 'Badge Edit' : '编辑徽章'}</option>
                    <option value="badge-delete">{isEnglish ? 'Badge Delete' : '删除徽章'}</option>
                    <option value="event-create">{isEnglish ? 'Event Create' : '创建活动'}</option>
                    <option value="event-edit">{isEnglish ? 'Event Edit' : '编辑活动'}</option>
                    <option value="event-delete">{isEnglish ? 'Event Delete' : '删除活动'}</option>
                </select>
                <select
                    className="record-filter-select"
                    value={recordFilterActor}
                    onChange={e => setRecordFilterActor(e.target.value)}
                >
                    <option value="">{isEnglish ? 'All Actors' : '所有操作人'}</option>
                    {uniqueActors.map(a => (
                        <option key={a.uid} value={a.uid}>{a.name}</option>
                    ))}
                </select>
            </div>

            {loadingRecords && records.length === 0 && (
                <div className="profile-spinner" style={{margin: '20px auto'}}/>
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
                        <span className="record-actor">{clickableName(r.performedBy, r.performedByName)}</span>
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
