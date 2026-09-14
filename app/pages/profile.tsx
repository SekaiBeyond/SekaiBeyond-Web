import React, { useEffect, useMemo, useRef, useState } from 'react';
import { collection, documentId, getDocs, query, where } from 'firebase/firestore';
import { FaStar } from 'react-icons/fa';
import { FiAward, FiCalendar, FiClock, FiImage, FiLock, FiMail, FiPlayCircle, FiStar, FiTrash2, } from 'react-icons/fi';
import {
    formatGroupWithTitle,
    hasPermission,
    normalizeGroup,
    useAuth,
    type UserGroup,
} from '~/components/AuthProvider';
import { LoginButton } from '~/components/LoginButton';
import { useLanguage } from '~/components/LanguageContextProvider';
import { callGetPublicProfile, getFirebaseDb } from '~/lib/firebase';
import { LanguageSwitcher } from '~/components/LanguageSwitcher';
import { type PastEvent, usePastEvents } from '~/lib/pastEvents';
import { useTags } from '~/lib/tags';
import { useNavigate, useSearchParams } from 'react-router';
import type { BadgeDef as BaseBadgeDef } from '~/lib/types';
import { isValidHttpUrl } from '~/lib/urls';
import { PassportShelf, usePassportsByOwner } from '~/pages/PassportShelf';
import { ProfileCard, ProfileCardNote, ProfileSection, ProfileWelcome, type SectionState, } from '~/pages/ProfileCards';
import { ProfileSettingsTab } from '~/pages/ProfileSettingsTab';
import { ImageCropModal } from '~/pages/admin/ImageCropModal';
import { validateImageFile } from "~/pages/admin/utils";
import { ToastContainer, useToasts } from '~/lib/useToasts';

interface BadgeDef extends BaseBadgeDef {
    holderPct?: number;
    createdByUid?: string;
    createdByName?: string;
    createdByLink?: string;
}

interface ViewedProfile {
    displayName: string;
    photoURL: string;
    bannerURL: string;
    joinedAt: Date;
    attendedEvents: string[];
    eventStaffEvents: string[];
    badges: string[];
    badgeEarnedAt: Record<string, Date>;
    group: UserGroup;
    isMember: boolean;
    title?: string;
    titleCn?: string;
    /**
     * Which sections this member shows other people. A hidden one arrives
     * empty from the server, so this is what separates "kept private" from
     * "none yet" — without it the page would claim they had earned nothing.
     */
    visibility: {badges: boolean; events: boolean};
}

/**
 * Width over height of an uploaded banner: the shape of the banner on the widest
 * card, 1158px by 96px (see .profile-hero-banner), so there the crop is what
 * people see. Narrower screens keep the height and trim the sides.
 */
const BANNER_ASPECT = 12;
// Wide enough to stay sharp across the full-width card on a high-density screen.
const BANNER_WIDTH = 1500;

/**
 * A badge: a button that opens its detail modal, with a preview on hover or
 * keyboard focus. The preview carries no links — a link can't sit inside a
 * button — so who made the badge is left to the modal.
 */
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
        <span className="badge-label">{isEnglish ? badge.name : badge.nameCn}</span>
        <span className="badge-tooltip" aria-hidden="true">
            <span className="badge-tooltip-name">{isEnglish ? badge.name : badge.nameCn}</span>
            <span className="badge-tooltip-desc">{isEnglish ? badge.description : badge.descriptionCn}</span>
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

