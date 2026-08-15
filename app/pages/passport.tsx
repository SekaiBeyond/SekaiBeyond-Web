import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router';
import { formatGroupWithTitle, normalizeGroup, useAuth } from '~/components/AuthProvider';
import { LanguageSwitcher } from '~/components/LanguageSwitcher';
import { LoginButton } from '~/components/LoginButton';
import { useLanguage } from '~/components/LanguageContextProvider';
import {
    callClaimPassport,
    callGetPassportPublicProfile,
    functionsErrorCode,
    functionsErrorDetails,
} from '~/lib/firebase';
import {
    ACTIVATION_KEY_LENGTH,
    isPassportCodeShape,
    normalizePassportCode,
    PASSPORT_ID_LENGTH,
    passportName,
    type PassportPublicProfile,
    usePassportDesigns,
    usePassportPrivacy,
} from '~/lib/passports';
import { usePastEvents } from '~/lib/pastEvents';
import { useTags } from '~/lib/tags';
import { type ShowToast, ToastContainer, useToasts } from '~/lib/useToasts';
import { PassportShelfCard } from './PassportShelfSection';
import { BadgeCard, EventCard } from './profile';
import { ExpiredCard } from './qrRedirect';

/**
 * /p/:passportId — the one URL on every passport sticker.
 *
 * What it renders depends on the passport, not on who is looking: an unclaimed
 * sticker is an activation form, a claimed one is its owner's public page (no
 * sign-in required), and a void or unknown code is a dead end. The owner gets an
 * extra management panel on their own passport.
 */
export const PassportPage = () => {
    const {passportId: raw} = useParams();
    const {isEnglish} = useLanguage();
    const passportId = normalizePassportCode(raw ?? '');
    const wellFormed = isPassportCodeShape(passportId, PASSPORT_ID_LENGTH);

    const [result, setResult] = useState<PassportPublicProfile | null>(null);
    const [failed, setFailed] = useState(false);
    // Bumped to re-resolve the sticker (after activating, or after the owner
    // flips visibility). Both bumps come from the owner, whose resolves the
    // server declines to tally — so re-resolving never inflates the scan count.
    const [nonce, setNonce] = useState(0);

    useEffect(() => {
        if (!wellFormed) return;
        let stale = false;
        setResult(null);
        setFailed(false);
        callGetPassportPublicProfile({passportId})
            .then(res => {
                if (!stale) setResult(res.data);
            })
            .catch(() => {
                if (!stale) setFailed(true);
            });
        return () => {
            stale = true;
        };
    }, [passportId, wellFormed, nonce]);

    // A code that can't be a passport id is answered here rather than by the
    // server, which would give the same "invalid" either way.
    if (!wellFormed) return <InvalidPassportCard isError={false}/>;
    if (failed) return <InvalidPassportCard isError={true}/>;

    if (!result) {
        return (
            <PassportShell>
                <div className="passport-loading">
                    <div className="spinner"/>
                </div>
            </PassportShell>
        );
    }

    if (result.status === 'invalid') return <InvalidPassportCard isError={false}/>;

    if (result.status === 'private') {
        return (
            <PassportShell>
                <div className="passport-notice">
                    <div className="passport-notice-icon" aria-hidden="true">🔒</div>
                    <h1 className="passport-notice-title">
                        {isEnglish ? 'This Passport Is Private' : '此通行证已设为私密'}
                    </h1>
                    <p className="passport-notice-text">
                        {isEnglish
                            ? 'Its holder has chosen not to show this page. The passport itself is still valid.'
                            : '持有者选择不公开此页面。通行证本身仍然有效。'}
                    </p>
                    <Link to="/" className="btn btn-primary passport-notice-cta">
                        <span>{isEnglish ? 'Explore Sekai Beyond' : '探索彼世界'}</span>
                        <span>✨</span>
                    </Link>
                </div>
            </PassportShell>
        );
    }

    if (result.status === 'unclaimed') {
        return (
            <ActivationCard
                passportId={passportId}
                year={result.year}
                termDays={result.termDays}
                onActivated={() => setNonce(n => n + 1)}
            />
        );
    }

    return <ClaimedPassport passportId={passportId} data={result} onChanged={() => setNonce(n => n + 1)}/>;
};

