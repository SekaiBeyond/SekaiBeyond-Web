import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { useAuth } from '~/components/AuthProvider';
import { useLanguage } from '~/components/LanguageContextProvider';
import { callRedeemCode, functionsErrorCode, functionsErrorDetails } from '~/lib/firebase';
import type { BadgeDef } from '~/lib/types';
import { useModalEffects } from '~/lib/useModalEffects';

const OPEN_EVENT = 'open-redeem-modal';
const PASSPORT_CLAIMED_EVENT = 'passport-claimed';

/** Opens the Redeem Code modal, which root mounts once for every page. */
export const openRedeemModal = () => window.dispatchEvent(new CustomEvent(OPEN_EVENT));

/** Calls `handler` with the id of each passport the modal activates, so a page
 * showing that passport can re-read it. Returns the unsubscribe. */
export const onPassportClaimed = (handler: (passportId: string) => void) => {
    const listener = (e: Event) => handler((e as CustomEvent<string>).detail);
    window.addEventListener(PASSPORT_CLAIMED_EVENT, listener);
    return () => window.removeEventListener(PASSPORT_CLAIMED_EVENT, listener);
};

interface EventInfo {
    eventTitle: string;
    eventTitleCn: string;
    eventPoster: string;
}

interface PassportGrant {
    passportId: string;
    name: string;
    coverImageUrl: string;
    daysGranted: number;
    membershipExpiresAt: string;
}

