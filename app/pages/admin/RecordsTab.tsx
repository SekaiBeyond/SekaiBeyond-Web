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
import { GROUP_LABELS, type UserGroup } from '~/components/AuthProvider';
import { useLanguage } from '~/components/LanguageContextProvider';
import { getFirebaseDb } from '~/lib/firebase';
import type { PastEvent } from '~/lib/pastEvents';
import type { UpcomingEvent } from '~/lib/upcomingEvents';
import type { Venue } from '~/lib/venues';
import type { ParkingLot } from '~/lib/parkingLots';
import { type ParkingRate, rateLabel } from '~/lib/parkingRates';
import { ticketTypeLabel } from './tickets/types';
import { type ActivityRecord, type BadgeDef, RECORD_CATEGORIES, type RecordCategory } from './types';

const PAGE_SIZE = 20;

const CATEGORY_BY_TYPE = new Map<string, RecordCategory>();
for (const [category, {types}] of Object.entries(RECORD_CATEGORIES)) {
    for (const type of types) CATEGORY_BY_TYPE.set(type, category as RecordCategory);
}

// The Site Config sections a config-update can name, labelled as that tab's
// own section navigator labels them.
const CONFIG_SECTION_LABELS: Record<string, {en: string; zh: string}> = {
    video: {en: 'Featured Video', zh: '精选视频'},
    contact: {en: 'Contact Email', zh: '联系邮箱'},
    sender: {en: 'Sender Email', zh: '发件邮箱'},
    team: {en: 'Our Team', zh: '我们的团队'},
    'con-edition': {en: 'Sekai Beyond Con', zh: '彼世界动漫游戏展'},
};

const parseRecordDocs = (snapshot: {docs: DocumentSnapshot[]}): ActivityRecord[] =>
    snapshot.docs.map(docSnap => {
        const data = docSnap.data()!;
        return {
            ...data,
            id: docSnap.id,
            performedByName: data.performedByName ?? '',
            timestamp: data.timestamp?.toDate() ?? new Date(),
        } as ActivityRecord;
    });

// Requires composite Firestore indexes: (type, timestamp), (performedBy, timestamp)
// and (type, performedBy, timestamp)
const buildRecordsQuery = (category: RecordCategory | '', actorFilter: string, after?: DocumentSnapshot) => {
    const constraints: QueryConstraint[] = [];
    if (category) {
        constraints.push(where('type', 'in', RECORD_CATEGORIES[category].types));
    }
    if (actorFilter) {
        constraints.push(where('performedBy', '==', actorFilter));
    }
    constraints.push(orderBy('timestamp', 'desc'));
    if (after) constraints.push(startAfter(after));
    constraints.push(limit(PAGE_SIZE));
    return query(collection(getFirebaseDb(), 'records'), ...constraints);
};

interface RecordsTabProps {
    pastEvents: PastEvent[];
    upcomingEvents: UpcomingEvent[];
    badgeDefs: BadgeDef[];
    venues: Venue[];
    parkingLots: ParkingLot[];
    parkingRates: ParkingRate[];
    onLookupUser: (uid: string) => void;
    onSelectBadge: (badgeId: string) => void;
    onSelectEvent: (eventId: string) => void;
    onSelectUpcomingEvent: (eventId: string) => void;
    onSelectVenue: (venueId: string) => void;
    onSelectParkingLot: (lotId: string) => void;
    onSelectParkingRate: (rateId: string) => void;
}

