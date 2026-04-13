import { useEffect, useMemo, useRef, useState } from 'react';
import { collection, getDocs } from 'firebase/firestore';
import { GROUP_LABELS, hasPermission, useAuth, type UserGroup } from '~/components/AuthProvider';
import { LoginButton } from '~/components/LoginButton';
import { useLanguage } from '~/components/LanguageContextProvider';
import { callGetPublicProfile, getFirebaseDb } from '~/lib/firebase';
import { LanguageSwitcher } from '~/components/LanguageSwitcher';
import { type PastEvent, usePastEvents } from '~/lib/pastEvents';
import { useTags } from '~/lib/tags';
import { useSearchParams } from 'react-router';
import type { BadgeDef as BaseBadgeDef } from '~/lib/types';
import { isValidHttpUrl } from '~/pages/admin/utils';
import { ImageCropModal } from '~/pages/admin/ImageCropModal';

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
    badges: string[];
    badgeEarnedAt: Record<string, Date>;
    group: UserGroup;
}

const BadgeCard = ({badge, earnedDate, isEnglish}: {
    badge: BadgeDef;
    earnedDate?: Date;
    isEnglish: boolean;
}) => (
    <div className="badge-circle">
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

const EventCard = ({event, isEnglish, showAdminLink, tagLabel}: {
    event: PastEvent;
    isEnglish: boolean;
    showAdminLink?: boolean;
    tagLabel?: string;
}) => (
    <div className="profile-event-card">
        <div className="profile-event-icon-wrapper">
            <img src={event.icon} alt={isEnglish ? event.title : event.titleCn} className="profile-event-icon"/>
        </div>
        <div className="profile-event-info">
            <span className="profile-event-category">{tagLabel ?? ''}</span>
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
    const {user, profile, loading, signIn, updateProfile} = useAuth();
    const {isEnglish} = useLanguage();
    const {pastEvents, loading: eventsLoading} = usePastEvents();
    const {tags} = useTags();
    const [searchParams] = useSearchParams();
    const viewUid = searchParams.get('uid');
    const isViewingOther = !!viewUid && viewUid !== user?.uid;
    const [viewedProfile, setViewedProfile] = useState<ViewedProfile | null>(null);
    const [loadingViewed, setLoadingViewed] = useState(false);
    const [editingName, setEditingName] = useState(false);
    const [editName, setEditName] = useState('');
    const [savingName, setSavingName] = useState(false);
    const [savingPhoto, setSavingPhoto] = useState(false);
    const [customPhotoLoaded, setCustomPhotoLoaded] = useState(false);
    const [pendingPhoto, setPendingPhoto] = useState<File | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const nameInputRef = useRef<HTMLInputElement>(null);
    const [badgeDefs, setBadgeDefs] = useState<BadgeDef[]>([]);

    useEffect(() => {
        let stale = false;
        const loadBadges = async () => {
            try {
                const db = getFirebaseDb();
                const snapshot = await getDocs(collection(db, 'badges'));
                if (stale) return;
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
                        holderPct: data.holderPct,
                        createdByUid: data.createdByUid ?? '',
                        createdByName: data.createdByName ?? '',
                        createdByLink: data.createdByLink ?? '',
                    });
                });
                setBadgeDefs(defs);
            } catch (err) {
                void (stale || err);
            }
        };
        void loadBadges();
        return () => {
            stale = true;
        };
    }, []);

    useEffect(() => {
        if (!viewUid || !isViewingOther) {
            setViewedProfile(null);
            setLoadingViewed(false);
            return;
        }
        let stale = false;
        setLoadingViewed(true);
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
                    badges: data.badges ?? [],
                    badgeEarnedAt: earnedAt,
                    group: (data.group ?? 'visitor') as UserGroup,
                });
            } catch (err) {
                void (stale || err);
            } finally {
                if (!stale) setLoadingViewed(false);
            }
        };
        void loadViewedUser();
        return () => {
            stale = true;
        };
    }, [viewUid, isViewingOther]);

    const earnedDates = useMemo<Record<string, Date>>(
        () => (isViewingOther ? viewedProfile?.badgeEarnedAt : profile?.badgeEarnedAt) ?? {},
        [isViewingOther, viewedProfile, profile],
    );

    const hasCustomPhoto = profile?.photoURL.includes('firebasestorage.googleapis.com') ?? false;

    useEffect(() => {
        if (!hasCustomPhoto || !profile) {
            setCustomPhotoLoaded(false);
            return;
        }
        const img = new Image();
        img.onload = () => setCustomPhotoLoaded(true);
        img.onerror = () => setCustomPhotoLoaded(false);
        img.src = profile.photoURL;
    }, [profile?.photoURL, hasCustomPhoto]);

    const startEditingName = () => {
        if (!profile) return;
        setEditName(profile.displayName);
        setEditingName(true);
        setTimeout(() => nameInputRef.current?.focus(), 0);
    };

    const cancelEditingName = () => {
        setEditingName(false);
    };

    const MAX_RAW_PHOTO_SIZE = 25 * 1024 * 1024; // 25 MB, pre-crop browser-side sanity cap

    const handlePhotoSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (fileInputRef.current) fileInputRef.current.value = '';
        if (!file || !profile || !user) return;
        if (!file.type.startsWith('image/')) {
            alert(isEnglish ? 'Please select an image file.' : '请选择图片文件。');
            return;
        }
        if (file.size > MAX_RAW_PHOTO_SIZE) {
            alert(isEnglish ? 'Image must be under 25 MB.' : '图片大小不能超过 25 MB。');
            return;
        }
        setPendingPhoto(file);
    };

    const handlePhotoCropConfirm = async (cropped: File) => {
        setPendingPhoto(null);
        if (!profile || !user) return;
        setSavingPhoto(true);
        try {
            await updateProfile({photoFile: cropped});
            setCustomPhotoLoaded(true);
        } catch (err) {
            void err;
        } finally {
            setSavingPhoto(false);
        }
    };

    const handlePhotoDelete = async () => {
        if (!profile || !user) return;
        setSavingPhoto(true);
        try {
            await updateProfile({deletePhoto: true});
            setCustomPhotoLoaded(false);
        } catch (err) {
            void err;
        } finally {
            setSavingPhoto(false);
        }
    };

    const handleSaveName = async () => {
        if (!profile || !editName.trim() || savingName || !editingName) return;
        if (editName === profile.displayName) {
            setEditingName(false);
            return;
        }
        setSavingName(true);
        try {
            await updateProfile({displayName: editName});
            setEditingName(false);
        } catch (err) {
            void err;
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
                    <h2>{isEnglish ? 'User not found' : '未找到用户'}</h2>
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
            group: profile!.group
        }
        : {
            name: viewedProfile!.displayName,
            joinedAt: viewedProfile!.joinedAt,
            badges: viewedProfile!.badges,
            attendedEvents: viewedProfile!.attendedEvents,
            group: viewedProfile!.group
        };
    const attendedSet = new Set(dp.attendedEvents);
    const attendedEvents = pastEvents.filter(e => attendedSet.has(e.id));
    const earnedBadges = badgeDefs.filter(b => dp.badges.includes(b.id));
    const canEdit = isOwnProfile && profile!.group !== 'visitor';
    const isStaff = isOwnProfile && hasPermission(profile!.group, 'staff');

    return (
        <>
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
                    <div className={`profile-avatar-wrapper ${canEdit ? 'profile-avatar-clickable' : ''}`}>
                        <img
                            src={displayedPhoto}
                            alt={dp.name}
                            className="profile-avatar"
                            referrerPolicy="no-referrer"
                            onClick={canEdit ? () => !savingPhoto && fileInputRef.current?.click() : undefined}
                        />
                        {canEdit && (
                            <>
                                <div
                                    className="profile-avatar-overlay"
                                    onClick={() => !savingPhoto && fileInputRef.current?.click()}
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
                                {hasCustomPhoto && !savingPhoto && (
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
                                <input
                                    ref={fileInputRef}
                                    type="file"
                                    accept="image/*"
                                    onChange={handlePhotoSelect}
                                    hidden
                                />
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
                                        onBlur={() => requestAnimationFrame(() => handleSaveName())}
                                        maxLength={50}
                                        disabled={savingName}
                                    />
                                    {savingName && <span
                                        className="profile-name-saving">{isEnglish ? 'Saving...' : '保存中...'}</span>}
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
                            {isEnglish ? GROUP_LABELS[dp.group].en : GROUP_LABELS[dp.group].zh}
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

                {earnedBadges.length > 0 && (
                    <section className="badge-section">
                        <h2 className="badge-section-title">
                            {isEnglish ? 'Badges' : '徽章'}
                        </h2>
                        <div className="badge-grid">
                            {earnedBadges.map(badge => (
                                <BadgeCard
                                    key={badge.id}
                                    badge={badge}
                                    earnedDate={earnedDates[badge.id]}
                                    isEnglish={isEnglish}
                                />
                            ))}
                        </div>
                    </section>
                )}

                {attendedEvents.length > 0 && (
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
                                    tagLabel={(() => {
                                        const tag = tags.find(t => t.id === event.tagId);
                                        return tag ? (isEnglish ? tag.name : tag.nameCn) : '';
                                    })()}
                                />
                            ))}
                        </div>
                    </section>
                )}
            </div>
            {pendingPhoto && (
                <ImageCropModal
                    file={pendingPhoto}
                    aspect={1}
                    onConfirm={handlePhotoCropConfirm}
                    onCancel={() => setPendingPhoto(null)}
                />
            )}
        </>
    );
};