/** Nav + page frame, matching the profile and admin pages. */
const PassportShell = ({children}: {children: ReactNode}) => {
    const {isEnglish} = useLanguage();
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
            <div className="passport-page">{children}</div>
        </>
    );
};

/** Unknown, malformed, void, and orphaned all land here — deliberately. */
const InvalidPassportCard = ({isError}: {isError: boolean}) => {
    const {isEnglish} = useLanguage();
    return (
        <ExpiredCard
            isError={isError}
            title={isError
                ? undefined
                : (isEnglish ? 'Passport Not Valid' : '通行证无效')}
            message={isError
                ? undefined
                : (isEnglish
                    ? 'This passport code doesn’t match a passport we can show. Check the code on the sticker, or get in touch if it came with a passport you bought.'
                    : '此通行证编号无法匹配到可显示的通行证。请核对贴纸上的编号；若通行证是您购买的，请联系我们。')}
        />
    );
};

interface ActivationCardProps {
    passportId: string;
    year: number;
    /** What this particular sticker grants — per-passport data, not a constant. */
    termDays: number;
    onActivated: () => void;
}

/**
 * The unclaimed state: sign in, then type the key from the slip packed with the
 * passport. Claiming is one-way — the passport binds to this account for good.
 */
const ActivationCard = ({passportId, year, termDays, onActivated}: ActivationCardProps) => {
    const {isEnglish} = useLanguage();
    const {user, loading: authLoading, signIn, refreshProfile} = useAuth();
    const {designs} = usePassportDesigns();
    const design = designs.find(d => d.year === year);

    const [key, setKey] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [granted, setGranted] = useState<{days: number; expiresAt: string} | null>(null);

    const keyReady = isPassportCodeShape(key, ACTIVATION_KEY_LENGTH);

    const activate = async () => {
        setBusy(true);
        setError(null);
        try {
            const res = await callClaimPassport({passportId, activationCode: key});
            setGranted({days: res.data.daysGranted, expiresAt: res.data.membershipExpiresAt});
            // The membership star and the profile shelf both read the auth
            // profile, so pull the new expiry in straight away.
            refreshProfile().catch(() => {
            });
        } catch (err) {
            setError(activationError(err, isEnglish));
        } finally {
            setBusy(false);
        }
    };

    if (granted) {
        const on = new Date(granted.expiresAt).toLocaleDateString(isEnglish ? 'en-US' : 'zh-CN', {
            year: 'numeric', month: 'long', day: 'numeric',
        });
        return (
            <PassportShell>
                <div className="passport-notice passport-notice--success">
                    <div className="passport-notice-icon" aria-hidden="true">🎉</div>
                    <h1 className="passport-notice-title">
                        {isEnglish ? 'Passport Activated!' : '通行证已激活！'}
                    </h1>
                    <p className="passport-grant">
                        {isEnglish ? `+${granted.days} days of membership` : `会员资格 +${granted.days} 天`}
                    </p>
                    <p className="passport-notice-text">
                        {isEnglish
                            ? `Your membership now runs to ${on}. This passport is yours from here on — anyone who scans it lands on your page.`
                            : `您的会员资格现有效期至 ${on}。此通行证从此归您所有 — 任何人扫描它都会看到您的页面。`}
                    </p>
                    <div className="passport-notice-actions">
                        <button className="btn btn-primary" onClick={onActivated} type="button">
                            <span>{isEnglish ? 'View My Passport Page' : '查看我的通行证页面'}</span>
                            <span>✨</span>
                        </button>
                        <a href="/profile" className="profile-back-link">
                            {isEnglish ? 'Go to My Profile' : '前往个人主页'}
                        </a>
                    </div>
                </div>
            </PassportShell>
        );
    }

    return (
        <PassportShell>
            <div className="passport-activate">
                {design?.coverImageUrl && (
                    <img
                        src={design.coverImageUrl}
                        alt={passportName(year, isEnglish)}
                        className="passport-activate-cover"
                    />
                )}
                <h1 className="passport-activate-title">
                    {isEnglish ? 'Activate Your Passport' : '激活您的通行证'}
                </h1>
                <p className="passport-activate-design">{passportName(year, isEnglish)}</p>
                <p className="passport-code">{passportId}</p>

                {authLoading ? (
                    <div className="spinner spinner-centered"/>
                ) : !user ? (
                    <>
                        <p className="passport-notice-text">
                            {isEnglish
                                ? 'Sign in first — a passport is bound to the account that activates it, permanently.'
                                : '请先登录 — 通行证会永久绑定到激活它的账号。'}
                        </p>
                        <button onClick={() => void signIn()} className="profile-sign-in-btn">
                            {isEnglish ? 'Sign in with Google' : '使用 Google 登录'}
                        </button>
                    </>
                ) : (
                    <>
                        <p className="passport-notice-text">
                            {isEnglish
                                ? `Enter the activation key from the slip of paper packed with your passport. It grants ${termDays} days of membership, added on top of any you already have.`
                                : `请输入通行证包装内附纸条上的激活码。激活可获得 ${termDays} 天会员资格，并在您现有会员期限上累加。`}
                        </p>
                        <div className="passport-key-row">
                            <input
                                className="passport-key-input"
                                value={key}
                                onChange={e => setKey(e.target.value.toUpperCase())}
                                onKeyDown={e => {
                                    if (e.key === 'Enter' && keyReady && !busy) void activate();
                                }}
                                placeholder="XXXX-XXXX-XXXX"
                                autoComplete="off"
                                autoCapitalize="characters"
                                spellCheck={false}
                                maxLength={ACTIVATION_KEY_LENGTH + 4}
                                disabled={busy}
                                aria-label={isEnglish ? 'Activation key' : '激活码'}
                            />
                            <button
                                className="btn btn-primary"
                                onClick={() => void activate()}
                                disabled={busy || !keyReady}
                                type="button"
                            >
                                {busy
                                    ? (isEnglish ? 'Activating…' : '激活中…')
                                    : (isEnglish ? 'Activate' : '激活')}
                            </button>
                        </div>
                        <p className="passport-key-hint">
                            {isEnglish
                                ? 'Dashes and capitalisation don’t matter. The key has no letter O or I — those are the digits 0 and 1.'
                                : '横线和大小写无需在意。激活码中不含字母 O 和 I — 相似字符为数字 0 和 1。'}
                        </p>
                        {error && <p className="passport-error">{error}</p>}
                    </>
                )}

                <a href="/" className="profile-back-link">
                    {isEnglish ? 'Back to Home' : '返回首页'}
                </a>
            </div>
        </PassportShell>
    );
};

