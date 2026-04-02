import { useEffect, useMemo, useRef, useState } from 'react';
import {
    addDoc,
    arrayRemove,
    arrayUnion,
    collection,
    deleteDoc,
    doc,
    getCountFromServer,
    getDoc,
    getDocs,
    limit,
    orderBy,
    query,
    serverTimestamp,
    updateDoc,
    where
} from 'firebase/firestore';
import {
    canAssignGroup,
    getAssignableGroups,
    GROUP_LABELS,
    hasPermission,
    useAuth,
    type UserGroup,
} from '~/components/AuthProvider';
import { LoginButton } from '~/components/LoginButton';
import { useLanguage } from '~/components/LanguageContextProvider';
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import { getFirebaseDb, getFirebaseStorage } from '~/lib/firebase';
import { LanguageSwitcher } from '~/components/LanguageSwitcher';
import { type PastEvent, usePastEvents } from '~/lib/pastEvents';
import { QRCodeSVG } from 'qrcode.react';
import { useSearchParams } from 'react-router';

interface BadgeCode {
    id: string;
    code: string;
    eventId: string;
    active: boolean;
    activeFrom: string | null;
    activeUntil: string | null;
}

interface BadgeActivationCode {
    id: string;
    code: string;
    badgeId: string;
    active: boolean;
    activeFrom: string | null;
    activeUntil: string | null;
    maxUses: number;
    usedCount: number;
    createdBy: string;
    createdAt: Date;
}

interface BadgeDef {
    id: string;
    name: string;
    nameCn: string;
    description: string;
    descriptionCn: string;
    imageUrl: string;
    createdBy: string;
    createdByUid: string;
    createdByName: string;
    createdByLink: string;
    createdAt: Date;
}

interface UserRecord {
    uid: string;
    displayName: string;
    email: string;
    photoURL: string;
    joinedAt: Date;
    attendedEvents: string[];
    badges: string[];
    group: UserGroup;
}

interface EventLabel {
    id: string;
    name: string;
    nameCn: string;
}

type Tab = 'users' | 'events' | 'labels' | 'badges' | 'records';

type RecordType =
    'group-assign'
    | 'code-create'
    | 'badge-grant'
    | 'badge-revoke'
    | 'achievement-grant'
    | 'achievement-revoke'
    | 'badge-create'
    | 'badge-edit'
    | 'badge-delete'
    | 'event-create'
    | 'event-edit'
    | 'event-delete'
    | 'label-create'
    | 'label-edit'
    | 'label-delete';

