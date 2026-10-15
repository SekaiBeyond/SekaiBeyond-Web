import { useCallback, useEffect, useRef, useState } from 'react';
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
import { useLanguage } from '~/components/LanguageContextProvider';
import { getFirebaseDb } from '~/lib/firebase';
import type { PastEvent } from '~/lib/pastEvents';
import type { UpcomingEvent } from '~/lib/upcomingEvents';
import type { Venue } from '~/lib/venues';
import { type ActivityRecord, type BadgeDef, RECORD_CATEGORIES, type RecordCategory } from './types';
import { CATEGORY_BY_TYPE, formatRecordLabel, type RecordFormatContext } from './recordFormatters';

const PAGE_SIZE = 20;

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

// Needs composite indexes (type, timestamp), (performedBy, timestamp) and
// (type, performedBy, timestamp).
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
    onLookupUser: (uid: string) => void;
    onSelectBadge: (badgeId: string) => void;
    onSelectEvent: (eventId: string) => void;
    onSelectUpcomingEvent: (eventId: string) => void;
    onSelectVenue: (venueId: string) => void;
}

export const RecordsTab = ({
                               pastEvents,
                               upcomingEvents,
                               badgeDefs,
                               venues,
                               onLookupUser,
                               onSelectBadge,
                               onSelectEvent,
                               onSelectUpcomingEvent,
                               onSelectVenue,
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
    // So a page landing after the filter changed is dropped.
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

            // System records have no actor to filter by.
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

    const formatContext: RecordFormatContext = {
        isEnglish,
        pastEvents,
        upcomingEvents,
        badgeDefs,
        venues,
        onLookupUser,
        onSelectBadge,
        onSelectEvent,
        onSelectUpcomingEvent,
        onSelectVenue,
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
                                {r.performedBy ? (
                                    <span
                                        className="record-clickable-name"
                                        onClick={() => onLookupUser(r.performedBy!)}
                                    >
                                        {r.performedByName}
                                    </span>
                                ) : (
                                    isEnglish ? 'System' : '系统'
                                )}
                            </span>
                            {' '}
                            <span className="record-description">{formatRecordLabel(r, formatContext)}</span>
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
