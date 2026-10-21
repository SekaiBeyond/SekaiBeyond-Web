import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { collection, getDocs } from 'firebase/firestore';
import { hasPermission, useAuth } from '~/components/AuthProvider';
import { LoginButton } from '~/components/LoginButton';
import { useLanguage } from '~/components/LanguageContextProvider';
import { getFirebaseDb } from '~/lib/firebase';
import { confirmExit } from '~/lib/useExitGuard';
import { LanguageSwitcher } from '~/components/LanguageSwitcher';
import { usePastEvents } from '~/lib/pastEvents';
import { useAllUpcomingEvents, useUpcomingEventsByIds } from '~/lib/upcomingEvents';
import { useNavigate, useSearchParams } from 'react-router';
import { useTags } from '~/lib/tags';
import { useVenues } from '~/lib/venues';
import type { BadgeDef, Tab } from './types';
import { UsersTab, type UsersTabHandle } from './UsersTab';
import { EventsTab, type EventsTabHandle } from './EventsTab';
import { UpcomingEventsTab, type UpcomingEventsTabHandle } from './UpcomingEventsTab';
import { BadgesTab, type BadgesTabHandle } from './BadgesTab';
import { TagsTab } from './TagsTab';
import { VenuesTab } from './VenuesTab';
import { UwParkingStatus } from './UwParkingStatus';
import { LocationsMap } from './LocationsMap';
import { PassportsTab } from './passports/PassportsTab';
import { RecordsTab } from './RecordsTab';
import { ToolsTab } from './ToolsTab';
import { SiteConfigTab } from './SiteConfigTab';
import { ConContentTab } from './ConContentTab';
import { SectionNav } from './SectionNav';
import type { LocationListHandle } from './useCardHighlight';
import { ToastContainer, useToasts } from '~/lib/useToasts';

/** Every tab a link can name. */
const LINKABLE_TABS: Tab[] = ['users', 'events', 'locations', 'badges', 'passports', 'records', 'tools', 'config', 'con'];

const ADMIN_TABS: {id: Tab; en: string; zh: string; generalStaffOnly?: boolean}[] = [
    {id: 'users', en: 'Users Management', zh: '用户管理', generalStaffOnly: true},
    {id: 'events', en: 'Events', zh: '活动管理'},
    {id: 'locations', en: 'Locations', zh: '场地管理', generalStaffOnly: true},
    {id: 'badges', en: 'Badges', zh: '徽章', generalStaffOnly: true},
    {id: 'passports', en: 'Passports', zh: '通行证', generalStaffOnly: true},
    {id: 'config', en: 'Site Config', zh: '网站配置', generalStaffOnly: true},
    {id: 'con', en: 'Con Content', zh: '漫展内容', generalStaffOnly: true},
    {id: 'tools', en: 'Tools', zh: '工具', generalStaffOnly: true},
    {id: 'records', en: 'Records', zh: '操作记录', generalStaffOnly: true},
];

