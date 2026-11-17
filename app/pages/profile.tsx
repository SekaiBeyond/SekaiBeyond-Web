import React, { useEffect, useMemo, useRef, useState } from 'react';
import { FaStar } from 'react-icons/fa';
import {
    FiAlertCircle,
    FiAward,
    FiBookOpen,
    FiCalendar,
    FiClock,
    FiImage,
    FiLock,
    FiMail,
    FiPlayCircle,
    FiStar,
    FiTrash2,
} from 'react-icons/fi';
import {
    formatGroupWithTitle,
    hasPermission,
    normalizeGroup,
    useAuth,
    type UserGroup,
} from '~/components/AuthProvider';
import { useLanguage } from '~/components/LanguageContextProvider';
import { type BadgeDef, toBadgeDef } from '~/lib/badges';
import { getDocsByIds } from '~/lib/collectionCache';
import { callGetPublicProfile, isStorageUrl } from '~/lib/firebase';
import { NoticeCard } from '~/components/NoticeCard';
import { PageNav } from '~/components/PageNav';
import { type PastEvent, usePastEvents } from '~/lib/pastEvents';
import type { ShelfPassport } from '~/lib/passports';
import { useTags } from '~/lib/tags';
import { useNavigate, useSearchParams } from 'react-router';
import { formatSiteTime } from '~/lib/siteTime';
import { isValidHttpUrl } from '~/lib/urls';
import { fetchOwnPassports, PassportShelf } from '~/pages/PassportShelf';
import { ProfileCard, ProfileCardNote, ProfileSection, ProfileWelcome, type SectionState, } from '~/pages/ProfileCards';
import { ProfileSettingsTab } from '~/pages/ProfileSettingsTab';
import { fetchHeldTickets, ProfileTickets } from '~/pages/ProfileTickets';
import { useLoaded } from '~/lib/useLoaded';
import { useImageEditor } from '~/pages/admin/ImageCropModal';
import { useModalEffects } from '~/lib/useModalEffects';
import { ToastContainer, useToasts } from '~/lib/useToasts';
import { localized } from '~/lib/localized';

interface ViewedProfile {
    displayName: string;
    photoURL: string;
    bannerURL: string;
    joinedAt: Date;
    attendedEvents: string[];
    eventStaffEvents: string[];
    badges: string[];
    badgeEarnedAt: Record<string, Date>;
    passports: ShelfPassport[];
    passportPageHidden: boolean;
    group: UserGroup;
    isMember: boolean;
    title?: string;
    titleCn?: string;
    visibility: {badges: boolean; events: boolean; passports: boolean};
}

const BANNER_ASPECT = 12;
const BANNER_WIDTH = 1500;

const BadgeCard = ({badge, earnedDate, isEnglish, onOpen}: {
    badge: BadgeDef;
    earnedDate?: Date;
    isEnglish: boolean;
    onOpen: () => void;
}) => (
    <button type="button" className="badge-circle" onClick={onOpen}>
        <span className="badge-icon-wrapper">
            <img src={badge.imageUrl} alt="" className="badge-icon"/>
        </span>
        <span className="badge-label">{localized(isEnglish, badge.name, badge.nameCn)}</span>
        <span className="badge-tooltip" aria-hidden="true">
            <span className="badge-tooltip-name">{localized(isEnglish, badge.name, badge.nameCn)}</span>
            <span
                className="badge-tooltip-desc">{localized(isEnglish, badge.description, badge.descriptionCn)}</span>
            {earnedDate && (
                <span className="badge-tooltip-date">
                    {isEnglish ? 'Earned ' : '获得于 '}
                    {earnedDate.toLocaleDateString(
                        isEnglish ? 'en-US' : 'zh-CN',
                        {year: 'numeric', month: 'short', day: 'numeric'}
                    )}
                </span>
            )}
        </span>
    </button>
);

