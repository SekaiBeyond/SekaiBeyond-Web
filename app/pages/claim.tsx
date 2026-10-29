import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { useAuth } from '~/components/AuthProvider';
import { useLanguage } from '~/components/LanguageContextProvider';
import { callClaimEventCode, callRedeemTicket, functionsErrorCode, functionsErrorDetails } from '~/lib/firebase';
import { anonymousAttendeeName } from './admin/tickets/types';

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
    | 'ticket-hometown-unlisted'
    | 'ticket-other-event'
    | 'ticket-not-authorized'
    | 'ticket-event-missing';

interface EventInfo {
    eventId: string;
    eventTitle: string;
    eventTitleCn: string;
    eventPoster: string;
}

interface TicketInfo {
    ticketId: string;
    attendeeName: string;
    attendeeEmail: string;
    eventTitle: string;
    hometown: boolean;
    /** A HomeTown ticket missing from the imported list, let in with a warning. */
    unlisted: boolean;
    /** A HomeTown ticket left out of the latest export: refunded or transferred, most likely. */
    missingFromHometown: boolean;
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
    // The event a HomeTown ticket refused here belongs to.
    const [otherEventTitle, setOtherEventTitle] = useState('');
    const [retryCount, setRetryCount] = useState(0);
    // Whether there is a profile, not the object: a claim refreshes it, and
    // re-running on the new one would claim again.
    const hasProfile = !!profile;

