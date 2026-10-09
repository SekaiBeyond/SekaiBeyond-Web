import { useCallback, useRef, useState } from 'react';
import { useLanguage } from '~/components/LanguageContextProvider';
import { callRedeemTicket, functionsErrorCode } from '~/lib/firebase';
import { useQrScanner } from '~/lib/useQrScanner';
import { type ScanOutcome, useScanSound, useScanVibration } from '~/lib/useScanFeedback';
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
    /** When the server's grace window for it closes, on this device's clock. */
    until: number;
    attendeeName: string;
    attendeeEmail: string;
    ticketType: string;
    userCheckedIn: boolean;
}

const DEDUPE_MS = 3000;
const CACHE_SIZE = 20;
/**
 * How long the same result for the same code stays quiet after it last came up.
 * A code held in front of the camera comes back every frame, or from the server
 * every DEDUPE_MS; this outlasts that plus the round trip, so it sounds once.
 */
const CUE_QUIET_MS = 5000;

interface TicketScannerProps {
    eventId: string;
    eventTitle: string;
    onRedeemed: () => void;
}

export function TicketScanner({eventId, eventTitle, onRedeemed}: TicketScannerProps) {
    const {isEnglish} = useLanguage();
    const lastScanRef = useRef<{ticketId: string; at: number} | null>(null);
    const redeemedCacheRef = useRef<CachedRedemption[]>([]);
    const lastCueRef = useRef<{key: string; at: number} | null>(null);
    const sound = useScanSound();
    const vibration = useScanVibration();
    const {play: playSound} = sound;
    const {play: vibrate} = vibration;

    const [status, setStatus] = useState<ScanStatus>({kind: 'idle'});
    const [manualTicketId, setManualTicketId] = useState('');
    const [busy, setBusy] = useState(false);

    // Signals a result once per showing of a code: each repeat of the same result
    // for it inside CUE_QUIET_MS restarts the quiet instead of playing again.
    const cue = useCallback((outcome: ScanOutcome, code: string) => {
        const key = `${outcome}:${code}`;
        const now = Date.now();
        const last = lastCueRef.current;
        lastCueRef.current = {key, at: now};
        if (last?.key === key && now - last.at < CUE_QUIET_MS) return;
        playSound(outcome);
        vibrate(outcome);
    }, [playSound, vibrate]);

    const handleTicket = useCallback(async (ticketId: string) => {
        const last = lastScanRef.current;
        const now = Date.now();
        if (last && last.ticketId === ticketId && now - last.at < DEDUPE_MS) return;

        // A ticket this device let in moments ago reads as the same success without
        // a round trip, but only inside the server's grace window. Past it the scan
        // goes to the server, which answers "already redeemed": a ticket shown again
        // later — a shared screenshot — must not get in on the strength of a cache.
        const cached = redeemedCacheRef.current.find(c => c.ticketId === ticketId && now < c.until);
        if (cached) {
            setStatus({
                kind: 'success',
                attendeeName: cached.attendeeName,
                attendeeEmail: cached.attendeeEmail,
                ticketType: cached.ticketType,
                userCheckedIn: cached.userCheckedIn,
            });
            cue('success', ticketId);
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
                cue('issue', ticketId);
            } else {
                const successData = {
                    attendeeName: d.attendeeName ?? '',
                    attendeeEmail: d.attendeeEmail ?? '',
                    ticketType: d.ticketType ?? 'normal',
                    userCheckedIn: !!d.userCheckedIn,
                };
                setStatus({kind: 'success', ...successData});
                cue('success', ticketId);

                // The server times the window from the first admission, and a rescan
                // it answers can come well into it, so it says how much is left. A
                // duration, not a time, so this phone's clock being off doesn't
                // matter. Without it, the entry expires at once.
                redeemedCacheRef.current = [
                    {ticketId, until: now + (d.graceRemainingMs ?? 0), ...successData},
                    ...redeemedCacheRef.current.filter(c => c.ticketId !== ticketId),
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
            cue('issue', ticketId);
        } finally {
            setBusy(false);
        }
    }, [eventId, isEnglish, onRedeemed, cue]);

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
            cue('issue', raw);
        }
        return false;
    }, [eventId, handleTicket, isEnglish, cue]);

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
        // Typed in on purpose, so it sounds even if the camera just read the same.
        lastCueRef.current = null;
        await handleTicket(ticketId);
        setManualTicketId('');
    };

    const clearStatus = () => {
        setStatus(scanner.cameraActive ? {kind: 'scanning'} : {kind: 'idle'});
        lastScanRef.current = null;
        lastCueRef.current = null;
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
                <div className="admin-tickets-scanner-feedback">
                    <label className="admin-checkbox-label">
                        <input
                            type="checkbox"
                            checked={sound.enabled}
                            onChange={(e) => sound.setEnabled(e.target.checked)}
                        />
                        <span>{isEnglish ? 'Sound' : '提示音'}</span>
                    </label>
                    {vibration.supported && (
                        <label className="admin-checkbox-label">
                            <input
                                type="checkbox"
                                checked={vibration.enabled}
                                onChange={(e) => vibration.setEnabled(e.target.checked)}
                            />
                            <span>{isEnglish ? 'Vibrate' : '振动'}</span>
                        </label>
                    )}
                </div>
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
