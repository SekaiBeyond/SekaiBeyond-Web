import { useEffect, useRef, useState } from 'react';
import { useAuth } from '~/components/AuthProvider';
import { useLanguage } from '~/components/LanguageContextProvider';
import { callClaimBadgeActivationCode, callClaimStaffCode, functionsErrorCode } from '~/lib/firebase';
import type { BadgeDef } from '~/lib/types';
import { useModalEffects } from '~/lib/useModalEffects';

interface EventInfo {
    eventTitle: string;
    eventTitleCn: string;
    eventPoster: string;
}

export const RedeemModal = () => {
    const {user, profile, refreshProfile} = useAuth();
    const {isEnglish} = useLanguage();
    const [show, setShow] = useState(false);
    const [input, setInput] = useState('');
    const [state, setState] = useState<'idle' | 'claiming' | 'badge-success' | 'staff-success' | 'error'>('idle');
    const [badge, setBadge] = useState<BadgeDef | null>(null);
    const [eventInfo, setEventInfo] = useState<EventInfo | null>(null);
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
            setError('');
            submittingRef.current = false;
            setTimeout(() => inputRef.current?.focus(), 50);
        };
        window.addEventListener('open-redeem-modal', handler);
        return () => window.removeEventListener('open-redeem-modal', handler);
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

        // Try badge activation code first
        try {
            const result = await callClaimBadgeActivationCode({code: trimmed});
            const d = result.data;
            setBadge({
                id: d.badgeId,
                name: d.badgeName,
                nameCn: d.badgeNameCn,
                description: d.badgeDescription,
                descriptionCn: d.badgeDescriptionCn,
                imageUrl: d.badgeImageUrl || '/images/mika.png',
                deleteAt: null,
            });
            setState('badge-success');
            refreshProfile().catch(() => {
            });
            submittingRef.current = false;
            return;
        } catch (badgeErr) {
            const badgeErrCode = functionsErrorCode(badgeErr);
            // Only fall through to staff code if badge code was simply not found
            if (badgeErrCode !== 'invalid' && badgeErrCode !== 'inactive') {
                setState('error');
                switch (badgeErrCode) {
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
                    case 'already-have':
                        setError(isEnglish ? 'You already have this badge.' : '您已拥有此徽章。');
                        break;
                    default:
                        setError(isEnglish ? 'Something went wrong. Please try again.' : '出错了，请重试。');
                }
                submittingRef.current = false;
                return;
            }
        }

        // Badge code not found — try staff claim code
        try {
            const result = await callClaimStaffCode({code: trimmed});
            const d = result.data;
            setEventInfo({
                eventTitle: d.eventTitle,
                eventTitleCn: d.eventTitleCn,
                eventPoster: d.eventPoster,
            });
            setState('staff-success');
            refreshProfile().catch(() => {
            });
        } catch (staffErr) {
            setState('error');
            switch (functionsErrorCode(staffErr)) {
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
                case 'already-have':
                    setError(isEnglish ? 'You are already staff for this event.' : '您已是此活动的工作人员。');
                    break;
                default:
                    setError(isEnglish ? 'Invalid or deactivated code.' : '兑换码无效或已被停用。');
            }
        } finally {
            submittingRef.current = false;
        }
    };

    if (!show) return null;

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
                                ? 'Enter your code to redeem a reward.'
                                : '输入兑换码以领取奖励。'}
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
                                className="admin-search-input redeem-input"
                            />
                            {error && (
                                <p className="redeem-error-text">
                                    {error}
                                </p>
                            )}
                            <button type="submit" className="admin-generate-btn redeem-submit-btn">
                                {isEnglish ? 'Redeem' : '兑换'}
                            </button>
                        </form>
                    </>
                )}

                {state === 'claiming' && (
                    <div className="redeem-loading">
                        <div className="profile-spinner spinner-centered"/>
                        <p>{isEnglish ? 'Redeeming...' : '兑换中...'}</p>
                    </div>
                )}

                {state === 'badge-success' && (
                    <>
                        {badge && (
                            <div className="claim-badge-icon">
                                <img src={badge.imageUrl} alt={isEnglish ? badge.name : badge.nameCn}/>
                            </div>
                        )}
                        <h2 className="redeem-heading">
                            {isEnglish ? 'Badge Claimed!' : '徽章领取成功！'}
                        </h2>
                        {badge && (
                            <>
                                <p className="claim-event-title redeem-centered-text">
                                    {isEnglish ? badge.name : badge.nameCn}
                                </p>
                                <p className="claim-event-category redeem-centered-text">
                                    {isEnglish ? badge.description : badge.descriptionCn}
                                </p>
                            </>
                        )}
                        <button className="admin-generate-btn redeem-done-btn" onClick={close}>
                            {isEnglish ? 'Done' : '完成'}
                        </button>
                    </>
                )}

                {state === 'staff-success' && (
                    <>
                        {eventInfo?.eventPoster && (
                            <div className="claim-badge-icon">
                                <img src={eventInfo.eventPoster}
                                     alt={isEnglish ? eventInfo.eventTitle : eventInfo.eventTitleCn}/>
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
                        <button className="admin-generate-btn redeem-done-btn" onClick={close}>
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
                            className="admin-generate-btn redeem-submit-btn"
                            onClick={() => {
                                setState('idle');
                                setInput('');
                                setError('');
                                setBadge(null);
                                setEventInfo(null);
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
