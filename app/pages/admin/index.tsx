import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { collection, getDocs } from 'firebase/firestore';
import { hasPermission, useAuth } from '~/components/AuthProvider';
import { LoginButton } from '~/components/LoginButton';
import { useLanguage } from '~/components/LanguageContextProvider';
import { getFirebaseDb } from '~/lib/firebase';
import { LanguageSwitcher } from '~/components/LanguageSwitcher';
import { usePastEvents } from '~/lib/pastEvents';
import { useAllUpcomingEvents } from '~/lib/upcomingEvents';
import { useNavigate, useSearchParams } from 'react-router';
import { useTags } from '~/lib/tags';
import type { BadgeDef, Tab } from './types';
import { UsersTab, type UsersTabHandle } from './UsersTab';
import { EventsTab, type EventsTabHandle } from './EventsTab';
import { UpcomingEventsTab, type UpcomingEventsTabHandle } from './UpcomingEventsTab';
import { BadgesTab, type BadgesTabHandle } from './BadgesTab';
import { TagsTab } from './TagsTab';
import { RecordsTab } from './RecordsTab';

type ToastType = 'success' | 'warning' | 'error';

interface Toast {
    id: number;
    message: string;
    type: ToastType;
}

let toastCounter = 0;

export const AdminPage = () => {
    const {user, profile, loading} = useAuth();
    const {isEnglish} = useLanguage();
    const {pastEvents: rawPastEvents, refresh: refreshEvents} = usePastEvents();
    const {upcomingEvents, refresh: refreshUpcoming} = useAllUpcomingEvents();
    const pastEvents = useMemo(() => [...rawPastEvents].sort((a, b) => b.date.localeCompare(a.date)), [rawPastEvents]);

    const isCoreStaffOrAbove = !!profile && hasPermission(profile.group, 'core-staff');
    const isEventStaffOnly = !!profile
        && !isCoreStaffOrAbove
        && profile.group === 'staff'
        && profile.eventStaffEvents.length > 0;

    const scopedUpcomingEvents = useMemo(() => {
        if (!isEventStaffOnly || !profile) return upcomingEvents;
        return upcomingEvents.filter(e => profile.eventStaffEvents.includes(e.id));
    }, [upcomingEvents, isEventStaffOnly, profile]);

    const [activeTab, setActiveTab] = useState<Tab>('users');
    const [badgeDefs, setBadgeDefs] = useState<BadgeDef[]>([]);
    const [badgeDefsError, setBadgeDefsError] = useState(false);
    const [toasts, setToasts] = useState<Toast[]>([]);

    const showToast = useCallback((message: string, type: ToastType) => {
        const id = ++toastCounter;
        setToasts(prev => [...prev, {id, message, type}]);
        setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 3000);
    }, []);
    const {tags, refresh: refreshTags} = useTags();
    const [searchParams] = useSearchParams();
    const navigate = useNavigate();
    const urlParamsHandled = useRef(false);
    const wasAuthorized = useRef(false);
    const usersTabRef = useRef<UsersTabHandle>(null);
    const eventsTabRef = useRef<EventsTabHandle>(null);
    const upcomingTabRef = useRef<UpcomingEventsTabHandle>(null);
    const badgesTabRef = useRef<BadgesTabHandle>(null);
    const pendingAction = useRef<{type: string; id: string} | null>(null);

    useEffect(() => {
        if (loading) return;
        if (user && profile && (isCoreStaffOrAbove || isEventStaffOnly)) {
            wasAuthorized.current = true;
            return;
        }
        if (wasAuthorized.current && !user) {
            navigate('/', {replace: true});
        }
    }, [loading, user, profile, isCoreStaffOrAbove, isEventStaffOnly, navigate]);

    useEffect(() => {
        if (urlParamsHandled.current) return;
        if (loading || !user || !profile) return;
        if (!isCoreStaffOrAbove && !isEventStaffOnly) return;
        const tab = searchParams.get('tab');
        const event = searchParams.get('event');
        if (isEventStaffOnly) {
            setActiveTab('upcoming');
            const firstEventId = event && profile.eventStaffEvents.includes(event)
                ? event
                : profile.eventStaffEvents[0];
            if (firstEventId) {
                upcomingTabRef.current?.selectEvent(firstEventId);
            }
        } else {
            if (tab === 'events' || tab === 'upcoming' || tab === 'badges' || tab === 'tags' || tab === 'records' || tab === 'users') {
                setActiveTab(tab);
            }
            if (tab === 'events' && event) {
                eventsTabRef.current?.selectManagedEvent(event);
            }
            if (tab === 'upcoming' && event) {
                upcomingTabRef.current?.selectEvent(event);
            }
        }
        urlParamsHandled.current = true;
    }, [loading, user, profile, searchParams, isCoreStaffOrAbove, isEventStaffOnly]);

    useEffect(() => {
        if (loading || !user || !profile || !isCoreStaffOrAbove) return;
        const loadBadgeDefinitions = async () => {
            const db = getFirebaseDb();
            const snapshot = await getDocs(collection(db, 'badges'));
            const defs: BadgeDef[] = snapshot.docs.map(docSnap => {
                const data = docSnap.data();
                return {
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
                    deleteAt: data.deleteAt?.toDate?.() ?? null,
                };
            });
            setBadgeDefs(defs);
        };
        loadBadgeDefinitions().catch(() => {
            setBadgeDefsError(true);
        });
    }, [loading, user, profile, isCoreStaffOrAbove]);

    const handleLookupUser = useCallback((uid: string) => {
        setActiveTab('users');
        pendingAction.current = {type: 'lookupUser', id: uid};
    }, []);

    const handleSelectBadge = useCallback((badgeId: string) => {
        setActiveTab('badges');
        pendingAction.current = {type: 'selectBadge', id: badgeId};
    }, []);

    const handleSelectEvent = useCallback((eventId: string) => {
        setActiveTab('events');
        pendingAction.current = {type: 'selectEvent', id: eventId};
    }, []);

    const handleSelectUpcomingEvent = useCallback((eventId: string) => {
        setActiveTab('upcoming');
        pendingAction.current = {type: 'selectUpcomingEvent', id: eventId};
    }, []);

    // Execute pending cross-tab actions after the target tab mounts
    useEffect(() => {
        const action = pendingAction.current;
        if (!action) return;
        pendingAction.current = null;

        switch (action.type) {
            case 'lookupUser':
                usersTabRef.current?.lookupUserByUid(action.id);
                break;
            case 'selectBadge':
                badgesTabRef.current?.selectBadgeById(action.id);
                break;
            case 'selectEvent':
                eventsTabRef.current?.selectManagedEvent(action.id);
                break;
            case 'selectUpcomingEvent':
                upcomingTabRef.current?.selectEvent(action.id);
                break;
        }
    }, [activeTab]);

    if (loading) {
        return (
            <div className="profile-loading">
                <div className="profile-spinner"/>
            </div>
        );
    }

    if (!user || !profile || (!isCoreStaffOrAbove && !isEventStaffOnly)) {
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

    return (
        <>
            <div className="admin-toast-container">
                {toasts.map(t => (
                    <div key={t.id} className={`admin-toast admin-toast-${t.type}`}>
                        {t.message}
                    </div>
                ))}
            </div>
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
                <div className="admin-tabs">
                    {!isEventStaffOnly && (
                        <button
                            className={`admin-tab ${activeTab === 'users' ? 'admin-tab-active' : ''}`}
                            onClick={() => setActiveTab('users')}
                        >
                            {isEnglish ? 'User Lookup' : '用户查询'}
                        </button>
                    )}
                    {!isEventStaffOnly && (
                        <button
                            className={`admin-tab ${activeTab === 'events' ? 'admin-tab-active' : ''}`}
                            onClick={() => setActiveTab('events')}
                        >
                            {isEnglish ? 'Past Events' : '往期活动'}
                        </button>
                    )}
                    <button
                        className={`admin-tab ${activeTab === 'upcoming' ? 'admin-tab-active' : ''}`}
                        onClick={() => setActiveTab('upcoming')}
                    >
                        {isEnglish ? 'Upcoming Events' : '活动预告'}
                    </button>
                    {!isEventStaffOnly && (
                        <button
                            className={`admin-tab ${activeTab === 'badges' ? 'admin-tab-active' : ''}`}
                            onClick={() => setActiveTab('badges')}
                        >
                            {isEnglish ? 'Badges' : '徽章'}
                        </button>
                    )}
                    {!isEventStaffOnly && (
                        <button
                            className={`admin-tab ${activeTab === 'tags' ? 'admin-tab-active' : ''}`}
                            onClick={() => setActiveTab('tags')}
                        >
                            {isEnglish ? 'Tags' : '标签'}
                        </button>
                    )}
                    {!isEventStaffOnly && (
                        <button
                            className={`admin-tab ${activeTab === 'records' ? 'admin-tab-active' : ''}`}
                            onClick={() => setActiveTab('records')}
                        >
                            {isEnglish ? 'Records' : '操作记录'}
                        </button>
                    )}
                </div>

                {activeTab === 'users' && !isEventStaffOnly && (
                    <UsersTab
                        ref={usersTabRef}
                        pastEvents={pastEvents}
                        upcomingEvents={upcomingEvents}
                        badgeDefs={badgeDefs}
                        badgeDefsError={badgeDefsError}
                        user={user}
                        profile={profile}
                        showToast={showToast}
                    />
                )}

                {activeTab === 'events' && !isEventStaffOnly && (
                    <EventsTab
                        ref={eventsTabRef}
                        pastEvents={pastEvents}
                        refreshEvents={refreshEvents}
                        tags={tags}
                        showToast={showToast}
                    />
                )}

                {activeTab === 'upcoming' && (
                    <UpcomingEventsTab
                        ref={upcomingTabRef}
                        upcomingEvents={scopedUpcomingEvents}
                        refreshEvents={refreshUpcoming}
                        refreshPastEvents={refreshEvents}
                        tags={tags}
                        showToast={showToast}
                        readOnly={!isCoreStaffOrAbove}
                        eventStaffEvents={profile.eventStaffEvents}
                    />
                )}

                {activeTab === 'badges' && !isEventStaffOnly && (
                    badgeDefsError ? (
                        <div className="admin-section">
                            <p className="admin-no-results">
                                {isEnglish ? 'Failed to load badges. Please refresh.' : '加载徽章失败，请刷新页面。'}
                            </p>
                        </div>
                    ) : (
                        <BadgesTab
                            ref={badgesTabRef}
                            badgeDefs={badgeDefs}
                            setBadgeDefs={setBadgeDefs}
                            user={user}
                            showToast={showToast}
                        />
                    )
                )}

                {activeTab === 'tags' && !isEventStaffOnly && (
                    <TagsTab tags={tags} refreshTags={refreshTags} showToast={showToast}/>
                )}

                {activeTab === 'records' && !isEventStaffOnly && (
                    <RecordsTab
                        pastEvents={pastEvents}
                        upcomingEvents={upcomingEvents}
                        badgeDefs={badgeDefs}
                        onLookupUser={handleLookupUser}
                        onSelectBadge={handleSelectBadge}
                        onSelectEvent={handleSelectEvent}
                        onSelectUpcomingEvent={handleSelectUpcomingEvent}
                    />
                )}
            </div>
        </>
    );
};
