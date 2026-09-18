import { type ReactNode, useEffect, useState } from 'react';
import { FiGlobe, FiLock } from 'react-icons/fi';
import { Link, useParams } from 'react-router';
import { formatGroupWithTitle, normalizeGroup, useAuth } from '~/components/AuthProvider';
import { LanguageSwitcher } from '~/components/LanguageSwitcher';
import { LoginButton } from '~/components/LoginButton';
import { useLanguage } from '~/components/LanguageContextProvider';
import {
    callClaimPassport,
    callGetPassportPublicProfile,
    callSetPassportPrivacy,
    functionsErrorCode,
    functionsErrorDetails,
} from '~/lib/firebase';
import {
    ACTIVATION_KEY_LENGTH,
    isPassportCodeShape,
    normalizePassportCode,
    PASSPORT_ID_LENGTH,
    type PassportDesign,
    passportName,
    type PassportPublicProfile,
    usePassportDesigns,
} from '~/lib/passports';
import { privacyRow, privacyStateLabel } from '~/lib/privacy';
import { type ShowToast, ToastContainer, useToasts } from '~/lib/useToasts';
import { ExpiredCard } from './qrRedirect';

/**
 * /p/:passportId — the one URL on every passport sticker.
 *
 * What it renders depends on the passport, not on who is looking: an unclaimed
 * sticker is an activation form, a claimed one is its owner's public page (no
 * sign-in required), and a void or unknown code is a dead end. The owner also
 * gets a privacy toggle on their own passport.
 */
export const PassportPage = () => {
    const {passportId: raw} = useParams();
    const {isEnglish} = useLanguage();
    const passportId = normalizePassportCode(raw ?? '');
    const wellFormed = isPassportCodeShape(passportId, PASSPORT_ID_LENGTH);

    const [result, setResult] = useState<PassportPublicProfile | null>(null);
    const [failed, setFailed] = useState(false);
    // Bumped to re-resolve the sticker after the owner activates it.
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
                designId={result.designId}
                termDays={result.termDays}
                onActivated={() => setNonce(n => n + 1)}
            />
        );
    }

    return <ClaimedPassport passportId={passportId} data={result}/>;
};

/**
 * Nav + page frame, matching the profile and admin pages. `wide` lets the open
 * passport fill the screen; the message cards keep the narrower frame.
 */
const PassportShell = ({children, wide = false}: {children: ReactNode; wide?: boolean}) => {
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
            <div className={`passport-page${wide ? ' passport-page--wide' : ''}`}>{children}</div>
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
    designId: string;
    /** What this particular sticker grants — per-passport data, not a constant. */
    termDays: number;
    onActivated: () => void;
}

/**
 * The unclaimed state: sign in, then type the key from the slip packed with the
 * passport. Claiming is one-way — the passport binds to this account for good.
 */
const ActivationCard = ({passportId, designId, termDays, onActivated}: ActivationCardProps) => {
    const {isEnglish} = useLanguage();
    const {user, loading: authLoading, signIn, refreshProfile} = useAuth();
    const {designs} = usePassportDesigns();
    const design = designs.find(d => d.id === designId);
    const name = passportName(design, isEnglish);

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
            // The profile's member chip and passport shelf both read the auth
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
                        alt={name}
                        className="passport-activate-cover"
                    />
                )}
                <h1 className="passport-activate-title">
                    {isEnglish ? 'Activate Your Passport' : '激活您的通行证'}
                </h1>
                <p className="passport-activate-design">{name}</p>
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
}

/**
 * The owner's public page. Renders for signed-out visitors — no login wall.
 *
 * Laid out as an open passport: the design's cover art on one page, the holder's
 * data page on the other, stamped with their membership. The owner also gets the
 * privacy toggle in the data page's corner and a line of what only they see.
 */
