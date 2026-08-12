import { useCallback, useRef, useState } from 'react';
import { useLanguage } from '~/components/LanguageContextProvider';
import { callRedeemTicket, functionsErrorCode } from '~/lib/firebase';
import { useQrScanner } from '~/lib/useQrScanner';
import { QrScannerViewport } from './QrScannerViewport';
import { ticketTypeLabel } from './tickets/types';

type ScanStatus =
    | {kind: 'idle'}
    | {kind: 'scanning'}
    | {kind: 'loading'; ticketId: string}
    | {kind: 'success'; attendeeName: string; attendeeEmail: string; ticketType: string; userCheckedIn: boolean}
    | {
    kind: 'already';
    attendeeName: string;
    attendeeEmail: string;
    ticketType: string;
    redeemedBy: string;
    redeemedAt: string | null
}
    | {kind: 'error'; reason: string};

interface CachedRedemption {
    ticketId: string;
    attendeeName: string;
    attendeeEmail: string;
    ticketType: string;
    userCheckedIn: boolean;
}

const DEDUPE_MS = 3000;
const CACHE_SIZE = 20;

interface TicketScannerProps {
    eventId: string;
    eventTitle: string;
    onRedeemed: () => void;
}

export function TicketScanner({eventId, eventTitle, onRedeemed}: TicketScannerProps) {
    const {isEnglish} = useLanguage();
    const lastScanRef = useRef<{ticketId: string; at: number} | null>(null);
    const redeemedCacheRef = useRef<CachedRedemption[]>([]);

    const [status, setStatus] = useState<ScanStatus>({kind: 'idle'});
    const [manualTicketId, setManualTicketId] = useState('');
    const [busy, setBusy] = useState(false);

    const handleTicket = useCallback(async (ticketId: string) => {
        const last = lastScanRef.current;
        const now = Date.now();
        if (last && last.ticketId === ticketId && now - last.at < DEDUPE_MS) return;

        // Check RAM cache for "immediate" success on repeat scans in the same session
        const cached = redeemedCacheRef.current.find(c => c.ticketId === ticketId);
        if (cached) {
            setStatus({
                kind: 'success',
                attendeeName: cached.attendeeName,
                attendeeEmail: cached.attendeeEmail,
                ticketType: cached.ticketType,
                userCheckedIn: cached.userCheckedIn,
            });
            return;
        }

        lastScanRef.current = {ticketId, at: now};
        setBusy(true);
        setStatus({kind: 'loading', ticketId});
        try {
            const result = await callRedeemTicket({eventId, ticketId});
            const d = result.data;
            if (d.alreadyRedeemed) {
                setStatus({
                    kind: 'already',
                    attendeeName: d.attendeeName ?? '',
                    attendeeEmail: d.attendeeEmail ?? '',
                    ticketType: d.ticketType ?? 'normal',
                    redeemedBy: d.redeemedBy ?? '',
                    redeemedAt: d.redeemedAt ?? null,
                });
            } else {
                const successData = {
                    attendeeName: d.attendeeName ?? '',
                    attendeeEmail: d.attendeeEmail ?? '',
                    ticketType: d.ticketType ?? 'normal',
                    userCheckedIn: !!d.userCheckedIn,
                };
                setStatus({kind: 'success', ...successData});

                redeemedCacheRef.current = [
                    {ticketId, ...successData},
                    ...redeemedCacheRef.current,
                ].slice(0, CACHE_SIZE);

                onRedeemed();
            }
        } catch (err) {
            const code = functionsErrorCode(err);
            let reason: string;
            if (code === 'voided') {
                reason = isEnglish ? 'This ticket has been voided.' : '此门票已作废。';
            } else if (code === 'invalid') {
                reason = isEnglish ? 'Ticket not found.' : '未找到此门票。';
            } else if (code === 'not-authorized') {
                reason = isEnglish ? 'You are not authorized to scan for this event.' : '你没有权限扫描此活动的门票。';
            } else if (code === 'event-missing') {
                reason = isEnglish ? 'Event not found.' : '活动不存在。';
            } else {
                reason = isEnglish ? 'Scan failed. Please try again.' : '扫描失败，请重试。';
            }
            setStatus({kind: 'error', reason});
        } finally {
            setBusy(false);
        }
    }, [eventId, isEnglish, onRedeemed]);

    // Each decoded code: redeem if it's for this event, warn if it's for another,
    // ignore anything unparseable. Always returns false so scanning continues.
    const onDecode = useCallback((raw: string): boolean => {
        const parsed = parseTicketUrl(raw);
        if (parsed && parsed.eventId === eventId) {
            void handleTicket(parsed.ticketId);
        } else if (parsed && parsed.eventId !== eventId) {
            setStatus({
                kind: 'error',
                reason: isEnglish
                    ? 'QR code is for a different event.'
                    : '二维码属于其他活动。',
            });
        }
        return false;
    }, [eventId, handleTicket, isEnglish]);

    const scanner = useQrScanner({
        onDecode,
        onStart: () => setStatus({kind: 'scanning'}),
        onStartError: () => setStatus({kind: 'idle'}),
        cameraErrorMessage: isEnglish
            ? 'Camera permission denied or not available. Use manual entry below.'
            : '无法访问摄像头，请使用下方手动输入。',
        logLabel: '[TicketScanner]',
    });

    const submitManual = async () => {
        const raw = manualTicketId.trim();
        if (!raw) return;
        const parsed = parseTicketUrl(raw);
        const ticketId = parsed?.ticketId ?? raw;
        await handleTicket(ticketId);
        setManualTicketId('');
    };

    const clearStatus = () => {
        setStatus(scanner.cameraActive ? {kind: 'scanning'} : {kind: 'idle'});
        lastScanRef.current = null;
    };

    return (
        <div className="admin-tickets-scanner">
            <p className="admin-helper-text">
                {isEnglish
                    ? `Scanning tickets for "${eventTitle}". Point the camera at a ticket QR to redeem.`
                    : `正在扫描"${eventTitle}"的门票。将摄像头对准二维码进行验证。`}
            </p>

            <QrScannerViewport scanner={scanner} isEnglish={isEnglish} startDisabled={busy}>
                {status.kind !== 'idle' && status.kind !== 'scanning' && (
                    <button className="admin-toggle-btn admin-toggle-edit" onClick={clearStatus}>
                        {isEnglish ? 'Next Scan' : '继续扫描'}
                    </button>
                )}
            </QrScannerViewport>

            <ResultBanner status={status} isEnglish={isEnglish}/>

            <div className="admin-tickets-scanner-manual">
                <label className="admin-tickets-template-field">
                    <span>{isEnglish ? 'Manual ticket ID or URL' : '手动输入门票 ID 或链接'}</span>
                    <div className="admin-tickets-scanner-manual-row">
                        <input
                            type="text"
                            className="admin-input"
                            placeholder={isEnglish ? 'Paste ticket ID or QR URL' : '粘贴门票 ID 或二维码链接'}
                            value={manualTicketId}
                            onChange={(e) => setManualTicketId(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') void submitManual();
                            }}
                            disabled={busy}
                        />
                        <button
                            className="admin-toggle-btn admin-toggle-save"
                            onClick={() => void submitManual()}
                            disabled={busy || !manualTicketId.trim()}
                        >
                            {isEnglish ? 'Redeem' : '验证'}
                        </button>
                    </div>
                </label>
            </div>
        </div>
    );
}