/** Server rejection → something the holder can act on. */
function activationError(err: unknown, isEnglish: boolean): string {
    const code = functionsErrorCode(err);
    switch (code) {
        case 'bad-key': {
            const details = functionsErrorDetails<{attemptsLeft?: number}>(err);
            const left = details?.attemptsLeft ?? 0;
            if (left <= 0) {
                return isEnglish
                    ? 'That key is not correct. This passport is now locked for a while — please try again later.'
                    : '激活码不正确。此通行证已暂时锁定，请稍后再试。';
            }
            return isEnglish
                ? `That key is not correct. ${left} ${left === 1 ? 'try' : 'tries'} left before this passport locks for a while.`
                : `激活码不正确。还可尝试 ${left} 次，之后通行证将被暂时锁定。`;
        }
        case 'locked':
            return isEnglish
                ? 'Too many incorrect keys. Please wait a few minutes and try again.'
                : '错误次数过多。请等待几分钟后再试。';
        case 'already-claimed':
            return isEnglish
                ? 'This passport has already been activated. Reload the page to see whose it is.'
                : '此通行证已被激活。请刷新页面查看其归属。';
        case 'void':
            return isEnglish
                ? 'This passport has been voided and can’t be activated.'
                : '此通行证已作废，无法激活。';
        case 'no-key':
            return isEnglish
                ? 'This passport has no activation key on file. Please get in touch so we can reissue it.'
                : '此通行证没有对应的激活码记录。请联系我们重新签发。';
        case 'invalid':
            return isEnglish
                ? 'This passport code is not valid.'
                : '此通行证编号无效。';
        case 'no-profile':
            // The sticker is fine — point at the account rather than sending the
            // holder off to retype a code that was never wrong.
            return isEnglish
                ? 'Your account isn’t set up yet. Please sign out and back in, then try again.'
                : '您的账号尚未完成设置。请退出登录后重新登录，然后再试。';
        case 'rate-limited':
            return isEnglish
                ? 'Too many requests. Please wait a moment and try again.'
                : '请求过于频繁，请稍后再试。';
        default:
            return isEnglish
                ? 'Could not activate this passport. Please try again.'
                : '无法激活此通行证，请重试。';
    }
}