export const RedeemModal = () => {
    const {user, profile, refreshProfile} = useAuth();
    const {isEnglish} = useLanguage();
    const navigate = useNavigate();
    const [show, setShow] = useState(false);
    const [input, setInput] = useState('');
    const [state, setState] = useState<
        'idle' | 'claiming' | 'badge-success' | 'staff-success' | 'passport-success' | 'error'
    >('idle');
    const [badge, setBadge] = useState<BadgeDef | null>(null);
    const [eventInfo, setEventInfo] = useState<EventInfo | null>(null);
    const [passport, setPassport] = useState<PassportGrant | null>(null);
    const [error, setError] = useState('');
    const inputRef = useRef<HTMLInputElement>(null);
    const overlayRef = useRef<HTMLDivElement>(null);
    const submittingRef = useRef(false);
    useModalEffects(show, overlayRef);

    useEffect(() => {
        const handler = () => {
            if (!user || !profile) return;
            setShow(true);
            setInput('');
            setState('idle');
            setBadge(null);
            setEventInfo(null);
            setPassport(null);
            setError('');
            submittingRef.current = false;
            setTimeout(() => inputRef.current?.focus(), 50);
        };
        window.addEventListener(OPEN_EVENT, handler);
        return () => window.removeEventListener(OPEN_EVENT, handler);
    }, [user, profile]);

    useEffect(() => {
        if (!user || !profile) setShow(false);
    }, [user, profile]);

    const close = () => setShow(false);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        const trimmed = input.trim();
        if (!trimmed) {
            setError(isEnglish ? 'Please enter a code.' : '请输入兑换码。');
            return;
        }
        if (trimmed.length < 6 || trimmed.length > 20) {
            setError(isEnglish ? 'Invalid code length.' : '兑换码长度无效。');
            return;
        }
        if (!user || !profile) return;
        if (submittingRef.current) return;

        submittingRef.current = true;
        setState('claiming');
        setError('');

        // One call whatever kind of code this is: the server knows them all, and
        // guessing from here would spend a rate-limit slot per guess.
        try {
            const {data} = await callRedeemCode({code: trimmed});

            if (data.kind === 'passport-claim') {
                setPassport({
                    passportId: data.passportId,
                    name: isEnglish ? data.designName : (data.designNameCn || data.designName),
                    coverImageUrl: data.coverImageUrl,
                    daysGranted: data.daysGranted,
                    membershipExpiresAt: data.membershipExpiresAt,
                });
                setState('passport-success');
                window.dispatchEvent(new CustomEvent(PASSPORT_CLAIMED_EVENT, {detail: data.passportId}));
            } else if (data.kind === 'badge') {
                setBadge({
                    id: data.badgeId,
                    name: data.badgeName,
                    nameCn: data.badgeNameCn,
                    description: data.badgeDescription,
                    descriptionCn: data.badgeDescriptionCn,
                    imageUrl: data.badgeImageUrl || '/mika.webp',
                    deleteAt: null,
                });
                setState('badge-success');
            } else {
                setEventInfo({
                    eventTitle: data.eventTitle,
                    eventTitleCn: data.eventTitleCn,
                    eventPoster: data.eventPoster,
                });
                setState('staff-success');
            }
            refreshProfile().catch(() => {
            });
        } catch (err) {
            setState('error');
            switch (functionsErrorCode(err)) {
                case 'rate-limited':
                    setError(isEnglish ? 'Too many attempts. Please wait a moment.' : '尝试次数过多，请稍后再试。');
                    break;
                case 'not-active-yet':
                    setError(isEnglish ? 'This code is not active yet.' : '此兑换码尚未生效。');
                    break;
                case 'expired':
                    setError(isEnglish ? 'This code has expired.' : '此兑换码已过期。');
                    break;
                case 'max-uses':
                    setError(isEnglish ? 'This code has reached its maximum uses.' : '此兑换码已达到最大使用次数。');
                    break;
                // Only a passport key reaches these two: its passport was found,
                // so "invalid" would send the holder off to retype a key that
                // was never wrong.
                case 'already-claimed':
                    setError(isEnglish
                        ? 'This passport has already been activated.'
                        : '此通行证已被激活。');
                    break;
                case 'no-profile':
                    setError(isEnglish
                        ? 'Your account isn’t set up yet. Please sign out and back in, then try again.'
                        : '您的账号尚未完成设置。请退出登录后重新登录，然后再试。');
                    break;
                case 'already-have':
                    setError(functionsErrorDetails<{kind?: string}>(err)?.kind === 'staff'
                        ? (isEnglish ? 'You are already staff for this event.' : '您已是此活动的工作人员。')
                        : (isEnglish ? 'You already have this badge.' : '您已拥有此徽章。'));
                    break;
                // A check-in code names itself, so it can be turned away by name
                // instead of joining everything else under "invalid".
                case 'event-code':
                    setError(isEnglish
                        ? 'That code checks you in at an event — use the link or QR code from the event itself.'
                        : '这是活动签到码 — 请使用活动提供的链接或二维码。');
                    break;
                default:
                    setError(isEnglish ? 'Invalid or deactivated code.' : '兑换码无效或已被停用。');
            }
        } finally {
            submittingRef.current = false;
        }
    };

    if (!show) return null;

    const memberUntil = passport
        ? new Date(passport.membershipExpiresAt).toLocaleDateString(isEnglish ? 'en-US' : 'zh-CN', {
            year: 'numeric', month: 'long', day: 'numeric',
        })
        : '';

    return (
        <div ref={overlayRef} className="modal-overlay" onClick={(e) => e.target === e.currentTarget && close()}>
            <div className="modal-content">
                <button className="modal-close" onClick={close} type="button">×</button>

                {state === 'idle' && (
                    <>
                        <h2 className="redeem-heading">
                            {isEnglish ? 'Redeem Code' : '兑换码'}
                        </h2>
                        <p className="redeem-subtitle">
                            {isEnglish
                                ? 'Enter a code to redeem a reward, or the key from a passport’s slip to activate it.'
                                : '输入兑换码以领取奖励，或输入通行证纸条上的激活码以激活通行证。'}
                        </p>
                        <form onSubmit={handleSubmit}>
                            <input
                                ref={inputRef}
                                type="text"
                                value={input}
                                onChange={e => {
                                    setInput(e.target.value);
                                    setError('');
                                }}
                                placeholder={isEnglish ? 'Enter code' : '输入兑换码'}
                                className="admin-input redeem-input"
                            />
                            {error && (
                                <p className="redeem-error-text">
                                    {error}
                                </p>
                            )}
                            <button type="submit" className="admin-btn admin-btn--dashed redeem-submit-btn">
                                {isEnglish ? 'Redeem' : '兑换'}
                            </button>
                        </form>
                    </>
                )}

                {state === 'claiming' && (
                    <div className="redeem-loading">
                        <div className="spinner spinner-centered"/>
                        <p>{isEnglish ? 'Redeeming...' : '兑换中...'}</p>
                    </div>
                )}

                {state === 'badge-success' && (
                    <>
                        {badge && (
                            <div className="claim-badge-icon">
                                <img src={badge.imageUrl} alt={isEnglish ? badge.name : (badge.nameCn || badge.name)}/>
                            </div>
                        )}
                        <h2 className="redeem-heading">
                            {isEnglish ? 'Badge Claimed!' : '徽章领取成功！'}
                        </h2>
                        {badge && (
                            <>
                                <p className="claim-event-title redeem-centered-text">
                                    {isEnglish ? badge.name : (badge.nameCn || badge.name)}
                                </p>
                                <p className="claim-event-category redeem-centered-text">
                                    {isEnglish ? badge.description : (badge.descriptionCn || badge.description)}
                                </p>
                            </>
                        )}
                        <button className="admin-btn admin-btn--dashed redeem-done-btn" onClick={close}>
                            {isEnglish ? 'Done' : '完成'}
                        </button>
                    </>
                )}

                {state === 'staff-success' && (
                    <>
                        {eventInfo?.eventPoster && (
                            <div className="claim-badge-icon">
                                <img src={eventInfo.eventPoster}
                                     alt={isEnglish ? eventInfo.eventTitle : (eventInfo.eventTitleCn || eventInfo.eventTitle)}/>
                            </div>
                        )}
                        <h2 className="redeem-heading">
                            {isEnglish ? 'You are now Event Staff!' : '你已成为活动工作人员！'}
                        </h2>
                        {eventInfo && (eventInfo.eventTitle || eventInfo.eventTitleCn) && (
                            <p className="claim-event-title redeem-centered-text">
                                {isEnglish
                                    ? (eventInfo.eventTitle || eventInfo.eventTitleCn)
                                    : (eventInfo.eventTitleCn || eventInfo.eventTitle)}
                            </p>
                        )}
                        <button className="admin-btn admin-btn--dashed redeem-done-btn" onClick={close}>
                            {isEnglish ? 'Done' : '完成'}
                        </button>
                    </>
                )}

                {state === 'passport-success' && passport && (
                    <>
                        {passport.coverImageUrl && (
                            <div className="redeem-passport-cover">
                                <img src={passport.coverImageUrl} alt=""/>
                            </div>
                        )}
                        <h2 className="redeem-heading">
                            {isEnglish ? 'Passport Activated!' : '通行证已激活！'}
                        </h2>
                        {passport.name && (
                            <p className="claim-event-title redeem-centered-text">{passport.name}</p>
                        )}
                        <p className="redeem-grant">
                            <span className="redeem-grant-number">+{passport.daysGranted}</span>
                            <span className="redeem-grant-unit">
                                {isEnglish
                                    ? `${passport.daysGranted === 1 ? 'day' : 'days'} of membership`
                                    : '天会员资格'}
                            </span>
                        </p>
                        <p className="redeem-subtitle redeem-passport-until">
                            {isEnglish
                                ? `Your membership now runs to ${memberUntil}. This passport is yours from here on.`
                                : `您的会员资格现有效期至 ${memberUntil}。此通行证从此归您所有。`}
                        </p>
                        <button
                            className="admin-btn admin-btn--cta redeem-done-btn"
                            onClick={() => {
                                close();
                                navigate(`/p/${passport.passportId}`);
                            }}
                        >
                            {isEnglish ? 'View My Passport' : '查看我的通行证'}
                        </button>
                        <button className="admin-btn admin-btn--dashed redeem-submit-btn" onClick={close}>
                            {isEnglish ? 'Done' : '完成'}
                        </button>
                    </>
                )}

                {state === 'error' && (
                    <>
                        <h2 className="redeem-heading redeem-heading--error">
                            {isEnglish ? 'Claim Failed' : '领取失败'}
                        </h2>
                        <p className="redeem-subtitle">{error}</p>
                        <button
                            className="admin-btn admin-btn--dashed redeem-submit-btn"
                            onClick={() => {
                                setState('idle');
                                setInput('');
                                setError('');
                                setBadge(null);
                                setEventInfo(null);
                                setPassport(null);
                                setTimeout(() => inputRef.current?.focus(), 50);
                            }}
                        >
                            {isEnglish ? 'Try Again' : '重试'}
                        </button>
                    </>
                )}
            </div>
        </div>
    );
};