interface ActivityRecord {
    id: string;
    type: RecordType;
    performedBy: string;
    performedByName: string;
    targetUid?: string;
    targetName?: string;
    eventTitle?: string;
    eventId?: string;
    badgeId?: string;
    badgeName?: string;
    labelName?: string;
    code?: string;
    oldGroup?: UserGroup;
    newGroup?: UserGroup;
    timestamp: Date;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const docToUserRecord = (docSnap: {id: string; data: () => Record<string, any>}): UserRecord => {
    const data = docSnap.data();
    return {
        uid: docSnap.id,
        displayName: data.displayName ?? '',
        email: data.email ?? '',
        photoURL: data.photoURL ?? '',
        joinedAt: data.joinedAt?.toDate() ?? new Date(),
        attendedEvents: data.attendedEvents ?? [],
        badges: data.badges ?? [],
        group: data.group ?? 'visitor',
    };
};

export const AdminPage = () => {
    const {user, profile, loading} = useAuth();
    const {isEnglish} = useLanguage();
    const {pastEvents: rawPastEvents, refresh: refreshEvents} = usePastEvents();
    const pastEvents = useMemo(() => [...rawPastEvents].sort((a, b) => {
        const pad = (d: string) => d.split('-').map(p => p.padStart(2, '0')).join('-');
        return pad(b.date).localeCompare(pad(a.date));
    }), [rawPastEvents]);

    const [activeTab, setActiveTab] = useState<Tab>('users');
    const [searchQuery, setSearchQuery] = useState('');
    const [searchResults, setSearchResults] = useState<UserRecord[]>([]);
    const [selectedUser, setSelectedUser] = useState<UserRecord | null>(null);
    const [eventAttendees, setEventAttendees] = useState<UserRecord[]>([]);
    const [searching, setSearching] = useState(false);
    const [updating, setUpdating] = useState(false);
    const [eventCode, setEventCode] = useState<BadgeCode | null>(null);
    const [managedEvent, setManagedEvent] = useState<string | null>(null);
    const [eventSubTab, setEventSubTab] = useState<'codes' | 'attendees'>('codes');
    const [generatingCode, setGeneratingCode] = useState(false);
    const [codeFrom, setCodeFrom] = useState('');
    const [codeUntil, setCodeUntil] = useState('');
    const [recentUsers, setRecentUsers] = useState<UserRecord[]>([]);
    const [loadingRecent, setLoadingRecent] = useState(false);
    const [records, setRecords] = useState<ActivityRecord[]>([]);
    const [loadingRecords, setLoadingRecords] = useState(false);
    const [recordFilterType, setRecordFilterType] = useState<RecordType | ''>('');
    const [recordFilterActor, setRecordFilterActor] = useState('');
    const [badgeDefs, setBadgeDefs] = useState<BadgeDef[]>([]);
    const [loadingBadgeDefs, setLoadingBadgeDefs] = useState(false);
    const [selectedBadgeDef, setSelectedBadgeDef] = useState<BadgeDef | null>(null);
    const [badgeHolders, setBadgeHolders] = useState<UserRecord[]>([]);
    const [loadingBadgeHolders, setLoadingBadgeHolders] = useState(false);
    const [showCreateBadge, setShowCreateBadge] = useState(false);
    const [newBadgeName, setNewBadgeName] = useState('');
    const [newBadgeNameCn, setNewBadgeNameCn] = useState('');
    const [newBadgeDesc, setNewBadgeDesc] = useState('');
    const [newBadgeDescCn, setNewBadgeDescCn] = useState('');
    const [newBadgeImage, setNewBadgeImage] = useState<File | null>(null);
    const [newBadgeImagePreview, setNewBadgeImagePreview] = useState<string | null>(null);
    const [creatingBadgeDef, setCreatingBadgeDef] = useState(false);
    const [newBadgeCreatorUser, setNewBadgeCreatorUser] = useState<UserRecord | null>(null);
    const [newBadgeCreatedByName, setNewBadgeCreatedByName] = useState('');
    const [newBadgeCreatedByLink, setNewBadgeCreatedByLink] = useState('');
    const [editingBadgeDef, setEditingBadgeDef] = useState(false);
    const [editBadgeName, setEditBadgeName] = useState('');
    const [editBadgeNameCn, setEditBadgeNameCn] = useState('');
    const [editBadgeDesc, setEditBadgeDesc] = useState('');
    const [editBadgeDescCn, setEditBadgeDescCn] = useState('');
    const [editBadgeCreatorUser, setEditBadgeCreatorUser] = useState<UserRecord | null>(null);
    const [editBadgeCreatedByName, setEditBadgeCreatedByName] = useState('');
    const [editBadgeCreatedByLink, setEditBadgeCreatedByLink] = useState('');
    const [editBadgeImage, setEditBadgeImage] = useState<File | null>(null);
    const [editBadgeImagePreview, setEditBadgeImagePreview] = useState<string | null>(null);
    const [savingBadgeDef, setSavingBadgeDef] = useState(false);

    // Badge activation codes
    const [badgeActivationCodes, setBadgeActivationCodes] = useState<BadgeActivationCode[]>([]);
    const [loadingActivationCodes, setLoadingActivationCodes] = useState(false);
    const [generatingActivationCode, setGeneratingActivationCode] = useState(false);
    const [newCodeMaxUses, setNewCodeMaxUses] = useState<number>(100);
    const [newCodeUnlimited, setNewCodeUnlimited] = useState(false);
    const [newCodeFrom, setNewCodeFrom] = useState('');
    const [newCodeUntil, setNewCodeUntil] = useState('');
    const [creatorSearchQuery, setCreatorSearchQuery] = useState('');
    const [creatorSearchResults, setCreatorSearchResults] = useState<UserRecord[]>([]);
    const [searchingCreator, setSearchingCreator] = useState(false);
    const [eventLabels, setEventLabels] = useState<EventLabel[]>([]);
    const [newLabelName, setNewLabelName] = useState('');
    const [newLabelNameCn, setNewLabelNameCn] = useState('');
    const [savingLabel, setSavingLabel] = useState(false);
    const [editingLabelId, setEditingLabelId] = useState<string | null>(null);
    const [editLabelName, setEditLabelName] = useState('');
    const [editLabelNameCn, setEditLabelNameCn] = useState('');
    const [showCreateEvent, setShowCreateEvent] = useState(false);
    const [editingEvent, setEditingEvent] = useState<PastEvent | null>(null);
    const [eventForm, setEventForm] = useState({
        title: '', titleCn: '', label: '', labelCn: '', date: '',
        location: '', description: '', descriptionCn: '', icon: '',
    });
    const [savingEvent, setSavingEvent] = useState(false);
    const [eventImage, setEventImage] = useState<File | null>(null);
    const [eventImagePreview, setEventImagePreview] = useState<string | null>(null);
    const [searchParams] = useSearchParams();
    const urlParamsHandled = useRef(false);

    useEffect(() => {
        if (urlParamsHandled.current) return;
        if (loading || !user || !profile || !hasPermission(profile.group, 'core-staff')) return;
        const tab = searchParams.get('tab');
        const event = searchParams.get('event');
        if (tab === 'events' || tab === 'labels' || tab === 'badges' || tab === 'records' || tab === 'users') {
            setActiveTab(tab);
        }
        if (tab === 'events' && event) {
            selectManagedEvent(event).then();
        }
        urlParamsHandled.current = true;
    }, [loading, user, profile, searchParams]);

    useEffect(() => {
        if (loading || !user || !profile || !hasPermission(profile.group, 'core-staff')) return;
        const loadRecentUsers = async () => {
            setLoadingRecent(true);
            try {
                const db = getFirebaseDb();
                const usersRef = collection(db, 'users');
                const q = query(usersRef, orderBy('joinedAt', 'desc'), limit(10));
                const snapshot = await getDocs(q);
                setRecentUsers(snapshot.docs.map(docToUserRecord));
            } finally {
                setLoadingRecent(false);
            }
        };
        const loadBadgeDefinitions = async () => {
            setLoadingBadgeDefs(true);
            try {
                const db = getFirebaseDb();
                const snapshot = await getDocs(collection(db, 'badges'));
                const defs: BadgeDef[] = [];
                snapshot.forEach(docSnap => {
                    const data = docSnap.data();
                    defs.push({
                        id: docSnap.id,
                        name: data.name ?? '',
                        nameCn: data.nameCn ?? '',
                        description: data.description ?? '',
                        descriptionCn: data.descriptionCn ?? '',
                        imageUrl: data.imageUrl ?? '',
                        createdBy: data.createdBy ?? '',
                        createdByUid: data.createdByUid ?? '',
                        createdByName: data.createdByName ?? '',
                        createdByLink: data.createdByLink ?? '',
                        createdAt: data.createdAt?.toDate() ?? new Date(),
                    });
                });
                setBadgeDefs(defs);
            } finally {
                setLoadingBadgeDefs(false);
            }
        };
        const loadEventLabels = async () => {
            const db = getFirebaseDb();
            const snapshot = await getDocs(collection(db, 'eventLabels'));
            setEventLabels(snapshot.docs.map(d => ({
                id: d.id,
                name: d.data().name ?? '',
                nameCn: d.data().nameCn ?? ''
            })));
        };
        loadRecentUsers().then();
        loadBadgeDefinitions().then();
        loadEventLabels().then();
    }, [loading, user, profile]);

    const loadRecords = async () => {
        setLoadingRecords(true);
        try {
            const db = getFirebaseDb();
            const q = query(collection(db, 'records'), orderBy('timestamp', 'desc'), limit(20));
            const snapshot = await getDocs(q);

            const items: ActivityRecord[] = [];
            snapshot.forEach((docSnap) => {
                const data = docSnap.data();
                items.push({
                    id: docSnap.id,
                    type: data.type,
                    performedBy: data.performedBy,
                    performedByName: data.performedByName ?? '',
                    targetUid: data.targetUid,
                    targetName: data.targetName,
                    eventTitle: data.eventTitle,
                    badgeId: data.badgeId,
                    badgeName: data.badgeName,
                    labelName: data.labelName,
                    code: data.code,
                    oldGroup: data.oldGroup,
                    newGroup: data.newGroup,
                    timestamp: data.timestamp?.toDate() ?? new Date(),
                });
            });
            setRecords(items);
        } finally {
            setLoadingRecords(false);
        }
    };

    const filteredRecords = records.filter((r) => {
        if (recordFilterType && r.type !== recordFilterType) return false;
        if (recordFilterActor && r.performedBy !== recordFilterActor) return false;
        return true;
    });

    const uniqueActors = records.reduce<{uid: string; name: string}[]>((acc, r) => {
        if (!acc.some((a) => a.uid === r.performedBy)) {
            acc.push({uid: r.performedBy, name: r.performedByName});
        }
        return acc;
    }, []);

    if (loading) {
        return (
            <div className="profile-loading">
                <div className="profile-spinner"/>
            </div>
        );
    }

    if (!user || !profile || !hasPermission(profile.group, 'core-staff')) {
        return (
            <div className="profile-login-prompt">
                <div className="profile-login-card">
                    <h2>{isEnglish ? 'Access Denied' : '无权访问'}</h2>
                    <p>{isEnglish ? 'This page is for staff members only.' : '此页面仅限工作人员访问。'}</p>
                    <a href="/" className="profile-back-link">
                        {isEnglish ? 'Back to Home' : '返回首页'}
                    </a>
                </div>
            </div>
        );
    }

    const lookupUserByUid = async (uid: string) => {
        const db = getFirebaseDb();
        const userSnap = await getDoc(doc(db, 'users', uid));
        if (!userSnap.exists()) return;
        setSelectedUser(docToUserRecord(userSnap));
        setSearchResults([]);
        setSearchQuery('');
        setActiveTab('users');
    };

    const searchUsers = async () => {
        if (!searchQuery.trim()) return;
        setSearching(true);
        setSelectedUser(null);
        try {
            const db = getFirebaseDb();
            const usersRef = collection(db, 'users');
            const q = query(usersRef, where('email', '==', searchQuery.trim().toLowerCase()));
            const snapshot = await getDocs(q);
            setSearchResults(snapshot.docs.map(docToUserRecord));
        } finally {
            setSearching(false);
        }
    };

    const toggleBadge = async (userRecord: UserRecord, eventId: string) => {
        setUpdating(true);
        try {
            const db = getFirebaseDb();
            const userRef = doc(db, 'users', userRecord.uid);
            const has = userRecord.attendedEvents.includes(eventId);
            const evt = pastEvents.find(e => e.id === eventId);

            await updateDoc(userRef, {
                attendedEvents: has ? arrayRemove(eventId) : arrayUnion(eventId),
            });

            await addDoc(collection(db, 'records'), {
                type: has ? 'badge-revoke' : 'badge-grant',
                performedBy: user.uid,
                performedByName: profile.displayName,
                targetUid: userRecord.uid,
                targetName: userRecord.displayName,
                eventTitle: evt?.title ?? eventId,
                eventId,
                timestamp: serverTimestamp(),
            });

            const updatedEvents = has
                ? userRecord.attendedEvents.filter(e => e !== eventId)
                : [...userRecord.attendedEvents, eventId];

            const updated = {...userRecord, attendedEvents: updatedEvents};

            if (selectedUser?.uid === userRecord.uid) {
                setSelectedUser(updated);
            }
            setSearchResults(prev => prev.map(u => u.uid === userRecord.uid ? updated : u));
            setEventAttendees(prev => prev.map(u => u.uid === userRecord.uid ? updated : u));
        } finally {
            setUpdating(false);
        }
    };

    const changeUserGroup = async (userRecord: UserRecord, newGroup: UserGroup) => {
        if (!canAssignGroup(profile.group, newGroup)) return;
        setUpdating(true);
        try {
            const db = getFirebaseDb();
            const userRef = doc(db, 'users', userRecord.uid);
            await updateDoc(userRef, {group: newGroup});

            await addDoc(collection(db, 'records'), {
                type: 'group-assign',
                performedBy: user.uid,
                performedByName: profile.displayName,
                targetUid: userRecord.uid,
                targetName: userRecord.displayName,
                oldGroup: userRecord.group,
                newGroup,
                timestamp: serverTimestamp(),
            });

            const updated = {...userRecord, group: newGroup};
            if (selectedUser?.uid === userRecord.uid) {
                setSelectedUser(updated);
            }
            setSearchResults(prev => prev.map(u => u.uid === userRecord.uid ? updated : u));
            setEventAttendees(prev => prev.map(u => u.uid === userRecord.uid ? updated : u));
        } finally {
            setUpdating(false);
        }
    };

    const resetEventForm = () => {
        setEventForm({
            title: '',
            titleCn: '',
            label: '',
            labelCn: '',
            date: '',
            location: '',
            description: '',
            descriptionCn: '',
            icon: ''
        });
        setEventImage(null);
        if (eventImagePreview?.startsWith('blob:')) URL.revokeObjectURL(eventImagePreview);
        setEventImagePreview(null);
    };

    const openCreateEvent = () => {
        resetEventForm();
        setEditingEvent(null);
        setShowCreateEvent(true);
    };

    const openEditEvent = (event: PastEvent) => {
        const parts = event.date.split('-');
        const normalizedDate = parts.length === 3
            ? `${parts[0]}-${parts[1].padStart(2, '0')}-${parts[2].padStart(2, '0')}`
            : event.date;
        setEventForm({...event, date: normalizedDate});
        setEditingEvent(event);
        setEventImage(null);
        setEventImagePreview(event.icon || null);
        setShowCreateEvent(true);
    };

    const createLabel = async () => {
        if (!newLabelName.trim()) return;
        setSavingLabel(true);
        try {
            const db = getFirebaseDb();
            const docRef = await addDoc(collection(db, 'eventLabels'), {
                name: newLabelName.trim(),
                nameCn: newLabelNameCn.trim(),
            });
            setEventLabels(prev => [...prev, {
                id: docRef.id,
                name: newLabelName.trim(),
                nameCn: newLabelNameCn.trim()
            }]);
            await addDoc(collection(db, 'records'), {
                type: 'label-create',
                performedBy: user!.uid,
                performedByName: profile!.displayName,
                labelName: newLabelName.trim(),
                timestamp: serverTimestamp(),
            });
            setNewLabelName('');
            setNewLabelNameCn('');
        } finally {
            setSavingLabel(false);
        }
    };

    const saveLabelEdit = async (labelId: string) => {
        if (!editLabelName.trim()) return;
        const db = getFirebaseDb();
        await updateDoc(doc(db, 'eventLabels', labelId), {name: editLabelName.trim(), nameCn: editLabelNameCn.trim()});
        setEventLabels(prev => prev.map(l => l.id === labelId ? {
            ...l,
            name: editLabelName.trim(),
            nameCn: editLabelNameCn.trim()
        } : l));
        await addDoc(collection(db, 'records'), {
            type: 'label-edit',
            performedBy: user!.uid,
            performedByName: profile!.displayName,
            labelName: editLabelName.trim(),
            timestamp: serverTimestamp(),
        });
        setEditingLabelId(null);
    };

    const deleteLabel = async (labelId: string) => {
        const label = eventLabels.find(l => l.id === labelId);
        const db = getFirebaseDb();
        await deleteDoc(doc(db, 'eventLabels', labelId));
        setEventLabels(prev => prev.filter(l => l.id !== labelId));
        await addDoc(collection(db, 'records'), {
            type: 'label-delete',
            performedBy: user!.uid,
            performedByName: profile!.displayName,
            labelName: label?.name ?? '',
            timestamp: serverTimestamp(),
        });
    };

    const saveEvent = async () => {
        if (!eventForm.title.trim() || !eventForm.date.trim()) return;
        setSavingEvent(true);
        try {
            const db = getFirebaseDb();

            let iconUrl = eventForm.icon;
            if (eventImage) {
                const imageId = crypto.randomUUID();
                const storageRef = ref(getFirebaseStorage(), `events/${imageId}.webp`);
                await uploadBytes(storageRef, eventImage);
                iconUrl = await getDownloadURL(storageRef);
            }

            const data: Record<string, string> = {
                label: eventForm.label,
                labelCn: eventForm.labelCn,
                title: eventForm.title,
                titleCn: eventForm.titleCn,
                date: eventForm.date,
                location: eventForm.location,
                description: eventForm.description,
                descriptionCn: eventForm.descriptionCn,
                icon: iconUrl,
            };

            let newEventId: string | undefined;
            if (editingEvent) {
                await updateDoc(doc(db, 'pastEvents', editingEvent.id), data);
                newEventId = editingEvent.id;
            } else {
                const docRef = await addDoc(collection(db, 'pastEvents'), data);
                newEventId = docRef.id;
            }

            await addDoc(collection(db, 'records'), {
                type: editingEvent ? 'event-edit' : 'event-create',
                performedBy: user!.uid,
                performedByName: profile!.displayName,
                eventTitle: eventForm.title,
                eventId: newEventId,
                timestamp: serverTimestamp(),
            });

            await refreshEvents();
            setShowCreateEvent(false);
            resetEventForm();
            setEditingEvent(null);
        } finally {
            setSavingEvent(false);
        }
    };

    const deleteEvent = async (event: PastEvent) => {
        if (!confirm(isEnglish
            ? `Delete "${event.title}"? This cannot be undone.`
            : `删除"${event.title}"？此操作不可撤销。`
        )) return;
        const db = getFirebaseDb();
        await deleteDoc(doc(db, 'pastEvents', event.id));
        await addDoc(collection(db, 'records'), {
            type: 'event-delete',
            performedBy: user!.uid,
            performedByName: profile!.displayName,
            eventTitle: event.title,
            eventId: event.id,
            timestamp: serverTimestamp(),
        });
        await refreshEvents();
        if (managedEvent === event.id) setManagedEvent(null);
    };

    const selectManagedEvent = async (eventId: string) => {
        setManagedEvent(eventId);
        setEventSubTab('codes');
        setEventCode(null);
        setEventAttendees([]);
        await loadEventCode(eventId);
    };

    const loadEventAttendees = async (eventId: string) => {
        setSearching(true);
        try {
            const db = getFirebaseDb();
            const usersRef = collection(db, 'users');
            const q = query(usersRef, where('attendedEvents', 'array-contains', eventId));
            const snapshot = await getDocs(q);
            setEventAttendees(snapshot.docs.map(docToUserRecord));
        } finally {
            setSearching(false);
        }
    };

    const loadEventCode = async (eventId: string) => {
        const db = getFirebaseDb();
        const codesRef = collection(db, 'badgeCodes');

        // Query new field
        const q1 = query(codesRef, where('eventId', '==', eventId));
        const snapshot1 = await getDocs(q1);

        // Also query legacy field for backward compatibility
        const q2 = query(codesRef, where('eventTitle', '==', eventId));
        const snapshot2 = await getDocs(q2);

        const seen = new Set<string>();
        const codes: BadgeCode[] = [];
        for (const docSnap of [...snapshot1.docs, ...snapshot2.docs]) {
            if (seen.has(docSnap.id)) continue;
            seen.add(docSnap.id);
            const data = docSnap.data();
            codes.push({
                id: docSnap.id,
                code: data.code,
                eventId: data.eventId ?? data.eventTitle,
                active: data.active ?? true,
                activeFrom: data.activeFrom ?? null,
                activeUntil: data.activeUntil ?? null,
            });
        }
        // Pick the first active code, or fall back to first overall
        const active = codes.find(c => c.active);
        const picked = active ?? codes[0] ?? null;
        setEventCode(picked);
        setCodeFrom(picked?.activeFrom ?? '');
        setCodeUntil(picked?.activeUntil ?? '');
    };

    const generateEventCode = async (eventId: string) => {
        if (!user) return;
        setGeneratingCode(true);
        try {
            const evt = pastEvents.find(e => e.id === eventId);
            const db = getFirebaseDb();

            // Deactivate existing code if any
            if (eventCode) {
                await updateDoc(doc(db, 'badgeCodes', eventCode.id), {active: false});
            }

            const code = crypto.randomUUID().replace(/-/g, '').slice(0, 12);
            const docRef = await addDoc(collection(db, 'badgeCodes'), {
                code,
                eventId,
                createdBy: user.uid,
                createdAt: serverTimestamp(),
                active: true,
            });

            await addDoc(collection(db, 'records'), {
                type: 'code-create',
                performedBy: user.uid,
                performedByName: profile.displayName,
                eventTitle: evt?.title ?? eventId,
                code,
                timestamp: serverTimestamp(),
            });

            setEventCode({id: docRef.id, code, eventId, active: true, activeFrom: null, activeUntil: null});
            setCodeFrom('');
            setCodeUntil('');
        } finally {
            setGeneratingCode(false);
        }
    };

    const toggleCodeActive = async () => {
        if (!eventCode) return;
        const db = getFirebaseDb();
        await updateDoc(doc(db, 'badgeCodes', eventCode.id), {active: !eventCode.active});
        setEventCode({...eventCode, active: !eventCode.active});
    };

    const saveCodeTimeWindow = async () => {
        if (!eventCode) return;
        const activeFrom = codeFrom || null;
        const activeUntil = codeUntil || null;
        const db = getFirebaseDb();
        await updateDoc(doc(db, 'badgeCodes', eventCode.id), {activeFrom, activeUntil});
        setEventCode({...eventCode, activeFrom, activeUntil});
    };

    const getClaimUrl = (code: string) => {
        return `${window.location.origin}/claim?code=${code}`;
    };

    const searchCreator = async () => {
        if (!creatorSearchQuery.trim()) return;
        setSearchingCreator(true);
        try {
            const db = getFirebaseDb();
            const q = query(collection(db, 'users'), where('email', '==', creatorSearchQuery.trim().toLowerCase()));
            const snapshot = await getDocs(q);
            setCreatorSearchResults(snapshot.docs.map(docToUserRecord));
        } finally {
            setSearchingCreator(false);
        }
    };

    const createBadgeDef = async () => {
        if (!user) return;
        setCreatingBadgeDef(true);
        try {
            let imageUrl = '/images/mika.png';
            if (newBadgeImage) {
                const imageId = crypto.randomUUID();
                const storageRef = ref(getFirebaseStorage(), `badges/${imageId}.webp`);
                await uploadBytes(storageRef, newBadgeImage);
                imageUrl = await getDownloadURL(storageRef);
            }

            const db = getFirebaseDb();
            const creatorUid = newBadgeCreatorUser?.uid ?? '';
            const creatorName = newBadgeCreatorUser?.displayName ?? newBadgeCreatedByName.trim();
            const creatorLink = newBadgeCreatorUser ? '' : newBadgeCreatedByLink.trim();

            const docRef = await addDoc(collection(db, 'badges'), {
                name: newBadgeName.trim(),
                nameCn: newBadgeNameCn.trim(),
                description: newBadgeDesc.trim(),
                descriptionCn: newBadgeDescCn.trim(),
                imageUrl,
                createdBy: user.uid,
                createdByUid: creatorUid,
                createdByName: creatorName,
                createdByLink: creatorLink,
                createdAt: serverTimestamp(),
            });

            await addDoc(collection(db, 'records'), {
                type: 'badge-create',
                performedBy: user.uid,
                performedByName: profile.displayName,
                badgeId: docRef.id,
                badgeName: newBadgeName.trim(),
                timestamp: serverTimestamp(),
            });

            setBadgeDefs(prev => [...prev, {
                id: docRef.id,
                name: newBadgeName.trim(),
                nameCn: newBadgeNameCn.trim(),
                description: newBadgeDesc.trim(),
                descriptionCn: newBadgeDescCn.trim(),
                imageUrl,
                createdBy: user.uid,
                createdByUid: creatorUid,
                createdByName: creatorName,
                createdByLink: creatorLink,
                createdAt: new Date(),
            }]);

            setNewBadgeName('');
            setNewBadgeNameCn('');
            setNewBadgeDesc('');
            setNewBadgeDescCn('');
            setNewBadgeImage(null);
            setNewBadgeImagePreview(null);
            setNewBadgeCreatorUser(null);
            setNewBadgeCreatedByName('');
            setNewBadgeCreatedByLink('');
            setCreatorSearchQuery('');
            setCreatorSearchResults([]);
            setShowCreateBadge(false);
        } finally {
            setCreatingBadgeDef(false);
        }
    };

    const deleteBadgeDef = async (bd: BadgeDef) => {
        if (!confirm(isEnglish
            ? `Delete badge "${bd.name}"? This cannot be undone.`
            : `删除徽章"${bd.name}"？此操作不可撤销。`
        )) return;
        const db = getFirebaseDb();
        await deleteDoc(doc(db, 'badges', bd.id));
        await addDoc(collection(db, 'records'), {
            type: 'badge-delete',
            performedBy: user.uid,
            performedByName: profile.displayName,
            badgeId: bd.id,
            badgeName: bd.name,
            timestamp: serverTimestamp(),
        });
        setBadgeDefs(prev => prev.filter(d => d.id !== bd.id));
        setSelectedBadgeDef(null);
    };

    const updateBadgeDef = async () => {
        if (!selectedBadgeDef || !user) return;
        setSavingBadgeDef(true);
        try {
            const db = getFirebaseDb();
            const creatorUid = editBadgeCreatorUser?.uid ?? '';
            const creatorName = editBadgeCreatorUser?.displayName ?? editBadgeCreatedByName.trim();
            const creatorLink = editBadgeCreatorUser ? '' : editBadgeCreatedByLink.trim();
            const updates: Record<string, string> = {
                name: editBadgeName.trim(),
                nameCn: editBadgeNameCn.trim(),
                description: editBadgeDesc.trim(),
                descriptionCn: editBadgeDescCn.trim(),
                createdByUid: creatorUid,
                createdByName: creatorName,
                createdByLink: creatorLink,
            };

            if (editBadgeImage) {
                const imageId = crypto.randomUUID();
                const storageRef = ref(getFirebaseStorage(), `badges/${imageId}.webp`);
                await uploadBytes(storageRef, editBadgeImage);
                updates.imageUrl = await getDownloadURL(storageRef);
            }

            await updateDoc(doc(db, 'badges', selectedBadgeDef.id), updates);

            await addDoc(collection(db, 'records'), {
                type: 'badge-edit',
                performedBy: user.uid,
                performedByName: profile.displayName,
                badgeId: selectedBadgeDef.id,
                badgeName: editBadgeName.trim(),
                timestamp: serverTimestamp(),
            });

            const updated = {...selectedBadgeDef, ...updates};
            setBadgeDefs(prev => prev.map(d => d.id === selectedBadgeDef.id ? updated : d));
            setSelectedBadgeDef(updated);
            setEditingBadgeDef(false);
            setEditBadgeImage(null);
            setEditBadgeImagePreview(null);
        } finally {
            setSavingBadgeDef(false);
        }
    };

    const selectBadgeDef = async (bd: BadgeDef) => {
        setSelectedBadgeDef(bd);
        setLoadingBadgeHolders(true);
        setBadgeActivationCodes([]);
        try {
            const db = getFirebaseDb();
            const usersRef = collection(db, 'users');
            const q = query(usersRef, where('badges', 'array-contains', bd.id));
            const snapshot = await getDocs(q);
            setBadgeHolders(snapshot.docs.map(docToUserRecord));
        } finally {
            setLoadingBadgeHolders(false);
        }
        loadBadgeActivationCodes(bd.id).then();
    };

    const loadBadgeActivationCodes = async (badgeId: string) => {
        setLoadingActivationCodes(true);
        try {
            const db = getFirebaseDb();
            const codesRef = collection(db, 'badgeActivationCodes');
            const q1 = query(codesRef, where('badgeId', '==', badgeId), orderBy('createdAt', 'desc'));
            const snapshot = await getDocs(q1);
            const codes: BadgeActivationCode[] = snapshot.docs.map(docSnap => {
                const data = docSnap.data();
                return {
                    id: docSnap.id,
                    code: data.code,
                    badgeId: data.badgeId,
                    active: data.active ?? true,
                    activeFrom: data.activeFrom ?? null,
                    activeUntil: data.activeUntil ?? null,
                    maxUses: data.maxUses ?? 0,
                    usedCount: data.usedCount ?? 0,
                    createdBy: data.createdBy ?? '',
                    createdAt: data.createdAt?.toDate?.() ?? new Date(),
                };
            });
            setBadgeActivationCodes(codes);
        } finally {
            setLoadingActivationCodes(false);
        }
    };

    const createBadgeActivationCode = async (badgeId: string) => {
        if (!user) return;
        setGeneratingActivationCode(true);
        try {
            const bd = badgeDefs.find(d => d.id === badgeId);
            const db = getFirebaseDb();
            const code = crypto.randomUUID().replace(/-/g, '').slice(0, 12);
            const docData: Record<string, unknown> = {
                code,
                badgeId,
                createdBy: user.uid,
                createdAt: serverTimestamp(),
                active: true,
                maxUses: newCodeMaxUses,
                usedCount: 0,
            };
            if (newCodeFrom) docData.activeFrom = newCodeFrom;
            if (newCodeUntil) docData.activeUntil = newCodeUntil;

            const docRef = await addDoc(collection(db, 'badgeActivationCodes'), docData);

            await addDoc(collection(db, 'records'), {
                type: 'code-create',
                performedBy: user.uid,
                performedByName: profile.displayName,
                badgeId,
                badgeName: bd?.name ?? badgeId,
                code,
                timestamp: serverTimestamp(),
            });

            setBadgeActivationCodes(prev => [{
                id: docRef.id,
                code,
                badgeId,
                active: true,
                activeFrom: newCodeFrom || null,
                activeUntil: newCodeUntil || null,
                maxUses: newCodeMaxUses,
                usedCount: 0,
                createdBy: user.uid,
                createdAt: new Date(),
            }, ...prev]);
            setNewCodeMaxUses(100);
            setNewCodeFrom('');
            setNewCodeUntil('');
        } finally {
            setGeneratingActivationCode(false);
        }
    };

    const toggleActivationCodeActive = async (ac: BadgeActivationCode) => {
        const db = getFirebaseDb();
        await updateDoc(doc(db, 'badgeActivationCodes', ac.id), {active: !ac.active});
        setBadgeActivationCodes(prev => prev.map(c => c.id === ac.id ? {...c, active: !c.active} : c));
    };

    const deleteActivationCode = async (ac: BadgeActivationCode) => {
        const db = getFirebaseDb();
        await deleteDoc(doc(db, 'badgeActivationCodes', ac.id));
        setBadgeActivationCodes(prev => prev.filter(c => c.id !== ac.id));
    };

    const getClaimBadgeUrl = (code: string) => {
        return `${window.location.origin}/claim-badge?code=${code}`;
    };

    const toggleUserBadge = async (userRecord: UserRecord, badgeId: string, badgeName: string) => {
        setUpdating(true);
        try {
            const db = getFirebaseDb();
            const userRef = doc(db, 'users', userRecord.uid);
            const has = userRecord.badges.includes(badgeId);

            await updateDoc(userRef, {
                badges: has ? arrayRemove(badgeId) : arrayUnion(badgeId),
            });

            await addDoc(collection(db, 'records'), {
                type: has ? 'achievement-revoke' : 'achievement-grant',
                performedBy: user.uid,
                performedByName: profile.displayName,
                targetUid: userRecord.uid,
                targetName: userRecord.displayName,
                badgeId,
                badgeName,
                timestamp: serverTimestamp(),
            });

            // Update badge holder percentage
            const usersRef = collection(db, 'users');
            const [holderSnap, totalSnap] = await Promise.all([
                getCountFromServer(query(usersRef, where('badges', 'array-contains', badgeId))),
                getCountFromServer(usersRef),
            ]);
            const holderPct = totalSnap.data().count > 0
                ? Math.round((holderSnap.data().count / totalSnap.data().count) * 100)
                : 0;
            await updateDoc(doc(db, 'badges', badgeId), {holderPct});

            const updatedBadges = has
                ? userRecord.badges.filter(id => id !== badgeId)
                : [...userRecord.badges, badgeId];

            const updated = {...userRecord, badges: updatedBadges};

            if (selectedUser?.uid === userRecord.uid) {
                setSelectedUser(updated);
            }
            setSearchResults(prev => prev.map(u => u.uid === userRecord.uid ? updated : u));
        } finally {
            setUpdating(false);
        }
    };

    const assignableGroups = getAssignableGroups(profile.group);
    const managedEvt = managedEvent ? pastEvents.find(e => e.id === managedEvent) ?? null : null;

    const clickableName = (uid: string, name: string) => (
        <span className="record-clickable-name" onClick={() => lookupUserByUid(uid)}>{name}</span>
    );

    const clickableBadge = (badgeId: string, badgeName?: string) => {
        const bd = badgeDefs.find(d => d.id === badgeId);
        const name = badgeName ?? (bd ? (isEnglish ? bd.name : bd.nameCn) : badgeId);
        if (!bd) return <span>{name}</span>;
        return (
            <span className="record-clickable-name" onClick={() => {
                setActiveTab('badges');
                selectBadgeDef(bd).then();
            }}>{name}</span>
        );
    };

    const clickableEvent = (eventId: string, eventTitle?: string) => {
        const evt = pastEvents.find(e => e.id === eventId);
        const title = evt ? (isEnglish ? evt.title : evt.titleCn) : (eventTitle ?? eventId);
        if (!evt) return <span>{title}</span>;
        return (
            <span className="record-clickable-name" onClick={() => {
                setActiveTab('events');
                selectManagedEvent(evt.id).then();
            }}>{title}</span>
        );
    };

    const getRecordLabel = (r: ActivityRecord) => {
        const target = r.targetUid ? clickableName(r.targetUid, r.targetName ?? '') : r.targetName;
        switch (r.type) {
            case 'group-assign':
                return isEnglish
                    ? <>assigned {target} from {GROUP_LABELS[r.oldGroup!].en} to {GROUP_LABELS[r.newGroup!].en}</>
                    : <>将 {target} 从 {GROUP_LABELS[r.oldGroup!].zh} 改为 {GROUP_LABELS[r.newGroup!].zh}</>;
            case 'code-create': {
                const badge = r.badgeId ? clickableBadge(r.badgeId) : r.badgeName;
                return isEnglish
                    ? <>created claim code for {badge}</>
                    : <>为 {badge} 创建了兑换码</>;
            }
            case 'badge-grant':
                return isEnglish
                    ? <>marked {target} as attended {r.eventId ? clickableEvent(r.eventId, r.eventTitle) : (r.eventTitle ? clickableEvent(r.eventTitle) : '')}</>
                    : <>标记 {target} 参加了 {r.eventId ? clickableEvent(r.eventId, r.eventTitle) : (r.eventTitle ? clickableEvent(r.eventTitle) : '')}</>;
            case 'badge-revoke':
                return isEnglish
                    ? <>revoked {target}'s attendance for {r.eventId ? clickableEvent(r.eventId, r.eventTitle) : (r.eventTitle ? clickableEvent(r.eventTitle) : '')}</>
                    : <>撤销了 {target} 的 {r.eventId ? clickableEvent(r.eventId, r.eventTitle) : (r.eventTitle ? clickableEvent(r.eventTitle) : '')} 签到</>;
            case 'achievement-grant': {
                const badge = r.badgeId ? clickableBadge(r.badgeId, r.badgeName ?? undefined) : r.badgeName;
                return isEnglish
                    ? <>granted {badge} badge to {target}</>
                    : <>授予 {target} {badge} 徽章</>;
            }
            case 'achievement-revoke': {
                const badge = r.badgeId ? clickableBadge(r.badgeId, r.badgeName ?? undefined) : r.badgeName;
                return isEnglish
                    ? <>revoked {badge} badge from {target}</>
                    : <>撤销了 {target} 的 {badge} 徽章</>;
            }
            case 'badge-create': {
                const badge = r.badgeId ? clickableBadge(r.badgeId, r.badgeName ?? undefined) : r.badgeName;
                return isEnglish
                    ? <>created badge {badge}</>
                    : <>创建了徽章 {badge}</>;
            }
            case 'badge-edit': {
                const badge = r.badgeId ? clickableBadge(r.badgeId, r.badgeName ?? undefined) : r.badgeName;
                return isEnglish
                    ? <>edited badge {badge}</>
                    : <>编辑了徽章 {badge}</>;
            }
            case 'badge-delete':
                return isEnglish
                    ? <>deleted badge {r.badgeName ?? ''}</>
                    : <>删除了徽章 {r.badgeName ?? ''}</>;
            case 'event-create':
                return isEnglish
                    ? <>created event {r.eventId ? clickableEvent(r.eventId, r.eventTitle) : (r.eventTitle ? clickableEvent(r.eventTitle) : '')}</>
                    : <>创建了活动 {r.eventId ? clickableEvent(r.eventId, r.eventTitle) : (r.eventTitle ? clickableEvent(r.eventTitle) : '')}</>;
            case 'event-edit':
                return isEnglish
                    ? <>edited event {r.eventId ? clickableEvent(r.eventId, r.eventTitle) : (r.eventTitle ? clickableEvent(r.eventTitle) : '')}</>
                    : <>编辑了活动 {r.eventId ? clickableEvent(r.eventId, r.eventTitle) : (r.eventTitle ? clickableEvent(r.eventTitle) : '')}</>;
            case 'event-delete':
                return isEnglish
                    ? <>deleted event {r.eventTitle ?? r.eventId ?? ''}</>
                    : <>删除了活动 {r.eventTitle ?? r.eventId ?? ''}</>;
            case 'label-create':
                return isEnglish
                    ? <>created label {r.labelName ?? ''}</>
                    : <>创建了标签 {r.labelName ?? ''}</>;
            case 'label-edit':
                return isEnglish
                    ? <>edited label {r.labelName ?? ''}</>
                    : <>编辑了标签 {r.labelName ?? ''}</>;
            case 'label-delete':
                return isEnglish
                    ? <>deleted label {r.labelName ?? ''}</>
                    : <>删除了标签 {r.labelName ?? ''}</>;
        }
    };

    const getRecordTypeTag = (type: RecordType) => {
        switch (type) {
            case 'group-assign':
                return isEnglish ? 'Group' : '用户组';
            case 'code-create':
                return isEnglish ? 'Code' : '兑换码';
            case 'badge-grant':
                return isEnglish ? 'Attend' : '签到';
            case 'badge-revoke':
                return isEnglish ? 'Attend' : '签到';
            case 'achievement-grant':
                return isEnglish ? 'Badge' : '徽章';
            case 'achievement-revoke':
                return isEnglish ? 'Badge' : '徽章';
            case 'badge-create':
                return isEnglish ? 'Badge' : '徽章';
            case 'badge-edit':
                return isEnglish ? 'Badge' : '徽章';
            case 'badge-delete':
                return isEnglish ? 'Badge' : '徽章';
            case 'event-create':
                return isEnglish ? 'Event' : '活动';
            case 'event-edit':
                return isEnglish ? 'Event' : '活动';
            case 'event-delete':
                return isEnglish ? 'Event' : '活动';
            case 'label-create':
            case 'label-edit':
            case 'label-delete':
                return isEnglish ? 'Label' : '标签';
        }
    };

    return (
        <>
            <nav className="profile-nav">
                <a href="/" className="profile-nav-home">
                    {isEnglish ? 'SEKAI BEYOND' : '彼世界动漫社'}
                </a>
                <span className="admin-nav-title">{isEnglish ? 'Admin Panel' : '管理面板'}</span>
                <div className="nav-actions">
                    <LanguageSwitcher/>
                    <LoginButton/>
                </div>
            </nav>
            <div className="profile-page">

                {/* Tabs */}
                <div className="admin-tabs">
                    <button
                        className={`admin-tab ${activeTab === 'users' ? 'admin-tab-active' : ''}`}
                        onClick={() => setActiveTab('users')}
                    >
                        {isEnglish ? 'User Lookup' : '用户查询'}
                    </button>
                    <button
                        className={`admin-tab ${activeTab === 'events' ? 'admin-tab-active' : ''}`}
                        onClick={() => setActiveTab('events')}
                    >
                        {isEnglish ? 'Past Event Management' : '往期活动管理'}
                    </button>
                    <button
                        className={`admin-tab ${activeTab === 'labels' ? 'admin-tab-active' : ''}`}
                        onClick={() => setActiveTab('labels')}
                    >
                        {isEnglish ? 'Event Labels' : '活动标签'}
                    </button>
                    <button
                        className={`admin-tab ${activeTab === 'badges' ? 'admin-tab-active' : ''}`}
                        onClick={() => setActiveTab('badges')}
                    >
                        {isEnglish ? 'Badges' : '徽章'}
                    </button>
                    <button
                        className={`admin-tab ${activeTab === 'records' ? 'admin-tab-active' : ''}`}
                        onClick={() => {
                            setActiveTab('records');
                            loadRecords().then();
                        }}
                    >
                        {isEnglish ? 'Records' : '操作记录'}
                    </button>
                </div>

                {/* User Lookup Tab */}
                {activeTab === 'users' && (
                    <div className="admin-section">
                        <div className="admin-search">
                            <input
                                type="email"
                                placeholder={isEnglish ? 'Search by email address...' : '输入邮箱地址搜索...'}
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                onKeyDown={(e) => e.key === 'Enter' && searchUsers()}
                                className="admin-search-input"
                            />
                            <button onClick={searchUsers} disabled={searching} className="admin-search-btn">
                                {searching
                                    ? (isEnglish ? 'Searching...' : '搜索中...')
                                    : (isEnglish ? 'Search' : '搜索')}
                            </button>
                        </div>

                        {searchResults.length > 0 && !selectedUser && (
                            <div className="admin-results">
                                {searchResults.map((u) => (
                                    <div key={u.uid} className="admin-user-row" onClick={() => setSelectedUser(u)}>
                                        <img src={u.photoURL} alt="" className="admin-user-avatar"
                                             referrerPolicy="no-referrer"/>
                                        <div>
                                            <div className="admin-user-name">{u.displayName}</div>
                                            <div className="admin-user-email">{u.email}</div>
                                        </div>
                                        <span className="admin-user-group-tag" data-group={u.group}>
                                            {isEnglish ? GROUP_LABELS[u.group].en : GROUP_LABELS[u.group].zh}
                                        </span>
                                        <span className="admin-user-badge-count">
                                            {u.attendedEvents.length} {isEnglish ? 'events' : '活动'}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        )}

                        {searchResults.length === 0 && !searching && searchQuery && (
                            <p className="admin-no-results">{isEnglish ? 'No users found.' : '未找到用户。'}</p>
                        )}

                        {/* Recent Users */}
                        {!selectedUser && searchResults.length === 0 && (
                            <div className="admin-recent-users">
                                <h4 className="admin-badges-title">
                                    {isEnglish ? 'Recent Users' : '最近加入的用户'}
                                </h4>
                                {loadingRecent && <div className="profile-spinner" style={{margin: '20px auto'}}/>}
                                {!loadingRecent && recentUsers.map((u) => (
                                    <div key={u.uid} className="admin-user-row" onClick={() => setSelectedUser(u)}>
                                        <img src={u.photoURL} alt="" className="admin-user-avatar"
                                             referrerPolicy="no-referrer"/>
                                        <div>
                                            <div className="admin-user-name">{u.displayName}</div>
                                            <div className="admin-user-email">{u.email}</div>
                                        </div>
                                        <span className="admin-user-group-tag" data-group={u.group}>
                                            {isEnglish ? GROUP_LABELS[u.group].en : GROUP_LABELS[u.group].zh}
                                        </span>
                                        <span className="admin-detail-joined">
                                            {u.joinedAt.toLocaleDateString(isEnglish ? 'en-US' : 'zh-CN', {
                                                year: 'numeric', month: 'short', day: 'numeric',
                                            })}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        )}

                        {/* Selected User Detail */}
                        {selectedUser && (
                            <div className="admin-user-detail">
                                <button className="admin-back-btn" onClick={() => setSelectedUser(null)}>
                                    &larr; {isEnglish ? 'Back to results' : '返回结果'}
                                </button>

                                <div className="admin-detail-header">
                                    <img src={selectedUser.photoURL} alt="" className="admin-detail-avatar"
                                         referrerPolicy="no-referrer"/>
                                    <div>
                                        <h3>{selectedUser.displayName}</h3>
                                        <p>{selectedUser.email}</p>
                                        <p className="admin-detail-joined">
                                            {isEnglish ? 'Joined: ' : '加入时间：'}
                                            {selectedUser.joinedAt.toLocaleDateString(isEnglish ? 'en-US' : 'zh-CN', {
                                                year: 'numeric', month: 'long', day: 'numeric',
                                            })}
                                        </p>
                                    </div>
                                </div>

                                {/* User Group Management */}
                                <div className="admin-group-section">
                                    <h4 className="admin-badges-title">
                                        {isEnglish ? 'User Group' : '用户组'}
                                    </h4>
                                    <div className="admin-group-current">
                                        <span className="admin-group-label">
                                            {isEnglish ? 'Current group: ' : '当前用户组：'}
                                        </span>
                                        <span className="admin-user-group-tag" data-group={selectedUser.group}>
                                            {isEnglish ? GROUP_LABELS[selectedUser.group].en : GROUP_LABELS[selectedUser.group].zh}
                                        </span>
                                    </div>
                                    {assignableGroups.length > 0 && (
                                        <div className="admin-group-actions">
                                            {assignableGroups.map((g) => (
                                                <button
                                                    key={g}
                                                    className={`admin-group-btn ${selectedUser.group === g ? 'admin-group-btn-active' : ''}`}
                                                    onClick={() => changeUserGroup(selectedUser, g)}
                                                    disabled={updating || selectedUser.group === g}
                                                >
                                                    {isEnglish ? GROUP_LABELS[g].en : GROUP_LABELS[g].zh}
                                                </button>
                                            ))}
                                        </div>
                                    )}
                                </div>

                                {badgeDefs.length > 0 && (
                                    <>
                                        <h4 className="admin-badges-title">
                                            {isEnglish ? 'Badges' : '徽章'}
                                            <span className="admin-badges-count">
                                                {selectedUser.badges.filter(id => badgeDefs.some(bd => bd.id === id)).length}/{badgeDefs.length}
                                            </span>
                                        </h4>

                                        <div className="admin-badge-list">
                                            {badgeDefs.map((bd) => {
                                                const has = selectedUser.badges.includes(bd.id);
                                                return (
                                                    <div key={bd.id}
                                                         className={`admin-badge-row ${has ? 'admin-badge-has' : ''}`}>
                                                        <img src={bd.imageUrl} alt="" className="admin-badge-img"/>
                                                        <div className="admin-badge-info">
                                                            <span
                                                                className="admin-badge-name">{isEnglish ? bd.name : bd.nameCn}</span>
                                                            <span
                                                                className="admin-badge-date">{isEnglish ? bd.description : bd.descriptionCn}</span>
                                                        </div>
                                                        <button
                                                            className={`admin-toggle-btn ${has ? 'admin-toggle-revoke' : 'admin-toggle-grant'}`}
                                                            onClick={() => toggleUserBadge(selectedUser, bd.id, isEnglish ? bd.name : bd.nameCn)}
                                                            disabled={updating}
                                                        >
                                                            {has
                                                                ? (isEnglish ? 'Revoke' : '撤销')
                                                                : (isEnglish ? 'Grant' : '授予')}
                                                        </button>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </>
                                )}

                                <h4 className="admin-badges-title">
                                    {isEnglish ? 'Events Attended' : '参与活动'}
                                    <span className="admin-badges-count">
                                    {selectedUser.attendedEvents.length}/{pastEvents.length}
                                </span>
                                </h4>

                                <div className="admin-badge-list">
                                    {pastEvents.map((event) => {
                                        const has = selectedUser.attendedEvents.includes(event.id);
                                        return (
                                            <div key={event.id}
                                                 className={`admin-badge-row ${has ? 'admin-badge-has' : ''}`}>
                                                <img src={event.icon} alt="" className="admin-badge-img"/>
                                                <div className="admin-badge-info">
                                                    <span
                                                        className="admin-badge-name">{isEnglish ? event.title : event.titleCn}</span>
                                                    <span className="admin-badge-date">{event.date}</span>
                                                </div>
                                                <button
                                                    className={`admin-toggle-btn ${has ? 'admin-toggle-revoke' : 'admin-toggle-grant'}`}
                                                    onClick={() => toggleBadge(selectedUser, event.id)}
                                                    disabled={updating}
                                                >
                                                    {has
                                                        ? (isEnglish ? 'Revoke' : '撤销')
                                                        : (isEnglish ? 'Grant' : '授予')}
                                                </button>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        )}
                    </div>
                )}

                {/* Event Management Tab */}
                {activeTab === 'events' && (
                    <div className="admin-section">
                        {!managedEvent ? (
                            <>
                                {showCreateEvent ? (
                                    <div className="admin-create-badge-form">
                                        <h4 className="admin-badges-title">
                                            {editingEvent
                                                ? (isEnglish ? 'Edit Event' : '编辑活动')
                                                : (isEnglish ? 'Create New Event' : '创建新活动')}
                                        </h4>
                                        <div className="admin-form-grid">
                                            <label>
                                                <span>{isEnglish ? 'Title (English)' : '标题（英文）'}</span>
                                                <input
                                                    value={eventForm.title}
                                                    onChange={e => setEventForm(f => ({...f, title: e.target.value}))}
                                                    className="admin-search-input"
                                                    placeholder={isEnglish ? 'Event title' : '活动标题'}
                                                />
                                            </label>
                                            <label>
                                                <span>{isEnglish ? 'Title (Chinese)' : '标题（中文）'}</span>
                                                <input
                                                    value={eventForm.titleCn}
                                                    onChange={e => setEventForm(f => ({...f, titleCn: e.target.value}))}
                                                    className="admin-search-input"
                                                    placeholder={isEnglish ? 'Event title in Chinese' : '活动中文标题'}
                                                />
                                            </label>
                                            <label>
                                                <span>{isEnglish ? 'Label' : '标签'}</span>
                                                <div style={{display: 'flex', gap: '8px', alignItems: 'center'}}>
                                                    <select
                                                        value={eventLabels.find(l => l.name === eventForm.label)?.id ?? ''}
                                                        onChange={e => {
                                                            const lbl = eventLabels.find(l => l.id === e.target.value);
                                                            setEventForm(f => ({
                                                                ...f,
                                                                label: lbl?.name ?? '',
                                                                labelCn: lbl?.nameCn ?? ''
                                                            }));
                                                        }}
                                                        className="admin-search-input"
                                                    >
                                                        <option
                                                            value="">{isEnglish ? '-- Select label --' : '-- 选择标签 --'}</option>
                                                        {eventLabels.map(l => (
                                                            <option key={l.id}
                                                                    value={l.id}>{isEnglish ? l.name : l.nameCn || l.name}</option>
                                                        ))}
                                                    </select>
                                                    <button
                                                        type="button"
                                                        className="admin-generate-btn"
                                                        style={{
                                                            whiteSpace: 'nowrap',
                                                            padding: '6px 12px',
                                                            fontSize: '13px',
                                                        }}
                                                        onClick={() => setActiveTab('labels')}
                                                    >
                                                        {isEnglish ? 'Manage' : '管理'}
                                                    </button>
                                                </div>
                                            </label>
                                            <label>
                                                <span>{isEnglish ? 'Date' : '日期'}</span>
                                                <input
                                                    type="date"
                                                    value={eventForm.date}
                                                    onChange={e => setEventForm(f => ({...f, date: e.target.value}))}
                                                    className="admin-search-input"
                                                />
                                            </label>
                                            <label>
                                                <span>{isEnglish ? 'Location' : '地点'}</span>
                                                <input
                                                    value={eventForm.location}
                                                    onChange={e => setEventForm(f => ({
                                                        ...f,
                                                        location: e.target.value
                                                    }))}
                                                    className="admin-search-input"
                                                    placeholder={isEnglish ? 'Event location' : '活动地点'}
                                                />
                                            </label>
                                            <label>
                                                <span>{isEnglish ? 'Event Image' : '活动图片'}</span>
                                                <input
                                                    type="file"
                                                    accept="image/webp"
                                                    onChange={e => {
                                                        const file = e.target.files?.[0];
                                                        if (!file) return;
                                                        if (file.type !== 'image/webp') {
                                                            alert(isEnglish ? 'Please upload a WebP image.' : '请上传 WebP 格式的图片。');
                                                            e.target.value = '';
                                                            return;
                                                        }
                                                        setEventImage(file);
                                                        if (eventImagePreview?.startsWith('blob:')) URL.revokeObjectURL(eventImagePreview);
                                                        setEventImagePreview(URL.createObjectURL(file));
                                                    }}
                                                />
                                                {eventImagePreview && (
                                                    <img src={eventImagePreview} alt=""
                                                         className="admin-badge-image-preview"/>
                                                )}
                                            </label>
                                            <label style={{gridColumn: '1 / -1'}}>
                                                <span>{isEnglish ? 'Description (English)' : '描述（英文）'}</span>
                                                <textarea
                                                    value={eventForm.description}
                                                    onChange={e => setEventForm(f => ({
                                                        ...f,
                                                        description: e.target.value
                                                    }))}
                                                    className="admin-search-input admin-textarea"
                                                    placeholder={isEnglish ? 'Event description' : '活动描述'}
                                                />
                                            </label>
                                            <label style={{gridColumn: '1 / -1'}}>
                                                <span>{isEnglish ? 'Description (Chinese)' : '描述（中文）'}</span>
                                                <textarea
                                                    value={eventForm.descriptionCn}
                                                    onChange={e => setEventForm(f => ({
                                                        ...f,
                                                        descriptionCn: e.target.value
                                                    }))}
                                                    className="admin-search-input admin-textarea"
                                                    placeholder={isEnglish ? 'Event description in Chinese' : '活动中文描述'}
                                                />
                                            </label>
                                        </div>
                                        <div style={{display: 'flex', gap: '10px'}}>
                                            <button
                                                className="admin-generate-btn"
                                                onClick={saveEvent}
                                                disabled={savingEvent || !eventForm.title.trim() || !eventForm.date.trim()}
                                            >
                                                {savingEvent
                                                    ? (isEnglish ? 'Saving...' : '保存中...')
                                                    : editingEvent
                                                        ? (isEnglish ? 'Save Changes' : '保存更改')
                                                        : (isEnglish ? 'Create Event' : '创建活动')}
                                            </button>
                                            <button
                                                className="admin-back-btn"
                                                onClick={() => {
                                                    setShowCreateEvent(false);
                                                    setEditingEvent(null);
                                                }}
                                            >
                                                {isEnglish ? 'Cancel' : '取消'}
                                            </button>
                                        </div>
                                    </div>
                                ) : (
                                    <button className="admin-generate-btn" onClick={openCreateEvent}
                                            style={{marginBottom: '16px'}}>
                                        {isEnglish ? '+ New Event' : '+ 新建活动'}
                                    </button>
                                )}
                                <div className="admin-event-grid">
                                    {pastEvents.map((event) => (
                                        <button
                                            key={event.id}
                                            className="admin-event-card"
                                            onClick={() => selectManagedEvent(event.id)}
                                        >
                                            <img src={event.icon} alt="" className="admin-event-card-img"/>
                                            <div className="admin-event-card-info">
                                                <span
                                                    className="admin-event-card-title">{isEnglish ? event.title : event.titleCn}</span>
                                                <span className="admin-event-card-date">{event.date}</span>
                                            </div>
                                        </button>
                                    ))}
                                </div>
                            </>
                        ) : (
                            <div className="admin-event-detail">
                                <button className="admin-back-btn" onClick={() => setManagedEvent(null)}>
                                    &larr; {isEnglish ? 'All Events' : '所有活动'}
                                </button>

                                {managedEvt && (
                                    <>
                                        <div className="admin-event-detail-header">
                                            <img src={managedEvt.icon} alt="" className="admin-event-detail-img"/>
                                            <div>
                                                <h3>{isEnglish ? managedEvt.title : managedEvt.titleCn}</h3>
                                                <p className="admin-event-detail-meta">
                                                    <span>{isEnglish ? managedEvt.label : managedEvt.labelCn}</span>
                                                    <span>{managedEvt.date}</span>
                                                    <span>{managedEvt.location}</span>
                                                </p>
                                            </div>
                                        </div>
                                        <div className="admin-form-actions" style={{marginBottom: '20px'}}>
                                            <button
                                                className="admin-generate-btn"
                                                onClick={() => {
                                                    setManagedEvent(null);
                                                    openEditEvent(managedEvt);
                                                }}
                                            >
                                                {isEnglish ? 'Edit Event' : '编辑活动'}
                                            </button>
                                            <button
                                                className="admin-toggle-btn admin-toggle-revoke"
                                                onClick={async () => {
                                                    await deleteEvent(managedEvt);
                                                    setManagedEvent(null);
                                                }}
                                            >
                                                {isEnglish ? 'Delete Event' : '删除活动'}
                                            </button>
                                        </div>
                                    </>
                                )}

                                <div className="admin-sub-tabs">
                                    <button
                                        className={`admin-sub-tab ${eventSubTab === 'codes' ? 'admin-sub-tab-active' : ''}`}
                                        onClick={() => setEventSubTab('codes')}
                                    >
                                        {isEnglish ? 'Check-in Code' : '签到码'}
                                    </button>
                                    <button
                                        className={`admin-sub-tab ${eventSubTab === 'attendees' ? 'admin-sub-tab-active' : ''}`}
                                        onClick={() => {
                                            setEventSubTab('attendees');
                                            if (eventAttendees.length === 0) loadEventAttendees(managedEvent).then();
                                        }}
                                    >
                                        {isEnglish ? 'Attendees' : '参加者'}
                                        {eventAttendees.length > 0 && (
                                            <span className="admin-sub-tab-count">{eventAttendees.length}</span>
                                        )}
                                    </button>
                                </div>

                                {/* Check-in Code Sub-Tab */}
                                {eventSubTab === 'codes' && (
                                    <div className="admin-codes-section">
                                        {!eventCode ? (
                                            <>
                                                <p className="admin-no-results">
                                                    {isEnglish ? 'No check-in code yet.' : '暂无签到码。'}
                                                </p>
                                                <button
                                                    className="admin-generate-btn"
                                                    onClick={() => generateEventCode(managedEvent)}
                                                    disabled={generatingCode}
                                                >
                                                    {generatingCode
                                                        ? (isEnglish ? 'Generating...' : '生成中...')
                                                        : (isEnglish ? '+ Generate Code' : '+ 生成签到码')}
                                                </button>
                                            </>
                                        ) : (
                                            <div className="admin-single-code">
                                                <div className="admin-single-code-qr">
                                                    <QRCodeSVG value={getClaimUrl(eventCode.code)} size={200}
                                                               level="M"/>
                                                </div>
                                                <div className="admin-code-url">
                                                    <input
                                                        readOnly
                                                        value={getClaimUrl(eventCode.code)}
                                                        onClick={(e) => (e.target as HTMLInputElement).select()}
                                                        className="admin-code-input"
                                                    />
                                                    <button
                                                        className="admin-copy-btn"
                                                        onClick={() => navigator.clipboard.writeText(getClaimUrl(eventCode.code))}
                                                    >
                                                        {isEnglish ? 'Copy' : '复制'}
                                                    </button>
                                                </div>
                                                <span
                                                    className={eventCode.active ? 'admin-code-active-tag' : 'admin-code-inactive-tag'}>
                                                    {eventCode.active
                                                        ? (isEnglish ? 'Active' : '启用')
                                                        : (isEnglish ? 'Disabled' : '已停用')}
                                                </span>
                                                <div className="admin-code-time-inputs">
                                                    <label>
                                                        <span>{isEnglish ? 'Active from' : '开始时间'}</span>
                                                        <input
                                                            type="datetime-local"
                                                            value={codeFrom}
                                                            onChange={(e) => setCodeFrom(e.target.value)}
                                                            className="admin-datetime-input"
                                                        />
                                                    </label>
                                                    <label>
                                                        <span>{isEnglish ? 'Active until' : '结束时间'}</span>
                                                        <input
                                                            type="datetime-local"
                                                            value={codeUntil}
                                                            onChange={(e) => setCodeUntil(e.target.value)}
                                                            className="admin-datetime-input"
                                                        />
                                                    </label>
                                                    <button
                                                        className="admin-toggle-btn admin-toggle-grant"
                                                        onClick={saveCodeTimeWindow}
                                                        disabled={codeFrom === (eventCode.activeFrom ?? '') && codeUntil === (eventCode.activeUntil ?? '')}
                                                    >
                                                        {isEnglish ? 'Save' : '保存'}
                                                    </button>
                                                </div>
                                                <p className="admin-time-hint">
                                                    {isEnglish ? 'Leave empty for no time limit.' : '留空表示不限时间。'}
                                                </p>
                                                <div className="admin-single-code-actions">
                                                    <button
                                                        className="admin-toggle-btn"
                                                        onClick={toggleCodeActive}
                                                    >
                                                        {eventCode.active
                                                            ? (isEnglish ? 'Disable' : '停用')
                                                            : (isEnglish ? 'Enable' : '启用')}
                                                    </button>
                                                    <button
                                                        className="admin-toggle-btn admin-toggle-revoke"
                                                        onClick={() => {
                                                            const msg = isEnglish
                                                                ? 'This will deactivate the current code and generate a new one. Users with the old QR code will no longer be able to check in. Continue?'
                                                                : '此操作将停用当前签到码并生成新码。持有旧二维码的用户将无法签到。是否继续？';
                                                            if (window.confirm(msg)) generateEventCode(managedEvent);
                                                        }}
                                                        disabled={generatingCode}
                                                    >
                                                        {generatingCode
                                                            ? (isEnglish ? 'Regenerating...' : '重新生成中...')
                                                            : (isEnglish ? 'Regenerate' : '重新生成')}
                                                    </button>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                )}

                                {/* Attendees Sub-Tab */}
                                {eventSubTab === 'attendees' && (
                                    <div className="admin-attendees-section">
                                        {searching &&
                                            <div className="profile-spinner" style={{margin: '20px auto'}}/>}
                                        {!searching && eventAttendees.length === 0 && (
                                            <p className="admin-no-results">{isEnglish ? 'No attendees yet.' : '暂无参加者。'}</p>
                                        )}
                                        {!searching && eventAttendees.length > 0 && (
                                            <p className="admin-attendees-count">
                                                {eventAttendees.length} {isEnglish ? 'attendees' : '人参加'}
                                            </p>
                                        )}
                                        {!searching && eventAttendees.map((u) => (
                                            <div key={u.uid} className="admin-user-row">
                                                <img src={u.photoURL} alt="" className="admin-user-avatar"
                                                     referrerPolicy="no-referrer"/>
                                                <div>
                                                    <div className="admin-user-name">{u.displayName}</div>
                                                    <div className="admin-user-email">{u.email}</div>
                                                </div>
                                                <span className="admin-user-group-tag" data-group={u.group}>
                                                    {isEnglish ? GROUP_LABELS[u.group].en : GROUP_LABELS[u.group].zh}
                                                </span>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                )}

                {/* Event Labels Tab */}
                {activeTab === 'labels' && (
                    <div className="admin-section">
                        <h4 className="admin-badges-title" style={{marginBottom: '16px'}}>
                            {isEnglish ? 'Create New Label' : '创建新标签'}
                        </h4>
                        <div style={{
                            display: 'flex',
                            gap: '8px',
                            alignItems: 'flex-end',
                            flexWrap: 'wrap',
                            marginBottom: '24px'
                        }}>
                            <input
                                value={newLabelName}
                                onChange={e => setNewLabelName(e.target.value)}
                                className="admin-search-input"
                                placeholder={isEnglish ? 'English name' : '英文名称'}
                                style={{flex: 1, minWidth: '120px'}}
                                onKeyDown={e => e.key === 'Enter' && createLabel()}
                            />
                            <input
                                value={newLabelNameCn}
                                onChange={e => setNewLabelNameCn(e.target.value)}
                                className="admin-search-input"
                                placeholder={isEnglish ? 'Chinese name' : '中文名称'}
                                style={{flex: 1, minWidth: '120px'}}
                                onKeyDown={e => e.key === 'Enter' && createLabel()}
                            />
                            <button
                                className="admin-generate-btn"
                                onClick={createLabel}
                                disabled={savingLabel || !newLabelName.trim()}
                            >
                                {savingLabel ? '...' : (isEnglish ? '+ Create' : '+ 创建')}
                            </button>
                        </div>

                        <h4 className="admin-badges-title" style={{marginBottom: '16px'}}>
                            {isEnglish ? `All Labels (${eventLabels.length})` : `所有标签 (${eventLabels.length})`}
                        </h4>

                        {eventLabels.length === 0 ? (
                            <p style={{color: '#999', textAlign: 'center'}}>
                                {isEnglish ? 'No labels yet.' : '暂无标签。'}
                            </p>
                        ) : (
                            <div style={{display: 'flex', flexDirection: 'column', gap: '8px'}}>
                                {eventLabels.map(l => (
                                    <div key={l.id} className="admin-badge-row">
                                        {editingLabelId === l.id ? (
                                            <>
                                                <input
                                                    value={editLabelName}
                                                    onChange={e => setEditLabelName(e.target.value)}
                                                    className="admin-search-input"
                                                    style={{flex: 1, minWidth: '80px'}}
                                                    onKeyDown={e => e.key === 'Enter' && saveLabelEdit(l.id)}
                                                />
                                                <input
                                                    value={editLabelNameCn}
                                                    onChange={e => setEditLabelNameCn(e.target.value)}
                                                    className="admin-search-input"
                                                    style={{flex: 1, minWidth: '80px'}}
                                                    onKeyDown={e => e.key === 'Enter' && saveLabelEdit(l.id)}
                                                />
                                                <button
                                                    className="admin-toggle-btn admin-toggle-grant"
                                                    onClick={() => saveLabelEdit(l.id)}
                                                    disabled={!editLabelName.trim()}
                                                >
                                                    {isEnglish ? 'Save' : '保存'}
                                                </button>
                                                <button
                                                    className="admin-toggle-btn"
                                                    onClick={() => setEditingLabelId(null)}
                                                >
                                                    {isEnglish ? 'Cancel' : '取消'}
                                                </button>
                                            </>
                                        ) : (
                                            <>
                                                <div className="admin-badge-info" style={{flex: 1}}>
                                                    <span className="admin-badge-name">{l.name}</span>
                                                    {l.nameCn && (
                                                        <span className="admin-badge-date">{l.nameCn}</span>
                                                    )}
                                                </div>
                                                <button
                                                    className="admin-toggle-btn admin-toggle-grant"
                                                    onClick={() => {
                                                        setEditingLabelId(l.id);
                                                        setEditLabelName(l.name);
                                                        setEditLabelNameCn(l.nameCn);
                                                    }}
                                                >
                                                    {isEnglish ? 'Edit' : '编辑'}
                                                </button>
                                                <button
                                                    className="admin-toggle-btn admin-toggle-revoke"
                                                    onClick={() => deleteLabel(l.id)}
                                                >
                                                    {isEnglish ? 'Delete' : '删除'}
                                                </button>
                                            </>
                                        )}
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                )}

                {/* Badges Tab */}
                {activeTab === 'badges' && (
                    <div className="admin-section">
                        {!selectedBadgeDef ? (
                            <>
                                {showCreateBadge ? (
                                    <div className="admin-create-badge-form">
                                        <h4 className="admin-badges-title">
                                            {isEnglish ? 'Create New Badge' : '创建新徽章'}
                                        </h4>
                                        <div className="admin-form-grid">
                                            <label>
                                                <span>{isEnglish ? 'Name (English)' : '名称（英文）'}</span>
                                                <input
                                                    value={newBadgeName}
                                                    onChange={(e) => setNewBadgeName(e.target.value)}
                                                    className="admin-search-input"
                                                    placeholder={isEnglish ? 'Badge name' : '徽章名称'}
                                                />
                                            </label>
                                            <label>
                                                <span>{isEnglish ? 'Name (Chinese)' : '名称（中文）'}</span>
                                                <input
                                                    value={newBadgeNameCn}
                                                    onChange={(e) => setNewBadgeNameCn(e.target.value)}
                                                    className="admin-search-input"
                                                    placeholder={isEnglish ? 'Badge name in Chinese' : '徽章中文名称'}
                                                />
                                            </label>
                                            <label>
                                                <span>{isEnglish ? 'Description (English)' : '描述（英文）'}</span>
                                                <textarea
                                                    value={newBadgeDesc}
                                                    onChange={(e) => setNewBadgeDesc(e.target.value)}
                                                    className="admin-search-input admin-textarea"
                                                    placeholder={isEnglish ? 'Badge description' : '徽章描述'}
                                                />
                                            </label>
                                            <label>
                                                <span>{isEnglish ? 'Description (Chinese)' : '描述（中文）'}</span>
                                                <textarea
                                                    value={newBadgeDescCn}
                                                    onChange={(e) => setNewBadgeDescCn(e.target.value)}
                                                    className="admin-search-input admin-textarea"
                                                    placeholder={isEnglish ? 'Badge description in Chinese' : '徽章中文描述'}
                                                />
                                            </label>
                                            <div className="admin-creator-picker">
                                                <span className="admin-creator-picker-label">
                                                    {isEnglish ? 'Creator (optional)' : '创建者（可选）'}
                                                </span>
                                                {newBadgeCreatorUser ? (
                                                    <div className="admin-creator-selected">
                                                        <img src={newBadgeCreatorUser.photoURL} alt=""
                                                             className="admin-user-avatar"
                                                             referrerPolicy="no-referrer"/>
                                                        <div>
                                                            <div
                                                                className="admin-user-name">{newBadgeCreatorUser.displayName}</div>
                                                            <div
                                                                className="admin-user-email">{newBadgeCreatorUser.email}</div>
                                                        </div>
                                                        <button className="admin-back-btn"
                                                                onClick={() => setNewBadgeCreatorUser(null)}>
                                                            {isEnglish ? 'Clear' : '清除'}
                                                        </button>
                                                    </div>
                                                ) : (
                                                    <>
                                                        <div className="admin-creator-search-row">
                                                            <input
                                                                value={creatorSearchQuery}
                                                                onChange={(e) => setCreatorSearchQuery(e.target.value)}
                                                                onKeyDown={(e) => e.key === 'Enter' && searchCreator()}
                                                                className="admin-search-input"
                                                                placeholder={isEnglish ? 'Search user by email' : '通过邮箱搜索用户'}
                                                            />
                                                            <button onClick={searchCreator} disabled={searchingCreator}
                                                                    className="admin-search-btn">
                                                                {searchingCreator
                                                                    ? (isEnglish ? 'Searching...' : '搜索中...')
                                                                    : (isEnglish ? 'Search' : '搜索')}
                                                            </button>
                                                        </div>
                                                        {creatorSearchResults.map(u => (
                                                            <div key={u.uid} className="admin-user-row" onClick={() => {
                                                                setNewBadgeCreatorUser(u);
                                                                setNewBadgeCreatedByName('');
                                                                setNewBadgeCreatedByLink('');
                                                                setCreatorSearchQuery('');
                                                                setCreatorSearchResults([]);
                                                            }}>
                                                                <img src={u.photoURL} alt=""
                                                                     className="admin-user-avatar"
                                                                     referrerPolicy="no-referrer"/>
                                                                <div>
                                                                    <div
                                                                        className="admin-user-name">{u.displayName}</div>
                                                                    <div className="admin-user-email">{u.email}</div>
                                                                </div>
                                                            </div>
                                                        ))}
                                                        {creatorSearchResults.length === 0 && !searchingCreator && (
                                                            <>
                                                                <label style={{marginTop: '8px'}}>
                                                                    <span>{isEnglish ? 'Or enter name manually' : '或手动输入名称'}</span>
                                                                    <input
                                                                        value={newBadgeCreatedByName}
                                                                        onChange={(e) => setNewBadgeCreatedByName(e.target.value)}
                                                                        className="admin-search-input"
                                                                        placeholder={isEnglish ? 'Creator name' : '创建者名称'}
                                                                    />
                                                                </label>
                                                                {newBadgeCreatedByName && (
                                                                    <label>
                                                                        <span>{isEnglish ? 'Creator Link (optional)' : '创建者链接（可选）'}</span>
                                                                        <input
                                                                            value={newBadgeCreatedByLink}
                                                                            onChange={(e) => setNewBadgeCreatedByLink(e.target.value)}
                                                                            className="admin-search-input"
                                                                            placeholder="https://..."
                                                                        />
                                                                    </label>
                                                                )}
                                                            </>
                                                        )}
                                                    </>
                                                )}
                                            </div>
                                            <label>
                                                <span>{isEnglish ? 'Badge Image' : '徽章图片'}</span>
                                                <input
                                                    type="file"
                                                    accept="image/webp"
                                                    onChange={(e) => {
                                                        const file = e.target.files?.[0];
                                                        if (!file) return;
                                                        if (file.type !== 'image/webp') {
                                                            alert(isEnglish ? 'Please upload a WebP image.' : '请上传 WebP 格式的图片。');
                                                            e.target.value = '';
                                                            return;
                                                        }
                                                        setNewBadgeImage(file);
                                                        if (newBadgeImagePreview?.startsWith('blob:')) URL.revokeObjectURL(newBadgeImagePreview);
                                                        setNewBadgeImagePreview(URL.createObjectURL(file));
                                                    }}
                                                />
                                                {newBadgeImagePreview && (
                                                    <img src={newBadgeImagePreview} alt=""
                                                         className="admin-badge-image-preview"/>
                                                )}
                                            </label>
                                        </div>
                                        <div className="admin-form-actions">
                                            <button
                                                className="admin-generate-btn"
                                                onClick={createBadgeDef}
                                                disabled={creatingBadgeDef || !newBadgeName.trim()}
                                            >
                                                {creatingBadgeDef
                                                    ? (isEnglish ? 'Creating...' : '创建中...')
                                                    : (isEnglish ? 'Create Badge' : '创建徽章')}
                                            </button>
                                            <button
                                                className="admin-back-btn"
                                                onClick={() => {
                                                    setShowCreateBadge(false);
                                                    setNewBadgeName('');
                                                    setNewBadgeNameCn('');
                                                    setNewBadgeDesc('');
                                                    setNewBadgeDescCn('');
                                                    setNewBadgeImage(null);
                                                    if (newBadgeImagePreview?.startsWith('blob:')) URL.revokeObjectURL(newBadgeImagePreview);
                                                    setNewBadgeImagePreview(null);
                                                    setNewBadgeCreatorUser(null);
                                                    setNewBadgeCreatedByName('');
                                                    setNewBadgeCreatedByLink('');
                                                    setCreatorSearchQuery('');
                                                    setCreatorSearchResults([]);
                                                }}
                                            >
                                                {isEnglish ? 'Cancel' : '取消'}
                                            </button>
                                        </div>
                                    </div>
                                ) : (
                                    <button className="admin-generate-btn" onClick={() => setShowCreateBadge(true)}>
                                        {isEnglish ? '+ Create Badge' : '+ 创建徽章'}
                                    </button>
                                )}

                                {loadingBadgeDefs && <div className="profile-spinner" style={{margin: '20px auto'}}/>}
                                {!loadingBadgeDefs && badgeDefs.length === 0 && !showCreateBadge && (
                                    <p className="admin-no-results">
                                        {isEnglish ? 'No badges yet. Create one above.' : '暂无徽章，点击上方按钮创建。'}
                                    </p>
                                )}
                                {!loadingBadgeDefs && badgeDefs.length > 0 && (
                                    <div className="admin-event-grid">
                                        {badgeDefs.map(bd => (
                                            <button
                                                key={bd.id}
                                                className="admin-event-card"
                                                onClick={() => selectBadgeDef(bd)}
                                            >
                                                <img src={bd.imageUrl} alt="" className="admin-event-card-img"/>
                                                <div className="admin-event-card-info">
                                                    <span className="admin-event-card-title">
                                                        {isEnglish ? bd.name : bd.nameCn}
                                                    </span>
                                                    <span className="admin-event-card-date">
                                                        {isEnglish ? bd.description : bd.descriptionCn}
                                                    </span>
                                                </div>
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </>
                        ) : (
                            <div className="admin-event-detail">
                                <button className="admin-back-btn" onClick={() => {
                                    setSelectedBadgeDef(null);
                                    setBadgeHolders([]);
                                    setEditingBadgeDef(false);
                                }}>
                                    &larr; {isEnglish ? 'All Badges' : '所有徽章'}
                                </button>

                                <div className="admin-event-detail-header">
                                    <img src={selectedBadgeDef.imageUrl} alt="" className="admin-event-detail-img"/>
                                    <div>
                                        <h3>{isEnglish ? selectedBadgeDef.name : selectedBadgeDef.nameCn}</h3>
                                        <p className="admin-event-detail-meta">
                                            {isEnglish ? selectedBadgeDef.description : selectedBadgeDef.descriptionCn}
                                        </p>
                                        {selectedBadgeDef.createdByName && (
                                            <p className="admin-event-detail-meta" style={{marginTop: '4px'}}>
                                                {isEnglish ? 'Created by: ' : '创建者：'}
                                                {selectedBadgeDef.createdByUid ? (
                                                    <a href={`/profile?uid=${selectedBadgeDef.createdByUid}`}
                                                       style={{color: '#6c63ff'}}>
                                                        {selectedBadgeDef.createdByName}
                                                    </a>
                                                ) : selectedBadgeDef.createdByLink ? (
                                                    <a href={selectedBadgeDef.createdByLink} target="_blank"
                                                       rel="noopener noreferrer"
                                                       style={{color: '#6c63ff'}}>
                                                        {selectedBadgeDef.createdByName}
                                                    </a>
                                                ) : selectedBadgeDef.createdByName}
                                            </p>
                                        )}
                                    </div>
                                </div>

                                {editingBadgeDef ? (
                                    <div className="admin-create-badge-form" style={{marginBottom: '20px'}}>
                                        <h4 className="admin-badges-title">
                                            {isEnglish ? 'Edit Badge' : '编辑徽章'}
                                        </h4>
                                        <div className="admin-form-grid">
                                            <label>
                                                <span>{isEnglish ? 'Name (English)' : '名称（英文）'}</span>
                                                <input
                                                    value={editBadgeName}
                                                    onChange={(e) => setEditBadgeName(e.target.value)}
                                                    className="admin-search-input"
                                                />
                                            </label>
                                            <label>
                                                <span>{isEnglish ? 'Name (Chinese)' : '名称（中文）'}</span>
                                                <input
                                                    value={editBadgeNameCn}
                                                    onChange={(e) => setEditBadgeNameCn(e.target.value)}
                                                    className="admin-search-input"
                                                />
                                            </label>
                                            <label>
                                                <span>{isEnglish ? 'Description (English)' : '描述（英文）'}</span>
                                                <textarea
                                                    value={editBadgeDesc}
                                                    onChange={(e) => setEditBadgeDesc(e.target.value)}
                                                    className="admin-search-input admin-textarea"
                                                />
                                            </label>
                                            <label>
                                                <span>{isEnglish ? 'Description (Chinese)' : '描述（中文）'}</span>
                                                <textarea
                                                    value={editBadgeDescCn}
                                                    onChange={(e) => setEditBadgeDescCn(e.target.value)}
                                                    className="admin-search-input admin-textarea"
                                                />
                                            </label>
                                            <div className="admin-creator-picker">
                                                <span className="admin-creator-picker-label">
                                                    {isEnglish ? 'Creator (optional)' : '创建者（可选）'}
                                                </span>
                                                {editBadgeCreatorUser ? (
                                                    <div className="admin-creator-selected">
                                                        <img src={editBadgeCreatorUser.photoURL} alt=""
                                                             className="admin-user-avatar"
                                                             referrerPolicy="no-referrer"/>
                                                        <div>
                                                            <div
                                                                className="admin-user-name">{editBadgeCreatorUser.displayName}</div>
                                                            <div
                                                                className="admin-user-email">{editBadgeCreatorUser.email}</div>
                                                        </div>
                                                        <button className="admin-back-btn" onClick={() => {
                                                            setEditBadgeCreatorUser(null);
                                                            setEditBadgeCreatedByName('');
                                                            setEditBadgeCreatedByLink('');
                                                        }}>
                                                            {isEnglish ? 'Clear' : '清除'}
                                                        </button>
                                                    </div>
                                                ) : (
                                                    <>
                                                        <div className="admin-creator-search-row">
                                                            <input
                                                                value={creatorSearchQuery}
                                                                onChange={(e) => setCreatorSearchQuery(e.target.value)}
                                                                onKeyDown={(e) => e.key === 'Enter' && searchCreator()}
                                                                className="admin-search-input"
                                                                placeholder={isEnglish ? 'Search user by email' : '通过邮箱搜索用户'}
                                                            />
                                                            <button onClick={searchCreator} disabled={searchingCreator}
                                                                    className="admin-search-btn">
                                                                {searchingCreator
                                                                    ? (isEnglish ? 'Searching...' : '搜索中...')
                                                                    : (isEnglish ? 'Search' : '搜索')}
                                                            </button>
                                                        </div>
                                                        {creatorSearchResults.map(u => (
                                                            <div key={u.uid} className="admin-user-row" onClick={() => {
                                                                setEditBadgeCreatorUser(u);
                                                                setEditBadgeCreatedByName('');
                                                                setEditBadgeCreatedByLink('');
                                                                setCreatorSearchQuery('');
                                                                setCreatorSearchResults([]);
                                                            }}>
                                                                <img src={u.photoURL} alt=""
                                                                     className="admin-user-avatar"
                                                                     referrerPolicy="no-referrer"/>
                                                                <div>
                                                                    <div
                                                                        className="admin-user-name">{u.displayName}</div>
                                                                    <div className="admin-user-email">{u.email}</div>
                                                                </div>
                                                            </div>
                                                        ))}
                                                        {creatorSearchResults.length === 0 && !searchingCreator && (
                                                            <>
                                                                <label style={{marginTop: '8px'}}>
                                                                    <span>{isEnglish ? 'Or enter name manually' : '或手动输入名称'}</span>
                                                                    <input
                                                                        value={editBadgeCreatedByName}
                                                                        onChange={(e) => setEditBadgeCreatedByName(e.target.value)}
                                                                        className="admin-search-input"
                                                                    />
                                                                </label>
                                                                {editBadgeCreatedByName && (
                                                                    <label>
                                                                        <span>{isEnglish ? 'Creator Link (optional)' : '创建者链接（可选）'}</span>
                                                                        <input
                                                                            value={editBadgeCreatedByLink}
                                                                            onChange={(e) => setEditBadgeCreatedByLink(e.target.value)}
                                                                            className="admin-search-input"
                                                                            placeholder="https://..."
                                                                        />
                                                                    </label>
                                                                )}
                                                            </>
                                                        )}
                                                    </>
                                                )}
                                            </div>
                                            <label>
                                                <span>{isEnglish ? 'Badge Image' : '徽章图片'}</span>
                                                <input
                                                    type="file"
                                                    accept="image/webp"
                                                    onChange={(e) => {
                                                        const file = e.target.files?.[0];
                                                        if (!file) return;
                                                        if (file.type !== 'image/webp') {
                                                            alert(isEnglish ? 'Please upload a WebP image.' : '请上传 WebP 格式的图片。');
                                                            e.target.value = '';
                                                            return;
                                                        }
                                                        setEditBadgeImage(file);
                                                        if (editBadgeImagePreview?.startsWith('blob:')) URL.revokeObjectURL(editBadgeImagePreview);
                                                        setEditBadgeImagePreview(URL.createObjectURL(file));
                                                    }}
                                                />
                                                {editBadgeImagePreview && (
                                                    <img src={editBadgeImagePreview} alt=""
                                                         className="admin-badge-image-preview"/>
                                                )}
                                            </label>
                                        </div>
                                        <div className="admin-form-actions">
                                            <button
                                                className="admin-generate-btn"
                                                onClick={updateBadgeDef}
                                                disabled={savingBadgeDef || !editBadgeName.trim()}
                                            >
                                                {savingBadgeDef
                                                    ? (isEnglish ? 'Saving...' : '保存中...')
                                                    : (isEnglish ? 'Save Changes' : '保存更改')}
                                            </button>
                                            <button
                                                className="admin-back-btn"
                                                onClick={() => {
                                                    setEditingBadgeDef(false);
                                                    setEditBadgeImage(null);
                                                    if (editBadgeImagePreview?.startsWith('blob:')) URL.revokeObjectURL(editBadgeImagePreview);
                                                    setEditBadgeImagePreview(null);
                                                    setEditBadgeCreatorUser(null);
                                                    setCreatorSearchQuery('');
                                                    setCreatorSearchResults([]);
                                                }}
                                            >
                                                {isEnglish ? 'Cancel' : '取消'}
                                            </button>
                                        </div>
                                    </div>
                                ) : (
                                    <div className="admin-form-actions" style={{marginBottom: '20px'}}>
                                        <button
                                            className="admin-generate-btn"
                                            onClick={async () => {
                                                setEditBadgeName(selectedBadgeDef.name);
                                                setEditBadgeNameCn(selectedBadgeDef.nameCn);
                                                setEditBadgeDesc(selectedBadgeDef.description);
                                                setEditBadgeDescCn(selectedBadgeDef.descriptionCn);
                                                setEditBadgeImage(null);
                                                setEditBadgeImagePreview(null);
                                                setCreatorSearchQuery('');
                                                setCreatorSearchResults([]);
                                                if (selectedBadgeDef.createdByUid) {
                                                    const db = getFirebaseDb();
                                                    const snap = await getDoc(doc(db, 'users', selectedBadgeDef.createdByUid));
                                                    if (snap.exists()) {
                                                        setEditBadgeCreatorUser(docToUserRecord(snap));
                                                    } else {
                                                        setEditBadgeCreatorUser(null);
                                                        setEditBadgeCreatedByName(selectedBadgeDef.createdByName);
                                                        setEditBadgeCreatedByLink(selectedBadgeDef.createdByLink);
                                                    }
                                                } else {
                                                    setEditBadgeCreatorUser(null);
                                                    setEditBadgeCreatedByName(selectedBadgeDef.createdByName);
                                                    setEditBadgeCreatedByLink(selectedBadgeDef.createdByLink);
                                                }
                                                setEditingBadgeDef(true);
                                            }}
                                        >
                                            {isEnglish ? 'Edit Badge' : '编辑徽章'}
                                        </button>
                                        <button
                                            className="admin-toggle-btn admin-toggle-revoke"
                                            onClick={() => deleteBadgeDef(selectedBadgeDef)}
                                        >
                                            {isEnglish ? 'Delete Badge' : '删除徽章'}
                                        </button>
                                    </div>
                                )}

                                <h4 className="admin-badges-title">
                                    {isEnglish ? 'Badge Holders' : '徽章持有者'}
                                    {badgeHolders.length > 0 && (
                                        <span className="admin-badges-count">{badgeHolders.length}</span>
                                    )}
                                </h4>

                                {loadingBadgeHolders &&
                                    <div className="profile-spinner" style={{margin: '20px auto'}}/>}
                                {!loadingBadgeHolders && badgeHolders.length === 0 && (
                                    <p className="admin-no-results">
                                        {isEnglish ? 'No one has this badge yet.' : '暂无人持有此徽章。'}
                                    </p>
                                )}
                                {!loadingBadgeHolders && badgeHolders.map((u) => (
                                    <div key={u.uid} className="admin-user-row" onClick={() => {
                                        setSelectedUser(u);
                                        setSelectedBadgeDef(null);
                                        setActiveTab('users');
                                    }}>
                                        <img src={u.photoURL} alt="" className="admin-user-avatar"
                                             referrerPolicy="no-referrer"/>
                                        <div>
                                            <div className="admin-user-name">{u.displayName}</div>
                                            <div className="admin-user-email">{u.email}</div>
                                        </div>
                                        <span className="admin-user-group-tag" data-group={u.group}>
                                            {isEnglish ? GROUP_LABELS[u.group].en : GROUP_LABELS[u.group].zh}
                                        </span>
                                    </div>
                                ))}

                                {/* Badge Activation Codes */}
                                <h4 className="admin-badges-title" style={{marginTop: '28px'}}>
                                    {isEnglish ? 'Activation Codes' : '激活码'}
                                    {badgeActivationCodes.length > 0 && (
                                        <span className="admin-badges-count">{badgeActivationCodes.length}</span>
                                    )}
                                </h4>

                                <div className="admin-activation-create-form">
                                    <div className="admin-code-time-inputs">
                                        <label>
                                            <span>{isEnglish ? 'Max Uses' : '最大使用次数'}</span>
                                            <div style={{display: 'flex', alignItems: 'center', gap: '8px'}}>
                                                <input
                                                    type="number"
                                                    min="1"
                                                    value={newCodeUnlimited ? '' : newCodeMaxUses}
                                                    disabled={newCodeUnlimited}
                                                    onChange={(e) => {
                                                        setNewCodeUnlimited(false);
                                                        const val = parseInt(e.target.value);
                                                        setNewCodeMaxUses(isNaN(val) ? 1 : Math.max(1, val));
                                                    }}
                                                    className="admin-search-input"
                                                    placeholder={newCodeUnlimited ? '∞' : undefined}
                                                />
                                                <label style={{
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    gap: '4px',
                                                    fontSize: '13px',
                                                    whiteSpace: 'nowrap'
                                                }}>
                                                    <input
                                                        type="checkbox"
                                                        checked={newCodeUnlimited}
                                                        onChange={(e) => {
                                                            setNewCodeUnlimited(false);
                                                            if (e.target.checked) setNewCodeMaxUses(0);
                                                            else setNewCodeMaxUses(100);
                                                        }}
                                                    />
                                                    {isEnglish ? 'Unlimited' : '无限次'}
                                                </label>
                                            </div>
                                        </label>
                                        <label>
                                            <span>{isEnglish ? 'Active From' : '生效时间'}</span>
                                            <input
                                                type="datetime-local"
                                                value={newCodeFrom}
                                                onChange={(e) => setNewCodeFrom(e.target.value)}
                                                className="admin-search-input"
                                            />
                                        </label>
                                        <label>
                                            <span>{isEnglish ? 'Active Until' : '失效时间'}</span>
                                            <input
                                                type="datetime-local"
                                                value={newCodeUntil}
                                                onChange={(e) => setNewCodeUntil(e.target.value)}
                                                className="admin-search-input"
                                            />
                                        </label>
                                    </div>
                                    <button
                                        className="admin-generate-btn"
                                        onClick={() => createBadgeActivationCode(selectedBadgeDef.id)}
                                        disabled={generatingActivationCode}
                                        style={{marginTop: '12px'}}
                                    >
                                        {generatingActivationCode
                                            ? (isEnglish ? 'Generating...' : '生成中...')
                                            : (isEnglish ? '+ Generate Activation Code' : '+ 生成激活码')}
                                    </button>
                                </div>

                                {loadingActivationCodes &&
                                    <div className="profile-spinner" style={{margin: '20px auto'}}/>}

                                {!loadingActivationCodes && badgeActivationCodes.length === 0 && (
                                    <p className="admin-no-results">
                                        {isEnglish ? 'No activation codes yet.' : '暂无激活码。'}
                                    </p>
                                )}

                                {!loadingActivationCodes && badgeActivationCodes.map((ac) => (
                                    <div key={ac.id} className="admin-single-code" style={{marginTop: '12px'}}>
                                        <div style={{
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: '10px',
                                            flexWrap: 'wrap'
                                        }}>
                                            <span
                                                className={ac.active ? 'admin-code-active-tag' : 'admin-code-inactive-tag'}>
                                                {ac.active
                                                    ? (isEnglish ? 'Active' : '活跃')
                                                    : (isEnglish ? 'Inactive' : '已停用')}
                                            </span>
                                            <span style={{fontSize: '13px', color: '#7a8190'}}>
                                                {ac.maxUses === 0
                                                    ? (isEnglish
                                                        ? `Used ${ac.usedCount} / ∞ times`
                                                        : `已使用 ${ac.usedCount} / ∞ 次`)
                                                    : (isEnglish
                                                        ? `Used ${ac.usedCount} / ${ac.maxUses} times`
                                                        : `已使用 ${ac.usedCount} / ${ac.maxUses} 次`)}
                                            </span>
                                            {ac.activeFrom && (
                                                <span style={{fontSize: '12px', color: '#999'}}>
                                                    {isEnglish ? 'From: ' : '从：'}{new Date(ac.activeFrom).toLocaleString()}
                                                </span>
                                            )}
                                            {ac.activeUntil && (
                                                <span style={{fontSize: '12px', color: '#999'}}>
                                                    {isEnglish ? 'Until: ' : '至：'}{new Date(ac.activeUntil).toLocaleString()}
                                                </span>
                                            )}
                                        </div>
                                        <div className="admin-single-code-qr">
                                            <QRCodeSVG value={getClaimBadgeUrl(ac.code)} size={160}/>
                                        </div>
                                        <div className="admin-code-url">
                                            <input
                                                readOnly
                                                value={getClaimBadgeUrl(ac.code)}
                                                className="admin-code-input"
                                            />
                                            <button
                                                className="admin-copy-btn"
                                                onClick={() => navigator.clipboard.writeText(getClaimBadgeUrl(ac.code))}
                                            >
                                                {isEnglish ? 'Copy' : '复制'}
                                            </button>
                                        </div>
                                        <div className="admin-single-code-actions">
                                            <button
                                                className="admin-toggle-btn admin-toggle-grant"
                                                onClick={() => toggleActivationCodeActive(ac)}
                                            >
                                                {ac.active
                                                    ? (isEnglish ? 'Deactivate' : '停用')
                                                    : (isEnglish ? 'Activate' : '激活')}
                                            </button>
                                            <button
                                                className="admin-toggle-btn admin-toggle-revoke"
                                                onClick={() => deleteActivationCode(ac)}
                                            >
                                                {isEnglish ? 'Delete' : '删除'}
                                            </button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                )}

                {/* Records Tab */}
                {activeTab === 'records' && (
                    <div className="admin-section">
                        <div className="record-filter-bar">
                            <span className="record-filter-label">{isEnglish ? 'Filter' : '筛选'}</span>
                            <select
                                className="record-filter-select"
                                value={recordFilterType}
                                onChange={(e) => setRecordFilterType(e.target.value as RecordType | '')}
                            >
                                <option value="">{isEnglish ? 'All Types' : '所有类型'}</option>
                                <option value="group-assign">{isEnglish ? 'Group' : '用户组'}</option>
                                <option value="code-create">{isEnglish ? 'Code' : '兑换码'}</option>
                                <option value="badge-grant">{isEnglish ? 'Attend' : '签到'}</option>
                                <option value="badge-revoke">{isEnglish ? 'Unattend' : '取消签到'}</option>
                                <option value="achievement-grant">{isEnglish ? 'Badge Grant' : '授予徽章'}</option>
                                <option value="achievement-revoke">{isEnglish ? 'Badge Revoke' : '撤销徽章'}</option>
                                <option value="badge-create">{isEnglish ? 'Badge Create' : '创建徽章'}</option>
                                <option value="badge-edit">{isEnglish ? 'Badge Edit' : '编辑徽章'}</option>
                                <option value="badge-delete">{isEnglish ? 'Badge Delete' : '删除徽章'}</option>
                                <option value="event-create">{isEnglish ? 'Event Create' : '创建活动'}</option>
                                <option value="event-edit">{isEnglish ? 'Event Edit' : '编辑活动'}</option>
                                <option value="event-delete">{isEnglish ? 'Event Delete' : '删除活动'}</option>
                                <option value="label-create">{isEnglish ? 'Label Create' : '创建标签'}</option>
                                <option value="label-edit">{isEnglish ? 'Label Edit' : '编辑标签'}</option>
                                <option value="label-delete">{isEnglish ? 'Label Delete' : '删除标签'}</option>
                            </select>
                            <select
                                className="record-filter-select"
                                value={recordFilterActor}
                                onChange={(e) => setRecordFilterActor(e.target.value)}
                            >
                                <option value="">{isEnglish ? 'All Actors' : '所有操作人'}</option>
                                {uniqueActors.map((a) => (
                                    <option key={a.uid} value={a.uid}>{a.name}</option>
                                ))}
                            </select>
                        </div>

                        {loadingRecords && <div className="profile-spinner" style={{margin: '20px auto'}}/>}

                        {!loadingRecords && records.length === 0 && (
                            <p className="admin-no-results">{isEnglish ? 'No records yet.' : '暂无记录。'}</p>
                        )}

                        {!loadingRecords && filteredRecords.map((r) => (
                            <div key={r.id} className="record-row">
                                <span className={`record-type-tag record-type-${r.type}`}>
                                    {getRecordTypeTag(r.type)}
                                </span>
                                <div className="record-content">
                                    <span
                                        className="record-actor">{clickableName(r.performedBy, r.performedByName)}</span>
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
                    </div>
                )}
            </div>
        </>
    );
};
