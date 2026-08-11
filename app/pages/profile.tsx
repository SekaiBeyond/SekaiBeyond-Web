import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { collection, documentId, getDocs, query, where } from 'firebase/firestore';
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
    joinedAt: Date;
    attendedEvents: string[];
    eventStaffEvents: string[];
    badges: string[];
    badgeEarnedAt: Record<string, Date>;
    group: UserGroup;
    isMember: boolean;
    title?: string;
    titleCn?: string;
}

const BadgeCard = ({badge, earnedDate, isEnglish, active, onToggle}: {
    badge: BadgeDef;
    earnedDate?: Date;
    isEnglish: boolean;
    active: boolean;
    onToggle: () => void;
}) => (
    <div className={`badge-circle ${active ? 'badge-circle-active' : ''}`} onClick={onToggle}>
        <div className="badge-icon-wrapper">
            <img src={badge.imageUrl} alt={isEnglish ? badge.name : badge.nameCn} className="badge-icon"/>
        </div>
        <span className="badge-label">{isEnglish ? badge.name : badge.nameCn}</span>
        <div className="badge-tooltip">
            <h4 className="badge-tooltip-name">{isEnglish ? badge.name : badge.nameCn}</h4>
            <p className="badge-tooltip-desc">{isEnglish ? badge.description : badge.descriptionCn}</p>
            {earnedDate && (
                <p className="badge-tooltip-date">
                    {isEnglish ? 'Earned: ' : '获得于：'}
                    {earnedDate.toLocaleDateString(
                        isEnglish ? 'en-US' : 'zh-CN',
                        {year: 'numeric', month: 'short', day: 'numeric'}
                    )}
                </p>
            )}
            {badge.holderPct != null && (
                <p className="badge-tooltip-pct">
                    {isEnglish
                        ? `${badge.holderPct}% of members have this`
                        : `${badge.holderPct}% 的成员拥有此徽章`}
                </p>
            )}
            {badge.createdByName && (
                <p className="badge-tooltip-creator">
                    {isEnglish ? 'Created by ' : '由 '}
                    {badge.createdByUid ? (
                        <a href={`/profile?uid=${badge.createdByUid}`}
                           className="badge-tooltip-creator-link">
                            {badge.createdByName}
                        </a>
                    ) : (badge.createdByLink && isValidHttpUrl(badge.createdByLink)) ? (
                        <a href={badge.createdByLink} target="_blank"
                           rel="noopener noreferrer"
                           className="badge-tooltip-creator-link">
                            {badge.createdByName}
                        </a>
                    ) : badge.createdByName}
                    {!isEnglish && ' 创建'}
                </p>
            )}
        </div>
    </div>
);

const EventCard = ({event, isEnglish, showAdminLink, tagLabels, wasStaff}: {
    event: PastEvent;
    isEnglish: boolean;
    showAdminLink?: boolean;
    tagLabels?: string[];
    wasStaff?: boolean;
}) => (
    <div className="profile-event-card">
        <div className="profile-event-icon-wrapper">
            <img src={event.icon} alt={isEnglish ? event.title : event.titleCn} className="profile-event-icon"/>
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
            <h3 className="profile-event-title">
                {showAdminLink ? (
                    <a href={`/admin?tab=events&event=${encodeURIComponent(event.id)}`}
                       className="profile-event-title-link">
                        {isEnglish ? event.title : event.titleCn}
                    </a>
                ) : (
                    isEnglish ? event.title : event.titleCn
                )}
            </h3>
            <p className="profile-event-date">
                {new Date(event.date).toLocaleDateString(isEnglish ? 'en-US' : 'zh-CN', {
                    year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC',
                })}
            </p>
        </div>
    </div>
);