export const AdminPage = () => {
    const {user, profile, loading} = useAuth();
    const {isEnglish} = useLanguage();
    const {pastEvents: rawPastEvents, refresh: refreshEvents} = usePastEvents();
    // Only staff and above may read the whole collection; for anyone else the
    // read is refused, so it isn't made.
    const {upcomingEvents: allUpcomingEvents, refresh: refreshAllUpcoming} = useAllUpcomingEvents(
        !!profile && hasPermission(profile.group, 'staff'),
    );
    // Per-ID fetch for event-staff: avoids collection-level permission errors.
    const staffEventIds = profile?.eventStaffEvents ?? [];
    const {
        upcomingEvents: staffUpcomingEvents,
        loading: staffEventsLoading,
        refresh: refreshStaffUpcoming
    } = useUpcomingEventsByIds(staffEventIds);
    const pastEvents = useMemo(() => [...rawPastEvents].sort((a, b) => b.date.localeCompare(a.date)), [rawPastEvents]);

    const isCoreStaffOrAbove = !!profile && hasPermission(profile.group, 'core-staff');
    // Staff group: view-only admin access + Tools. Superset of event-staff access.
    const isStaffGroup = !!profile && hasPermission(profile.group, 'staff') && !isCoreStaffOrAbove;
    // Event staff is a per-event tag, independent of the group: staff for an
    // upcoming event get scanner and admin access to it. Gated on upcoming events
    // because eventStaffEvents keeps past ones, so access lapses on archive.
    const isEventStaffOnly = !!profile
        && !isCoreStaffOrAbove
        && !isStaffGroup
        && staffUpcomingEvents.length > 0;

    // Core-staff and staff group see all events; event-staff only sees their assigned ones.
    const upcomingEvents = (isCoreStaffOrAbove || isStaffGroup) ? allUpcomingEvents : staffUpcomingEvents;
    const refreshUpcoming = (isCoreStaffOrAbove || isStaffGroup) ? refreshAllUpcoming : refreshStaffUpcoming;

    const [activeTab, selectTab] = useState<Tab>('users');
    // Switching tabs unmounts the tab, so it goes through the exit guard (the
    // generator's unsaved keys, above all).
    const setActiveTab = (tab: Tab) => {
        if (confirmExit()) selectTab(tab);
    };
    const activeTabRef = useRef<HTMLButtonElement>(null);
    // On a phone the tabs scroll sideways: keep the open one in view, scrolling
    // only the row, never the page.
    useEffect(() => {
        const tab = activeTabRef.current;
        const row = tab?.parentElement;
        if (!tab || !row) return;
        const rowBox = row.getBoundingClientRect();
        const tabBox = tab.getBoundingClientRect();
        if (tabBox.left < rowBox.left || tabBox.right > rowBox.right) {
            row.scrollLeft += tabBox.left - rowBox.left - (rowBox.width - tabBox.width) / 2;
        }
    }, [activeTab]);
    const [upcomingInDetail, setUpcomingInDetail] = useState(false);
    const [eventsInDetail, setEventsInDetail] = useState(false);
    const [badgeDefs, setBadgeDefs] = useState<BadgeDef[]>([]);
    const [badgeDefsError, setBadgeDefsError] = useState(false);
    const {toasts, showToast} = useToasts();
    const {tags, refresh: refreshTags} = useTags();
    const {venues, refresh: refreshVenues} = useVenues();
    const [searchParams] = useSearchParams();
    const navigate = useNavigate();
    const urlParamsHandled = useRef(false);
    const wasAuthorized = useRef(false);
    const usersTabRef = useRef<UsersTabHandle>(null);
    const eventsTabRef = useRef<EventsTabHandle>(null);
    const upcomingTabRef = useRef<UpcomingEventsTabHandle>(null);
    const badgesTabRef = useRef<BadgesTabHandle>(null);
    const venuesTabRef = useRef<LocationListHandle>(null);
    // Cross-tab "jump to this card" requests, in state with a nonce so the effect
    // fires after the target tab mounts, and again when it's already active.
    const actionNonce = useRef(0);
    const [pendingAction, setPendingAction] = useState<{type: string; id: string; nonce: number} | null>(null);
    const queueAction = useCallback((type: string, id: string) => {
        setPendingAction({type, id, nonce: ++actionNonce.current});
    }, []);

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
        // Queued: the tab only mounts once setActiveTab lands.
        if (isEventStaffOnly) {
            setActiveTab('events');
            const firstEventId = event && staffUpcomingEvents.some(e => e.id === event)
                ? event
                : staffUpcomingEvents[0]?.id;
            if (firstEventId) queueAction('selectUpcomingEvent', firstEventId);
        } else {
            if (LINKABLE_TABS.includes(tab as Tab)) setActiveTab(tab as Tab);
            if (tab === 'events' && event) queueAction('selectEvent', event);
        }
        urlParamsHandled.current = true;
    }, [loading, user, profile, searchParams, isCoreStaffOrAbove, isStaffGroup, isEventStaffOnly, staffUpcomingEvents, queueAction]);

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
                    createdByUid: data.createdByUid ?? '',
                    createdByName: data.createdByName ?? '',
                    createdByLink: data.createdByLink ?? '',
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
        queueAction('lookupUser', uid);
    }, [queueAction]);

    const handleSelectBadge = useCallback((badgeId: string) => {
        setActiveTab('badges');
        queueAction('selectBadge', badgeId);
    }, [queueAction]);

    const handleSelectEvent = useCallback((eventId: string) => {
        setActiveTab('events');
        queueAction('selectEvent', eventId);
    }, [queueAction]);

    const handleSelectUpcomingEvent = useCallback((eventId: string) => {
        setActiveTab('events');
        queueAction('selectUpcomingEvent', eventId);
    }, [queueAction]);

    const handleSelectVenue = useCallback((venueId: string) => {
        setActiveTab('locations');
        queueAction('selectVenue', venueId);
    }, [queueAction]);

    const handleEditVenue = useCallback((venueId: string) => {
        setActiveTab('locations');
        queueAction('editVenue', venueId);
    }, [queueAction]);

    // Runs after the target tab mounts and registers its card refs.
    useEffect(() => {
        const action = pendingAction;
        if (!action) return;

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
            case 'selectVenue':
                venuesTabRef.current?.highlight(action.id);
                break;
            case 'editVenue':
                venuesTabRef.current?.openEdit(action.id);
                break;
        }
    }, [pendingAction]);

    // Possible event staff can't be classified until we know which of their events
    // are upcoming; hold the spinner rather than flash "Access Denied".
    const resolvingEventStaff = !!profile && !isCoreStaffOrAbove && !isStaffGroup
        && staffEventIds.length > 0 && staffEventsLoading;
    if (loading || resolvingEventStaff) {
        return (
            <div className="profile-loading">
                <div className="spinner"/>
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
            <ToastContainer toasts={toasts}/>
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
            <div className="profile-page admin-page">
                <div className="admin-tabs">
                    {ADMIN_TABS.map(tab => {
                        if (tab.generalStaffOnly && !isCoreStaffOrAbove && !isStaffGroup) return null;
                        return (
                            <button
                                key={tab.id}
                                ref={activeTab === tab.id ? activeTabRef : null}
                                className={`admin-tab ${activeTab === tab.id ? 'admin-tab-active' : ''}`}
                                onClick={() => setActiveTab(tab.id)}
                            >
                                {isEnglish ? tab.en : tab.zh}
                            </button>
                        );
                    })}
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
                        <div id="admin-sec-upcoming" style={eventsInDetail ? {display: 'none'} : undefined}>
                            {!upcomingInDetail && (
                                <h2 className="admin-section-header">
                                    {isEnglish ? 'Upcoming Events' : '活动预告'}
                                </h2>
                            )}
                            <UpcomingEventsTab
                                ref={upcomingTabRef}
                                upcomingEvents={upcomingEvents}
                                refreshEvents={refreshUpcoming}
                                refreshPastEvents={refreshEvents}
                                tags={tags}
                                showToast={showToast}
                                readOnly={!isCoreStaffOrAbove}
                                onDetailChange={setUpcomingInDetail}
                            />
                        </div>
                        {(isCoreStaffOrAbove || isStaffGroup) && (
                            <div id="admin-sec-past" style={upcomingInDetail ? {display: 'none'} : undefined}>
                                {!eventsInDetail && (
                                    <h2 className="admin-section-header admin-section-mt">
                                        {isEnglish ? 'Past Events' : '往期活动'}
                                    </h2>
                                )}
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
                        )}
                        {(isCoreStaffOrAbove || isStaffGroup) && !upcomingInDetail && !eventsInDetail && (
                            <div id="admin-sec-tags">
                                <h2 className="admin-section-header admin-section-mt">
                                    {isEnglish ? 'Tags' : '标签'}
                                </h2>
                                <TagsTab tags={tags} refreshTags={refreshTags} showToast={showToast}
                                         readOnly={isStaffGroup}/>
                            </div>
                        )}
                        {/* An open event's detail view is the only thing on screen. */}
                        {!upcomingInDetail && !eventsInDetail && (
                            <SectionNav
                                sections={[
                                    {id: 'admin-sec-upcoming', label: isEnglish ? 'Upcoming Events' : '活动预告'},
                                    ...(isCoreStaffOrAbove || isStaffGroup ? [
                                        {id: 'admin-sec-past', label: isEnglish ? 'Past Events' : '往期活动'},
                                        {id: 'admin-sec-tags', label: isEnglish ? 'Tags' : '标签'},
                                    ] : []),
                                ]}
                            />
                        )}
                    </>
                )}

                {activeTab === 'locations' && (isCoreStaffOrAbove || isStaffGroup) && (
                    <>
                        <div id="admin-sec-map">
                            <h2 className="admin-section-header">
                                {isEnglish ? 'Overview Map' : '总览地图'}
                            </h2>
                            <LocationsMap
                                venues={venues}
                                onShowVenue={handleSelectVenue}
                                onEditVenue={handleEditVenue}
                                readOnly={isStaffGroup}
                            />
                        </div>
                        <div id="admin-sec-uw-parking">
                            <h2 className="admin-section-header admin-section-mt">
                                {isEnglish ? 'UW Parking Data' : 'UW 停车数据'}
                            </h2>
                            <UwParkingStatus showToast={showToast} readOnly={isStaffGroup}/>
                        </div>
                        <div id="admin-sec-venues">
                            <h2 className="admin-section-header admin-section-mt">
                                {isEnglish ? 'Venues' : '场地'}
                            </h2>
                            <VenuesTab
                                ref={venuesTabRef}
                                venues={venues}
                                refreshVenues={refreshVenues}
                                showToast={showToast}
                                readOnly={isStaffGroup}
                            />
                        </div>
                        <SectionNav
                            sections={[
                                {id: 'admin-sec-map', label: isEnglish ? 'Overview Map' : '总览地图'},
                                {id: 'admin-sec-uw-parking', label: isEnglish ? 'UW Parking Data' : 'UW 停车数据'},
                                {id: 'admin-sec-venues', label: isEnglish ? 'Venues' : '场地'},
                            ]}
                        />
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
                            onLookupUser={handleLookupUser}
                            showToast={showToast}
                            readOnly={isStaffGroup}
                        />
                    )
                )}

                {activeTab === 'passports' && (isCoreStaffOrAbove || isStaffGroup) && (
                    <PassportsTab
                        onLookupUser={handleLookupUser}
                        showToast={showToast}
                        readOnly={isStaffGroup}
                    />
                )}

                {activeTab === 'records' && (isCoreStaffOrAbove || isStaffGroup) && (
                    <RecordsTab
                        pastEvents={pastEvents}
                        upcomingEvents={upcomingEvents}
                        badgeDefs={badgeDefs}
                        venues={venues}
                        onLookupUser={handleLookupUser}
                        onSelectBadge={handleSelectBadge}
                        onSelectEvent={handleSelectEvent}
                        onSelectUpcomingEvent={handleSelectUpcomingEvent}
                        onSelectVenue={handleSelectVenue}
                    />
                )}

                {activeTab === 'tools' && (isCoreStaffOrAbove || isStaffGroup) && (
                    <ToolsTab showToast={showToast} readOnly={isStaffGroup}/>
                )}

                {activeTab === 'con' && (isCoreStaffOrAbove || isStaffGroup) && (
                    <ConContentTab showToast={showToast} readOnly={isStaffGroup}/>
                )}

                {activeTab === 'config' && (isCoreStaffOrAbove || isStaffGroup) && (
                    <SiteConfigTab showToast={showToast} readOnly={isStaffGroup}/>
                )}
            </div>
        </>
    );
};