const EventCard = ({event, isEnglish, showAdminLink, tagLabels, wasStaff}: {
    event: PastEvent;
    isEnglish: boolean;
    showAdminLink?: boolean;
    tagLabels?: string[];
    wasStaff?: boolean;
}) => {
    const title = localized(isEnglish, event.title, event.titleCn);
    const hasCategories = !!event.con || (!!tagLabels && tagLabels.length > 0);
    return (
        <div className={`profile-event-card${event.con ? ' profile-event-card--con' : ''}`}>
            <div className="profile-event-icon-wrapper">
                <img src={event.icon} alt={title} className="profile-event-icon"/>
                {wasStaff && (
                    <span className="profile-event-staff-tag">
                        {isEnglish ? 'Staff' : '工作人员'}
                    </span>
                )}
            </div>
            <div className="profile-event-info">
                {hasCategories ? (
                    <span className="profile-event-categories">
                        {event.con && (
                            <span className="profile-event-category profile-event-category--con">
                                {isEnglish ? `Con ${event.con.year}` : `${event.con.year} 漫展`}
                            </span>
                        )}
                        {tagLabels?.map((label, i) => (
                            <span key={i} className="profile-event-category">{label}</span>
                        ))}
                    </span>
                ) : (
                    <span className="profile-event-category profile-event-category-hidden">{'\u00A0'}</span>
                )}
                <h3 className="profile-event-title" title={title}>
                    {showAdminLink ? (
                        <a href={`/admin?tab=events&event=${encodeURIComponent(event.id)}`}
                           className="profile-event-title-link">
                            {title}
                        </a>
                    ) : title}
                </h3>
                <p className="profile-event-date">
                    {new Date(event.date).toLocaleDateString(isEnglish ? 'en-US' : 'zh-CN', {
                        year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC',
                    })}
                </p>
            </div>
        </div>
    );
};