export const ProfilePage = () => {
    const {user, profile, isMember, loading, signIn, updateProfile} = useAuth();
    const {isEnglish} = useLanguage();
    const {pastEvents, loading: eventsLoading} = usePastEvents();
    const {tags} = useTags();
    const tagMap = useMemo(() => new Map(tags.map(t => [t.id, t])), [tags]);
    const [searchParams] = useSearchParams();
    const navigate = useNavigate();
    const viewUid = searchParams.get('uid');
    const isViewingOther = !!viewUid && viewUid !== user?.uid;
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
    const nameInputRef = useRef<HTMLInputElement>(null);
    const [badgeDefs, setBadgeDefs] = useState<BadgeDef[]>([]);
    const [badgeLoadError, setBadgeLoadError] = useState(false);
    const [viewedLoadError, setViewedLoadError] = useState(false);
    const [activeBadge, setActiveBadge] = useState<string | null>(null);
    const badgeGridRef = useRef<HTMLDivElement>(null);
    const {toasts, showToast} = useToasts();
    const [selectedBadge, setSelectedBadge] = useState<BadgeDef | null>(null);

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

    useEffect(() => {
        if (!viewUid || !isViewingOther) {
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
                    joinedAt: data.joinedAt ? new Date(data.joinedAt) : new Date(),
                    attendedEvents: data.attendedEvents ?? [],
                    eventStaffEvents: data.eventStaffEvents ?? [],
                    badges: data.badges ?? [],
                    badgeEarnedAt: earnedAt,
                    group: normalizeGroup(data.group),
                    isMember: data.isMember ?? false,
                    title: data.title ?? '',
                    titleCn: data.titleCn ?? '',
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
    }, [viewUid, isViewingOther]);

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
        if (!activeBadge) return;
        const handleClick = (e: MouseEvent) => {
            if (badgeGridRef.current && !badgeGridRef.current.contains(e.target as Node)) {
                setActiveBadge(null);
            }
        };
        document.addEventListener('click', handleClick);
        return () => document.removeEventListener('click', handleClick);
    }, [activeBadge]);

    const toggleBadge = useCallback((badge: BadgeDef) => {
        setActiveBadge(prev => prev === badge.id ? null : badge.id);
        setSelectedBadge(badge);
    }, []);

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

    if (loading || loadingViewed || eventsLoading) {
        return (
            <div className="profile-loading">
                <div className="profile-spinner"/>
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
            membershipExpiresAt: profile!.membershipExpiresAt,
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
            // Only the owner sees their own expiry date; others just see the chip.
            membershipExpiresAt: null,
            title: viewedProfile!.title ?? '',
            titleCn: viewedProfile!.titleCn ?? '',
        };
    const staffedSet = new Set(dp.eventStaffEvents);
    const attendedSet = new Set([...dp.attendedEvents, ...dp.eventStaffEvents]);
    const attendedEvents = pastEvents
        .filter(e => attendedSet.has(e.id))
        .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    const earnedBadges = badgeDefs
        .filter(b => dp.badges.includes(b.id))
        .sort((a, b) => (earnedDates[b.id]?.getTime() ?? 0) - (earnedDates[a.id]?.getTime() ?? 0));
    // Avatar uploads are a membership perk, but staff+ keep them without one —
    // the only people blocked are plain users who have never paid.
    const canEdit = isOwnProfile && (isMember || hasPermission(profile!.group, 'staff'));
    // Non-members can't upload a photo, but may remove one an admin gave them.
    const canRemovePhoto = isOwnProfile && hasCustomPhoto;
    const isStaff = isOwnProfile && hasPermission(profile!.group, 'staff');
    // Label behind the star on the group chip. Only the owner has an expiry date to
    // reveal — for everyone else the star just says "member", which is all
    // getPublicProfile hands back.
    const memberLabel = ((): string | null => {
        if (!dp.isMember) return null;
        const expiry = dp.membershipExpiresAt;
        if (!expiry) return isEnglish ? 'Member' : '会员';
        const on = expiry.toLocaleDateString(isEnglish ? 'en-US' : 'zh-CN', {
            year: 'numeric', month: 'long', day: 'numeric',
        });
        // Round up so the last partial day still reads as "1 day left" rather than 0.
        const daysLeft = Math.ceil((expiry.getTime() - Date.now()) / 86400000);
        return isEnglish
            ? `Member until ${on} · ${daysLeft} day${daysLeft === 1 ? '' : 's'} left`
            : `会员有效期至 ${on} · 剩余 ${daysLeft} 天`;
    })();

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

                <div className="profile-header">
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
                                            ? 'A profile photo needs an active membership. Activate a passport to upload one.'
                                            : '设置头像需要有效会员资格。激活通行证后即可上传。')}
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
                                        <button className="profile-name-pencil" onClick={startEditingName} type="button"
                                                aria-label="Edit name">
                                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                                                 strokeLinecap="round" strokeLinejoin="round">
                                                <path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/>
                                            </svg>
                                        </button>
                                    )}
                                </>
                            )}
                        </div>
                        {isOwnProfile && 'email' in dp && <p className="profile-email">{dp.email}</p>}
                        <p className="profile-joined">
                            {isEnglish ? 'Joined ' : '加入时间：'}
                            {dp.joinedAt.toLocaleDateString(isEnglish ? 'en-US' : 'zh-CN', {
                                year: 'numeric', month: 'long', day: 'numeric',
                            })}
                        </p>
                        <span className="profile-group-tag" data-group={dp.group}>
                            {formatGroupWithTitle(dp.group, dp.title, dp.titleCn, isEnglish)}
                            {/* Membership is not a group, so it rides on the chip as a star
                                instead of replacing the label — a president can be a member too. */}
                            {memberLabel && (
                                <span
                                    className="profile-member-star"
                                    role="img"
                                    aria-label={memberLabel}
                                    tabIndex={0}
                                >
                                    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                                        <path
                                            d="M12 17.27 18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"/>
                                    </svg>
                                    <span className="profile-member-tooltip">{memberLabel}</span>
                                </span>
                            )}
                        </span>
                    </div>
                </div>

                <div className="profile-stats">
                    {earnedBadges.length > 0 && (
                        <div className="profile-stat">
                            <span className="profile-stat-number">{earnedBadges.length}</span>
                            <span className="profile-stat-label">{isEnglish ? 'Badges' : '徽章'}</span>
                        </div>
                    )}
                    <div className="profile-stat">
                        <span className="profile-stat-number">{attendedEvents.length}</span>
                        <span className="profile-stat-label">{isEnglish ? 'Events Attended' : '参与活动'}</span>
                    </div>
                </div>

                {badgeLoadError && dp.badges.length > 0 && (
                    <p className="profile-load-error">
                        {isEnglish ? 'Failed to load badge details.' : '加载徽章详情失败。'}
                    </p>
                )}
                {!badgeLoadError && earnedBadges.length > 0 ? (
                    <section className="badge-section">
                        <h2 className="badge-section-title">
                            {isEnglish ? 'Badges' : '徽章'}
                        </h2>
                        <div className="badge-grid" ref={badgeGridRef}>
                            {earnedBadges.map(badge => (
                                <BadgeCard
                                    key={badge.id}
                                    badge={badge}
                                    earnedDate={earnedDates[badge.id]}
                                    isEnglish={isEnglish}
                                    active={activeBadge === badge.id}
                                    onToggle={() => toggleBadge(badge)}
                                />
                            ))}
                        </div>
                    </section>
                ) : !badgeLoadError && earnedBadges.length === 0 && (
                    <section className="badge-section">
                        <h2 className="badge-section-title">
                            {isEnglish ? 'Badges' : '徽章'}
                        </h2>
                        <p className="profile-empty-state">
                            {isEnglish
                                ? 'No badges yet — attend events and complete challenges to earn your first!'
                                : '还没有徽章——参加活动和完成挑战来获得你的第一枚徽章吧！'}
                        </p>
                    </section>
                )}

                {attendedEvents.length > 0 ? (
                    <section className="badge-section">
                        <h2 className="badge-section-title">
                            {isEnglish ? 'Events Attended' : '参与活动'}
                        </h2>
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
                    </section>
                ) : (
                    <section className="badge-section">
                        <h2 className="badge-section-title">
                            {isEnglish ? 'Events Attended' : '参与活动'}
                        </h2>
                        <p className="profile-empty-state">
                            {isEnglish
                                ? 'No events attended yet — check out our upcoming events and join one!'
                                : '还没有参加过活动——看看即将到来的活动，来参加一场吧！'}
                        </p>
                    </section>
                )}
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
        </>
    );
};
