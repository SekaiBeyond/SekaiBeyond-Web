import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { collection, getDocs } from 'firebase/firestore';
import { hasPermission, useAuth } from '~/components/AuthProvider';
import { LoginButton } from '~/components/LoginButton';
import { useLanguage } from '~/components/LanguageContextProvider';
import { getFirebaseDb } from '~/lib/firebase';
import { LanguageSwitcher } from '~/components/LanguageSwitcher';
import { usePastEvents } from '~/lib/pastEvents';
import { useAllUpcomingEvents, useUpcomingEventsByIds } from '~/lib/upcomingEvents';
import { useNavigate, useSearchParams } from 'react-router';
import { useTags } from '~/lib/tags';
import type { BadgeDef, Tab } from './types';
import { UsersTab, type UsersTabHandle } from './UsersTab';
import { EventsTab, type EventsTabHandle } from './EventsTab';
import { UpcomingEventsTab, type UpcomingEventsTabHandle } from './UpcomingEventsTab';
import { BadgesTab, type BadgesTabHandle } from './BadgesTab';
import { TagsTab } from './TagsTab';
import { RecordsTab } from './RecordsTab';
import { ToolsTab } from './ToolsTab';
import { SiteConfigTab } from './SiteConfigTab';

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
    const {upcomingEvents: allUpcomingEvents, refresh: refreshAllUpcoming} = useAllUpcomingEvents();
    // Per-ID fetch for event-staff: avoids collection-level permission errors.
    const staffEventIds = profile?.eventStaffEvents ?? [];
    const {
        upcomingEvents: staffUpcomingEvents,
        loading: staffEventsLoading,
        refresh: refreshStaffUpcoming
    } = useUpcomingEventsByIds(staffEventIds);
    const pastEvents = useMemo(() => [...rawPastEvents].sort((a, b) => b.date.localeCompare(a.date)), [rawPastEvents]);

    const isCoreStaffOrAbove = !!profile && hasPermission(profile.group, 'core-staff');
    // Staff group (level 2): view-only admin access + Tools. Superset of event-staff access.
    const isStaffGroup = !!profile && hasPermission(profile.group, 'staff') && !isCoreStaffOrAbove;
    // Event-staff is a per-event tag, independent of the global user group — a user
    // below staff group who is staff for an UPCOMING event gets scanner/admin access
    // for those events. Access is gated on upcoming (not raw eventStaffEvents)
    // membership: past-event staff entries are retained for the profile badge +
    // roster, so access falls away naturally once a staffer's events are archived.
    const isEventStaffOnly = !!profile
        && !isCoreStaffOrAbove
        && !isStaffGroup
        && staffUpcomingEvents.length > 0;

    // Core-staff and staff group see all events; event-staff only sees their assigned ones.
    const upcomingEvents = (isCoreStaffOrAbove || isStaffGroup) ? allUpcomingEvents : staffUpcomingEvents;
    const refreshUpcoming = (isCoreStaffOrAbove || isStaffGroup) ? refreshAllUpcoming : refreshStaffUpcoming;

    const [activeTab, setActiveTab] = useState<Tab>('users');
    const [upcomingInDetail, setUpcomingInDetail] = useState(false);
    const [eventsInDetail, setEventsInDetail] = useState(false);
    const [upcomingOpen, setUpcomingOpen] = useState(true);
    const [pastOpen, setPastOpen] = useState(true);
    const [tagsOpen, setTagsOpen] = useState(true);
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
        if (user && profile && (isCoreStaffOrAbove || isStaffGroup || isEventStaffOnly)) {
            wasAuthorized.current = true;
            return;
        }
        if (wasAuthorized.current && !user) {
            navigate('/', {replace: true});
        }
    }, [loading, user, profile, isCoreStaffOrAbove, isStaffGroup, isEventStaffOnly, navigate]);

    useEffect(() => {
        if (urlParamsHandled.current) return;
        if (loading || !user || !profile) return;
        if (!isCoreStaffOrAbove && !isStaffGroup && !isEventStaffOnly) return;
        const tab = searchParams.get('tab');
        const event = searchParams.get('event');
        if (isEventStaffOnly) {
            setActiveTab('events');
            const firstEventId = event && staffUpcomingEvents.some(e => e.id === event)
                ? event
                : staffUpcomingEvents[0]?.id;
            if (firstEventId) {
                upcomingTabRef.current?.selectEvent(firstEventId);
            }
        } else if (isStaffGroup) {
            if (tab === 'events' || tab === 'tools' || tab === 'users' || tab === 'badges' || tab === 'records' || tab === 'config') {
                setActiveTab(tab);
            } else if (tab === 'tags') {
                setActiveTab('events');
            } else if (tab === 'upcoming') {
                setActiveTab('events');
            } else if (tab === 'policy') {
                setActiveTab('config');
            } else {
                setActiveTab('users');
            }
            if (tab === 'events' && event) {
                eventsTabRef.current?.selectManagedEvent(event);
            }
            if (tab === 'upcoming' && event) {
                upcomingTabRef.current?.selectEvent(event);
            }
        } else {
            if (tab === 'events' || tab === 'badges' || tab === 'records' || tab === 'users' || tab === 'tools' || tab === 'config') {
                setActiveTab(tab);
            } else if (tab === 'tags') {
                setActiveTab('events');
            } else if (tab === 'upcoming') {
                setActiveTab('events');
            } else if (tab === 'policy') {
                setActiveTab('config');
            }
            if (tab === 'events' && event) {
                eventsTabRef.current?.selectManagedEvent(event);
            }
            if (tab === 'upcoming' && event) {
                upcomingTabRef.current?.selectEvent(event);
            }
        }
        urlParamsHandled.current = true;
    }, [loading, user, profile, searchParams, isCoreStaffOrAbove, isStaffGroup, isEventStaffOnly, staffUpcomingEvents]);

    useEffect(() => {
        if (loading || !user || !profile || (!isCoreStaffOrAbove && !isStaffGroup)) return;
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
    }, [loading, user, profile, isCoreStaffOrAbove, isStaffGroup]);

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
        setPastOpen(true);
        pendingAction.current = {type: 'selectEvent', id: eventId};
    }, []);

    const handleSelectUpcomingEvent = useCallback((eventId: string) => {
        setActiveTab('events');
        setUpcomingOpen(true);
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

    // A potential event-staff user (below staff group, has eventStaffEvents) can't be
    // classified until we know which of their assigned events are still upcoming.
    // Hold the spinner until that resolves so we don't flash "Access Denied".
    const resolvingEventStaff = !!profile && !isCoreStaffOrAbove && !isStaffGroup
        && staffEventIds.length > 0 && staffEventsLoading;
    if (loading || resolvingEventStaff) {
        return (
            <div className="profile-loading">
                <div className="profile-spinner"/>
            </div>
        );
    }

    if (!user || !profile || (!isCoreStaffOrAbove && !isStaffGroup && !isEventStaffOnly)) {
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
                    {(isCoreStaffOrAbove || isStaffGroup) && (
                        <button
                            className={`admin-tab ${activeTab === 'users' ? 'admin-tab-active' : ''}`}
                            onClick={() => setActiveTab('users')}
                        >
                            {isEnglish ? 'Users Management' : '用户管理'}
                        </button>
                    )}
                    <button
                        className={`admin-tab ${activeTab === 'events' ? 'admin-tab-active' : ''}`}
                        onClick={() => setActiveTab('events')}
                    >
                        {isEnglish ? 'Events' : '活动管理'}
                    </button>
                    {(isCoreStaffOrAbove || isStaffGroup) && (
                        <button
                            className={`admin-tab ${activeTab === 'badges' ? 'admin-tab-active' : ''}`}
                            onClick={() => setActiveTab('badges')}
                        >
                            {isEnglish ? 'Badges' : '徽章'}
                        </button>
                    )}
                    {(isCoreStaffOrAbove || isStaffGroup) && (
                        <button
                            className={`admin-tab ${activeTab === 'config' ? 'admin-tab-active' : ''}`}
                            onClick={() => setActiveTab('config')}
                        >
                            {isEnglish ? 'Site Config' : '网站配置'}
                        </button>
                    )}
                    {(isCoreStaffOrAbove || isStaffGroup) && (
                        <button
                            className={`admin-tab ${activeTab === 'tools' ? 'admin-tab-active' : ''}`}
                            onClick={() => setActiveTab('tools')}
                        >
                            {isEnglish ? 'Tools' : '工具'}
                        </button>
                    )}
                    {(isCoreStaffOrAbove || isStaffGroup) && (
                        <button
                            className={`admin-tab ${activeTab === 'records' ? 'admin-tab-active' : ''}`}
                            onClick={() => setActiveTab('records')}
                        >
                            {isEnglish ? 'Records' : '操作记录'}
                        </button>
                    )}
                </div>

                {activeTab === 'users' && (isCoreStaffOrAbove || isStaffGroup) && (
                    <UsersTab
                        ref={usersTabRef}
                        pastEvents={pastEvents}
                        badgeDefs={badgeDefs}
                        badgeDefsError={badgeDefsError}
                        user={user}
                        profile={profile}
                        showToast={showToast}
                        readOnly={isStaffGroup}
                    />
                )}

                {activeTab === 'events' && (
                    <>
                        <div style={eventsInDetail ? {display: 'none'} : undefined}>
                            {!upcomingInDetail && (
                                <button
                                    className="admin-section-header"
                                    onClick={() => setUpcomingOpen(v => !v)}
                                >
                                    <span className="admin-section-header-title">
                                        {isEnglish ? 'Upcoming Events' : '活动预告'}
                                    </span>
                                    <span
                                        className={`admin-section-chevron${upcomingOpen ? ' admin-section-chevron-open' : ''}`}>▾</span>
                                </button>
                            )}
                            <div style={!upcomingOpen && !upcomingInDetail ? {display: 'none'} : undefined}>
                                <UpcomingEventsTab
                                    ref={upcomingTabRef}
                                    upcomingEvents={upcomingEvents}
                                    refreshEvents={refreshUpcoming}
                                    refreshPastEvents={refreshEvents}
                                    tags={tags}
                                    showToast={showToast}
                                    readOnly={!isCoreStaffOrAbove}
                                    eventStaffEvents={profile.eventStaffEvents}
                                    onDetailChange={setUpcomingInDetail}
                                />
                            </div>
                        </div>
                        {(isCoreStaffOrAbove || isStaffGroup) && (
                            <div style={upcomingInDetail ? {display: 'none'} : undefined}>
                                {!eventsInDetail && (
                                    <button
                                        className="admin-section-header admin-section-mt"
                                        onClick={() => setPastOpen(v => !v)}
                                    >
                                        <span className="admin-section-header-title">
                                            {isEnglish ? 'Past Events' : '往期活动'}
                                        </span>
                                        <span
                                            className={`admin-section-chevron${pastOpen ? ' admin-section-chevron-open' : ''}`}>▾</span>
                                    </button>
                                )}
                                <div style={!pastOpen && !eventsInDetail ? {display: 'none'} : undefined}>
                                    <EventsTab
                                        ref={eventsTabRef}
                                        pastEvents={pastEvents}
                                        refreshEvents={refreshEvents}
                                        tags={tags}
                                        showToast={showToast}
                                        onDetailChange={setEventsInDetail}
                                        readOnly={isStaffGroup}
                                    />
                                </div>
                            </div>
                        )}
                        {(isCoreStaffOrAbove || isStaffGroup) && !upcomingInDetail && !eventsInDetail && (
                            <div>
                                <button
                                    className="admin-section-header admin-section-mt"
                                    onClick={() => setTagsOpen(v => !v)}
                                >
                                    <span className="admin-section-header-title">
                                        {isEnglish ? 'Tags' : '标签'}
                                    </span>
                                    <span
                                        className={`admin-section-chevron${tagsOpen ? ' admin-section-chevron-open' : ''}`}>▾</span>
                                </button>
                                {tagsOpen && <TagsTab tags={tags} refreshTags={refreshTags} showToast={showToast}
                                                      readOnly={isStaffGroup}/>}
                            </div>
                        )}
                    </>
                )}

                {activeTab === 'badges' && (isCoreStaffOrAbove || isStaffGroup) && (
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
                            readOnly={isStaffGroup}
                        />
                    )
                )}

                {activeTab === 'records' && (isCoreStaffOrAbove || isStaffGroup) && (
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

                {activeTab === 'tools' && (isCoreStaffOrAbove || isStaffGroup) && (
                    <ToolsTab/>
                )}

                {activeTab === 'config' && (isCoreStaffOrAbove || isStaffGroup) && (
                    <SiteConfigTab showToast={showToast} readOnly={isStaffGroup}/>
                )}
            </div>
        </>
    );
};