export const ProfilePage = () => {
    const {user, profile, isMember, loading, signIn, updateProfile} = useAuth();
    const {isEnglish} = useLanguage();
    const {pastEvents, loading: eventsLoading} = usePastEvents();
    const {tags} = useTags();
    const tagMap = useMemo(() => new Map(tags.map(t => [t.id, t])), [tags]);
    const [searchParams, setSearchParams] = useSearchParams();
    const navigate = useNavigate();
    const viewUid = searchParams.get('uid');
    const isViewingOther = !!viewUid && viewUid !== user?.uid;
    const settingsTab = !isViewingOther && searchParams.get('tab') === 'settings';
    const openTab = (tab: 'profile' | 'settings') => {
        const next = new URLSearchParams(searchParams);
        if (tab === 'settings') next.set('tab', tab);
        else next.delete('tab');
        setSearchParams(next);
    };
    const wasAuthorized = useRef(false);
    const [viewedProfile, setViewedProfile] = useState<ViewedProfile | null>(null);
    const [loadingViewed, setLoadingViewed] = useState(false);
    const [editingName, setEditingName] = useState(false);
    const [editName, setEditName] = useState('');
    const [savingName, setSavingName] = useState(false);
    const [avatarError, setAvatarError] = useState(false);
    const [failedBanner, setFailedBanner] = useState<string | null>(null);
    const nameInputRef = useRef<HTMLInputElement>(null);
    const [badgeDefs, setBadgeDefs] = useState<BadgeDef[] | null>(null);
    const [badgeLoadError, setBadgeLoadError] = useState(false);
    const [viewedLoadError, setViewedLoadError] = useState(false);
    const {toasts, showToast} = useToasts();
    const photoEditor = useImageEditor({
        showToast,
        upload: {
            send: file => updateProfile({photoFile: file}),
            done: isEnglish ? 'Profile photo updated.' : '头像已更新。',
            failed: isEnglish ? 'Failed to upload photo. Please try again.' : '上传头像失败，请重试。',
        },
        removal: {
            done: isEnglish ? 'Profile photo removed.' : '头像已删除。',
            failed: isEnglish ? 'Failed to remove photo. Please try again.' : '删除头像失败，请重试。',
        },
    });
    const bannerEditor = useImageEditor({
        aspect: BANNER_ASPECT,
        outputWidth: BANNER_WIDTH,
        showToast,
        upload: {
            send: file => updateProfile({bannerFile: file}),
            done: isEnglish ? 'Banner updated.' : '横幅已更新。',
            failed: isEnglish ? 'Failed to upload banner. Please try again.' : '上传横幅失败，请重试。',
        },
        removal: {
            done: isEnglish ? 'Banner removed.' : '横幅已删除。',
            failed: isEnglish ? 'Failed to remove banner. Please try again.' : '删除横幅失败，请重试。',
        },
    });
    const [selectedBadge, setSelectedBadge] = useState<BadgeDef | null>(null);
    const badgeModalRef = useRef<HTMLDivElement>(null);
    useModalEffects(!!selectedBadge, badgeModalRef, () => setSelectedBadge(null));
    const ownUid = isViewingOther ? null : user?.uid ?? null;
    const {data: passports, failed: passportsFailed} = useLoaded(ownUid, fetchOwnPassports);
    const {data: ticketEvents, failed: ticketsFailed} = useLoaded(ownUid, fetchHeldTickets);

    useEffect(() => {
        if (loading || isViewingOther) return;
        if (user && profile) {
            wasAuthorized.current = true;
            return;
        }
        if (wasAuthorized.current && !user) {
            navigate('/', {replace: true});
        }
    }, [loading, user, profile, isViewingOther, navigate]);

    const badgeIds = isViewingOther ? viewedProfile?.badges : profile?.badges;
    const badgeIdsKey = badgeIds?.slice().sort().join(',') ?? '';

    useEffect(() => {
        if (!badgeIds || badgeIds.length === 0) {
            setBadgeDefs([]);
            setBadgeLoadError(false);
            return;
        }
        let stale = false;
        setBadgeDefs(null);
        const loadBadges = async () => {
            try {
                const defs = (await getDocsByIds('badges', badgeIds)).map(toBadgeDef);
                if (stale) return;
                setBadgeDefs(defs);
                setBadgeLoadError(false);
            } catch {
                if (!stale) setBadgeLoadError(true);
            }
        };
        void loadBadges();
        return () => {
            stale = true;
        };
    }, [badgeIdsKey]);

    const viewerUid = user?.uid;
    useEffect(() => {
        if (!viewUid || !isViewingOther || !viewerUid) {
            setViewedProfile(null);
            setLoadingViewed(false);
            setViewedLoadError(false);
            return;
        }
        let stale = false;
        setLoadingViewed(true);
        setViewedLoadError(false);
        const loadViewedUser = async () => {
            try {
                const result = await callGetPublicProfile({uid: viewUid});
                if (stale) return;
                const data = result.data;
                const earnedAt: Record<string, Date> = {};
                for (const [k, v] of Object.entries(data.badgeEarnedAt)) {
                    const d = new Date(v);
                    if (!isNaN(d.getTime())) earnedAt[k] = d;
                }
                setViewedProfile({
                    ...data,
                    joinedAt: new Date(data.joinedAt),
                    badgeEarnedAt: earnedAt,
                    passports: data.passports.map(p => ({
                        ...p,
                        claimedAt: p.claimedAt ? new Date(p.claimedAt) : null,
                    })),
                    group: normalizeGroup(data.group),
                });
            } catch {
                if (!stale) setViewedLoadError(true);
            } finally {
                if (!stale) setLoadingViewed(false);
            }
        };
        void loadViewedUser();
        return () => {
            stale = true;
        };
    }, [viewUid, isViewingOther, viewerUid]);

    const viewedEarnedAt = viewedProfile?.badgeEarnedAt;
    const ownEarnedAt = profile?.badgeEarnedAt;
    const earnedDates = useMemo<Record<string, Date>>(
        () => (isViewingOther ? viewedEarnedAt : ownEarnedAt) ?? {},
        [isViewingOther, viewedEarnedAt, ownEarnedAt],
    );

    useEffect(() => {
        setAvatarError(false);
    }, [profile?.photoURL]);

    useEffect(() => {
        if (isViewingOther && viewedProfile) {
            document.title = `${viewedProfile.displayName} | Sekai Beyond`;
        } else {
            document.title = 'Profile | Sekai Beyond';
        }
        return () => {
            document.title = 'Profile | Sekai Beyond';
        };
    }, [isViewingOther, viewedProfile?.displayName]);

    const startEditingName = () => {
        if (!profile) return;
        setEditName(profile.displayName);
        setEditingName(true);
        setTimeout(() => nameInputRef.current?.focus(), 0);
    };

    const cancelEditingName = () => {
        setEditingName(false);
    };

    const handlePhotoDelete = () => photoEditor.remove(
        isEnglish
            ? 'Remove your profile photo? It goes back to your Google account photo if you have one bound.'
            : '确定要删除头像吗？如已绑定 Google 账号，将恢复为其头像。',
        () => updateProfile({deletePhoto: true}),
    );

    const handleBannerDelete = () => bannerEditor.remove(
        isEnglish
            ? 'Remove your banner? Your profile will go back to the default one.'
            : '确定要删除横幅吗？个人主页将恢复为默认横幅。',
        () => updateProfile({deleteBanner: true}),
    );

    const handleSaveName = async () => {
        if (!profile || !editName.trim() || savingName || !editingName) return;
        if (editName.trim() === profile.displayName) {
            setEditingName(false);
            return;
        }
        const trimmed = editName.trim();
        setSavingName(true);
        try {
            await updateProfile({displayName: trimmed});
            setEditingName(false);
            showToast(isEnglish ? 'Name updated.' : '名称已更新。', 'success');
        } catch {
            showToast(isEnglish ? 'Failed to update name. Please try again.' : '修改名称失败，请重试。', 'error');
        } finally {
            setSavingName(false);
        }
    };

    const handleNameKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') void handleSaveName();
        if (e.key === 'Escape') cancelEditingName();
    };

    const awaitingViewed = isViewingOther && !!user && !viewedProfile && !viewedLoadError;

    if (loading || loadingViewed || awaitingViewed || eventsLoading) {
        return (
            <div className="profile-loading">
                <div className="spinner"/>
            </div>
        );
    }

    if (isViewingOther && !user) {
        return (
            <NoticeCard
                title={isEnglish ? 'Sign in to view this profile' : '登录以查看此个人主页'}
                text={isEnglish
                    ? 'Member profiles are only shown to signed-in visitors.'
                    : '成员个人主页仅对已登录的访客显示。'}
                onSignIn={signIn}
            />
        );
    }

    if (isViewingOther && !viewedProfile) {
        return (
            <NoticeCard
                title={viewedLoadError
                    ? (isEnglish ? 'Failed to load profile' : '加载用户信息失败')
                    : (isEnglish ? 'User not found' : '未找到用户')}
            />
        );
    }

    if (!isViewingOther && (!user || !profile)) {
        return (
            <NoticeCard
                title={isEnglish ? 'Sign in to view your profile' : '登录以查看你的个人主页'}
                text={isEnglish ? 'Track your event attendance and earn badges!' : '记录你的活动参与、收集徽章！'}
                onSignIn={signIn}
            />
        );
    }

    const isOwnProfile = !isViewingOther;
    const displayedPhoto = isOwnProfile ? profile!.photoURL : viewedProfile!.photoURL;
    const dp = isOwnProfile
        ? {
            name: profile!.displayName,
            email: profile!.email,
            joinedAt: profile!.joinedAt,
            badges: profile!.badges,
            attendedEvents: profile!.attendedEvents,
            eventStaffEvents: profile!.eventStaffEvents,
            group: profile!.group,
            isMember,
            title: profile!.title ?? '',
            titleCn: profile!.titleCn ?? '',
        }
        : {
            name: viewedProfile!.displayName,
            joinedAt: viewedProfile!.joinedAt,
            badges: viewedProfile!.badges,
            attendedEvents: viewedProfile!.attendedEvents,
            eventStaffEvents: viewedProfile!.eventStaffEvents,
            group: viewedProfile!.group,
            isMember: viewedProfile!.isMember,
            title: viewedProfile!.title ?? '',
            titleCn: viewedProfile!.titleCn ?? '',
        };
    const showBadges = isOwnProfile || viewedProfile!.visibility.badges;
    const showEvents = isOwnProfile || viewedProfile!.visibility.events;
    const showPassports = isOwnProfile || viewedProfile!.visibility.passports;
    const shelf = isOwnProfile ? passports : viewedProfile!.passports;
    const staffedSet = new Set(dp.eventStaffEvents);
    const attendedSet = new Set([...dp.attendedEvents, ...dp.eventStaffEvents]);
    const attendedEvents = pastEvents
        .filter(e => attendedSet.has(e.id))
        .sort((a, b) => (b.con?.year ?? 0) - (a.con?.year ?? 0));
    const earnedBadges = (badgeDefs ?? [])
        .filter(b => dp.badges.includes(b.id))
        .sort((a, b) => (earnedDates[b.id]?.getTime() ?? 0) - (earnedDates[a.id]?.getTime() ?? 0));

    const badgeState: SectionState = !showBadges ? 'private'
        : dp.badges.length === 0 ? 'empty'
            : badgeLoadError ? 'failed'
                : badgeDefs === null ? 'loading'
                    : earnedBadges.length > 0 ? 'filled' : 'empty';
    const eventState: SectionState = !showEvents ? 'private'
        : attendedEvents.length > 0 ? 'filled' : 'empty';
    const passportState: SectionState = !showPassports ? 'private'
        : passportsFailed ? 'failed'
            : shelf === null ? 'loading'
                : shelf.length > 0 ? 'filled' : 'empty';
    const checkedIn = !!ticketEvents?.some(e => e.tickets.some(t => t.redeemed && !t.voided));
    const states = [badgeState, passportState, eventState];
    const anyFilled = states.includes('filled');
    const allEmpty = states.every(s => s === 'empty');
    const settling = !anyFilled && states.includes('loading');

    const stat = (key: string, count: number | null, one: string, many: string, zh: string) =>
        ({key, count, label: isEnglish ? (count === 1 ? one : many) : zh});
    const stats = anyFilled ? [
        ...(showBadges
            ? [stat('badges', badgeDefs === null ? dp.badges.length : earnedBadges.length, 'Badge', 'Badges', '徽章')]
            : []),
        ...(showPassports && !passportsFailed
            ? [stat('passports', shelf?.length ?? null, 'Passport', 'Passports', '通行证')]
            : []),
        ...(showEvents ? [stat('events', attendedEvents.length, 'Event', 'Events', '活动')] : []),
    ] : [];
    const canEdit = isOwnProfile && (isMember || hasPermission(profile!.group, 'staff'));
    const canRemovePhoto = isOwnProfile && isStorageUrl(profile?.photoURL);
    const bannerURL = isOwnProfile ? profile!.bannerURL : viewedProfile!.bannerURL;
    const showBanner = !!bannerURL && bannerURL !== failedBanner;
    const bannerLabel = bannerURL
        ? (isEnglish ? 'Change banner' : '更换横幅')
        : (isEnglish ? 'Add banner' : '添加横幅');
    const isStaff = isOwnProfile && hasPermission(profile!.group, 'staff');
    const longDate = (date: Date) => date.toLocaleDateString(isEnglish ? 'en-US' : 'zh-CN', {
        year: 'numeric', month: 'long', day: 'numeric',
    });
    const memberSince = isOwnProfile && isMember ? profile!.membershipStartedAt : null;

    const ticketsCard = !isOwnProfile ? null
        : ticketsFailed ? (
            <ProfileCard compact>
                <ProfileCardNote icon={FiAlertCircle} muted>
                    {isEnglish
                        ? 'Couldn’t check for your tickets just now. Try reloading the page.'
                        : '暂时无法查询你的门票，请刷新页面重试。'}
                </ProfileCardNote>
            </ProfileCard>
        ) : ticketEvents && ticketEvents.length > 0 ? (
            <ProfileTickets ticketEvents={ticketEvents}/>
        ) : null;

    return (
        <>
            <ToastContainer toasts={toasts}/>
            <PageNav/>
            <div className="profile-page">

                <div className="profile-hero">
                    <div
                        className={`profile-hero-banner${bannerEditor.busy ? ' profile-hero-banner--saving' : ''}`}>
                        {showBanner && (
                            <img
                                src={bannerURL}
                                alt=""
                                className="profile-hero-banner-image"
                                onError={() => setFailedBanner(bannerURL)}
                            />
                        )}
                        {isOwnProfile && (
                            <div className="profile-banner-actions">
                                {canEdit ? (
                                    <button
                                        type="button"
                                        className="profile-banner-btn"
                                        onClick={bannerEditor.choose}
                                        disabled={bannerEditor.busy}
                                        aria-label={bannerLabel}
                                    >
                                        {bannerEditor.busy
                                            ? <span className="profile-avatar-spinner" aria-hidden="true"/>
                                            : <FiImage aria-hidden="true"/>}
                                        <span className="profile-banner-btn-label">{bannerLabel}</span>
                                    </button>
                                ) : (
                                    <span className="profile-banner-btn profile-banner-btn--locked">
                                        <FiLock aria-hidden="true"/>
                                        <span className="profile-banner-btn-label">
                                            {isEnglish ? 'Banners are for members' : '横幅为会员专属'}
                                        </span>
                                    </span>
                                )}
                                {bannerURL && !bannerEditor.busy && (
                                    <button
                                        type="button"
                                        className="profile-banner-btn profile-banner-btn--remove"
                                        onClick={handleBannerDelete}
                                        aria-label={isEnglish ? 'Remove banner' : '删除横幅'}
                                    >
                                        <FiTrash2 aria-hidden="true"/>
                                    </button>
                                )}
                                {canEdit && bannerEditor.input}
                            </div>
                        )}
                    </div>
                    <div className="profile-hero-body">
                        <div
                            className={`profile-avatar-wrapper ${canEdit ? 'profile-avatar-clickable' : isOwnProfile ? 'profile-avatar-nonmember-hint' : ''} ${photoEditor.busy ? 'profile-avatar-saving' : ''}`}>
                            {!avatarError && displayedPhoto ? (
                                <img
                                    src={displayedPhoto}
                                    alt={dp.name}
                                    className="profile-avatar"
                                    referrerPolicy="no-referrer"
                                    onError={() => setAvatarError(true)}
                                    onClick={canEdit ? photoEditor.choose : undefined}
                                />
                            ) : (
                                <div
                                    className="profile-avatar profile-avatar-initials"
                                    onClick={canEdit ? photoEditor.choose : undefined}
                                >
                                    {(dp.name?.[0] ?? '?').toUpperCase()}
                                </div>
                            )}
                            {(canEdit || photoEditor.busy) && (
                                <div
                                    className="profile-avatar-overlay"
                                    onClick={canEdit ? photoEditor.choose : undefined}
                                >
                                    {photoEditor.busy ? (
                                        <div className="profile-avatar-spinner"/>
                                    ) : (
                                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                                             strokeLinecap="round" strokeLinejoin="round"
                                             className="profile-avatar-camera-icon">
                                            <path
                                                d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
                                            <circle cx="12" cy="13" r="4"/>
                                        </svg>
                                    )}
                                </div>
                            )}
                            {canRemovePhoto && !photoEditor.busy && (
                                <button
                                    className="profile-avatar-delete"
                                    onClick={handlePhotoDelete}
                                    type="button"
                                    aria-label={isEnglish ? 'Remove photo' : '删除头像'}
                                >
                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                                         strokeLinecap="round" strokeLinejoin="round">
                                        <line x1="18" y1="6" x2="6" y2="18"/>
                                        <line x1="6" y1="6" x2="18" y2="18"/>
                                    </svg>
                                </button>
                            )}
                            {canEdit && photoEditor.input}
                            {!canEdit && isOwnProfile && (
                                <>
                                    <div className="profile-avatar-hint-overlay">
                                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                                             strokeLinecap="round" strokeLinejoin="round"
                                             className="profile-avatar-hint-icon">
                                            <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                                            <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                                        </svg>
                                    </div>
                                    <span className="profile-avatar-hint-tooltip">
                                        {canRemovePhoto
                                            ? (isEnglish
                                                ? 'This photo was set by staff. You need an active membership to change it, but you can remove it.'
                                                : '此头像由工作人员设置。需要有效会员资格才能更换，但你可以将其删除。')
                                            : (isEnglish
                                                ? 'A profile photo or banner needs an active membership. Activate a passport to upload one.'
                                                : '设置头像或横幅需要有效会员资格。激活通行证后即可上传。')}
                                    </span>
                                </>
                            )}
                        </div>
                        <div className="profile-info">
                            <div className="profile-name-row">
                                {editingName && canEdit ? (
                                    <div className="profile-name-edit-group">
                                        <input
                                            ref={nameInputRef}
                                            className="profile-name-input"
                                            value={editName}
                                            onChange={e => setEditName(e.target.value)}
                                            onKeyDown={handleNameKeyDown}
                                            maxLength={50}
                                            disabled={savingName}
                                        />
                                        {savingName ? (
                                            <span
                                                className="profile-name-saving">{isEnglish ? 'Saving...' : '保存中...'}</span>
                                        ) : (
                                            <>
                                                <button type="button" className="profile-name-save"
                                                        onClick={() => void handleSaveName()}
                                                        aria-label={isEnglish ? 'Save name' : '保存名称'}>
                                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
                                                         strokeWidth="2.5"
                                                         strokeLinecap="round" strokeLinejoin="round">
                                                        <polyline points="20 6 9 17 4 12"/>
                                                    </svg>
                                                </button>
                                                <button type="button" className="profile-name-cancel"
                                                        onClick={cancelEditingName}
                                                        aria-label={isEnglish ? 'Cancel editing' : '取消编辑'}>
                                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
                                                         strokeWidth="2.5"
                                                         strokeLinecap="round" strokeLinejoin="round">
                                                        <line x1="18" y1="6" x2="6" y2="18"/>
                                                        <line x1="6" y1="6" x2="18" y2="18"/>
                                                    </svg>
                                                </button>
                                            </>
                                        )}
                                    </div>
                                ) : (
                                    <>
                                        <h1 className="profile-name">{dp.name}</h1>
                                        {canEdit && (
                                            <button className="profile-name-pencil" onClick={startEditingName}
                                                    type="button"
                                                    aria-label={isEnglish ? 'Edit name' : '编辑名称'}>
                                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
                                                     strokeWidth="2"
                                                     strokeLinecap="round" strokeLinejoin="round">
                                                    <path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/>
                                                </svg>
                                            </button>
                                        )}
                                    </>
                                )}
                            </div>
                            <div className="profile-meta">
                                <span className="profile-group-tag" data-group={dp.group}>
                                    {formatGroupWithTitle(dp.group, dp.title, dp.titleCn, isEnglish)}
                                </span>
                                <span className="profile-meta-item">
                                    <FiCalendar aria-hidden="true"/>
                                    {isEnglish ? 'Joined: ' : '注册日期：'}
                                    {longDate(dp.joinedAt)}
                                </span>
                                {isOwnProfile && 'email' in dp && (
                                    <span className="profile-meta-item profile-meta-email">
                                        <FiMail aria-hidden="true"/>
                                        {dp.email}
                                    </span>
                                )}
                            </div>
                            {dp.isMember && (
                                <div className="profile-meta">
                                    <span className="profile-member-chip">
                                        <FaStar aria-hidden="true"/>
                                        {isEnglish ? 'Member' : '会员'}
                                    </span>
                                    {memberSince && (
                                        <>
                                            <span className="profile-meta-item">
                                                <FiPlayCircle aria-hidden="true"/>
                                                {isEnglish ? 'Membership start: ' : '会员开通日期：'}
                                                {longDate(memberSince)}
                                            </span>
                                            <span className="profile-meta-item">
                                                <FiClock aria-hidden="true"/>
                                                {isEnglish ? 'Membership end: ' : '会员到期日期：'}
                                                {formatSiteTime(profile!.membershipExpiresAt!, isEnglish, {
                                                    year: 'numeric', month: 'long', day: 'numeric',
                                                })}
                                            </span>
                                        </>
                                    )}
                                </div>
                            )}
                        </div>
                    </div>

                    {stats.length > 0 && (
                        <ul className="profile-stats">
                            {stats.map(s => (
                                <li key={s.key} className="profile-stat">
                                    <span className="profile-stat-number">{s.count ?? '–'}</span>
                                    <span className="profile-stat-label">{s.label}</span>
                                </li>
                            ))}
                        </ul>
                    )}

                    {isOwnProfile && (
                        <div className="profile-tabs">
                            <button
                                type="button"
                                className={`profile-tab${!settingsTab ? ' profile-tab--active' : ''}`}
                                aria-current={!settingsTab ? 'page' : undefined}
                                onClick={() => openTab('profile')}
                            >
                                {isEnglish ? 'Profile' : '个人主页'}
                            </button>
                            <button
                                type="button"
                                className={`profile-tab${settingsTab ? ' profile-tab--active' : ''}`}
                                aria-current={settingsTab ? 'page' : undefined}
                                onClick={() => openTab('settings')}
                            >
                                {isEnglish ? 'Settings' : '设置'}
                            </button>
                        </div>
                    )}
                </div>

                <div className="profile-tab-body">
                    {!settingsTab && ticketsCard}
                    {settingsTab ? (
                        <ProfileSettingsTab showToast={showToast}/>
                    ) : settling ? (
                        <div className="spinner spinner-centered"/>
                    ) : isOwnProfile && allEmpty ? (
                        <ProfileWelcome checkedIn={checkedIn}/>
                    ) : !isOwnProfile && allEmpty ? (
                        <ProfileCard compact>
                            <ProfileCardNote icon={FiStar} muted>
                                {isEnglish
                                    ? `${dp.name} hasn’t earned a badge, activated a passport or checked in at an event yet.`
                                    : `${dp.name} 还没有获得徽章、激活通行证，也还没有参加过活动。`}
                            </ProfileCardNote>
                        </ProfileCard>
                    ) : !isOwnProfile && states.every(s => s === 'private') ? (
                        <ProfileCard compact>
                            <ProfileCardNote icon={FiLock} muted>
                                {isEnglish
                                    ? `${dp.name} keeps their badges, passports and events private.`
                                    : `${dp.name} 将徽章、通行证和参与活动设为私密。`}
                            </ProfileCardNote>
                        </ProfileCard>
                    ) : (
                        <div className="profile-collections">
                            <ProfileSection
                                kind="badges"
                                title={isEnglish ? 'Badges' : '徽章'}
                                state={badgeState}
                                own={isOwnProfile}
                                count={earnedBadges.length}
                                icon={FiAward}
                                none={isEnglish ? 'No badges yet.' : '还没有徽章。'}
                                hidden={isEnglish
                                    ? `${dp.name} keeps their badges private.`
                                    : `${dp.name} 将徽章设为私密。`}
                                failed={isEnglish ? 'Failed to load badge details.' : '加载徽章详情失败。'}
                            >
                                <div className="badge-grid">
                                    {earnedBadges.map(badge => (
                                        <BadgeCard
                                            key={badge.id}
                                            badge={badge}
                                            earnedDate={earnedDates[badge.id]}
                                            isEnglish={isEnglish}
                                            onOpen={() => setSelectedBadge(badge)}
                                        />
                                    ))}
                                </div>
                            </ProfileSection>

                            <ProfileSection
                                kind="passports"
                                title={isEnglish ? 'Passports' : '通行证'}
                                state={passportState}
                                own={isOwnProfile}
                                count={shelf?.length ?? 0}
                                icon={FiBookOpen}
                                none={isEnglish ? 'No passports yet.' : '还没有通行证。'}
                                hidden={isEnglish
                                    ? `${dp.name} keeps their passports private.`
                                    : `${dp.name} 将通行证设为私密。`}
                                failed={isEnglish ? 'Failed to load your passports.' : '加载通行证失败。'}
                            >
                                {shelf && (
                                    <PassportShelf
                                        passports={shelf}
                                        linked={isOwnProfile || !viewedProfile!.passportPageHidden}
                                    />
                                )}
                            </ProfileSection>

                            <ProfileSection
                                kind="events"
                                title={isEnglish ? 'Events Attended' : '参与活动'}
                                state={eventState}
                                own={isOwnProfile}
                                checkedIn={checkedIn}
                                count={attendedEvents.length}
                                icon={FiCalendar}
                                none={isEnglish ? 'No events attended yet.' : '还没有参加过活动。'}
                                hidden={isEnglish
                                    ? `${dp.name} keeps their events private.`
                                    : `${dp.name} 将参与活动设为私密。`}
                            >
                                <div className="profile-event-grid">
                                    {attendedEvents.map(event => (
                                        <EventCard
                                            key={event.id}
                                            event={event}
                                            isEnglish={isEnglish}
                                            showAdminLink={isStaff}
                                            wasStaff={staffedSet.has(event.id)}
                                            tagLabels={event.tagIds
                                                .map(id => tagMap.get(id))
                                                .filter((t): t is NonNullable<typeof t> => !!t)
                                                .map(t => localized(isEnglish, t.name, t.nameCn))}
                                        />
                                    ))}
                                </div>
                            </ProfileSection>
                        </div>
                    )}
                </div>
            </div>
            {selectedBadge && (
                <div ref={badgeModalRef} className="badge-modal-overlay" onClick={() => setSelectedBadge(null)}>
                    <div className="badge-modal-content" onClick={e => e.stopPropagation()}>
                        <button className="badge-modal-close" onClick={() => setSelectedBadge(null)}
                                aria-label={isEnglish ? 'Close' : '关闭'}>×
                        </button>
                        <div>
                            <img src={selectedBadge.imageUrl}
                                 alt={localized(isEnglish, selectedBadge.name, selectedBadge.nameCn)}
                                 className="badge-modal-icon"/>
                            <h3 className="badge-modal-title">{localized(isEnglish, selectedBadge.name, selectedBadge.nameCn)}</h3>
                        </div>
                        <p className="badge-modal-desc">{localized(isEnglish, selectedBadge.description, selectedBadge.descriptionCn)}</p>
                        <div className="badge-modal-meta">
                            {earnedDates[selectedBadge.id] && (
                                <p>
                                    <strong>{isEnglish ? 'Earned' : '获得于'}</strong>
                                    {earnedDates[selectedBadge.id].toLocaleDateString(
                                        isEnglish ? 'en-US' : 'zh-CN',
                                        {year: 'numeric', month: 'short', day: 'numeric'}
                                    )}
                                </p>
                            )}
                            {selectedBadge.createdByName && (
                                <p>
                                    <strong>{isEnglish ? 'Created by' : '创作者'}</strong>
                                    {selectedBadge.createdByUid ? (
                                        <a href={`/profile?uid=${selectedBadge.createdByUid}`}
                                           className="badge-modal-creator-link">
                                            {selectedBadge.createdByName}
                                        </a>
                                    ) : (selectedBadge.createdByLink && isValidHttpUrl(selectedBadge.createdByLink)) ? (
                                        <a href={selectedBadge.createdByLink} target="_blank"
                                           rel="noopener noreferrer"
                                           className="badge-modal-creator-link">
                                            {selectedBadge.createdByName}
                                        </a>
                                    ) : selectedBadge.createdByName}
                                </p>
                            )}
                        </div>
                    </div>
                </div>
            )}
            {photoEditor.cropModal}
            {bannerEditor.cropModal}
        </>
    );
};