interface ClaimedPassportProps {
    passportId: string;
    data: Extract<PassportPublicProfile, {status: 'claimed'}>;
    onChanged: () => void;
}

/** The owner's public page. Renders for signed-out visitors — no login wall. */
const ClaimedPassport = ({passportId, data, onChanged}: ClaimedPassportProps) => {
    const {isEnglish} = useLanguage();
    const {designs} = usePassportDesigns();
    const {pastEvents} = usePastEvents();
    const {tags} = useTags();
    const {toasts, showToast} = useToasts();
    const [activeBadge, setActiveBadge] = useState<string | null>(null);

    const {owner} = data;
    const design = designs.find(d => d.year === data.year);
    const tagMap = useMemo(() => new Map(tags.map(t => [t.id, t])), [tags]);

    useEffect(() => {
        if (!owner.displayName) return;
        document.title = `${owner.displayName} | Sekai Beyond`;
        return () => {
            document.title = 'Passport | Sekai Beyond';
        };
    }, [owner.displayName]);

    const staffedSet = useMemo(() => new Set(owner.eventStaffEvents), [owner.eventStaffEvents]);
    const attendedEvents = useMemo(() => {
        const attended = new Set([...owner.attendedEvents, ...owner.eventStaffEvents]);
        return pastEvents.filter(e => attended.has(e.id));
    }, [pastEvents, owner.attendedEvents, owner.eventStaffEvents]);

    const fmtDate = (iso: string | null): string => {
        if (!iso) return '';
        const d = new Date(iso);
        return isNaN(d.getTime()) ? '' : d.toLocaleDateString(isEnglish ? 'en-US' : 'zh-CN', {
            year: 'numeric', month: 'long', day: 'numeric',
        });
    };

    const claimedOn = fmtDate(data.claimedAt);
    const group = normalizeGroup(owner.group);

    return (
        <>
            <ToastContainer toasts={toasts}/>
            <PassportShell>
                <div className="passport-hero">
                    {design?.coverImageUrl && (
                        <img
                            src={design.coverImageUrl}
                            alt={passportName(data.year, isEnglish)}
                            className="passport-hero-cover"
                        />
                    )}
                    <div className="passport-hero-body">
                        <span className="passport-hero-eyebrow">
                            {isEnglish ? 'Sekai Beyond Passport' : '彼世界通行证'}
                        </span>
                        <h1 className="passport-hero-title">{passportName(data.year, isEnglish)}</h1>
                        <p className="passport-code passport-code--sm">{passportId}</p>
                    </div>
                </div>

                <div className="passport-owner">
                    {owner.photoURL ? (
                        <img
                            src={owner.photoURL}
                            alt={owner.displayName}
                            className="passport-owner-avatar"
                            referrerPolicy="no-referrer"
                        />
                    ) : (
                        <div className="passport-owner-avatar passport-owner-avatar--initials">
                            {(owner.displayName[0] ?? '?').toUpperCase()}
                        </div>
                    )}
                    <div className="passport-owner-info">
                        <h2 className="passport-owner-name">{owner.displayName}</h2>
                        <span className="profile-group-tag" data-group={group}>
                            {formatGroupWithTitle(group, owner.title, owner.titleCn, isEnglish)}
                        </span>
                        <div className="passport-chips">
                            <span className={`passport-chip${owner.isMember ? ' passport-chip--member' : ''}`}>
                                {owner.isMember
                                    ? (isEnglish ? '★ Member' : '★ 会员')
                                    : (isEnglish ? 'Membership lapsed' : '会员资格已过期')}
                            </span>
                            {claimedOn && (
                                <span className="passport-chip">
                                    {isEnglish ? `Held since ${claimedOn}` : `持有自 ${claimedOn}`}
                                </span>
                            )}
                        </div>
                        {owner.joinedAt && (
                            <p className="passport-owner-joined">
                                {isEnglish ? 'Joined ' : '加入时间：'}{fmtDate(owner.joinedAt)}
                            </p>
                        )}
                    </div>
                </div>

                {data.isOwner && (
                    <OwnerPanel
                        hidden={data.hidden}
                        scanCount={data.scanCount}
                        membershipExpiresAt={data.membershipExpiresAt}
                        onChanged={onChanged}
                        showToast={showToast}
                    />
                )}

                {data.shelf.length > 0 && (
                    <section className="passport-section">
                        <h3 className="passport-section-title">
                            {isEnglish ? 'Passports Collected' : '通行证收藏'}
                        </h3>
                        <div className="passport-shelf">
                            {data.shelf.map((entry, i) => (
                                <PassportShelfCard
                                    key={`${entry.year}-${entry.claimedAt ?? i}`}
                                    year={entry.year}
                                    date={fmtDate(entry.claimedAt)}
                                    current={entry.isCurrent}
                                />
                            ))}
                        </div>
                    </section>
                )}

                {owner.badges.length > 0 && (
                    <section className="passport-section">
                        <h3 className="passport-section-title">{isEnglish ? 'Badges' : '徽章'}</h3>
                        <div className="badge-grid">
                            {owner.badges.map(badge => (
                                <BadgeCard
                                    key={badge.id}
                                    // The public endpoint inlines badge art rather than
                                    // naming a document, and a badge pending deletion is
                                    // simply absent — so there is no deleteAt to carry.
                                    // Empty Chinese copy falls back to the English, which
                                    // a scanner is likelier to find useful than a blank.
                                    badge={{
                                        ...badge,
                                        nameCn: badge.nameCn || badge.name,
                                        descriptionCn: badge.descriptionCn || badge.description,
                                        deleteAt: null,
                                    }}
                                    earnedDate={badge.earnedAt ? new Date(badge.earnedAt) : undefined}
                                    isEnglish={isEnglish}
                                    active={activeBadge === badge.id}
                                    onToggle={() => setActiveBadge(prev => prev === badge.id ? null : badge.id)}
                                />
                            ))}
                        </div>
                    </section>
                )}

                {attendedEvents.length > 0 && (
                    <section className="passport-section">
                        <h3 className="passport-section-title">
                            {isEnglish ? 'Events Attended' : '参与活动'}
                        </h3>
                        <div className="profile-event-grid">
                            {attendedEvents.map(event => (
                                <EventCard
                                    key={event.id}
                                    event={event}
                                    isEnglish={isEnglish}
                                    tagLabels={event.tagIds.flatMap(id => {
                                        const tag = tagMap.get(id);
                                        return tag ? [isEnglish ? tag.name : tag.nameCn] : [];
                                    })}
                                    wasStaff={staffedSet.has(event.id)}
                                />
                            ))}
                        </div>
                    </section>
                )}

                <div className="passport-footer-actions">
                    <a href="/" className="btn btn-primary">
                        <span>{isEnglish ? 'Explore Sekai Beyond' : '探索彼世界'}</span>
                        <span>✨</span>
                    </a>
                </div>
            </PassportShell>
        </>
    );
};

