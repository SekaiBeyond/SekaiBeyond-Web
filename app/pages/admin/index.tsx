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
import { useVenues } from '~/lib/venues';
import { useParkingLots } from '~/lib/parkingLots';
import { useParkingRates } from '~/lib/parkingRates';
import type { BadgeDef, Tab } from './types';
import { UsersTab, type UsersTabHandle } from './UsersTab';
import { EventsTab, type EventsTabHandle } from './EventsTab';
import { UpcomingEventsTab, type UpcomingEventsTabHandle } from './UpcomingEventsTab';
import { BadgesTab, type BadgesTabHandle } from './BadgesTab';
import { TagsTab } from './TagsTab';
import { VenuesTab } from './VenuesTab';
import { LocationsMap } from './LocationsMap';
import { ParkingLotsTab } from './ParkingLotsTab';
import { ParkingRatesTab } from './ParkingRatesTab';
import { RecordsTab } from './RecordsTab';
import { ToolsTab } from './ToolsTab';
import { SiteConfigTab } from './SiteConfigTab';
import type { CardHighlightHandle, LocationListHandle } from './useCardHighlight';
import { ToastContainer, useToasts } from '~/lib/useToasts';

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
    const [locationsMapOpen, setLocationsMapOpen] = useState(true);
    const [venuesOpen, setVenuesOpen] = useState(true);
    const [parkingLotsOpen, setParkingLotsOpen] = useState(true);
    const [parkingRatesOpen, setParkingRatesOpen] = useState(true);
    const [badgeDefs, setBadgeDefs] = useState<BadgeDef[]>([]);
    const [badgeDefsError, setBadgeDefsError] = useState(false);
    const {toasts, showToast} = useToasts();
    const {tags, refresh: refreshTags} = useTags();
    const {venues, refresh: refreshVenues} = useVenues();
    const {parkingLots, refresh: refreshParkingLots} = useParkingLots();
    const {parkingRates, refresh: refreshParkingRates} = useParkingRates();
    const [searchParams] = useSearchParams();
    const navigate = useNavigate();
    const urlParamsHandled = useRef(false);
    const wasAuthorized = useRef(false);
    const usersTabRef = useRef<UsersTabHandle>(null);
    const eventsTabRef = useRef<EventsTabHandle>(null);
    const upcomingTabRef = useRef<UpcomingEventsTabHandle>(null);
    const badgesTabRef = useRef<BadgesTabHandle>(null);
    const venuesTabRef = useRef<LocationListHandle>(null);
    const parkingLotsTabRef = useRef<LocationListHandle>(null);
    const parkingRatesTabRef = useRef<CardHighlightHandle>(null);
    // Cross-tab/section "jump to this card" requests. Held in state (not a ref) with a
    // nonce so the effect below fires after the target tab/section has mounted — and
    // re-fires even when the target tab is already active (e.g. map → list jumps).
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
        if (isEventStaffOnly) {
            setActiveTab('events');
            const firstEventId = event && staffUpcomingEvents.some(e => e.id === event)
                ? event
                : staffUpcomingEvents[0]?.id;
            if (firstEventId) {
                upcomingTabRef.current?.selectEvent(firstEventId);
            }
        } else if (isStaffGroup) {
            if (tab === 'events' || tab === 'locations' || tab === 'tools' || tab === 'users' || tab === 'badges' || tab === 'records' || tab === 'config') {
                setActiveTab(tab);
            } else if (tab === 'venues' || tab === 'parking') {
                setActiveTab('locations');
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
            if (tab === 'events' || tab === 'locations' || tab === 'badges' || tab === 'records' || tab === 'users' || tab === 'tools' || tab === 'config') {
                setActiveTab(tab);
            } else if (tab === 'venues' || tab === 'parking') {
                setActiveTab('locations');
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
        queueAction('lookupUser', uid);
    }, [queueAction]);

    const handleSelectBadge = useCallback((badgeId: string) => {
        setActiveTab('badges');
        queueAction('selectBadge', badgeId);
    }, [queueAction]);

    const handleSelectEvent = useCallback((eventId: string) => {
        setActiveTab('events');
        setPastOpen(true);
        queueAction('selectEvent', eventId);
    }, [queueAction]);

    const handleSelectUpcomingEvent = useCallback((eventId: string) => {
        setActiveTab('events');
        setUpcomingOpen(true);
        queueAction('selectUpcomingEvent', eventId);
    }, [queueAction]);

    const handleSelectVenue = useCallback((venueId: string) => {
        setActiveTab('locations');
        setVenuesOpen(true);
        queueAction('selectVenue', venueId);
    }, [queueAction]);

    const handleSelectParkingLot = useCallback((lotId: string) => {
        setActiveTab('locations');
        setParkingLotsOpen(true);
        queueAction('selectParkingLot', lotId);
    }, [queueAction]);

    const handleSelectParkingRate = useCallback((rateId: string) => {
        setActiveTab('locations');
        setParkingRatesOpen(true);
        queueAction('selectParkingRate', rateId);
    }, [queueAction]);

    const handleEditVenue = useCallback((venueId: string) => {
        setActiveTab('locations');
        setVenuesOpen(true);
        queueAction('editVenue', venueId);
    }, [queueAction]);

    const handleEditParkingLot = useCallback((lotId: string) => {
        setActiveTab('locations');
        setParkingLotsOpen(true);
        queueAction('editParkingLot', lotId);
    }, [queueAction]);

    // Execute pending jump actions after the target tab/section mounts (same commit:
    // card refs register during mount, then this effect runs and can scroll to them).
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
            case 'selectParkingLot':
                parkingLotsTabRef.current?.highlight(action.id);
                break;
            case 'selectParkingRate':
                parkingRatesTabRef.current?.highlight(action.id);
                break;
            case 'editVenue':
                venuesTabRef.current?.openEdit(action.id);
                break;
            case 'editParkingLot':
                parkingLotsTabRef.current?.openEdit(action.id);
                break;
        }
    }, [pendingAction]);

    // A potential event-staff user (below staff group, has eventStaffEvents) can't be
    // classified until we know which of their assigned events are still upcoming.
    // Hold the spinner until that resolves so we don't flash "Access Denied".
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
                            className={`admin-tab ${activeTab === 'locations' ? 'admin-tab-active' : ''}`}
                            onClick={() => setActiveTab('locations')}
                        >
                            {isEnglish ? 'Locations' : '场地管理'}
                        </button>
                    )}
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

                {activeTab === 'locations' && (isCoreStaffOrAbove || isStaffGroup) && (
                    <>
                        <div>
                            <button
                                className="admin-section-header"
                                onClick={() => setLocationsMapOpen(v => !v)}
                            >
                                <span className="admin-section-header-title">
                                    {isEnglish ? 'Overview Map' : '总览地图'}
                                </span>
                                <span
                                    className={`admin-section-chevron${locationsMapOpen ? ' admin-section-chevron-open' : ''}`}>▾</span>
                            </button>
                            {locationsMapOpen && <LocationsMap
                                venues={venues}
                                parkingLots={parkingLots}
                                parkingRates={parkingRates}
                                onShowVenue={handleSelectVenue}
                                onShowLot={handleSelectParkingLot}
                                onEditVenue={handleEditVenue}
                                onEditLot={handleEditParkingLot}
                                readOnly={isStaffGroup}
                            />}
                        </div>
                        <div>
                            <button
                                className="admin-section-header admin-section-mt"
                                onClick={() => setVenuesOpen(v => !v)}
                            >
                                <span className="admin-section-header-title">
                                    {isEnglish ? 'Venues' : '场地'}
                                </span>
                                <span
                                    className={`admin-section-chevron${venuesOpen ? ' admin-section-chevron-open' : ''}`}>▾</span>
                            </button>
                            {venuesOpen && <VenuesTab
                                ref={venuesTabRef}
                                venues={venues}
                                parkingLots={parkingLots}
                                refreshVenues={refreshVenues}
                                showToast={showToast}
                                readOnly={isStaffGroup}
                            />}
                        </div>
                        <div>
                            <button
                                className="admin-section-header admin-section-mt"
                                onClick={() => setParkingRatesOpen(v => !v)}
                            >
                                <span className="admin-section-header-title">
                                    {isEnglish ? 'Parking Rates' : '停车费率'}
                                </span>
                                <span
                                    className={`admin-section-chevron${parkingRatesOpen ? ' admin-section-chevron-open' : ''}`}>▾</span>
                            </button>
                            {parkingRatesOpen && <ParkingRatesTab
                                ref={parkingRatesTabRef}
                                parkingRates={parkingRates}
                                refreshParkingRates={refreshParkingRates}
                                refreshParkingLots={refreshParkingLots}
                                showToast={showToast}
                                readOnly={isStaffGroup}
                            />}
                        </div>
                        <div>
                            <button
                                className="admin-section-header admin-section-mt"
                                onClick={() => setParkingLotsOpen(v => !v)}
                            >
                                <span className="admin-section-header-title">
                                    {isEnglish ? 'Parking Lots' : '停车场'}
                                </span>
                                <span
                                    className={`admin-section-chevron${parkingLotsOpen ? ' admin-section-chevron-open' : ''}`}>▾</span>
                            </button>
                            {parkingLotsOpen && <ParkingLotsTab
                                ref={parkingLotsTabRef}
                                parkingLots={parkingLots}
                                parkingRates={parkingRates}
                                refreshParkingLots={refreshParkingLots}
                                refreshVenues={refreshVenues}
                                showToast={showToast}
                                readOnly={isStaffGroup}
                            />}
                        </div>
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
                        venues={venues}
                        parkingLots={parkingLots}
                        parkingRates={parkingRates}
                        onLookupUser={handleLookupUser}
                        onSelectBadge={handleSelectBadge}
                        onSelectEvent={handleSelectEvent}
                        onSelectUpcomingEvent={handleSelectUpcomingEvent}
                        onSelectVenue={handleSelectVenue}
                        onSelectParkingLot={handleSelectParkingLot}
                        onSelectParkingRate={handleSelectParkingRate}
                    />
                )}

                {activeTab === 'tools' && (isCoreStaffOrAbove || isStaffGroup) && (
                    <ToolsTab showToast={showToast} readOnly={isStaffGroup}/>
                )}

                {activeTab === 'config' && (isCoreStaffOrAbove || isStaffGroup) && (
                    <SiteConfigTab showToast={showToast} readOnly={isStaffGroup}/>
                )}
            </div>
        </>
    );
};
