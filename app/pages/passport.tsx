import { type ReactNode, useEffect, useState } from 'react';
import { FiGlobe, FiLock } from 'react-icons/fi';
import { Link, useParams } from 'react-router';
import { formatGroupWithTitle, normalizeGroup, useAuth } from '~/components/AuthProvider';
import { LanguageSwitcher } from '~/components/LanguageSwitcher';
import { LoginButton } from '~/components/LoginButton';
import { useLanguage } from '~/components/LanguageContextProvider';
import { onPassportClaimed, openRedeemModal } from '~/components/RedeemModal';
import { callGetPassportPublicProfile, callSetPassportPrivacy } from '~/lib/firebase';
import {
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

/**
 * /p/:passportId — the one URL on every passport sticker.
 *
 * What it renders depends on the passport, not on who is looking: an unclaimed
 * sticker is the passport shown shut, a claimed one is its owner's public page
 * (no sign-in required), and an unknown code is a blank page stamped as having
 * no record. The owner also gets a privacy toggle on their own passport.
 */
export const PassportPage = () => {
    const {passportId: raw} = useParams();
    const {isEnglish} = useLanguage();
    const {user, loading: authLoading} = useAuth();
    const viewerUid = user?.uid ?? null;
    const passportId = normalizePassportCode(raw ?? '');
    const wellFormed = isPassportCodeShape(passportId, PASSPORT_ID_LENGTH);

    const [result, setResult] = useState<PassportPublicProfile | null>(null);
    const [failed, setFailed] = useState(false);
    // Bumped to re-resolve the sticker once Redeem Code activates it.
    const [nonce, setNonce] = useState(0);

    useEffect(() => onPassportClaimed(id => {
        if (id === passportId) setNonce(n => n + 1);
    }), [passportId]);

    // Resolved again when the viewer signs in or out: the server decides whether
    // they own it, which is what shows them the privacy switch and, if they hid
    // it, the page itself.
    useEffect(() => {
        if (!wellFormed || authLoading) return;
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
    }, [passportId, wellFormed, nonce, authLoading, viewerUid]);

    // A code that can't be a passport id is answered here rather than by the
    // server, which would give the same "invalid" either way.
    if (!wellFormed) return <PassportNotFound code={passportId}/>;
    if (failed) return <PassportNotFound code={passportId} failed onRetry={() => setNonce(n => n + 1)}/>;

    if (!result) return <PassportLoading/>;

    if (result.status === 'invalid') return <PassportNotFound code={passportId}/>;

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

    if (result.status === 'unclaimed') return <UnclaimedPassport designId={result.designId}/>;

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

/**
 * The page's one spinner, in the one place: while the sticker is being resolved,
 * and again while the cover art loads before the passport opens. The frame is
 * the same either way, so crossing from the first wait to the second changes
 * nothing on screen.
 */
const PassportLoading = () => (
    <PassportShell>
        <div className="passport-loading">
            <div className="spinner"/>
        </div>
    </PassportShell>
);

/**
 * The frame for a passport that can't be opened here: the passport as an object
 * on one side, and what to do about it on the other. Stacked on a phone.
 */
const PassportState = ({object, title, children}: {
    object: ReactNode;
    title: string;
    children: ReactNode;
}) => (
    <PassportShell>
        <section className="passport-state">
            <div className="passport-state-object">{object}</div>
            <div className="passport-state-body">
                <h1 className="passport-state-title">{title}</h1>
                {children}
            </div>
        </section>
    </PassportShell>
);

/** Room for a mistyped code to be read back, not for a pasted essay. */
const MAX_SHOWN_CODE = 16;

/**
 * Unknown, malformed, deleted and orphaned codes all land here, deliberately —
 * and so does a lookup that failed, which gets a retry instead of a stamp.
 *
 * The object is a blank passport page with the number that was looked up on its
 * one filled-in line, so it can be checked against the sticker, and stamped as
 * having no record behind it.
 */
const PassportNotFound = ({code, failed = false, onRetry}: {
    code: string;
    failed?: boolean;
    onRetry?: () => void;
}) => {
    const {isEnglish} = useLanguage();
    const shown = code.length > MAX_SHOWN_CODE ? `${code.slice(0, MAX_SHOWN_CODE)}…` : code;
    return (
        <PassportState
            title={failed
                // No apostrophes: the display face has no curly one of its own.
                ? (isEnglish ? 'Unable to Load This Passport' : '无法加载此通行证')
                : (isEnglish ? 'No Passport Found' : '查无此通行证')}
            object={
                // The number is in the text beside it too, so the page itself is
                // only a picture of it.
                <div className="passport-blank" aria-hidden="true">
                    <div className="passport-blank-lines">
                        <div className="passport-blank-line">
                            <span className="passport-blank-label">{isEnglish ? 'Passport no.' : '通行证编号'}</span>
                            <span className="passport-blank-code">{shown || '—'}</span>
                        </div>
                        <div className="passport-blank-line"/>
                        <div className="passport-blank-line"/>
                    </div>
                    {!failed && (
                        <span className="passport-blank-stamp">{isEnglish ? 'No record' : '查无记录'}</span>
                    )}
                </div>
            }
        >
            {failed ? (
                <>
                    <p className="passport-state-text">
                        {isEnglish
                            ? 'This passport didn’t load. Check your connection and try again.'
                            : '通行证未能加载。请检查网络连接后重试。'}
                    </p>
                    <button className="btn btn-primary passport-state-cta" onClick={onRetry} type="button">
                        {isEnglish ? 'Try Again' : '重试'}
                    </button>
                </>
            ) : (
                <>
                    <p className="passport-state-text">
                        {shown
                            ? (isEnglish
                                ? <>No passport has the number <span className="passport-state-code">{shown}</span>.
                                    Check it against the code printed under the QR on the sticker.</>
                                : <>没有编号为 <span
                                    className="passport-state-code">{shown}</span> 的通行证。请对照贴纸二维码下方印的编号核对。</>)
                            : (isEnglish
                                ? 'This link doesn’t include a passport number. Check it against the code printed under the QR on the sticker.'
                                : '此链接中没有通行证编号。请对照贴纸二维码下方印的编号核对。')}
                    </p>
                    <p className="passport-state-aside">
                        {isEnglish
                            ? <>Bought this passport and it still won’t open? <Link to="/#contact">Get in
                                touch</Link>.</>
                            : <>通行证是您购买的，却仍然无法打开？<Link to="/#contact">联系我们</Link>。</>}
                    </p>
                    <Link to="/" className="btn btn-primary passport-state-cta">
                        <span>{isEnglish ? 'Explore Sekai Beyond' : '探索彼世界'}</span>
                        <span>✨</span>
                    </Link>
                </>
            )}
        </PassportState>
    );
};

/**
 * The unclaimed state: the passport shown shut, by the art on its outside. It is
 * activated from Redeem Code with the key from its slip, and when that happens
 * the page re-resolves behind the box and the passport opens here.
 */
const UnclaimedPassport = ({designId}: {designId: string | undefined}) => {
    const {isEnglish} = useLanguage();
    const {user, loading: authLoading, signIn} = useAuth();
    const {designs, loading: designsLoading} = usePassportDesigns();
    const design = designs.find(d => d.id === designId);
    // The outside of the passport, which is what the open page swings away.
    const src = design?.outerCoverImageUrl || design?.coverImageUrl;
    const coverReady = useImagesReady([src]);

    // Held back until the art can paint, so the cover doesn't arrive blank and
    // then change.
    if (designsLoading || !coverReady) return <PassportLoading/>;

    return (
        <PassportState
            title={isEnglish ? 'Not Activated Yet' : '尚未激活'}
            object={
                <div
                    className="passport-shut"
                    role="img"
                    aria-label={passportName(design, isEnglish) || (isEnglish ? 'Passport' : '通行证')}
                >
                    {src ? (
                        <>
                            <img src={src} alt="" className="passport-book-cover-wash"/>
                            <img src={src} alt="" className="passport-book-cover-art"/>
                        </>
                    ) : (
                        <span className="passport-book-cover-blank">{isEnglish ? 'Sekai Beyond' : '彼世界动漫社'}</span>
                    )}
                </div>
            }
        >
            <p className="passport-state-text">
                {isEnglish
                    ? 'This passport hasn’t been activated. If it’s yours, enter the key from the slip that came with it, and it opens right here.'
                    : '这本通行证尚未激活。如果它是您的，请输入随附纸条上的激活码，它就会在这里打开。'}
            </p>
            {!authLoading && (user ? (
                <button className="btn btn-primary passport-state-cta" onClick={openRedeemModal} type="button">
                    <span>{isEnglish ? 'Redeem Code' : '兑换码'}</span>
                    <span>✨</span>
                </button>
            ) : (
                <button className="btn btn-primary passport-state-cta" onClick={() => void signIn()} type="button">
                    {isEnglish ? 'Sign in to Activate' : '登录以激活'}
                </button>
            ))}
        </PassportState>
    );
};

/** How long a slow image may hold the passport shut before it opens anyway. */
const COVER_LOAD_TIMEOUT_MS = 8000;

/**
 * Both faces of the cover are painted at once by the opening, so the passport
 * has to be held shut until they can be. This loads them off-screen and reports
 * when every one is decoded and ready for the copies in the DOM to paint from.
 *
 * A face that fails to load counts as settled — it falls back to its own
 * gradient, and a broken url shouldn't hold the passport shut forever. Neither
 * should a request that never answers, which is what the cap above is for.
 */
const useImagesReady = (urls: (string | undefined)[]): boolean => {
    // One string rather than the array, which is rebuilt every render: the
    // effect should re-run when the images change, not when React re-renders.
    const key = [...new Set(urls.filter((url): url is string => !!url))].join('\n');
    const [loadedKey, setLoadedKey] = useState<string | null>(null);

    useEffect(() => {
        if (!key) return;
        const srcs = key.split('\n');
        let left = srcs.length;
        let stale = false;
        const settle = () => {
            if (!stale && --left === 0) setLoadedKey(key);
        };
        for (const src of srcs) {
            const img = new Image();
            img.src = src;
            // decode() waits for the bitmap and not just the bytes, which is
            // what the copy in the DOM needs to paint in the flip's first
            // frame. It rejects on an image that can't be decoded, and that
            // settles it the same way a load error does.
            img.decode().then(settle, settle);
        }
        const cap = window.setTimeout(() => {
            if (!stale) setLoadedKey(key);
        }, COVER_LOAD_TIMEOUT_MS);
        return () => {
            stale = true;
            window.clearTimeout(cap);
        };
    }, [key]);

    // A design with no art of its own has nothing to wait for.
    return !key || loadedKey === key;
};

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
    const {designs, loading: designsLoading} = usePassportDesigns();
    const {toasts, showToast} = useToasts();

    const {owner} = data;
    const design = designs.find(d => d.id === data.designId);
    const name = passportName(design, isEnglish);
    // What the two faces of the cover will ask for — see CoverFace.
    const coverReady = useImagesReady([
        design?.coverImageUrl,
        design?.outerCoverImageUrl || design?.coverImageUrl,
    ]);

    useEffect(() => {
        if (!owner.displayName) return;
        document.title = `${owner.displayName} | Sekai Beyond`;
        return () => {
            document.title = 'Passport | Sekai Beyond';
        };
    }, [owner.displayName]);

    // The passport opens once, on load, and the opening is the whole of the
    // first second on this page — art that arrives part-way through it appears
    // out of a cover already in mid-air, or after it has landed. So the spread
    // isn't mounted, and the animation doesn't start, until the designs have
    // been read and their art is loaded.
    if (designsLoading || !coverReady) return <PassportLoading/>;

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