function parseTicketUrl(raw: string): {ticketId: string; eventId: string} | null {
    try {
        const url = new URL(raw);
        const ticket = url.searchParams.get('ticket');
        const event = url.searchParams.get('event');
        if (ticket && event) return {ticketId: ticket, eventId: event};
    } catch {
        // not a URL — caller falls back to raw string
    }
    return null;
}

function ResultBanner({status, isEnglish}: {status: ScanStatus; isEnglish: boolean}) {
    if (status.kind === 'idle' || status.kind === 'scanning') return null;
    if (status.kind === 'loading') {
        return (
            <div className="admin-tickets-scan-banner admin-tickets-scan-loading">
                <strong>{isEnglish ? 'Detecting...' : '检测中...'}</strong>
                <div>{isEnglish ? 'Ticket ID:' : '门票 ID：'} {status.ticketId}</div>
            </div>
        );
    }
    if (status.kind === 'success') {
        return (
            <div className="admin-tickets-scan-banner admin-tickets-scan-success">
                <strong>{isEnglish ? '✓ Redeemed' : '✓ 验证成功'}</strong>
                <div>{status.attendeeName} <span
                    className={`admin-tickets-tag admin-tickets-tag-type-${status.ticketType.toLowerCase().replace(/\s+/g, '-')}`}>{ticketTypeLabel(status.ticketType, isEnglish)}</span>
                </div>
                <div className="admin-user-email">{status.attendeeEmail}</div>
                <div className="admin-helper-text">
                    {status.userCheckedIn
                        ? (isEnglish ? 'User auto-checked in.' : '用户已自动签到。')
                        : (isEnglish ? 'Attendee not registered on site.' : '参加者未注册账号。')}
                </div>
            </div>
        );
    }
    if (status.kind === 'already') {
        return (
            <div className="admin-tickets-scan-banner admin-tickets-scan-already">
                <strong>{isEnglish ? '! Already redeemed' : '! 此门票已验证'}</strong>
                <div>{status.attendeeName} <span
                    className={`admin-tickets-tag admin-tickets-tag-type-${status.ticketType.toLowerCase().replace(/\s+/g, '-')}`}>{ticketTypeLabel(status.ticketType, isEnglish)}</span>
                </div>
                <div className="admin-user-email">{status.attendeeEmail}</div>
                <div className="admin-helper-text">
                    {isEnglish ? 'Redeemed by ' : '验证人：'}
                    {status.redeemedBy || (isEnglish ? 'unknown' : '未知')}
                    {status.redeemedAt && (
                        <> — {new Date(status.redeemedAt).toLocaleString(isEnglish ? 'en-US' : 'zh-CN', {
                            month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
                        })}</>
                    )}
                </div>
            </div>
        );
    }
    return (
        <div className="admin-tickets-scan-banner admin-tickets-scan-error">
            <strong>{isEnglish ? '✗ Error' : '✗ 错误'}</strong>
            <div>{status.reason}</div>
        </div>
    );
}
