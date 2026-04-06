import { useEffect, useRef, useState } from 'react';
import { FirebaseError } from 'firebase/app';
import { useAuth } from '~/components/AuthProvider';
import { useLanguage } from '~/components/LanguageContextProvider';
import { callClaimBadgeActivationCode } from '~/lib/firebase';
import type { BadgeDef } from '~/lib/types';

export const RedeemModal = () => {
    const {user, profile, refreshProfile} = useAuth();
    const {isEnglish} = useLanguage();
    const [show, setShow] = useState(false);
    const [input, setInput] = useState('');
    const [state, setState] = useState<'idle' | 'claiming' | 'success' | 'error'>('idle');
    const [badge, setBadge] = useState<BadgeDef | null>(null);
    const [error, setError] = useState('');
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        const handler = () => {
            if (!user || !profile) return;
            setShow(true);
            setInput('');
            setState('idle');
            setBadge(null);
            setError('');
            setTimeout(() => inputRef.current?.focus(), 50);
        };
        window.addEventListener('open-redeem-modal', handler);
        return () => window.removeEventListener('open-redeem-modal', handler);
    }, [user, profile]);

    const close = () => setShow(false);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        const trimmed = input.trim();
        if (!trimmed) {
            setError(isEnglish ? 'Please enter a code.' : '请输入激活码。');
            return;
        }
        if (trimmed.length < 6 || trimmed.length > 20) {
            setError(isEnglish ? 'Invalid code length.' : '激活码长度无效。');
            return;
        }
        if (!user || !profile) return;

        setState('claiming');
        setError('');
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
            });

            setState('success');
            refreshProfile().catch(() => {
            });
        } catch (err) {
            setState('error');
            const msg = err instanceof FirebaseError ? err.message : '';
            if (msg.includes('rate-limited')) {
                setError(isEnglish ? 'Too many attempts. Please wait a moment.' : '尝试次数过多，请稍后再试。');
            } else if (msg.includes('not-active-yet')) {
                setError(isEnglish ? 'This code is not active yet.' : '此激活码尚未激活。');
            } else if (msg.includes('expired')) {
                setError(isEnglish ? 'This code has expired.' : '此激活码已过期。');
            } else if (msg.includes('max-uses')) {
                setError(isEnglish ? 'This code has reached its maximum uses.' : '此激活码已达到最大使用次数。');
            } else if (msg.includes('already-have')) {
                setError(isEnglish ? 'You already have this badge.' : '您已拥有此徽章。');
            } else if (msg.includes('invalid') || msg.includes('inactive')) {
                setError(isEnglish ? 'Invalid or deactivated code.' : '激活码无效或已被停用。');
            } else {
                setError(isEnglish ? 'Something went wrong. Please try again.' : '出错了，请重试。');
            }
        }
    };

    if (!show) return null;

    return (
        <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && close()}>
            <div className="modal-content">
                <button className="modal-close" onClick={close} type="button">×</button>

                {state === 'idle' && (
                    <>
                        <h2 className="redeem-heading">
                            {isEnglish ? 'Redeem Badge Code' : '兑换徽章激活码'}
                        </h2>
                        <p className="redeem-subtitle">
                            {isEnglish
                                ? 'Enter your activation code to claim a badge.'
                                : '输入激活码来领取徽章。'}
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
                                placeholder={isEnglish ? 'Enter activation code' : '输入激活码'}
                                className="admin-search-input redeem-input"
                            />
                            {error && (
                                <p className="redeem-error-text">
                                    {error}
                                </p>
                            )}
                            <button type="submit" className="admin-generate-btn redeem-submit-btn">
                                {isEnglish ? 'Claim Badge' : '领取徽章'}
                            </button>
                        </form>
                    </>
                )}

                {state === 'claiming' && (
                    <div className="redeem-loading">
                        <div className="profile-spinner spinner-centered"/>
                        <p>{isEnglish ? 'Claiming...' : '领取中...'}</p>
                    </div>
                )}

                {state === 'success' && (
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
                        <button className="admin-generate-btn redeem-done-btn"
                                onClick={close}>
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