const ClaimedPassport = ({passportId, data}: ClaimedPassportProps) => {
    const {isEnglish} = useLanguage();
    const {designs} = usePassportDesigns();
    const {toasts, showToast} = useToasts();

    const {owner} = data;
    const design = designs.find(d => d.id === data.designId);
    const name = passportName(design, isEnglish);

    useEffect(() => {
        if (!owner.displayName) return;
        document.title = `${owner.displayName} | Sekai Beyond`;
        return () => {
            document.title = 'Passport | Sekai Beyond';
        };
    }, [owner.displayName]);

    const fmtDate = (iso: string | null): string => {
        if (!iso) return '';
        const d = new Date(iso);
        return isNaN(d.getTime()) ? '' : d.toLocaleDateString(isEnglish ? 'en-US' : 'zh-CN', {
            year: 'numeric', month: 'long', day: 'numeric',
        });
    };

    const claimedOn = fmtDate(data.claimedAt);
    const joinedOn = fmtDate(owner.joinedAt);
    const group = normalizeGroup(owner.group);

    // Officers are stamped with the role they hold; everyone else is a member.
    // Whether a membership is still running is never stamped — the page won't
    // announce someone's expiry to whoever just scanned their passport.
    const stamp = group !== 'user'
        ? {
            modifier: ' passport-stamp--role',
            context: isEnglish ? 'Role: ' : '身份：',
            word: isEnglish ? 'Officer' : '干部',
        }
        : {
            modifier: '',
            context: isEnglish ? 'Membership: ' : '会员状态：',
            word: isEnglish ? 'Member' : '会员',
        };

    return (
        <PassportShell wide>
            <ToastContainer toasts={toasts}/>
            <article className="passport-book">
                <div className="passport-book-cover">
                    <CoverFace design={design} name={name}/>
                    <CoverFace design={design} name={name} back/>
                </div>

                <div className="passport-book-page">
                    <header className="passport-book-head">
                        <h1 className="passport-book-title">{name}</h1>
                        {data.isOwner && <PrivacyToggle initialHidden={data.hidden} showToast={showToast}/>}
                    </header>

                    <div className="passport-holder">
                        {owner.photoURL ? (
                            <img
                                src={owner.photoURL}
                                alt=""
                                className="passport-holder-photo"
                                referrerPolicy="no-referrer"
                            />
                        ) : (
                            <div className="passport-holder-photo passport-holder-photo--initials" aria-hidden="true">
                                {(owner.displayName[0] ?? '?').toUpperCase()}
                            </div>
                        )}
                        <div className="passport-holder-id">
                            <h2 className="passport-holder-name">{owner.displayName}</h2>
                            <span className="profile-group-tag" data-group={group}>
                                {formatGroupWithTitle(group, owner.title, owner.titleCn, isEnglish)}
                            </span>
                        </div>
                    </div>

                    <dl className="passport-fields">
                        {claimedOn && (
                            <div className="passport-field">
                                <dt>{isEnglish ? 'Held since' : '持有自'}</dt>
                                <dd>{claimedOn}</dd>
                            </div>
                        )}
                        {joinedOn && (
                            <div className="passport-field">
                                <dt>{isEnglish ? 'Joined on' : '注册日期'}</dt>
                                <dd>{joinedOn}</dd>
                            </div>
                        )}
                        <div className="passport-field passport-field--wide">
                            <dt>{isEnglish ? 'Passport no.' : '通行证编号'}</dt>
                            <dd className="passport-field-code">{passportId}</dd>
                        </div>
                    </dl>

                    {/* A div, not <footer>: the landing page styles every footer element. */}
                    <div className="passport-book-foot">
                        {/* Absent until the function that sends it is deployed. */}
                        {owner.uid && (
                            <Link to={`/profile?uid=${owner.uid}`} className="passport-profile-link">
                                {isEnglish ? 'View profile' : '查看个人主页'}
                            </Link>
                        )}
                        <span className={`passport-stamp${stamp.modifier}`}>
                            {/* The stamp's word alone doesn't say what it is stamping. */}
                            <span className="passport-stamp-context">{stamp.context}</span>
                            {stamp.word}
                        </span>
                    </div>
                </div>
            </article>
        </PassportShell>
    );
};

/**
 * One side of the passport's cover, which is a two-faced card so that it can be
 * flipped open on load. The back face is the shut passport lying over the data
 * page, so it takes the design's outside art if it has any; the front face is
 * the page the cover comes to rest on, which is always the cover art. A design
 * without its own outside uses the cover art for both, the way every design did
 * before the two could differ. Only one face ever faces the viewer, so the back
 * is kept out of the accessibility tree.
 */
const CoverFace = ({design, name, back = false}: {
    design: PassportDesign | undefined;
    name: string;
    back?: boolean;
}) => {
    const {isEnglish} = useLanguage();
    const src = back
        ? (design?.outerCoverImageUrl || design?.coverImageUrl)
        : design?.coverImageUrl;
    return (
        <div
            className={`passport-book-cover-face${back ? ' passport-book-cover-face--back' : ''}`}
            aria-hidden={back || undefined}
        >
            {src ? (
                <>
                    <img src={src} alt="" aria-hidden="true" className="passport-book-cover-wash"/>
                    <img src={src} alt={back ? '' : name} className="passport-book-cover-art"/>
                </>
            ) : (
                <span className="passport-book-cover-blank">{isEnglish ? 'Sekai Beyond' : '彼世界动漫社'}</span>
            )}
        </div>
    );
};

/**
 * The passport page's privacy switch, as an icon in the corner of the data page:
 * a globe while scanners can see the page, a lock while they get the private
 * notice instead. It saves the same setting as the Settings tab on /profile and
 * refreshes the auth profile afterwards, so that tab reads the new value.
 */
const PrivacyToggle = ({initialHidden, showToast}: {initialHidden: boolean; showToast: ShowToast}) => {
    const {isEnglish} = useLanguage();
    const {refreshProfile} = useAuth();
    const [hidden, setHidden] = useState(initialHidden);
    const [busy, setBusy] = useState(false);

    const row = privacyRow('passportPage');
    const state = privacyStateLabel(row, !hidden, isEnglish);

    const toggle = async () => {
        const next = !hidden;
        setBusy(true);
        try {
            await callSetPassportPrivacy({hide: next});
            setHidden(next);
            showToast(
                `${isEnglish ? row.title.en : row.title.zh} · ${privacyStateLabel(row, !next, isEnglish)}`,
                'success',
            );
            refreshProfile().catch(() => {
            });
        } catch {
            showToast(isEnglish ? 'Failed to save. Please try again.' : '保存失败，请重试。', 'error');
        } finally {
            setBusy(false);
        }
    };

    return (
        <button
            type="button"
            role="switch"
            aria-checked={!hidden}
            aria-label={isEnglish ? 'Show this page to people who scan it' : '向扫描者公开此页面'}
            className={`passport-privacy${hidden ? ' passport-privacy--private' : ''}`}
            disabled={busy}
            onClick={() => void toggle()}
        >
            {hidden ? <FiLock aria-hidden="true"/> : <FiGlobe aria-hidden="true"/>}
            <span className="passport-privacy-tip" aria-hidden="true">{state}</span>
        </button>
    );
};
