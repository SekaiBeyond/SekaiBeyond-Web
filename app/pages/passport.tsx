import { type ReactNode, useEffect, useState } from 'react';
import { FiGlobe, FiLock } from 'react-icons/fi';
import { Link, useParams } from 'react-router';
import { formatGroupWithTitle, normalizeGroup, useAuth } from '~/components/AuthProvider';
import { useLanguage } from '~/components/LanguageContextProvider';
import { PageNav } from '~/components/PageNav';
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
 * /p/:passportId, the URL on every passport sticker. An unclaimed sticker shows
 * the passport shut, a claimed one its owner's public page (no sign-in), and an
 * unknown code a blank page stamped as having no record. The owner also gets a
 * privacy toggle.
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

    // Again on sign-in or out: the server decides ownership, which brings the
    // privacy switch and, if hidden, the page itself.
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

    // The server would answer a malformed code "invalid" anyway.
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
 * Nav and page frame, as on the profile and admin pages. `wide` lets the open
 * passport fill the screen.
 */
const PassportShell = ({children, wide = false}: {children: ReactNode; wide?: boolean}) => (
    <>
        <PageNav/>
        <div className={`passport-page${wide ? ' passport-page--wide' : ''}`}>{children}</div>
    </>
);

/**
 * The one spinner, while the sticker resolves and again while the cover art
 * loads, in the same frame so the handover is invisible.
 */
const PassportLoading = () => (
    <PassportShell>
        <div className="passport-loading">
            <div className="spinner"/>
        </div>
    </PassportShell>
);

/**
 * A passport that can't be opened: the object on one side, what to do on the
 * other. Stacked on a phone.
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
 * Unknown, malformed, deleted and orphaned codes all land here on purpose; a
 * failed lookup gets a retry instead. The object is a blank passport page with
 * the looked-up number on its one line, to check against the sticker.
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
                // The number is in the text beside it too.
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
 * Unclaimed: the passport shown shut. Once activated from Redeem Code, the page
 * re-resolves and the passport opens here.
 */
const UnclaimedPassport = ({designId}: {designId: string}) => {
    const {isEnglish} = useLanguage();
    const {user, loading: authLoading, signIn} = useAuth();
    const {designs, loading: designsLoading} = usePassportDesigns();
    const design = designs.find(d => d.id === designId);
    // The outside of the passport, which is what the open page swings away.
    const src = design?.outerCoverImageUrl || design?.coverImageUrl;
    const coverReady = useImagesReady([src]);

    // Held until the art can paint, so the cover doesn't arrive blank.
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
 * The opening paints both cover faces at once, so the passport stays shut until
 * they're decoded. A face that fails, or a request that never answers (the cap
 * above), counts as settled; it falls back to its gradient.
 */
const useImagesReady = (urls: (string | undefined)[]): boolean => {
    // A string, so the effect re-runs when the images change rather than on
    // every render.
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
            // decode() waits for the bitmap, which the flip's first frame
            // needs. A rejection settles it like a load error.
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
 * The owner's public page, signed in or not: an open passport, cover art on one
 * page and the holder's data page on the other, stamped with their membership.
 * The owner also gets the privacy toggle and a line of what only they see.
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

    // The opening fills the page's first second, so art arriving mid-flight
    // would pop in. Nothing mounts until the designs and their art have loaded.
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

    // Officers are stamped with their role, everyone else as a member. Expiry
    // is never stamped: the page doesn't tell a scanner when someone's
    // membership ends.
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
 * One face of the two-faced cover that flips open on load. The back is the shut
 * passport and takes the design's outside art if any; the front, where the
 * cover lands, is always the cover art. Only one face is ever visible, so the
 * back is hidden from the accessibility tree.
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
 * The privacy switch in the data page's corner: a globe while scanners can see
 * the page, a lock while they get the private notice. Saves the same setting as
 * /profile's Settings tab and refreshes the auth profile so that tab agrees.
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
