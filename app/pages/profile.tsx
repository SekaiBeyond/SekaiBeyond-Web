import { useEffect, useRef, useState } from 'react';
import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore';
import { GROUP_LABELS, hasPermission, useAuth, type UserGroup } from '~/components/AuthProvider';
import { LoginButton } from '~/components/LoginButton';
import { useLanguage } from '~/components/LanguageContextProvider';
import { getFirebaseDb } from '~/lib/firebase';
import { LanguageSwitcher } from '~/components/LanguageSwitcher';
import { type PastEvent, usePastEvents } from '~/lib/pastEvents';
import { useSearchParams } from 'react-router';

interface BadgeDef {
    id: string;
    name: string;
    nameCn: string;
    description: string;
    descriptionCn: string;
    imageUrl: string;
    holderPct?: number;
    createdByUid?: string;
    createdByName?: string;
    createdByLink?: string;
}

interface ViewedProfile {
    displayName: string;
    email: string;
    photoURL: string;
    joinedAt: Date;
    attendedEvents: string[];
    badges: string[];
    group: UserGroup;
}

const BadgeCard = ({badge, earned, earnedDate, isEnglish}: {
    badge: BadgeDef;
    earned: boolean;
    earnedDate?: Date;
    isEnglish: boolean;
}) => (
    <div className={`badge-card ${earned ? 'badge-earned' : 'badge-locked'}`}>
        <div className="badge-icon-wrapper">
            <img src={badge.imageUrl} alt={isEnglish ? badge.name : badge.nameCn} className="badge-icon"/>
            {earned && <span className="badge-check">&#10003;</span>}
            {!earned && <span className="badge-lock">&#128274;</span>}
        </div>
        <div className="badge-info">
            <h3 className="badge-title">{isEnglish ? badge.name : badge.nameCn}</h3>
            <p className="badge-description">
                {isEnglish ? badge.description : badge.descriptionCn}
            </p>
        </div>
        <div className="badge-tooltip">
            <h4 className="badge-tooltip-name">{isEnglish ? badge.name : badge.nameCn}</h4>
            <p className="badge-tooltip-desc">{isEnglish ? badge.description : badge.descriptionCn}</p>
            {earned && earnedDate && (
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
                    ) : badge.createdByLink ? (
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

const EventCard = ({event, attended, isEnglish, showAdminLink}: {
    event: PastEvent;
    attended: boolean;
    isEnglish: boolean;
    showAdminLink?: boolean;
}) => (
    <div className={`profile-event-card ${attended ? 'profile-event-earned' : 'profile-event-locked'}`}>
        <div className="profile-event-icon-wrapper">
            <img src={event.icon} alt={isEnglish ? event.title : event.titleCn} className="profile-event-icon"/>
            {attended && <span className="profile-event-check">&#10003;</span>}
            {!attended && <span className="profile-event-lock">&#128274;</span>}
        </div>
        <div className="profile-event-info">
            <span className="profile-event-category">{isEnglish ? event.badge : event.badgeCn}</span>
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
    const fileInputRef = useRef<HTMLInputElement>(null);
    const nameInputRef = useRef<HTMLInputElement>(null);
    const [badgeDefs, setBadgeDefs] = useState<BadgeDef[]>([]);
    const [earnedDates, setEarnedDates] = useState<Record<string, Date>>({});

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
                if (!stale) console.error('Failed to load badges:', err);
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
                const db = getFirebaseDb();
                const snap = await getDoc(doc(db, 'users', viewUid));
                if (stale) return;
                if (snap.exists()) {
                    const data = snap.data();
                    setViewedProfile({
                        displayName: data.displayName ?? '',
                        email: data.email ?? '',
                        photoURL: data.photoURL ?? '',
                        joinedAt: data.joinedAt?.toDate() ?? new Date(),
                        attendedEvents: data.attendedEvents ?? [],
                        badges: data.badges ?? [],
                        group: data.group ?? 'visitor',
                    });
                }
            } catch (err) {
                if (!stale) console.error('Failed to load user profile:', err);
            } finally {
                if (!stale) setLoadingViewed(false);
            }
        };
        void loadViewedUser();
        return () => {
            stale = true;
        };
    }, [viewUid, isViewingOther]);

    const targetUid = isViewingOther ? viewUid : user?.uid;

    useEffect(() => {
        if (!targetUid) return;
        let stale = false;
        const loadEarnedDates = async () => {
            try {
                const db = getFirebaseDb();
                const q = query(
                    collection(db, 'records'),
                    where('targetUid', '==', targetUid)
                );
                const snapshot = await getDocs(q);
                if (stale) return;
                const dates: Record<string, Date> = {};
                snapshot.forEach(docSnap => {
                    const data = docSnap.data();
                    if (data.type === 'achievement-grant' && data.badgeId && data.timestamp) {
                        dates[data.badgeId] = data.timestamp.toDate();
                    }
                });
                setEarnedDates(dates);
            } catch (err) {
                if (!stale) console.error('Failed to load earned dates:', err);
            }
        };
        void loadEarnedDates();
        return () => {
            stale = true;
        };
    }, [targetUid]);

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

    const handlePhotoSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file || !profile || !user) return;
        setSavingPhoto(true);
        try {
            await updateProfile({photoFile: file});
            setCustomPhotoLoaded(true);
        } catch (err) {
            console.error('Failed to update photo:', err);
        } finally {
            setSavingPhoto(false);
            if (fileInputRef.current) fileInputRef.current.value = '';
        }
    };

    const handlePhotoDelete = async () => {
        if (!profile || !user) return;
        setSavingPhoto(true);
        try {
            await updateProfile({deletePhoto: true});
            setCustomPhotoLoaded(false);
        } catch (err) {
            console.error('Failed to delete photo:', err);
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
            console.error('Failed to update name:', err);
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
            email: viewedProfile!.email,
            joinedAt: viewedProfile!.joinedAt,
            badges: viewedProfile!.badges,
            attendedEvents: viewedProfile!.attendedEvents,
            group: viewedProfile!.group
        };
    const attendedSet = new Set(dp.attendedEvents);
    const attendedCount = pastEvents.filter(e => attendedSet.has(e.id)).length;
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
                                        onBlur={handleSaveName}
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
                        {isOwnProfile && <p className="profile-email">{dp.email}</p>}
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
                    {badgeDefs.length > 0 && (
                        <div className="profile-stat">
                            <span className="profile-stat-number">
                                {badgeDefs.filter(b => dp.badges.includes(b.id)).length}
                            </span>
                            <span className="profile-stat-label">{isEnglish ? 'Badges' : '徽章'}</span>
                        </div>
                    )}
                    <div className="profile-stat">
                        <span className="profile-stat-number">{attendedCount}/{pastEvents.length}</span>
                        <span className="profile-stat-label">{isEnglish ? 'Events Attended' : '参与活动'}</span>
                    </div>
                </div>

                {badgeDefs.length > 0 && (
                    <section className="badge-section">
                        <h2 className="badge-section-title">
                            {isEnglish ? 'Badges' : '徽章'}
                        </h2>
                        {isOwnProfile && (
                            <p className="badge-section-subtitle">
                                {isEnglish
                                    ? 'Earn badges through challenges and special events!'
                                    : '通过挑战和特别活动赢取徽章！'}
                            </p>
                        )}
                        <div className="badge-grid">
                            {badgeDefs.map(badge => (
                                <BadgeCard
                                    key={badge.id}
                                    badge={badge}
                                    earned={dp.badges.includes(badge.id)}
                                    earnedDate={earnedDates[badge.id]}
                                    isEnglish={isEnglish}
                                />
                            ))}
                        </div>
                    </section>
                )}

                <section className="badge-section">
                    <h2 className="badge-section-title">
                        {isEnglish ? 'Events Attended' : '参与活动'}
                    </h2>
                    {isOwnProfile && (
                        <p className="badge-section-subtitle">
                            {isEnglish
                                ? 'Attend events and scan QR codes to check in'
                                : '参加活动并扫码签到'}
                        </p>
                    )}
                    <div className="badge-grid">
                        {pastEvents.map(event => (
                            <EventCard
                                key={event.id}
                                event={event}
                                attended={attendedSet.has(event.id)}
                                isEnglish={isEnglish}
                                showAdminLink={isStaff}
                            />
                        ))}
                    </div>
                </section>
            </div>
        </>
    );
};
