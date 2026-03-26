import { useEffect, useRef, useState } from 'react';
import { collection, getDocs } from 'firebase/firestore';
import { GROUP_LABELS, useAuth } from '~/components/AuthProvider';
import { LoginButton } from '~/components/LoginButton';
import { useLanguage } from '~/components/LanguageContextProvider';
import { getFirebaseDb } from '~/lib/firebase';
import { LanguageSwitcher } from '~/components/LanguageSwitcher';
import { PAST_EVENTS, type PastEvent } from '~/constants';

interface BadgeDef {
    id: string;
    name: string;
    nameCn: string;
    description: string;
    descriptionCn: string;
    imageUrl: string;
}

export const ProfilePage = () => {
    const {user, profile, loading, signIn, signOut, updateProfile} = useAuth();
    const {isEnglish} = useLanguage();
    const [editing, setEditing] = useState(false);
    const [editName, setEditName] = useState('');
    const [previewURL, setPreviewURL] = useState<string | null>(null);
    const [photoFile, setPhotoFile] = useState<File | null>(null);
    const [saving, setSaving] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [badgeDefs, setBadgeDefs] = useState<BadgeDef[]>([]);

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
                });
            });
            setBadgeDefs(defs);
        };
        loadBadges();
    }, []);

    const startEditing = () => {
        if (!profile) return;
        setEditName(profile.displayName);
        setPreviewURL(null);
        setPhotoFile(null);
        setEditing(true);
    };

    const cancelEditing = () => {
        setEditing(false);
        setPreviewURL(null);
        setPhotoFile(null);
    };

    const handlePhotoSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        setPhotoFile(file);
        setPreviewURL(URL.createObjectURL(file));
    };

    const handleSave = async () => {
        if (!profile) return;
        setSaving(true);
        try {
            await updateProfile({
                displayName: editName !== profile.displayName ? editName : undefined,
                photoFile: photoFile ?? undefined,
            });
            setEditing(false);
            setPreviewURL(null);
            setPhotoFile(null);
        } finally {
            setSaving(false);
        }
    };

    if (loading) {
        return (
            <div className="profile-loading">
                <div className="profile-spinner"/>
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
                    <div className="profile-avatar-wrapper">
                        <img
                            src={previewURL ?? profile.photoURL}
                            alt={profile.displayName}
                            className="profile-avatar"
                            referrerPolicy="no-referrer"
                        />
                        {editing && profile.group !== 'visitor' && (
                            <>
                                <button
                                    className="profile-avatar-edit"
                                    onClick={() => fileInputRef.current?.click()}
                                    type="button"
                                >
                                    {isEnglish ? 'Change' : '更换'}
                                </button>
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
                        {editing ? (
                            <input
                                className="profile-name-input"
                                value={editName}
                                onChange={e => setEditName(e.target.value)}
                                maxLength={50}
                            />
                        ) : (
                            <h1 className="profile-name">{profile.displayName}</h1>
                        )}
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
                        <div className="profile-edit-actions">
                            {editing ? (
                                <>
                                    <button
                                        className="profile-save-btn"
                                        onClick={handleSave}
                                        disabled={saving || !editName.trim()}
                                    >
                                        {saving
                                            ? (isEnglish ? 'Saving...' : '保存中...')
                                            : (isEnglish ? 'Save' : '保存')}
                                    </button>
                                    <button
                                        className="profile-cancel-btn"
                                        onClick={cancelEditing}
                                        disabled={saving}
                                    >
                                        {isEnglish ? 'Cancel' : '取消'}
                                    </button>
                                </>
                            ) : (
                                <button className="profile-edit-btn" onClick={startEditing}>
                                    {isEnglish ? 'Edit Profile' : '编辑资料'}
                                </button>
                            )}
                        </div>
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
                                            <img
                                                src={badge.imageUrl}
                                                alt={isEnglish ? badge.name : badge.nameCn}
                                                className="badge-icon"
                                                loading="lazy"
                                            />
                                            {earned && <span className="badge-check">&#10003;</span>}
                                            {!earned && <span className="badge-lock">&#128274;</span>}
                                        </div>
                                        <div className="badge-info">
                                            <h3 className="badge-title">{isEnglish ? badge.name : badge.nameCn}</h3>
                                            <p className="badge-description">
                                                {isEnglish ? badge.description : badge.descriptionCn}
                                            </p>
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
                                        <img
                                            src={event.icon}
                                            alt={isEnglish ? event.title : event.titleCn}
                                            className="badge-icon"
                                            loading="lazy"
                                        />
                                        {attended && <span className="badge-check">&#10003;</span>}
                                        {!attended && <span className="badge-lock">&#128274;</span>}
                                    </div>
                                    <div className="badge-info">
                                        <span
                                            className="badge-category">{isEnglish ? event.badge : event.badgeCn}</span>
                                        <h3 className="badge-title">{isEnglish ? event.title : event.titleCn}</h3>
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
