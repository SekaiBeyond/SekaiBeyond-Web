import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { arrayUnion, collection, doc, getDocs, query, updateDoc, where } from 'firebase/firestore';
import { useAuth } from '~/components/AuthProvider';
import { useLanguage } from '~/components/LanguageContextProvider';
import { getFirebaseDb } from '~/lib/firebase';
import { usePastEvents } from '~/lib/pastEvents';

type ClaimState =
    'loading'
    | 'no-code'
    | 'invalid'
    | 'expired'
    | 'not-logged-in'
    | 'claiming'
    | 'success'
    | 'already-have'
    | 'error';

export const ClaimPage = () => {
    const [searchParams] = useSearchParams();
    const code = searchParams.get('code');
    const {user, profile, loading: authLoading, signIn} = useAuth();
    const {isEnglish} = useLanguage();
    const {pastEvents} = usePastEvents();

    const [state, setState] = useState<ClaimState>('loading');
    const [eventId, setEventId] = useState<string | null>(null);

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

        const claimBadge = async () => {
            setState('loading');
            const db = getFirebaseDb();
            const codesRef = collection(db, 'badgeCodes');
            const q = query(codesRef, where('code', '==', code), where('active', '==', true));
            const snapshot = await getDocs(q);

            if (snapshot.empty) {
                setState('invalid');
                return;
            }

            const codeDoc = snapshot.docs[0];
            const data = codeDoc.data();
            const claimedEventId = (data.eventId ?? data.eventTitle) as string;
            setEventId(claimedEventId);

            const now = new Date();
            if (data.activeFrom && new Date(data.activeFrom) > now) {
                setState('expired');
                return;
            }
            if (data.activeUntil && new Date(data.activeUntil) < now) {
                setState('expired');
                return;
            }

            if (profile.attendedEvents.includes(claimedEventId)) {
                setState('already-have');
                return;
            }

            setState('claiming');
            const userRef = doc(db, 'users', user.uid);
            await updateDoc(userRef, {
                attendedEvents: arrayUnion(claimedEventId),
            });
            setState('success');
        };

        claimBadge().catch(() => setState('error'));
    }, [code, user, profile, authLoading]);

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

                {state === 'expired' && (
                    <>
                        <h2>{isEnglish ? 'Code Expired' : '兑换码已过期'}</h2>
                        <p>{isEnglish ? 'This claim code is no longer within its active time period.' : '此兑换码不在有效时间范围内。'}</p>
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
                        <div className="profile-spinner" style={{margin: '0 auto 20px'}}/>
                        <h2>{isEnglish ? 'Checking In...' : '签到中...'}</h2>
                    </>
                )}

                {(state === 'success' || state === 'already-have') && event && (
                    <>
                        <div className="claim-badge-icon">
                            <img src={event.icon} alt={isEnglish ? event.title : event.titleCn}/>
                        </div>
                        <h2>
                            {state === 'success'
                                ? (isEnglish ? 'Event Claimed!' : '签到成功！')
                                : (isEnglish ? 'Already Checked In' : '已签到此活动')}
                        </h2>
                        <p className="claim-event-title">{isEnglish ? event.title : event.titleCn}</p>
                        <p className="claim-event-category">{isEnglish ? event.badge : event.badgeCn}</p>
                    </>
                )}

                {state === 'error' && (
                    <>
                        <h2>{isEnglish ? 'Something Went Wrong' : '出错了'}</h2>
                        <p>{isEnglish ? 'Could not check in. Please try again.' : '无法签到，请重试。'}</p>
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
