import { useEffect, useRef, useState } from 'react';
import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore';
import { GROUP_LABELS, useAuth, type UserGroup } from '~/components/AuthProvider';
import { LoginButton } from '~/components/LoginButton';
import { useLanguage } from '~/components/LanguageContextProvider';
import { getFirebaseDb } from '~/lib/firebase';
import { LanguageSwitcher } from '~/components/LanguageSwitcher';
import { PAST_EVENTS, type PastEvent } from '~/constants';
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

export const ProfilePage = () => {
    const {user, profile, loading, signIn, updateProfile} = useAuth();
    const {isEnglish} = useLanguage();
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
        const loadBadges = async () => {
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
                    holderPct: data.holderPct,
                    createdByUid: data.createdByUid ?? '',
                    createdByName: data.createdByName ?? '',
                    createdByLink: data.createdByLink ?? '',
                });
            });
            setBadgeDefs(defs);
        };
        loadBadges().then();
    }, []);

    useEffect(() => {
        if (!viewUid || !isViewingOther) {
            setViewedProfile(null);
            return;
        }
        setLoadingViewed(true);
        const loadViewedUser = async () => {
            const db = getFirebaseDb();
            const snap = await getDoc(doc(db, 'users', viewUid));
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
            setLoadingViewed(false);
        };
        loadViewedUser().then();
    }, [viewUid, isViewingOther]);

    const targetUid = isViewingOther ? viewUid : user?.uid;

    useEffect(() => {
        if (!targetUid) return;
        const loadEarnedDates = async () => {
            const db = getFirebaseDb();
            const q = query(
                collection(db, 'records'),
                where('targetUid', '==', targetUid)
            );
            const snapshot = await getDocs(q);
            const dates: Record<string, Date> = {};
            snapshot.forEach(docSnap => {
                const data = docSnap.data();
                if (data.type === 'achievement-grant' && data.badgeId && data.timestamp) {
                    dates[data.badgeId] = data.timestamp.toDate();
                }
            });
            setEarnedDates(dates);
        };
        loadEarnedDates().then();
    }, [targetUid]);

    // Preload a custom (Firebase Storage) photo in the background; show the Google photo until ready
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
        } finally {
            setSavingPhoto(false);
        }
    };

    const handleSaveName = async () => {
        if (!profile || !editName.trim()) return;
        if (editName === profile.displayName) {
            setEditingName(false);
            return;
        }
        setSavingName(true);
        try {
            await updateProfile({displayName: editName});
            setEditingName(false);
        } finally {
            setSavingName(false);
        }
    };

    const handleNameKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') handleSaveName().then();
        if (e.key === 'Escape') cancelEditingName();
    };

    if (loading || loadingViewed) {
        return (
            <div className="profile-loading">
                <div className="profile-spinner"/>
            </div>
        );
    }

    if (isViewingOther && viewedProfile) {
        const vAttendedSet = new Set(viewedProfile.attendedEvents);
        const vAttendedCount = PAST_EVENTS.filter(e => vAttendedSet.has(e.title)).length;
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
                        <div className="profile-avatar-wrapper">
                            <img
                                src={viewedProfile.photoURL}
                                alt={viewedProfile.displayName}
                                className="profile-avatar"
                                referrerPolicy="no-referrer"
                            />
                        </div>
                        <div className="profile-info">
                            <div className="profile-name-row">
                                <h1 className="profile-name">{viewedProfile.displayName}</h1>
                            </div>
                            <p className="profile-joined">
                                {isEnglish ? 'Joined ' : '加入时间：'}
                                {viewedProfile.joinedAt.toLocaleDateString(isEnglish ? 'en-US' : 'zh-CN', {
                                    year: 'numeric', month: 'long', day: 'numeric',
                                })}
                            </p>
                            <span className="profile-group-tag" data-group={viewedProfile.group}>
                                {isEnglish ? GROUP_LABELS[viewedProfile.group].en : GROUP_LABELS[viewedProfile.group].zh}
                            </span>
                        </div>
                    </div>

                    <div className="profile-stats">
                        {badgeDefs.length > 0 && (
                            <div className="profile-stat">
                                <span className="profile-stat-number">
                                    {badgeDefs.filter(b => viewedProfile.badges.includes(b.id)).length}
                                </span>
                                <span className="profile-stat-label">{isEnglish ? 'Badges' : '徽章'}</span>
                            </div>
                        )}
                        <div className="profile-stat">
                            <span className="profile-stat-number">{vAttendedCount}/{PAST_EVENTS.length}</span>
                            <span className="profile-stat-label">{isEnglish ? 'Events Attended' : '参与活动'}</span>
                        </div>
                    </div>

                    {badgeDefs.length > 0 && (
                        <section className="badge-section">
                            <h2 className="badge-section-title">{isEnglish ? 'Badges' : '徽章'}</h2>
                            <div className="badge-grid">
                                {badgeDefs.map((badge: BadgeDef) => {
                                    const earned = viewedProfile.badges.includes(badge.id);
                                    return (
                                        <div key={badge.id}
                                             className={`badge-card ${earned ? 'badge-earned' : 'badge-locked'}`}>
                                            <div className="badge-icon-wrapper">
                                                <img src={badge.imageUrl}
                                                     alt={isEnglish ? badge.name : badge.nameCn}
                                                     className="badge-icon"/>
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
                                                <h4 className="badge-tooltip-name">
                                                    {isEnglish ? badge.name : badge.nameCn}
                                                </h4>
                                                <p className="badge-tooltip-desc">
                                                    {isEnglish ? badge.description : badge.descriptionCn}
                                                </p>
                                                {earned && earnedDates[badge.id] && (
                                                    <p className="badge-tooltip-date">
                                                        {isEnglish ? 'Earned: ' : '获得于：'}
                                                        {earnedDates[badge.id].toLocaleDateString(
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
                                })}
                            </div>
                        </section>
                    )}

                    <section className="badge-section">
                        <h2 className="badge-section-title">{isEnglish ? 'Events Attended' : '参与活动'}</h2>
                        <div className="badge-grid">
                            {PAST_EVENTS.map((event: PastEvent) => {
                                const attended = vAttendedSet.has(event.title);
                                return (
                                    <div key={event.title}
                                         className={`badge-card ${attended ? 'badge-earned' : 'badge-locked'}`}>
                                        <div className="badge-icon-wrapper">
                                            <img src={event.icon}
                                                 alt={isEnglish ? event.title : event.titleCn}
                                                 className="badge-icon"/>
                                            {attended && <span className="badge-check">&#10003;</span>}
                                            {!attended && <span className="badge-lock">&#128274;</span>}
                                        </div>
                                        <div className="badge-info">
                                            <span
                                                className="badge-category">{isEnglish ? event.badge : event.badgeCn}</span>
                                            <h3 className="badge-title">{isEnglish ? event.title : event.titleCn}</h3>
                                            <p className="badge-date">
                                                {new Date(event.date).toLocaleDateString(isEnglish ? 'en-US' : 'zh-CN', {
                                                    year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC',
                                                })}
                                            </p>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </section>
                </div>
            </>
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

    if (!user || !profile) {
        return (
            <div className="profile-login-prompt">
                <div className="profile-login-card">
                    <h2>{isEnglish ? 'Sign in to view your profile' : '登录以查看你的个人主页'}</h2>
                    <p>{isEnglish
                        ? 'Track your event attendance and earn badges!'
                        : '记录你的活动参与、收集徽章！'}
                    </p>
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

    const googlePhotoURL = user.photoURL ?? '';
    const displayedPhoto = hasCustomPhoto
        ? (customPhotoLoaded ? profile.photoURL : googlePhotoURL)
        : profile.photoURL;
    const attendedSet = new Set(profile.attendedEvents);
    const attendedCount = PAST_EVENTS.filter(e => attendedSet.has(e.title)).length;

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
                    <div
                        className={`profile-avatar-wrapper ${profile.group !== 'visitor' ? 'profile-avatar-clickable' : ''}`}>
                        <img
                            src={displayedPhoto}
                            alt={profile.displayName}
                            className="profile-avatar"
                            referrerPolicy="no-referrer"
                            onClick={() => profile.group !== 'visitor' && !savingPhoto && fileInputRef.current?.click()}
                        />
                        {profile.group !== 'visitor' && (
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
                            </>
                        )}
                        <input
                            ref={fileInputRef}
                            type="file"
                            accept="image/*"
                            onChange={handlePhotoSelect}
                            hidden
                        />
                    </div>
                    <div className="profile-info">
                        <div className="profile-name-row">
                            {editingName ? (
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
                                    <h1 className="profile-name">{profile.displayName}</h1>
                                    {profile.group !== 'visitor' && (
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
                        <p className="profile-email">{profile.email}</p>
                        <p className="profile-joined">
                            {isEnglish ? 'Joined ' : '加入时间：'}
                            {profile.joinedAt.toLocaleDateString(isEnglish ? 'en-US' : 'zh-CN', {
                                year: 'numeric',
                                month: 'long',
                                day: 'numeric',
                            })}
                        </p>
                        <span className="profile-group-tag" data-group={profile.group}>
                            {isEnglish ? GROUP_LABELS[profile.group].en : GROUP_LABELS[profile.group].zh}
                        </span>
                    </div>
                </div>

                <div className="profile-stats">
                    {badgeDefs.length > 0 && (
                        <div className="profile-stat">
                            <span className="profile-stat-number">
                                {badgeDefs.filter(b => profile.badges.includes(b.id)).length}
                            </span>
                            <span className="profile-stat-label">{isEnglish ? 'Badges' : '徽章'}</span>
                        </div>
                    )}
                    <div className="profile-stat">
                        <span className="profile-stat-number">{attendedCount}/{PAST_EVENTS.length}</span>
                        <span className="profile-stat-label">{isEnglish ? 'Events Attended' : '参与活动'}</span>
                    </div>
                </div>

                {badgeDefs.length > 0 && (
                    <section className="badge-section">
                        <h2 className="badge-section-title">
                            {isEnglish ? 'Badges' : '徽章'}
                        </h2>
                        <p className="badge-section-subtitle">
                            {isEnglish
                                ? 'Earn badges through challenges and special events!'
                                : '通过挑战和特别活动赢取徽章！'}
                        </p>

                        <div className="badge-grid">
                            {badgeDefs.map((badge: BadgeDef) => {
                                const earned = profile.badges.includes(badge.id);
                                return (
                                    <div
                                        key={badge.id}
                                        className={`badge-card ${earned ? 'badge-earned' : 'badge-locked'}`}
                                    >
                                        <div className="badge-icon-wrapper">
                                            <img src={badge.imageUrl} alt={isEnglish ? badge.name : badge.nameCn}
                                                 className="badge-icon"/>
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
                                            <h4 className="badge-tooltip-name">
                                                {isEnglish ? badge.name : badge.nameCn}
                                            </h4>
                                            <p className="badge-tooltip-desc">
                                                {isEnglish ? badge.description : badge.descriptionCn}
                                            </p>
                                            {earned && earnedDates[badge.id] && (
                                                <p className="badge-tooltip-date">
                                                    {isEnglish ? 'Earned: ' : '获得于：'}
                                                    {earnedDates[badge.id].toLocaleDateString(
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
                            })}
                        </div>
                    </section>
                )}

                <section className="badge-section">
                    <h2 className="badge-section-title">
                        {isEnglish ? 'Events Attended' : '参与活动'}
                    </h2>
                    <p className="badge-section-subtitle">
                        {isEnglish
                            ? 'Attend events and scan QR codes to check in'
                            : '参加活动并扫码签到'}
                    </p>

                    <div className="badge-grid">
                        {PAST_EVENTS.map((event: PastEvent, index: number) => {
                            const attended = attendedSet.has(event.title);
                            return (
                                <div
                                    key={index}
                                    className={`badge-card ${attended ? 'badge-earned' : 'badge-locked'}`}
                                >
                                    <div className="badge-icon-wrapper">
                                        <img src={event.icon} alt={isEnglish ? event.title : event.titleCn}
                                             className="badge-icon"/>
                                        {attended && <span className="badge-check">&#10003;</span>}
                                        {!attended && <span className="badge-lock">&#128274;</span>}
                                    </div>
                                    <div className="badge-info">
                                        <span
                                            className="badge-category">{isEnglish ? event.badge : event.badgeCn}</span>
                                        <h3 className="badge-title">
                                            <a href={`/admin?tab=events&event=${encodeURIComponent(event.title)}`}
                                               className="badge-title-link">
                                                {isEnglish ? event.title : event.titleCn}
                                            </a>
                                        </h3>
                                        <p className="badge-date">
                                            {new Date(event.date).toLocaleDateString(isEnglish ? 'en-US' : 'zh-CN', {
                                                year: 'numeric',
                                                month: 'short',
                                                day: 'numeric',
                                                timeZone: 'UTC',
                                            })}
                                        </p>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </section>
            </div>
        </>
    );
};