/** One attended event, with a link to its admin page for staff. */
const EventCard = ({event, isEnglish, showAdminLink, tagLabels, wasStaff}: {
    event: PastEvent;
    isEnglish: boolean;
    showAdminLink?: boolean;
    tagLabels?: string[];
    wasStaff?: boolean;
}) => {
    const title = isEnglish ? event.title : event.titleCn;
    return (
        <div className="profile-event-card">
            <div className="profile-event-icon-wrapper">
                <img src={event.icon} alt={title} className="profile-event-icon"/>
                {wasStaff && (
                    <span className="profile-event-staff-tag">
                        {isEnglish ? 'Staff' : '工作人员'}
                    </span>
                )}
            </div>
            <div className="profile-event-info">
                {tagLabels && tagLabels.length > 0 ? (
                    <span className="profile-event-categories">
                        {tagLabels.map((label, i) => (
                            <span key={i} className="profile-event-category">{label}</span>
                        ))}
                    </span>
                ) : (
                    <span className="profile-event-category profile-event-category-hidden">{'\u00A0'}</span>
                )}
                {/* The name wraps to two lines before it is cut; the title attribute
                    holds the whole of it for a name longer than that. */}
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
    // Settings are yours alone, so someone else's profile has no tabs at all —
    // and ?tab=settings on their uid falls back to the profile itself rather
    // than showing them your switches.
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
    const [savingPhoto, setSavingPhoto] = useState(false);
    const [customPhotoLoaded, setCustomPhotoLoaded] = useState(false);
    const [pendingPhoto, setPendingPhoto] = useState<File | null>(null);
    const [avatarError, setAvatarError] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [savingBanner, setSavingBanner] = useState(false);
    const [pendingBanner, setPendingBanner] = useState<File | null>(null);
    // The URL that failed to load, so a new upload gets a fresh try.
    const [failedBanner, setFailedBanner] = useState<string | null>(null);
    const bannerInputRef = useRef<HTMLInputElement>(null);
    const nameInputRef = useRef<HTMLInputElement>(null);
    // null while the definitions for the badge ids are still being read.
    const [badgeDefs, setBadgeDefs] = useState<BadgeDef[] | null>(null);
    const [badgeLoadError, setBadgeLoadError] = useState(false);
    const [viewedLoadError, setViewedLoadError] = useState(false);
    const {toasts, showToast} = useToasts();
    const [selectedBadge, setSelectedBadge] = useState<BadgeDef | null>(null);
    const {passports, failed: passportsFailed} = usePassportsByOwner(isViewingOther ? null : user?.uid ?? null);

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
                const db = getFirebaseDb();
                const col = collection(db, 'badges');
                // Firestore 'in' queries support max 30 items per batch
                const batches: string[][] = [];
                for (let i = 0; i < badgeIds.length; i += 30) {
                    batches.push(badgeIds.slice(i, i + 30));
                }
                const defs: BadgeDef[] = [];
                await Promise.all(batches.map(async (batch) => {
                    const q = query(col, where(documentId(), 'in', batch));
                    const snapshot = await getDocs(q);
                    snapshot.forEach(docSnap => {
                        const data = docSnap.data();
                        defs.push({
                            id: docSnap.id,
                            name: data.name ?? '',
                            nameCn: data.nameCn ?? '',
                            description: data.description ?? '',
                            descriptionCn: data.descriptionCn ?? '',
                            imageUrl: data.imageUrl ?? '',
                            holderPct: data.holderPct,
                            createdByUid: data.createdByUid ?? '',
                            createdByName: data.createdByName ?? '',
                            createdByLink: data.createdByLink ?? '',
                            deleteAt: data.deleteAt?.toDate?.() ?? null,
                        });
                    });
                }));
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
        // getPublicProfile refuses a signed-out caller, so wait for a sign-in
        // (the page prompts for one) rather than fetching into an error.
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
                for (const [k, v] of Object.entries(data.badgeEarnedAt ?? {})) {
                    const d = new Date(v);
                    if (!isNaN(d.getTime())) earnedAt[k] = d;
                }
                setViewedProfile({
                    displayName: data.displayName ?? '',
                    photoURL: data.photoURL ?? '',
                    bannerURL: data.bannerURL ?? '',
                    joinedAt: data.joinedAt ? new Date(data.joinedAt) : new Date(),
                    attendedEvents: data.attendedEvents ?? [],
                    eventStaffEvents: data.eventStaffEvents ?? [],
                    badges: data.badges ?? [],
                    badgeEarnedAt: earnedAt,
                    group: normalizeGroup(data.group),
                    isMember: data.isMember ?? false,
                    title: data.title ?? '',
                    titleCn: data.titleCn ?? '',
                    visibility: data.visibility,
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

    const hasCustomPhoto = profile?.photoURL?.includes('firebasestorage.googleapis.com') ?? false;

    useEffect(() => {
        setAvatarError(false);
        if (!hasCustomPhoto || !profile) {
            setCustomPhotoLoaded(false);
            return;
        }
        const img = new Image();
        img.onload = () => setCustomPhotoLoaded(true);
        img.onerror = () => setCustomPhotoLoaded(false);
        img.src = profile.photoURL;
    }, [profile?.photoURL, hasCustomPhoto]);

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

    const handlePhotoSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (fileInputRef.current) fileInputRef.current.value = '';
        if (!file || !profile || !user) return;
        if (!validateImageFile(file, isEnglish, showToast, true)) return;
        setPendingPhoto(file);
    };

    const handlePhotoCropConfirm = async (cropped: File) => {
        setPendingPhoto(null);
        if (!profile || !user) return;
        setSavingPhoto(true);
        try {
            await updateProfile({photoFile: cropped});
            setCustomPhotoLoaded(true);
            showToast(isEnglish ? 'Profile photo updated.' : '头像已更新。', 'success');
        } catch {
            showToast(isEnglish ? 'Failed to upload photo. Please try again.' : '上传头像失败，请重试。', 'error');
        } finally {
            setSavingPhoto(false);
        }
    };

    const handlePhotoDelete = async () => {
        if (!profile || !user) return;
        const confirmed = window.confirm(
            isEnglish
                ? 'Remove your profile photo? This will revert to your Google account photo.'
                : '确定要删除头像吗？将恢复为 Google 账户的头像。',
        );
        if (!confirmed) return;
        setSavingPhoto(true);
        try {
            await updateProfile({deletePhoto: true});
            setCustomPhotoLoaded(false);
            showToast(isEnglish ? 'Profile photo removed.' : '头像已删除。', 'warning');
        } catch {
            showToast(isEnglish ? 'Failed to remove photo. Please try again.' : '删除头像失败，请重试。', 'error');
        } finally {
            setSavingPhoto(false);
        }
    };

    const handleBannerSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (bannerInputRef.current) bannerInputRef.current.value = '';
        if (!file || !profile || !user) return;
        if (!validateImageFile(file, isEnglish, showToast, true)) return;
        setPendingBanner(file);
    };

    const handleBannerCropConfirm = async (cropped: File) => {
        setPendingBanner(null);
        if (!profile || !user) return;
        setSavingBanner(true);
        try {
            await updateProfile({bannerFile: cropped});
            showToast(isEnglish ? 'Banner updated.' : '横幅已更新。', 'success');
        } catch {
            showToast(isEnglish ? 'Failed to upload banner. Please try again.' : '上传横幅失败，请重试。', 'error');
        } finally {
            setSavingBanner(false);
        }
    };

    const handleBannerDelete = async () => {
        if (!profile || !user) return;
        const confirmed = window.confirm(
            isEnglish
                ? 'Remove your banner? Your profile will go back to the default one.'
                : '确定要删除横幅吗？个人主页将恢复为默认横幅。',
        );
        if (!confirmed) return;
        setSavingBanner(true);
        try {
            await updateProfile({deleteBanner: true});
            showToast(isEnglish ? 'Banner removed.' : '横幅已删除。', 'warning');
        } catch {
            showToast(isEnglish ? 'Failed to remove banner. Please try again.' : '删除横幅失败，请重试。', 'error');
        } finally {
            setSavingBanner(false);
        }
    };

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

    // Once signed in, there is a render between auth settling and the fetch
    // starting with neither a profile nor an error; keep the spinner up through it
    // rather than flashing "not found".
    const awaitingViewed = isViewingOther && !!user && !viewedProfile && !viewedLoadError;

    if (loading || loadingViewed || awaitingViewed || eventsLoading) {
        return (
            <div className="profile-loading">
                <div className="spinner"/>
            </div>
        );
    }

    // Someone else's profile is for signed-in visitors only. A passport scan is
    // the usual way a signed-out visitor ends up here.
    if (isViewingOther && !user) {
        return (
            <div className="profile-login-prompt">
                <div className="profile-login-card">
                    <h2>{isEnglish ? 'Sign in to view this profile' : '登录以查看此个人主页'}</h2>
                    <p>{isEnglish
                        ? 'Member profiles are only shown to signed-in visitors.'
                        : '成员个人主页仅对已登录的访客显示。'}</p>
                    <button onClick={signIn} className="profile-sign-in-btn">
                        {isEnglish ? 'Sign in with Google' : '使用 Google 登录'}
                    </button>
                    <a href="/" className="profile-back-link">
                        {isEnglish ? 'Back to Home' : '返回首页'}
                    </a>
                </div>
            </div>
        );
    }

    if (isViewingOther && !viewedProfile) {
        return (
            <div className="profile-login-prompt">
                <div className="profile-login-card">
                    <h2>{viewedLoadError
                        ? (isEnglish ? 'Failed to load profile' : '加载用户信息失败')
                        : (isEnglish ? 'User not found' : '未找到用户')}</h2>
                    <a href="/" className="profile-back-link">
                        {isEnglish ? 'Back to Home' : '返回首页'}
                    </a>
                </div>
            </div>
        );
    }

    if (!isViewingOther && (!user || !profile)) {
        return (
            <div className="profile-login-prompt">
                <div className="profile-login-card">
                    <h2>{isEnglish ? 'Sign in to view your profile' : '登录以查看你的个人主页'}</h2>
                    <p>{isEnglish
                        ? 'Track your event attendance and earn badges!'
                        : '记录你的活动参与、收集徽章！'}</p>
                    <button onClick={signIn} className="profile-sign-in-btn">
                        {isEnglish ? 'Sign in with Google' : '使用 Google 登录'}
                    </button>
                    <a href="/" className="profile-back-link">
                        {isEnglish ? 'Back to Home' : '返回首页'}
                    </a>
                </div>
            </div>
        );
    }

    const isOwnProfile = !isViewingOther;
    const googlePhotoURL = user?.photoURL ?? '';
    const displayedPhoto = isOwnProfile
        ? (hasCustomPhoto ? (customPhotoLoaded ? profile!.photoURL : googlePhotoURL) : profile!.photoURL)
        : viewedProfile!.photoURL;
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
    // A section the viewed member keeps private arrives empty. Own profile is
    // never filtered — you always see your own page whole.
    const showBadges = isOwnProfile || viewedProfile!.visibility.badges;
    const showEvents = isOwnProfile || viewedProfile!.visibility.events;
    const staffedSet = new Set(dp.eventStaffEvents);
    const attendedSet = new Set([...dp.attendedEvents, ...dp.eventStaffEvents]);
    const attendedEvents = pastEvents
        .filter(e => attendedSet.has(e.id))
        .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    const earnedBadges = (badgeDefs ?? [])
        .filter(b => dp.badges.includes(b.id))
        .sort((a, b) => (earnedDates[b.id]?.getTime() ?? 0) - (earnedDates[a.id]?.getTime() ?? 0));

    // Where each section stands. A badge id whose definition is gone counts for
    // nothing, so badges are only known to be empty once the definitions are in;
    // passports belong to the owner alone, so someone else's profile has none.
    const badgeState: SectionState = !showBadges ? 'private'
        : dp.badges.length === 0 ? 'empty'
            : badgeLoadError ? 'failed'
                : badgeDefs === null ? 'loading'
                    : earnedBadges.length > 0 ? 'filled' : 'empty';
    const eventState: SectionState = !showEvents ? 'private'
        : attendedEvents.length > 0 ? 'filled' : 'empty';
    const passportState: SectionState | null = !isOwnProfile ? null
        : passportsFailed ? 'failed'
            : passports === null ? 'loading'
                : passports.length > 0 ? 'filled' : 'empty';
    const states = [badgeState, passportState, eventState].filter((s): s is SectionState => s !== null);
    const anyFilled = states.includes('filled');
    const allEmpty = states.every(s => s === 'empty');
    // Until a section turns up something, a still-loading one could yet leave
    // the page empty — hold the spinner rather than draw sections that might be
    // swapped for the welcome card a moment later.
    const settling = !anyFilled && states.includes('loading');

    // The header's counts. A private section has no count to give — the server
    // withheld the list — and a profile with nothing in it has no row at all.
    const stat = (key: string, count: number | null, one: string, many: string, zh: string) =>
        ({key, count, label: isEnglish ? (count === 1 ? one : many) : zh});
    const stats = anyFilled ? [
        // The id count stands in until the definitions arrive; they almost always agree.
        ...(showBadges
            ? [stat('badges', badgeDefs === null ? dp.badges.length : earnedBadges.length, 'Badge', 'Badges', '徽章')]
            : []),
        ...(isOwnProfile && !passportsFailed
            ? [stat('passports', passports?.length ?? null, 'Passport', 'Passports', '通行证')]
            : []),
        ...(showEvents ? [stat('events', attendedEvents.length, 'Event', 'Events', '活动')] : []),
    ] : [];
    // Avatar uploads are a membership perk, but staff+ keep them without one —
    // the only people blocked are plain users who have never paid.
    const canEdit = isOwnProfile && (isMember || hasPermission(profile!.group, 'staff'));
    // Non-members can't upload a photo, but may remove one an admin gave them.
    const canRemovePhoto = isOwnProfile && hasCustomPhoto;
    // The banner follows the same rule as the photo. Only its owner ever sets
    // one, so a non-member only has one to remove if their membership lapsed.
    const bannerURL = isOwnProfile ? profile!.bannerURL : viewedProfile!.bannerURL;
    const showBanner = !!bannerURL && bannerURL !== failedBanner;
    const bannerLabel = bannerURL
        ? (isEnglish ? 'Change banner' : '更换横幅')
        : (isEnglish ? 'Add banner' : '添加横幅');
    const isStaff = isOwnProfile && hasPermission(profile!.group, 'staff');
    const longDate = (date: Date) => date.toLocaleDateString(isEnglish ? 'en-US' : 'zh-CN', {
        year: 'numeric', month: 'long', day: 'numeric',
    });
    // Only the owner has membership dates to show — getPublicProfile hands
    // everyone else a bare isMember. The start only means anything while a
    // membership is running, and isMember means there is an end.
    const memberSince = isOwnProfile && isMember ? profile!.membershipStartedAt : null;

    return (
        <>
            <ToastContainer toasts={toasts}/>
            <nav className="profile-nav">
                <a href="/" className="profile-nav-home">
                    {isEnglish ? 'SEKAI BEYOND' : '彼世界动漫社'}
                </a>
                <div className="nav-actions">
                    <LanguageSwitcher/>
                    <LoginButton/>
                </div>
            </nav>
            <div className="profile-page">

                <div className="profile-hero">
                    <div
                        className={`profile-hero-banner${savingBanner ? ' profile-hero-banner--saving' : ''}`}>
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
                                        onClick={() => bannerInputRef.current?.click()}
                                        disabled={savingBanner}
                                        aria-label={bannerLabel}
                                    >
                                        {savingBanner
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
                                {bannerURL && !savingBanner && (
                                    <button
                                        type="button"
                                        className="profile-banner-btn profile-banner-btn--remove"
                                        onClick={handleBannerDelete}
                                        aria-label={isEnglish ? 'Remove banner' : '删除横幅'}
                                    >
                                        <FiTrash2 aria-hidden="true"/>
                                    </button>
                                )}
                                {canEdit && (
                                    <input
                                        ref={bannerInputRef}
                                        type="file"
                                        accept="image/*"
                                        onChange={handleBannerSelect}
                                        hidden
                                    />
                                )}
                            </div>
                        )}
                    </div>
                    <div className="profile-hero-body">
                        <div
                            className={`profile-avatar-wrapper ${canEdit ? 'profile-avatar-clickable' : isOwnProfile ? 'profile-avatar-nonmember-hint' : ''} ${savingPhoto ? 'profile-avatar-saving' : ''}`}>
                            {!avatarError && displayedPhoto ? (
                                <img
                                    src={displayedPhoto}
                                    alt={dp.name}
                                    className="profile-avatar"
                                    referrerPolicy="no-referrer"
                                    onError={() => setAvatarError(true)}
                                    onClick={canEdit ? () => !savingPhoto && fileInputRef.current?.click() : undefined}
                                />
                            ) : (
                                <div
                                    className="profile-avatar profile-avatar-initials"
                                    onClick={canEdit ? () => !savingPhoto && fileInputRef.current?.click() : undefined}
                                >
                                    {(dp.name?.[0] ?? '?').toUpperCase()}
                                </div>
                            )}
                            {(canEdit || savingPhoto) && (
                                <div
                                    className="profile-avatar-overlay"
                                    onClick={canEdit ? () => !savingPhoto && fileInputRef.current?.click() : undefined}
                                >
                                    {savingPhoto ? (
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
                            {canRemovePhoto && !savingPhoto && (
                                <button
                                    className="profile-avatar-delete"
                                    onClick={handlePhotoDelete}
                                    type="button"
                                    aria-label="Remove photo"
                                >
                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                                         strokeLinecap="round" strokeLinejoin="round">
                                        <line x1="18" y1="6" x2="6" y2="18"/>
                                        <line x1="6" y1="6" x2="18" y2="18"/>
                                    </svg>
                                </button>
                            )}
                            {canEdit && (
                                <input
                                    ref={fileInputRef}
                                    type="file"
                                    accept="image/*"
                                    onChange={handlePhotoSelect}
                                    hidden
                                />
                            )}
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
                                                        aria-label="Save name">
                                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
                                                         strokeWidth="2.5"
                                                         strokeLinecap="round" strokeLinejoin="round">
                                                        <polyline points="20 6 9 17 4 12"/>
                                                    </svg>
                                                </button>
                                                <button type="button" className="profile-name-cancel"
                                                        onClick={cancelEditingName}
                                                        aria-label="Cancel editing">
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
                                                    aria-label="Edit name">
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
                            {/* Membership is not a group, so it gets a line of its own
                                under the group's — a president can be a member too. */}
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
                                                {longDate(profile!.membershipExpiresAt!)}
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

                    {/* Only your own profile has tabs: they sit on the header card,
                        so switching keeps your name and photo in place. */}
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
                    {settingsTab ? (
                        <ProfileSettingsTab showToast={showToast}/>
                    ) : settling ? (
                        <div className="spinner spinner-centered"/>
                    ) : isOwnProfile && allEmpty ? (
                        <ProfileWelcome/>
                    ) : !isOwnProfile && allEmpty ? (
                        <ProfileCard compact>
                            <ProfileCardNote icon={FiStar} muted>
                                {isEnglish
                                    ? `${dp.name} hasn’t earned a badge or checked in at an event yet.`
                                    : `${dp.name} 还没有获得徽章，也还没有参加过活动。`}
                            </ProfileCardNote>
                        </ProfileCard>
                    ) : !isOwnProfile && badgeState === 'private' && eventState === 'private' ? (
                        <ProfileCard compact>
                            <ProfileCardNote icon={FiLock} muted>
                                {isEnglish
                                    ? `${dp.name} keeps their badges and events private.`
                                    : `${dp.name} 将徽章和参与活动设为私密。`}
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

                            {/* Passports are the owner's own business: the shelf reads
                                straight from their passports, and getPublicProfile
                                carries none of it. */}
                            {passportState && (
                                <ProfileSection
                                    kind="passports"
                                    title={isEnglish ? 'Passports' : '通行证'}
                                    state={passportState}
                                    own={isOwnProfile}
                                    count={passports?.length ?? 0}
                                    failed={isEnglish ? 'Failed to load your passports.' : '加载通行证失败。'}
                                >
                                    {passports && <PassportShelf passports={passports}/>}
                                </ProfileSection>
                            )}

                            <ProfileSection
                                kind="events"
                                title={isEnglish ? 'Events Attended' : '参与活动'}
                                state={eventState}
                                own={isOwnProfile}
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
                                                .map(t => isEnglish ? t.name : t.nameCn)}
                                        />
                                    ))}
                                </div>
                            </ProfileSection>
                        </div>
                    )}
                </div>
            </div>
            {selectedBadge && (
                <div className="badge-modal-overlay" onClick={() => setSelectedBadge(null)}>
                    <div className="badge-modal-content" onClick={e => e.stopPropagation()}>
                        <button className="badge-modal-close" onClick={() => setSelectedBadge(null)}>×</button>
                        <div className="badge-modal-header">
                            <img src={selectedBadge.imageUrl}
                                 alt={isEnglish ? selectedBadge.name : selectedBadge.nameCn}
                                 className="badge-modal-icon"/>
                            <h3 className="badge-modal-title">{isEnglish ? selectedBadge.name : selectedBadge.nameCn}</h3>
                        </div>
                        <p className="badge-modal-desc">{isEnglish ? selectedBadge.description : selectedBadge.descriptionCn}</p>
                        <div className="badge-modal-meta">
                            {earnedDates[selectedBadge.id] && (
                                <p className="badge-modal-date">
                                    <strong>{isEnglish ? 'Earned' : '获得于'}</strong>
                                    {earnedDates[selectedBadge.id].toLocaleDateString(
                                        isEnglish ? 'en-US' : 'zh-CN',
                                        {year: 'numeric', month: 'short', day: 'numeric'}
                                    )}
                                </p>
                            )}
                            {selectedBadge.holderPct != null && (
                                <p className="badge-modal-pct">
                                    <strong>{isEnglish ? 'Rarity' : '稀有度'}</strong>
                                    {isEnglish
                                        ? `${selectedBadge.holderPct}% of members`
                                        : `${selectedBadge.holderPct}% 的成员拥有`}
                                </p>
                            )}
                            {selectedBadge.createdByName && (
                                <p className="badge-modal-creator">
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
            {pendingPhoto && (
                <ImageCropModal
                    imageSource={pendingPhoto}
                    aspect={1}
                    onConfirm={handlePhotoCropConfirm}
                    onCancel={() => setPendingPhoto(null)}
                    showToast={showToast}
                />
            )}
            {pendingBanner && (
                <ImageCropModal
                    imageSource={pendingBanner}
                    aspect={BANNER_ASPECT}
                    outputWidth={BANNER_WIDTH}
                    onConfirm={handleBannerCropConfirm}
                    onCancel={() => setPendingBanner(null)}
                    showToast={showToast}
                />
            )}
        </>
    );
};
