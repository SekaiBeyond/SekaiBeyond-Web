import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { useAuth } from '~/components/AuthProvider';
import { useLanguage } from '~/components/LanguageContextProvider';
import { callClaimEventCode, callRedeemTicket, functionsErrorCode, functionsErrorDetails } from '~/lib/firebase';

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
    | 'error'
    | 'redeeming'
    | 'ticket-redeemed'
    | 'ticket-already-redeemed'
    | 'ticket-voided'
    | 'ticket-invalid'
    | 'ticket-not-authorized'
    | 'ticket-event-missing';

interface EventInfo {
    eventId: string;
    eventTitle: string;
    eventTitleCn: string;
    eventPoster: string;
}

interface TicketInfo {
    attendeeName: string;
    attendeeEmail: string;
    eventTitle: string;
    userCheckedIn: boolean;
    redeemedBy?: string;
    redeemedAt?: string | null;
}

export const ClaimPage = () => {
    const [searchParams] = useSearchParams();
    const code = searchParams.get('code');
    const ticketIdParam = searchParams.get('ticket');
    const eventIdParam = searchParams.get('event');
    const isTicketFlow = !!(ticketIdParam && eventIdParam);
    const {user, profile, loading: authLoading, signIn, refreshProfile} = useAuth();
    const {isEnglish} = useLanguage();

    const [state, setState] = useState<ClaimState>('loading');
    const [eventInfo, setEventInfo] = useState<EventInfo | null>(null);
    const [ticketInfo, setTicketInfo] = useState<TicketInfo | null>(null);
    const [retryCount, setRetryCount] = useState(0);

    useEffect(() => {
        if (!code && !isTicketFlow) {
            setState('no-code');
            return;
        }
        if (authLoading) return;
        if (!user || !profile) {
            setState('not-logged-in');
            return;
        }

        if (isTicketFlow) {
            const redeem = async () => {
                setState('redeeming');
                const result = await callRedeemTicket({
                    eventId: eventIdParam!,
                    ticketId: ticketIdParam!,
                });
                const d = result.data;
                setTicketInfo({
                    attendeeName: d.attendeeName ?? '',
                    attendeeEmail: d.attendeeEmail ?? '',
                    eventTitle: d.eventTitle ?? '',
                    userCheckedIn: !!d.userCheckedIn,
                    redeemedBy: d.redeemedBy,
                    redeemedAt: d.redeemedAt ?? null,
                });
                if (d.alreadyRedeemed) {
                    setState('ticket-already-redeemed');
                } else {
                    setState('ticket-redeemed');
                    refreshProfile().catch(() => {
                    });
                }
            };
            redeem().catch((err) => {
                const errCode = functionsErrorCode(err);
                switch (errCode) {
                    case 'voided':
                        setState('ticket-voided');
                        break;
                    case 'invalid':
                        setState('ticket-invalid');
                        break;
                    case 'not-authorized':
                        setState('ticket-not-authorized');
                        break;
                    case 'event-missing':
                        setState('ticket-event-missing');
                        break;
                    default:
                        setState('error');
                }
            });
            return;
        }

        const claimEvent = async () => {
            setState('claiming');
            const result = await callClaimEventCode({code: code!});
            setEventInfo({
                eventId: result.data.eventId,
                eventTitle: result.data.eventTitle,
                eventTitleCn: result.data.eventTitleCn,
                eventPoster: result.data.eventPoster,
            });
            setState('success');
            refreshProfile().catch(() => {
            });
        };

        claimEvent().catch((err) => {
            const errCode = functionsErrorCode(err);
            if (errCode === 'already-have') {
                const details = functionsErrorDetails<EventInfo & {code: string}>(err);
                if (details) {
                    setEventInfo({
                        eventId: details.eventId,
                        eventTitle: details.eventTitle,
                        eventTitleCn: details.eventTitleCn,
                        eventPoster: details.eventPoster,
                    });
                }
                setState('already-have');
                return;
            }
            switch (errCode) {
                case 'not-active-yet':
                    setState('not-active-yet');
                    break;
                case 'expired':
                    setState('expired');
                    break;
                case 'max-uses':
                    setState('max-uses');
                    break;
                case 'invalid':
                case 'inactive':
                    setState('invalid');
                    break;
                default:
                    setState('error');
            }
        });
    }, [code, ticketIdParam, eventIdParam, isTicketFlow, user, profile, authLoading, retryCount]);

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
                        <h2>
                            {isTicketFlow
                                ? (isEnglish ? 'Sign In to Redeem Ticket' : '登录以验证门票')
                                : (isEnglish ? 'Sign In to Claim Event' : '登录以签到活动')}
                        </h2>
                        <p>
                            {isTicketFlow
                                ? (isEnglish ? 'You need to sign in first to redeem this ticket.' : '请先登录以验证此门票。')
                                : (isEnglish ? 'You need to sign in first to check in for this event.' : '请先登录以签到此活动。')}
                        </p>
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

                {state === 'redeeming' && (
                    <>
                        <div className="profile-spinner spinner-centered"/>
                        <h2>{isEnglish ? 'Redeeming Ticket...' : '验证门票中...'}</h2>
                    </>
                )}

                {(state === 'success' || state === 'already-have') && (
                    <>
                        {eventInfo?.eventPoster && (
                            <div className="claim-badge-icon">
                                <img src={eventInfo.eventPoster}
                                     alt={isEnglish ? eventInfo.eventTitle : eventInfo.eventTitleCn}/>
                            </div>
                        )}
                        <h2>
                            {state === 'success'
                                ? (isEnglish ? 'Event Claimed!' : '签到成功！')
                                : (isEnglish ? 'Already Checked In' : '已签到此活动')}
                        </h2>
                        {eventInfo && (eventInfo.eventTitle || eventInfo.eventTitleCn) && (
                            <p className="claim-event-title">
                                {isEnglish
                                    ? (eventInfo.eventTitle || eventInfo.eventTitleCn)
                                    : (eventInfo.eventTitleCn || eventInfo.eventTitle)}
                            </p>
                        )}
                    </>
                )}

                {state === 'ticket-redeemed' && ticketInfo && (
                    <>
                        <h2>{isEnglish ? '✓ Ticket Redeemed' : '✓ 门票已验证'}</h2>
                        {ticketInfo.eventTitle && (
                            <p className="claim-event-title">{ticketInfo.eventTitle}</p>
                        )}
                        <p><strong>{ticketInfo.attendeeName}</strong></p>
                        <p className="admin-user-email">{ticketInfo.attendeeEmail}</p>
                        <p className="admin-helper-text">
                            {ticketInfo.userCheckedIn
                                ? (isEnglish ? 'Attendee auto-checked in.' : '参加者已自动签到。')
                                : (isEnglish ? 'Ticket redeemed (attendee not registered on site).' : '门票验证成功（参加者未注册账号）。')}
                        </p>
                    </>
                )}

                {state === 'ticket-already-redeemed' && ticketInfo && (
                    <>
                        <h2>{isEnglish ? '! Already Redeemed' : '! 此门票已验证'}</h2>
                        {ticketInfo.eventTitle && (
                            <p className="claim-event-title">{ticketInfo.eventTitle}</p>
                        )}
                        <p><strong>{ticketInfo.attendeeName}</strong></p>
                        <p className="admin-user-email">{ticketInfo.attendeeEmail}</p>
                        <p className="admin-helper-text">
                            {isEnglish ? 'Redeemed by ' : '验证人：'}
                            {ticketInfo.redeemedBy || (isEnglish ? 'unknown' : '未知')}
                            {ticketInfo.redeemedAt && (
                                <> — {new Date(ticketInfo.redeemedAt).toLocaleString(isEnglish ? 'en-US' : 'zh-CN', {
                                    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
                                })}</>
                            )}
                        </p>
                    </>
                )}

                {state === 'ticket-voided' && (
                    <>
                        <h2>{isEnglish ? 'Ticket Voided' : '门票已作废'}</h2>
                        <p>{isEnglish ? 'This ticket has been voided and cannot be used.' : '此门票已作废，无法使用。'}</p>
                    </>
                )}

                {state === 'ticket-invalid' && (
                    <>
                        <h2>{isEnglish ? 'Invalid Ticket' : '无效的门票'}</h2>
                        <p>{isEnglish ? 'This ticket was not found.' : '未找到此门票。'}</p>
                    </>
                )}

                {state === 'ticket-not-authorized' && (
                    <>
                        <h2>{isEnglish ? 'Not Authorized' : '无权操作'}</h2>
                        <p>{isEnglish
                            ? 'You are not authorized to redeem tickets for this event. Only event staff can scan tickets.'
                            : '你没有权限验证此活动的门票。仅活动工作人员可以扫描门票。'}</p>
                    </>
                )}

                {state === 'ticket-event-missing' && (
                    <>
                        <h2>{isEnglish ? 'Event Not Found' : '活动不存在'}</h2>
                        <p>{isEnglish ? 'The event for this ticket no longer exists.' : '此门票对应的活动已不存在。'}</p>
                    </>
                )}

                {state === 'error' && (
                    <>
                        <h2>{isEnglish ? 'Something Went Wrong' : '出错了'}</h2>
                        <p>
                            {isTicketFlow
                                ? (isEnglish ? 'Could not redeem ticket. Please try again.' : '无法验证门票，请重试。')
                                : (isEnglish ? 'Could not check in. Please try again.' : '无法签到，请重试。')}
                        </p>
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