export const RecordsTab = ({
                               pastEvents,
                               upcomingEvents,
                               badgeDefs,
                               venues,
                               parkingLots,
                               parkingRates,
                               onLookupUser,
                               onSelectBadge,
                               onSelectEvent,
                               onSelectUpcomingEvent,
                               onSelectVenue,
                               onSelectParkingLot,
                               onSelectParkingRate,
                           }: RecordsTabProps) => {
    const {isEnglish} = useLanguage();
    const [records, setRecords] = useState<ActivityRecord[]>([]);
    const [loadingRecords, setLoadingRecords] = useState(false);
    const [lastDoc, setLastDoc] = useState<DocumentSnapshot | null>(null);
    const [hasMore, setHasMore] = useState(true);
    const [recordFilterType, setRecordFilterType] = useState<RecordCategory | ''>('');
    const [recordFilterActor, setRecordFilterActor] = useState('');
    const [knownActors, setKnownActors] = useState<{uid: string; name: string}[]>([]);
    const activeFilterRef = useRef<{type: RecordCategory | ''; actor: string}>({type: '', actor: ''});
    // Bumped by every load. A response that lands after a newer load began —
    // the filter changed while a page was in flight — is dropped rather than
    // overwriting the newer list.
    const loadSeqRef = useRef(0);

    const loadRecords = useCallback(async (typeFilter: RecordCategory | '', actorFilter: string, after?: DocumentSnapshot) => {
        const seq = ++loadSeqRef.current;
        setLoadingRecords(true);
        try {
            const snapshot = await getDocs(buildRecordsQuery(typeFilter, actorFilter, after));
            if (seq !== loadSeqRef.current) return;
            const items = parseRecordDocs(snapshot);

            if (after) {
                setRecords(prev => [...prev, ...items]);
            } else {
                setRecords(items);
            }
            setLastDoc(snapshot.docs[snapshot.docs.length - 1] ?? null);
            setHasMore(snapshot.docs.length === PAGE_SIZE);

            // Track unique actors for the dropdown. System-written records (TTL
            // deletions and the scheduled mail drain) carry no performedBy, so
            // skip them rather than adding a blank option that filters to nothing.
            setKnownActors(prev => {
                const merged = [...prev];
                for (const item of items) {
                    if (!item.performedBy) continue;
                    if (!merged.some(a => a.uid === item.performedBy)) {
                        merged.push({uid: item.performedBy, name: item.performedByName});
                    }
                }
                return merged;
            });
        } finally {
            if (seq === loadSeqRef.current) setLoadingRecords(false);
        }
    }, []);

    useEffect(() => {
        loadRecords('', '').catch(console.error);
    }, [loadRecords]);

    const applyFilters = (type: RecordCategory | '', actor: string) => {
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

    const clickable = (label: ReactNode, onClick?: () => void): ReactNode => onClick
        ? <span className="record-clickable-name" onClick={onClick}>{label}</span>
        : <span>{label}</span>;

    const clickableName = (uid: string, name: string) => clickable(name, () => onLookupUser(uid));

    // A record links to the live item by ID and names it as it is now, in the
    // viewer's language. Once the item is deleted (or for a record written
    // before it carried the ID) it falls back to the name it was written with.
    const localized = (en: string, zh: string) => (isEnglish ? en : zh) || en;

    // Upcoming and past events share IDs (archiving keeps it), so one lookup
    // across both covers check-in codes, attendance and archived events alike.
    const clickableEvent = (eventId?: string, storedTitle?: string): ReactNode => {
        const upcoming = upcomingEvents.find(e => e.id === eventId);
        if (upcoming) {
            return clickable(localized(upcoming.title, upcoming.titleCn), () => onSelectUpcomingEvent(upcoming.id));
        }
        const past = pastEvents.find(e => e.id === eventId);
        if (past) return clickable(localized(past.title, past.titleCn), () => onSelectEvent(past.id));
        return clickable(storedTitle ?? eventId ?? '');
    };

    const clickableBadge = (badgeId?: string, storedName?: string): ReactNode => {
        const bd = badgeDefs.find(d => d.id === badgeId);
        if (bd) return clickable(localized(bd.name, bd.nameCn), () => onSelectBadge(bd.id));
        return clickable(storedName ?? badgeId ?? '');
    };

    const clickableVenue = (venueId?: string, storedName?: string): ReactNode => {
        const venue = venues.find(v => v.id === venueId);
        if (venue) return clickable(localized(venue.nameEn, venue.nameCn), () => onSelectVenue(venue.id));
        return clickable(storedName ?? '');
    };

    const clickableLot = (lotId?: string, storedName?: string): ReactNode => {
        const lot = parkingLots.find(l => l.id === lotId);
        if (lot) return clickable(localized(lot.name, lot.nameCn), () => onSelectParkingLot(lot.id));
        return clickable(storedName ?? '');
    };

    const clickableRate = (rateId?: string, storedLabel?: string): ReactNode => {
        const rate = parkingRates.find(r => r.id === rateId);
        if (rate) return clickable(rateLabel(rate, isEnglish), () => onSelectParkingRate(rate.id));
        return clickable(storedLabel ?? '');
    };

    // Records outlive a group rename by up to RECORD_RETENTION_DAYS, so a stored
    // value may name a group that no longer has a label. Show the raw value rather
    // than crashing on an undefined lookup.
    const groupLabel = (g?: UserGroup) => {
        const labels = g ? GROUP_LABELS[g] : undefined;
        if (!labels) return g ?? '';
        return isEnglish ? labels.en : labels.zh;
    };

    const fmtExpiry = (iso?: string) => {
        if (!iso) return isEnglish ? 'never' : '无';
        const d = new Date(iso);
        return isNaN(d.getTime())
            ? iso
            : d.toLocaleDateString(isEnglish ? 'en-US' : 'zh-CN', {
                year: 'numeric', month: 'short', day: 'numeric',
            });
    };

    const getRecordLabel = (r: ActivityRecord): ReactNode => {
        const target = r.targetUid ? clickableName(r.targetUid, r.targetName ?? '') : r.targetName;
        const event = clickableEvent(r.eventId, r.eventTitle);
        const badge = clickableBadge(r.badgeId, r.badgeName);
        // Ticket holders are attendees rather than accounts, so they carry an
        // email to fall back on instead of a UID.
        const attendee = r.targetName || r.targetEmail || '';
        const code = r.code ? <> <span className="record-code">{r.code}</span></> : null;
        switch (r.type) {
            case 'group-assign':
                return isEnglish
                    ? <>assigned {target} from {groupLabel(r.oldGroup)} to {groupLabel(r.newGroup)}</>
                    : <>将 {target} 从 {groupLabel(r.oldGroup)} 改为 {groupLabel(r.newGroup)}</>;
            case 'membership-grant': {
                // No old expiry means they held no membership before this.
                const was = r.oldExpiresAt
                    ? (isEnglish ? ` (was ${fmtExpiry(r.oldExpiresAt)})` : `（原为 ${fmtExpiry(r.oldExpiresAt)}）`)
                    : '';
                return isEnglish
                    ? <>set {target}'s membership to expire {fmtExpiry(r.newExpiresAt)}{was}</>
                    : <>将 {target} 的会员到期日设为 {fmtExpiry(r.newExpiresAt)}{was}</>;
            }
            case 'membership-extend':
                return isEnglish
                    ? <>extended {target}'s membership by {r.extendDays} days
                        (now {fmtExpiry(r.newExpiresAt)})</>
                    : <>将 {target} 的会员资格延长了 {r.extendDays} 天（现到期于 {fmtExpiry(r.newExpiresAt)}）</>;
            case 'membership-revoke': {
                const was = r.oldExpiresAt
                    ? (isEnglish ? ` (was until ${fmtExpiry(r.oldExpiresAt)})` : `（原到期于 ${fmtExpiry(r.oldExpiresAt)}）`)
                    : '';
                return isEnglish
                    ? <>revoked {target}'s membership{was}</>
                    : <>撤销了 {target} 的会员资格{was}</>;
            }
            case 'title-set': {
                const fmtTitle = (en?: string, zh?: string) =>
                    [en, zh].map(s => (s ?? '').trim()).filter(Boolean).join(' / ');
                const oldT = fmtTitle(r.oldTitle, r.oldTitleCn);
                const newT = fmtTitle(r.newTitle, r.newTitleCn);
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
            case 'name-set':
                return isEnglish
                    ? <>renamed {target} from "{r.oldName ?? ''}" to "{r.newName ?? ''}"</>
                    : <>将 {target} 的名称从"{r.oldName ?? ''}"改为"{r.newName ?? ''}"</>;
            case 'avatar-set':
                return isEnglish
                    ? <>updated {target}'s profile photo</>
                    : <>更新了 {target} 的头像</>;
            case 'avatar-remove':
                return isEnglish
                    ? <>removed {target}'s profile photo</>
                    : <>删除了 {target} 的头像</>;
            case 'banner-remove':
                return isEnglish
                    ? <>removed {target}'s profile banner</>
                    : <>删除了 {target} 的主页横幅</>;
            case 'code-create':
                if (r.eventId) {
                    return isEnglish
                        ? <>created check-in code{code} for {event}</>
                        : <>为 {event} 创建了签到码{code}</>;
                }
                return isEnglish ? <>created claim code for {badge}</> : <>为 {badge} 创建了兑换码</>;
            case 'event-attend':
                // Attendance changed as a side effect of becoming event staff
                // rather than by hand — say so, or the row reads as a manual edit.
                if (r.reason === 'staff-code') {
                    return isEnglish
                        ? <>was marked as attending {event} on joining its staff with a code</>
                        : <>使用工作人员码成为 {event} 的活动工作人员，并被标记为已参加</>;
                }
                return isEnglish
                    ? <>marked {target} as attended {event}{r.reason === 'staff-assignment' ? ' (event-staff assignment)' : ''}</>
                    : <>标记 {target} 参加了 {event}{r.reason === 'staff-assignment' ? '（因指派为活动工作人员）' : ''}</>;
            case 'event-unattend':
                if (r.reason === 'staff-code') {
                    return isEnglish
                        ? <>was taken off {event}'s attendees on joining its staff with a code</>
                        : <>使用工作人员码成为 {event} 的活动工作人员，并被移出参加者名单</>;
                }
                return isEnglish
                    ? <>revoked {target}'s attendance
                        for {event}{r.reason === 'staff-assignment' ? ' (event-staff assignment)' : ''}</>
                    : <>撤销了 {target} 的 {event} 签到{r.reason === 'staff-assignment' ? '（因指派为活动工作人员）' : ''}</>;
            case 'event-claim':
                return isEnglish
                    ? <>checked in to {event} with code{code}</>
                    : <>使用兑换码{code} 签到 {event}</>;
            case 'badge-claim':
                return isEnglish ? <>claimed {badge} badge with code</> : <>使用兑换码获得 {badge} 徽章</>;
            case 'badge-code-activate':
                return isEnglish ? <>activated code for {badge}</> : <>激活了 {badge} 的兑换码</>;
            case 'badge-code-deactivate':
                return isEnglish ? <>deactivated code for {badge}</> : <>停用了 {badge} 的兑换码</>;
            case 'code-delete':
                return isEnglish ? <>deleted code for {badge}</> : <>删除了 {badge} 的兑换码</>;
            case 'achievement-grant':
                return isEnglish ? <>granted {badge} badge to {target}</> : <>授予 {target} {badge} 徽章</>;
            case 'achievement-revoke':
                return isEnglish ? <>revoked {badge} badge from {target}</> : <>撤销了 {target} 的 {badge} 徽章</>;
            case 'badge-create':
                return isEnglish ? <>created badge {badge}</> : <>创建了徽章 {badge}</>;
            case 'badge-edit':
                return isEnglish ? <>edited badge {badge}</> : <>编辑了徽章 {badge}</>;
            case 'badge-deletion-requested':
                return isEnglish
                    ? <>requested deletion of badge {badge}</>
                    : <>申请删除徽章 {badge}</>;
            case 'badge-deletion-cancelled':
                return isEnglish
                    ? <>cancelled deletion of badge {badge}</>
                    : <>取消了徽章 {badge} 的删除</>;
            case 'badge-deleted':
                return isEnglish ? <>deleted badge {r.badgeName ?? ''}</> : <>删除了徽章 {r.badgeName ?? ''}</>;
            case 'event-create':
                return isEnglish ? <>created event {event}</> : <>创建了活动 {event}</>;
            case 'event-edit':
                return isEnglish ? <>edited event {event}</> : <>编辑了活动 {event}</>;
            case 'event-deletion-requested':
                return isEnglish
                    ? <>requested deletion of event {event}</>
                    : <>申请删除活动 {event}</>;
            case 'event-deletion-cancelled':
                return isEnglish
                    ? <>cancelled deletion of event {event}</>
                    : <>取消了活动 {event} 的删除</>;
            case 'event-deleted':
                return isEnglish
                    ? <>deleted event {r.eventTitle ?? r.eventId ?? ''}</>
                    : <>删除了活动 {r.eventTitle ?? r.eventId ?? ''}</>;
            case 'past-event-publish':
                return isEnglish ? <>published event {event}</> : <>发布了活动 {event}</>;
            case 'past-event-unpublish':
                return isEnglish ? <>unpublished event {event}</> : <>取消发布了活动 {event}</>;
            case 'upcoming-event-create':
                return isEnglish ? <>created upcoming event {event}</> : <>创建了活动预告 {event}</>;
            case 'upcoming-event-edit':
                return isEnglish ? <>edited upcoming event {event}</> : <>编辑了活动预告 {event}</>;
            case 'upcoming-event-deletion-requested':
                return isEnglish
                    ? <>requested deletion of upcoming event {event}</>
                    : <>申请删除活动预告 {event}</>;
            case 'upcoming-event-deletion-cancelled':
                return isEnglish
                    ? <>cancelled deletion of upcoming event {event}</>
                    : <>取消了活动预告 {event} 的删除</>;
            case 'upcoming-event-deleted':
                return isEnglish
                    ? <>deleted upcoming event {r.eventTitle ?? ''}</>
                    : <>删除了活动预告 {r.eventTitle ?? ''}</>;
            case 'upcoming-event-archive':
                return isEnglish
                    ? <>archived {event} to past events</>
                    : <>将 {event} 归档到往期活动</>;
            case 'upcoming-event-publish':
                return isEnglish ? <>published upcoming event {event}</> : <>发布了活动预告 {event}</>;
            case 'upcoming-event-unpublish':
                return isEnglish ? <>unpublished upcoming event {event}</> : <>取消发布了活动预告 {event}</>;
            case 'event-code-activate':
                return isEnglish
                    ? <>activated check-in code{code} for {event}</>
                    : <>激活了 {event} 的签到码{code}</>;
            case 'event-code-deactivate':
                return isEnglish
                    ? <>deactivated check-in code{code} for {event}</>
                    : <>停用了 {event} 的签到码{code}</>;
            case 'event-code-time-window':
                return isEnglish
                    ? <>updated the time window of check-in code{code} for {event}</>
                    : <>更新了 {event} 签到码{code} 的时间窗口</>;
            case 'staff-code-create':
                return isEnglish
                    ? <>created staff code for {event}</>
                    : <>为 {event} 创建了工作人员码</>;
            case 'staff-code-activate':
                return isEnglish
                    ? <>activated staff code for {event}</>
                    : <>激活了 {event} 的工作人员码</>;
            case 'staff-code-deactivate':
                return isEnglish
                    ? <>deactivated staff code for {event}</>
                    : <>停用了 {event} 的工作人员码</>;
            case 'staff-code-time-window':
                return isEnglish
                    ? <>updated time window for staff code of {event}</>
                    : <>更新了 {event} 工作人员码的时间窗口</>;
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
            case 'venue-create':
                return isEnglish
                    ? <>created venue {clickableVenue(r.venueId, r.venueName)}</>
                    : <>创建了场地 {clickableVenue(r.venueId, r.venueName)}</>;
            case 'venue-edit':
                return isEnglish
                    ? <>edited venue {clickableVenue(r.venueId, r.venueName)}</>
                    : <>编辑了场地 {clickableVenue(r.venueId, r.venueName)}</>;
            case 'venue-delete':
                return isEnglish
                    ? <>deleted venue {r.venueName ?? ''}</>
                    : <>删除了场地 {r.venueName ?? ''}</>;
            case 'parkinglot-create':
                return isEnglish
                    ? <>created parking lot {clickableLot(r.lotId, r.lotName)}</>
                    : <>创建了停车场 {clickableLot(r.lotId, r.lotName)}</>;
            case 'parkinglot-edit':
                return isEnglish
                    ? <>edited parking lot {clickableLot(r.lotId, r.lotName)}</>
                    : <>编辑了停车场 {clickableLot(r.lotId, r.lotName)}</>;
            case 'parkinglot-delete': {
                const unlinked = r.unlinkedFrom ?? 0;
                if (unlinked > 0) {
                    return isEnglish
                        ? <>deleted parking lot {r.lotName ?? ''} (unlinked
                            from {unlinked} venue{unlinked === 1 ? '' : 's'})</>
                        : <>删除了停车场 {r.lotName ?? ''}（已从 {unlinked} 个场地解除关联）</>;
                }
                return isEnglish
                    ? <>deleted parking lot {r.lotName ?? ''}</>
                    : <>删除了停车场 {r.lotName ?? ''}</>;
            }
            case 'parkingrate-create':
                return isEnglish
                    ? <>created parking rate {clickableRate(r.rateId, r.rateLabel)}</>
                    : <>创建了停车费率 {clickableRate(r.rateId, r.rateLabel)}</>;
            case 'parkingrate-edit':
                return isEnglish
                    ? <>edited parking rate {clickableRate(r.rateId, r.rateLabel)}</>
                    : <>编辑了停车费率 {clickableRate(r.rateId, r.rateLabel)}</>;
            case 'parkingrate-delete': {
                const unlinked = r.unlinkedFrom ?? 0;
                if (unlinked > 0) {
                    return isEnglish
                        ? <>deleted parking rate {r.rateLabel ?? ''} (unlinked
                            from {unlinked} lot{unlinked === 1 ? '' : 's'})</>
                        : <>删除了停车费率 {r.rateLabel ?? ''}（已从 {unlinked} 个停车场解除关联）</>;
                }
                return isEnglish
                    ? <>deleted parking rate {r.rateLabel ?? ''}</>
                    : <>删除了停车费率 {r.rateLabel ?? ''}</>;
            }
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
                const added = r.addedCount ?? 0;
                const replaced = r.replacedCount ?? 0;
                return isEnglish
                    ? <>imported attendees for {event} ({added} added, {replaced} replaced)</>
                    : <>导入了 {event} 的参加者（新增 {added}，替换 {replaced}）</>;
            }
            case 'ticket-redeem':
                return isEnglish
                    ? <>redeemed a ticket for {attendee} at {event}</>
                    : <>为 {attendee} 在 {event} 验证了门票</>;
            case 'ticket-void':
                return isEnglish
                    ? <>voided a ticket for {attendee} at {event}</>
                    : <>作废了 {attendee} 在 {event} 的一张门票</>;
            case 'ticket-unvoid':
                return isEnglish
                    ? <>restored a voided ticket for {attendee} at {event}</>
                    : <>恢复了 {attendee} 在 {event} 的一张作废门票</>;
            case 'ticket-reset':
                return isEnglish
                    ? <>reset the check-in state of a ticket for {attendee} at {event}</>
                    : <>重置了 {attendee} 在 {event} 的门票签到状态</>;
            case 'ticket-type-edit': {
                const from = ticketTypeLabel(r.oldType ?? '', isEnglish);
                const to = ticketTypeLabel(r.newType ?? '', isEnglish);
                return isEnglish
                    ? <>changed {attendee}'s ticket type from {from} to {to} at {event}</>
                    : <>将 {attendee} 在 {event} 的门票类型从 {from} 改为 {to}</>;
            }
            case 'ticket-attendee-delete':
                return isEnglish
                    ? <>removed attendee {attendee} from {event}</>
                    : <>将 {attendee} 从 {event} 的名单中移除</>;
            case 'ticket-attendee-edit': {
                const oldName = r.oldName || r.targetEmail || '';
                const newName = r.newName ?? '';
                return isEnglish
                    ? <>renamed attendee {oldName} to {newName} at {event}</>
                    : <>将 {event} 的参加者 {oldName} 改名为 {newName}</>;
            }
            case 'ticket-regenerate':
                return isEnglish
                    ? <>re-issued tickets for {attendee} at {event}</>
                    : <>为 {attendee} 在 {event} 重新签发门票</>;
            case 'ticket-email-send': {
                const sent = r.sentCount ?? 0;
                return isEnglish
                    ? <>sent {sent} ticket email{sent === 1 ? '' : 's'} for {event}</>
                    : <>为 {event} 发送了 {sent} 封门票邮件</>;
            }
            case 'ticket-email-queue': {
                const queued = r.sentCount ?? 0;
                return isEnglish
                    ? <>queued {queued} ticket email{queued === 1 ? '' : 's'} for {event} past the daily cap</>
                    : <>为 {event} 将 {queued} 封门票邮件排入队列（已超出每日上限）</>;
            }
            case 'scheduled-mail-drain': {
                const sent = r.sentCount ?? 0;
                return isEnglish
                    ? <>sent {sent} queued email{sent === 1 ? '' : 's'} from the scheduled mail queue</>
                    : <>从邮件队列中发送了 {sent} 封排队邮件</>;
            }
            case 'upcoming-event-email-template-update':
                return isEnglish
                    ? <>updated the ticket email template for {event}</>
                    : <>更新了 {event} 的门票邮件模板</>;
            case 'event-staff-assign':
                if (r.reason === 'staff-code') {
                    return isEnglish
                        ? <>joined {event}'s event staff with a code</>
                        : <>使用工作人员码成为 {event} 的活动工作人员</>;
                }
                return isEnglish
                    ? <>granted {target} event-staff access to {event}</>
                    : <>授予 {target} {event} 的活动工作人员权限</>;
            case 'event-staff-remove':
                return isEnglish
                    ? <>revoked {target}'s event-staff access to {event}</>
                    : <>撤销了 {target} 对 {event} 的活动工作人员权限</>;
            case 'passport-generate':
                return isEnglish
                    ? <>generated {r.passportCount ?? 0} passports from the {r.passportYear ?? ''} design
                        “{r.passportDesignName ?? ''}”</>
                    : <>用 {r.passportYear ?? ''} 年设计「{r.passportDesignName ?? ''}」生成了 {r.passportCount ?? 0} 本通行证</>;
            case 'passport-claim':
                return isEnglish
                    ? <>activated passport {r.passportId ?? ''} (+{r.extendDays ?? 0} days,
                        now {fmtExpiry(r.newExpiresAt)})</>
                    : <>激活了通行证 {r.passportId ?? ''}（+{r.extendDays ?? 0} 天，现到期于 {fmtExpiry(r.newExpiresAt)}）</>;
            case 'passport-delete': {
                // One deletion names its passport; a bulk one only counts them,
                // since the codes it removed no longer resolve to anything.
                // A claimed one also names who held it — nothing else can say so
                // once the passport is gone.
                if (r.passportId) {
                    // Negative days, mirroring what passport-claim records as
                    // given; absent whenever the membership was left alone.
                    const taken = r.extendDays ? (isEnglish
                        ? <>, taking back {Math.abs(r.extendDays)} days (now {fmtExpiry(r.newExpiresAt)})</>
                        : <>，并收回 {Math.abs(r.extendDays)} 天（现到期于 {fmtExpiry(r.newExpiresAt)}）</>) : null;
                    // Only when the holder has a name to show: an account
                    // deleted before its passport was leaves none behind, and a
                    // blank one would read as "deleted 's passport".
                    if (r.targetName) {
                        return isEnglish
                            ? <>deleted {target}'s passport {r.passportId}{taken}</>
                            : <>删除了 {target} 的通行证 {r.passportId}{taken}</>;
                    }
                    return isEnglish
                        ? <>deleted passport {r.passportId}{taken}</>
                        : <>删除了通行证 {r.passportId}{taken}</>;
                }
                return isEnglish
                    ? <>deleted {r.passportCount ?? 0} {r.passportYear ?? ''} passports</>
                    : <>删除了 {r.passportCount ?? 0} 本 {r.passportYear ?? ''} 年通行证</>;
            }
            case 'passport-key-reissue':
                return isEnglish
                    ? <>issued a new activation key for passport {r.passportId ?? ''}</>
                    : <>为通行证 {r.passportId ?? ''} 重新签发了激活码</>;
            case 'passport-key-view':
                return isEnglish
                    ? <>viewed the activation key for passport {r.passportId ?? ''}</>
                    : <>查看了通行证 {r.passportId ?? ''} 的激活码</>;
            case 'passport-key-export':
                if (r.passportId) {
                    return isEnglish
                        ? <>downloaded the activation key for passport {r.passportId}</>
                        : <>下载了通行证 {r.passportId} 的激活码</>;
                }
                return isEnglish
                    ? <>downloaded the activation keys for {r.passportCount ?? 0} {r.passportYear ?? ''} passports</>
                    : <>下载了 {r.passportCount ?? 0} 本 {r.passportYear ?? ''} 年通行证的激活码</>;
            case 'passport-design-create':
                return isEnglish
                    ? <>created the {r.passportYear ?? ''} passport design “{r.passportDesignName ?? ''}”</>
                    : <>创建了 {r.passportYear ?? ''} 年通行证设计「{r.passportDesignName ?? ''}」</>;
            case 'passport-design-edit':
                return isEnglish
                    ? <>edited the {r.passportYear ?? ''} passport design “{r.passportDesignName ?? ''}”</>
                    : <>编辑了 {r.passportYear ?? ''} 年通行证设计「{r.passportDesignName ?? ''}」</>;
            case 'passport-design-delete':
                return isEnglish
                    ? <>deleted the {r.passportYear ?? ''} passport design “{r.passportDesignName ?? ''}”</>
                    : <>删除了 {r.passportYear ?? ''} 年通行证设计「{r.passportDesignName ?? ''}」</>;
            case 'qrcode-create':
                return isEnglish
                    ? <>created QR code {r.qrLabel ?? ''}</>
                    : <>创建了二维码 {r.qrLabel ?? ''}</>;
            case 'qrcode-edit':
                return isEnglish
                    ? <>edited QR code {r.qrLabel ?? ''}</>
                    : <>编辑了二维码 {r.qrLabel ?? ''}</>;
            case 'qrcode-delete':
                return isEnglish
                    ? <>deleted QR code {r.qrLabel ?? ''}</>
                    : <>删除了二维码 {r.qrLabel ?? ''}</>;
            case 'qrcode-spot-set':
                return isEnglish
                    ? <>linked QR code {r.qrLabel ?? ''} to a map spot</>
                    : <>将二维码 {r.qrLabel ?? ''} 关联到地图位置</>;
            case 'social-platform-create':
                return isEnglish
                    ? <>added social platform {r.platformLabel ?? ''}</>
                    : <>添加了社交平台 {r.platformLabel ?? ''}</>;
            case 'social-platform-edit':
                return isEnglish
                    ? <>edited social platform {r.platformLabel ?? ''}</>
                    : <>编辑了社交平台 {r.platformLabel ?? ''}</>;
            case 'social-platform-delete':
                return isEnglish
                    ? <>deleted social platform {r.platformLabel ?? ''}</>
                    : <>删除了社交平台 {r.platformLabel ?? ''}</>;
            case 'policy-update':
                return isEnglish ? <>updated policy content</> : <>更新了政策内容</>;
            case 'config-update': {
                const sections = (r.configSections ?? [])
                    .map(s => CONFIG_SECTION_LABELS[s] ? localized(CONFIG_SECTION_LABELS[s].en, CONFIG_SECTION_LABELS[s].zh) : s)
                    .join(isEnglish ? ', ' : '、');
                if (!sections) return isEnglish ? <>updated site config</> : <>更新了网站配置</>;
                return isEnglish
                    ? <>updated site config ({sections})</>
                    : <>更新了网站配置（{sections}）</>;
            }
            case 'con-content-update':
                return isEnglish
                    ? <>updated con page content {r.conSection ? `(${r.conSection})` : ''}</>
                    : <>更新了漫展页面内容 {r.conSection ? `(${r.conSection})` : ''}</>;
            default:
                // A record type written by a newer Cloud Function than this build
                // knows about. Show the raw type instead of an empty row.
                return <>{r.type}</>;
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
                        const val = e.target.value as RecordCategory | '';
                        setRecordFilterType(val);
                        applyFilters(val, recordFilterActor);
                    }}
                >
                    <option value="">{isEnglish ? 'All Types' : '所有类型'}</option>
                    {Object.entries(RECORD_CATEGORIES).map(([category, {en, zh}]) => (
                        <option key={category} value={category}>{isEnglish ? en : zh}</option>
                    ))}
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
                <div className="spinner spinner-centered"/>
            )}

            {!loadingRecords && records.length === 0 && (
                <p className="admin-no-results">{isEnglish ? 'No records yet.' : '暂无记录。'}</p>
            )}

            {records.map(r => {
                const category = CATEGORY_BY_TYPE.get(r.type);
                return (
                    <div key={r.id} className="record-row">
                        <span className={`record-type-tag record-cat-${category ?? 'unknown'} record-type-${r.type}`}>
                            {category ? (isEnglish ? RECORD_CATEGORIES[category].en : RECORD_CATEGORIES[category].zh) : r.type}
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
                );
            })}

            {hasMore && records.length > 0 && (
                <button
                    className="admin-btn admin-btn--outline"
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