/**
 * Shown only to the owner, scanning their own sticker: how long their membership
 * has left, how often the passport has been scanned, and the visibility switch.
 * Kept behind a disclosure so a passport page stays a passport page.
 */
const OwnerPanel = ({hidden, scanCount, membershipExpiresAt, onChanged, showToast}: {
    hidden: boolean;
    scanCount: number | null;
    membershipExpiresAt: string | null;
    onChanged: () => void;
    showToast: ShowToast;
}) => {
    const {isEnglish} = useLanguage();
    const {saving: busy, setPrivacy} = usePassportPrivacy(showToast);
    const [open, setOpen] = useState(false);

    const expiry = membershipExpiresAt ? new Date(membershipExpiresAt) : null;
    const daysLeft = expiry && !isNaN(expiry.getTime())
        ? Math.ceil((expiry.getTime() - Date.now()) / 86_400_000)
        : null;

    return (
        <div className="passport-owner-panel">
            <div className="passport-owner-panel-head">
                <span className="passport-owner-panel-title">
                    {isEnglish ? 'This passport is yours' : '这是您的通行证'}
                </span>
                <button
                    className="admin-btn admin-btn--link"
                    onClick={() => setOpen(v => !v)}
                    type="button"
                >
                    {open
                        ? (isEnglish ? 'Hide' : '收起')
                        : (isEnglish ? 'Manage' : '管理')}
                </button>
            </div>
            {open && (
                <div className="passport-owner-panel-body">
                    <p className="passport-owner-panel-row">
                        {daysLeft !== null && daysLeft > 0 && expiry
                            ? (isEnglish
                                ? `Membership active — ${daysLeft} day${daysLeft === 1 ? '' : 's'} left, through ${expiry.toLocaleDateString('en-US', {
                                    year: 'numeric',
                                    month: 'long',
                                    day: 'numeric'
                                })}.`
                                : `会员资格有效 — 剩余 ${daysLeft} 天，至 ${expiry.toLocaleDateString('zh-CN', {
                                    year: 'numeric',
                                    month: 'long',
                                    day: 'numeric'
                                })}。`)
                            : (isEnglish
                                ? 'Your membership has lapsed. The passport stays yours — activating another one adds a year.'
                                : '您的会员资格已过期。通行证仍归您所有 — 激活另一本可再获得一年。')}
                    </p>
                    {scanCount !== null && (
                        <p className="passport-owner-panel-row">
                            {isEnglish
                                ? `Scanned ${scanCount} ${scanCount === 1 ? 'time' : 'times'}.`
                                : `已被扫描 ${scanCount} 次。`}
                        </p>
                    )}
                    <p className="passport-owner-panel-row">
                        {hidden
                            ? (isEnglish
                                ? 'This page is private: scanners see a notice instead of your profile.'
                                : '此页面为私密：扫描者只会看到提示，而看不到您的资料。')
                            : (isEnglish
                                ? 'This page is public: anyone who scans your passport sees it.'
                                : '此页面已公开：任何扫描您通行证的人都能看到它。')}
                    </p>
                    <button
                        className="admin-btn admin-btn--outline"
                        onClick={() => void setPrivacy(!hidden, onChanged)}
                        disabled={busy}
                        type="button"
                    >
                        {busy
                            ? (isEnglish ? 'Saving…' : '保存中…')
                            : hidden
                                ? (isEnglish ? 'Make my passport page public' : '公开我的通行证页面')
                                : (isEnglish ? 'Make my passport page private' : '将我的通行证页面设为私密')}
                    </button>
                </div>
            )}
        </div>
    );
};
