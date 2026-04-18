import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { useAuth } from '~/components/AuthProvider';
import { useLanguage } from '~/components/LanguageContextProvider';
import { callClaimEventCode, functionsErrorCode } from '~/lib/firebase';
import { usePastEvents } from '~/lib/pastEvents';
import { useTags } from '~/lib/tags';

type ClaimState =
    'loading'
    | 'no-code'
    | 'invalid'
    | 'not-active-yet'
    | 'expired'
    | 'max-uses'
    | 'not-logged-in'
    | 'claiming'
    | 'success'
    | 'already-have'
    | 'error';

export const ClaimPage = () => {
    const [searchParams] = useSearchParams();
    const code = searchParams.get('code');
    const {user, profile, loading: authLoading, signIn, refreshProfile} = useAuth();
    const {isEnglish} = useLanguage();
    const {pastEvents} = usePastEvents();
    const {tags} = useTags();

    const [state, setState] = useState<ClaimState>('loading');
    const [eventId, setEventId] = useState<string | null>(null);
    const [retryCount, setRetryCount] = useState(0);

    const event = pastEvents.find(e => e.id === eventId);

    useEffect(() => {
        if (!code) {
            setState('no-code');
            return;
        }
        if (authLoading) return;
        if (!user || !profile) {
            setState('not-logged-in');
            return;
        }

        const claimEvent = async () => {
            setState('claiming');
            const result = await callClaimEventCode({code});
            const claimedEventId = result.data.eventId;
            setEventId(claimedEventId);
            setState('success');
            refreshProfile().catch(() => {
            });
        };

        claimEvent().catch((err) => {
            switch (functionsErrorCode(err)) {
                case 'not-active-yet':
                    setState('not-active-yet');
                    break;
                case 'expired':
                    setState('expired');
                    break;
                case 'max-uses':
                    setState('max-uses');
                    break;
                case 'already-have':
                    setState('already-have');
                    break;
                case 'invalid':
                case 'inactive':
                    setState('invalid');
                    break;
                default:
                    setState('error');
            }
        });
    }, [code, user, profile, authLoading, retryCount]);

    if (state === 'loading' || authLoading) {
        return (
            <div className="profile-loading">
                <div className="profile-spinner"/>
            </div>
        );
    }

    return (
        <div className="profile-login-prompt">
            <div className="claim-card">
                {state === 'no-code' && (
                    <>
                        <h2>{isEnglish ? 'No Claim Code' : '缺少兑换码'}</h2>
                        <p>{isEnglish ? 'This link is missing a claim code.' : '此链接缺少兑换码。'}</p>
                    </>
                )}

                {state === 'invalid' && (
                    <>
                        <h2>{isEnglish ? 'Invalid Code' : '无效的兑换码'}</h2>
                        <p>{isEnglish ? 'This claim code is invalid or has been deactivated.' : '此兑换码无效或已被停用。'}</p>
                    </>
                )}

                {state === 'not-active-yet' && (
                    <>
                        <h2>{isEnglish ? 'Code Not Active Yet' : '兑换码尚未生效'}</h2>
                        <p>{isEnglish ? 'This claim code is not active yet. Please try again later.' : '此兑换码尚未生效，请稍后再试。'}</p>
                    </>
                )}

                {state === 'expired' && (
                    <>
                        <h2>{isEnglish ? 'Code Expired' : '兑换码已过期'}</h2>
                        <p>{isEnglish ? 'This claim code has expired.' : '此兑换码已过期。'}</p>
                    </>
                )}

                {state === 'max-uses' && (
                    <>
                        <h2>{isEnglish ? 'Code Fully Used' : '兑换码已用完'}</h2>
                        <p>{isEnglish ? 'This claim code has reached its maximum number of uses.' : '此兑换码已达到最大使用次数。'}</p>
                    </>
                )}

                {state === 'not-logged-in' && (
                    <>
                        <h2>{isEnglish ? 'Sign In to Claim Event' : '登录以签到活动'}</h2>
                        <p>{isEnglish ? 'You need to sign in first to check in for this event.' : '请先登录以签到此活动。'}</p>
                        <button onClick={signIn} className="profile-sign-in-btn">
                            {isEnglish ? 'Sign in with Google' : '使用 Google 登录'}
                        </button>
                    </>
                )}

                {state === 'claiming' && (
                    <>
                        <div className="profile-spinner spinner-centered"/>
                        <h2>{isEnglish ? 'Checking In...' : '签到中...'}</h2>
                    </>
                )}

                {(state === 'success' || state === 'already-have') && (
                    <>
                        {event && (
                            <div className="claim-badge-icon">
                                <img src={event.icon} alt={isEnglish ? event.title : event.titleCn}/>
                            </div>
                        )}
                        <h2>
                            {state === 'success'
                                ? (isEnglish ? 'Event Claimed!' : '签到成功！')
                                : (isEnglish ? 'Already Checked In' : '已签到此活动')}
                        </h2>
                        {event ? (
                            <>
                                <p className="claim-event-title">{isEnglish ? event.title : event.titleCn}</p>
                                <p className="claim-event-category">{(() => {
                                    const tag = tags.find(t => t.id === event.tagId);
                                    return tag ? (isEnglish ? tag.name : tag.nameCn) : '';
                                })()}</p>
                            </>
                        ) : (
                            <p className="claim-event-title">{eventId}</p>
                        )}
                    </>
                )}

                {state === 'error' && (
                    <>
                        <h2>{isEnglish ? 'Something Went Wrong' : '出错了'}</h2>
                        <p>{isEnglish ? 'Could not check in. Please try again.' : '无法签到，请重试。'}</p>
                        <button
                            onClick={() => setRetryCount(c => c + 1)}
                            className="profile-sign-in-btn"
                        >
                            {isEnglish ? 'Try Again' : '重试'}
                        </button>
                    </>
                )}

                <div className="claim-actions">
                    <a href="/profile" className="claim-profile-link">
                        {isEnglish ? 'View My Profile' : '查看个人主页'}
                    </a>
                    <a href="/" className="profile-back-link">
                        {isEnglish ? 'Back to Home' : '返回首页'}
                    </a>
                </div>
            </div>
        </div>
    );
};