    useEffect(() => {
        if (!code && !isTicketFlow) {
            setState('no-code');
            return;
        }
        if (authLoading) return;
        if (!user || !hasProfile) {
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
                    ticketId: ticketIdParam!,
                    attendeeName: d.attendeeName ?? '',
                    attendeeEmail: d.attendeeEmail ?? '',
                    eventTitle: d.eventTitle ?? '',
                    hometown: !!d.hometown,
                    unlisted: !!d.unlisted,
                    missingFromHometown: !!d.missingFromHometown,
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
                    case 'hometown-unlisted':
                        setState('ticket-hometown-unlisted');
                        break;
                    case 'hometown-other-event':
                        setOtherEventTitle(functionsErrorDetails<{eventTitle?: string}>(err)?.eventTitle ?? '');
                        setState('ticket-other-event');
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
            setEventInfo(result.data);
            setState('success');
            refreshProfile().catch(() => {
            });
        };

        claimEvent().catch((err) => {
            const errCode = functionsErrorCode(err);
            if (errCode === 'already-have') {
                const details = functionsErrorDetails<EventInfo>(err);
                if (details) setEventInfo(details);
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
    }, [code, ticketIdParam, eventIdParam, isTicketFlow, user, hasProfile, authLoading, retryCount]);

    if (state === 'loading' || authLoading) {
        return (
            <div className="profile-loading">
                <div className="spinner"/>
            </div>
        );
    }

    // What a door is told when the link reaches someone who can't redeem it.
    const showAtDoor = (
        <>
            <h2>{isEnglish ? 'Show This at the Door' : '请在入场时出示此二维码'}</h2>
            <p>{isEnglish
                ? 'This ticket link is scanned by event staff at check-in. Keep this page (or the QR code from your email) handy when you arrive.'
                : '此门票链接由活动工作人员在入场时扫描。请在到场时出示此页面或邮件中的二维码。'}</p>
        </>
    );

    // The event and who the ticket is for, whichever way the scan went.
    const ticketHolder = ticketInfo && (
        <>
            {ticketInfo.eventTitle && (
                <p className="claim-event-title">{ticketInfo.eventTitle}</p>
            )}
            <p>
                <strong>
                    {ticketInfo.attendeeName || ticketInfo.attendeeEmail
                        || anonymousAttendeeName({hometown: ticketInfo.hometown, ticketIds: [ticketInfo.ticketId]}, isEnglish)}
                </strong>
            </p>
            {ticketInfo.attendeeName && ticketInfo.attendeeEmail && (
                <p className="admin-user-email">{ticketInfo.attendeeEmail}</p>
            )}
        </>
    );

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

                {state === 'not-logged-in' && (isTicketFlow ? showAtDoor : (
                    <>
                        <h2>{isEnglish ? 'Sign In to Claim Event' : '登录以签到活动'}</h2>
                        <p>{isEnglish ? 'You need to sign in first to check in for this event.' : '请先登录以签到此活动。'}</p>
                        <button onClick={signIn} className="profile-sign-in-btn">
                            {isEnglish ? 'Sign in with Google' : '使用 Google 登录'}
                        </button>
                    </>
                ))}

                {state === 'claiming' && (
                    <>
                        <div className="spinner spinner-centered"/>
                        <h2>{isEnglish ? 'Checking In...' : '签到中...'}</h2>
                    </>
                )}

                {state === 'redeeming' && (
                    <>
                        <div className="spinner spinner-centered"/>
                        <h2>{isEnglish ? 'Redeeming Ticket...' : '验证门票中...'}</h2>
                    </>
                )}

                {(state === 'success' || state === 'already-have') && (
                    <>
                        {eventInfo?.eventPoster && (
                            <div className="claim-badge-icon">
                                <img src={eventInfo.eventPoster}
                                     alt={isEnglish ? eventInfo.eventTitle : (eventInfo.eventTitleCn || eventInfo.eventTitle)}/>
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
                        <h2>
                            {ticketInfo.unlisted
                                ? (isEnglish ? '✓ Let In — Not on the HomeTown List' : '✓ 已放行 — 不在 HomeTown 名单中')
                                : (isEnglish ? '✓ Ticket Redeemed' : '✓ 门票已验证')}
                        </h2>
                        {ticketHolder}
                        {/* The scanner's warnings, for a code read with a phone's camera. */}
                        {ticketInfo.unlisted ? (
                            <p className="admin-helper-text admin-tickets-edit-warning">
                                {isEnglish
                                    ? 'Check their HomeTown confirmation email is for this event and shows this number; if not, get an admin. Bought after the last import, or not a real ticket for this event. It\'s recorded now, so a second scan of it will be refused.'
                                    : '请核对其 HomeTown 购票确认邮件是否为本活动且门票号一致；若不一致或无法出示，请联系管理员。可能是上次导入后购买的，也可能不是本活动的真票。此票现已记录，再次扫描将被拒绝。'}
                            </p>
                        ) : ticketInfo.missingFromHometown ? (
                            <p className="admin-helper-text admin-tickets-edit-warning">
                                {isEnglish
                                    ? 'Not in the latest HomeTown export: it may have been refunded or transferred. Ask to see their HomeTown ticket email if in doubt.'
                                    : '不在最新的 HomeTown 导出中：可能已退款或转让。如有疑问，请查看其 HomeTown 购票邮件。'}
                            </p>
                        ) : (
                            <p className="admin-helper-text">
                                {ticketInfo.userCheckedIn
                                    ? (isEnglish ? 'Attendee auto-checked in.' : '参加者已自动签到。')
                                    : (isEnglish ? 'Ticket redeemed (attendee not registered on site).' : '门票验证成功（参加者未注册账号）。')}
                            </p>
                        )}
                    </>
                )}

                {state === 'ticket-already-redeemed' && ticketInfo && (
                    <>
                        <h2>{isEnglish ? '! Already Redeemed' : '! 此门票已验证'}</h2>
                        {ticketHolder}
                        <p className="admin-helper-text">
                            {isEnglish ? 'Redeemed by ' : '验证人：'}
                            {ticketInfo.redeemedBy || (isEnglish ? 'unknown' : '未知')}
                            {ticketInfo.redeemedAt && (
                                <> — {new Date(ticketInfo.redeemedAt).toLocaleString(isEnglish ? 'en-US' : 'zh-CN', {
                                    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
                                })}</>
                            )}
                            {ticketInfo.unlisted && (isEnglish
                                ? ', while it wasn\'t on the HomeTown list.'
                                : '，当时不在 HomeTown 名单中。')}
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

                {state === 'ticket-hometown-unlisted' && (
                    <>
                        <h2>{isEnglish ? 'Not on the HomeTown List' : '不在 HomeTown 名单中'}</h2>
                        <p>{isEnglish
                            ? 'This HomeTown ticket isn\'t on the imported list. Ask an admin to import the latest HomeTown guest list.'
                            : '此 HomeTown 门票不在已导入的名单中。请管理员导入最新的 HomeTown 来宾名单。'}</p>
                    </>
                )}

                {state === 'ticket-other-event' && (
                    <>
                        <h2>{isEnglish ? 'Ticket for Another Event' : '其他活动的门票'}</h2>
                        <p>{isEnglish
                            ? `This HomeTown ticket is for another event${otherEventTitle ? `: ${otherEventTitle}` : ''}.`
                            : `此 HomeTown 门票属于其他活动${otherEventTitle ? `：${otherEventTitle}` : ''}。`}</p>
                    </>
                )}

                {state === 'ticket-not-authorized' && showAtDoor}

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
