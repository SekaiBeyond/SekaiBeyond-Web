import { useCallback, useEffect, useRef, useState } from 'react';
import { FirebaseError } from 'firebase/app';
import { useLanguage } from '~/components/LanguageContextProvider';
import { callRedeemTicket, errorSuffix, functionsErrorCode, functionsErrorDetails } from '~/lib/firebase';
import { useQrScanner } from '~/lib/useQrScanner';
import { type ScanOutcome, useScanSound, useScanVibration } from '~/lib/useScanFeedback';
import { QrScannerViewport } from './QrScannerViewport';
import { isHometownTicketId } from './tickets/hometown';
import { anonymousAttendeeName, ticketTypeClass, ticketTypeLabel } from './tickets/types';

interface ScannedTicket {
    ticketId: string;
    attendeeName: string;
    attendeeEmail: string;
    ticketType: string;
    hometown: boolean;
    unlisted: boolean;
    missingFromHometown: boolean;
    notes: string;
}

const hasWarning = (ticket: ScannedTicket): boolean => ticket.unlisted || ticket.missingFromHometown;

const hasReading = (ticket: ScannedTicket): boolean => hasWarning(ticket) || ticket.notes !== '';

type ScanStatus =
    | {kind: 'idle'}
    | {kind: 'scanning'}
    | {kind: 'loading'; ticketId: string}
    | (ScannedTicket & {
    kind: 'success';
    userCheckedIn: boolean;
    shownAt: number
})
    | (ScannedTicket & {
    kind: 'already';
    redeemedBy: string;
    redeemedAt: string | null;
    shownAt: number
})
    | {kind: 'error'; reason: string; shownAt: number};

type ShownStatus = Extract<ScanStatus, {shownAt: number}>;

interface CachedRedemption extends ScannedTicket {
    until: number;
    userCheckedIn: boolean;
}

const DEDUPE_MS = 3000;
const CACHE_SIZE = 20;
const CUE_QUIET_MS = 5000;
const CLEAR_AFTER_MS: Record<ShownStatus['kind'], number> = {
    success: 4000,
    already: 12000,
    error: 12000,
};
const FADE_MS = 300;
const SLOW_MS = 3000;

const showFor = (status: ShownStatus): number =>
    status.kind === 'success' && hasReading(status) ? CLEAR_AFTER_MS.already : CLEAR_AFTER_MS[status.kind];

const holdsLine = (status: ShownStatus): boolean => status.kind !== 'success' || hasReading(status);

interface TicketScannerProps {
    eventId: string;
    canManage: boolean;
    onRedeemed: () => void;
}

export function TicketScanner({
                                  eventId,
                                  canManage,
                                  onRedeemed,
                              }: TicketScannerProps) {
    const {isEnglish} = useLanguage();
    const lastScanRef = useRef<{ticketId: string; at: number} | null>(null);
    const redeemedCacheRef = useRef<CachedRedemption[]>([]);
    const lastCueRef = useRef<{key: string; at: number} | null>(null);
    const inFlightRef = useRef(false);
    const holdingRef = useRef(false);
    const sound = useScanSound();
    const vibration = useScanVibration();
    const {play: playSound} = sound;
    const {play: vibrate} = vibration;

    const [status, setStatus] = useState<ScanStatus>({kind: 'idle'});
    const resultRef = useRef<HTMLDivElement>(null);
    const viewportRef = useRef<HTMLDivElement>(null);
    const [manualTicketId, setManualTicketId] = useState('');
    const [busy, setBusy] = useState(false);
    const [leaving, setLeaving] = useState(false);
    const [slow, setSlow] = useState(false);

    const show = useCallback((next: ShownStatus) => {
        holdingRef.current = holdsLine(next);
        setStatus(next);
    }, []);

    const ready = useCallback((cameraActive: boolean) => {
        holdingRef.current = false;
        setStatus(cameraActive ? {kind: 'scanning'} : {kind: 'idle'});
    }, []);

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
        if (inFlightRef.current) return;
        const last = lastScanRef.current;
        const now = Date.now();
        if (last && last.ticketId === ticketId && now - last.at < DEDUPE_MS) return;

        const cached = redeemedCacheRef.current.find(c => c.ticketId === ticketId && now < c.until);
        if (cached) {
            const {until: _until, ...shown} = cached;
            show({kind: 'success', ...shown, shownAt: now});
            cue(hasWarning(cached) ? 'issue' : 'success', ticketId);
            return;
        }

        lastScanRef.current = {ticketId, at: now};
        inFlightRef.current = true;
        setBusy(true);
        setStatus({kind: 'loading', ticketId});
        try {
            const result = await callRedeemTicket({eventId, ticketId});
            const d = result.data;
            const scanned: ScannedTicket = {
                ticketId,
                attendeeName: d.attendeeName ?? '',
                attendeeEmail: d.attendeeEmail ?? '',
                ticketType: d.ticketType ?? 'normal',
                hometown: !!d.hometown,
                unlisted: !!d.unlisted,
                missingFromHometown: !!d.missingFromHometown,
                notes: d.notes ?? '',
            };
            if (d.alreadyRedeemed) {
                show({
                    kind: 'already',
                    ...scanned,
                    redeemedBy: d.redeemedBy ?? '',
                    redeemedAt: d.redeemedAt ?? null,
                    shownAt: Date.now(),
                });
                cue('issue', ticketId);
            } else {
                const successData = {...scanned, userCheckedIn: !!d.userCheckedIn};
                show({kind: 'success', ...successData, shownAt: Date.now()});
                cue(hasWarning(scanned) ? 'issue' : 'success', ticketId);

                redeemedCacheRef.current = [
                    {...successData, until: now + (d.graceRemainingMs ?? 0)},
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
            } else if (code === 'hometown-unlisted') {
                reason = canManage
                    ? (isEnglish
                        ? 'This HomeTown ticket isn\'t on the imported list. Import HomeTown\'s latest guest list, or let unlisted tickets in under Settings.'
                        : '此 HomeTown 门票不在已导入的名单中。请导入最新的 HomeTown 来宾名单，或在"设置"中放行不在名单中的门票。')
                    : (isEnglish
                        ? 'This HomeTown ticket isn\'t on the imported list. Ask an admin to import the latest HomeTown guest list.'
                        : '此 HomeTown 门票不在已导入的名单中。请管理员导入最新的 HomeTown 来宾名单。');
            } else if (code === 'hometown-other-event') {
                const other = functionsErrorDetails<{eventTitle?: string}>(err)?.eventTitle;
                reason = isEnglish
                    ? `This HomeTown ticket is for another event${other ? `: ${other}` : ''}.`
                    : `此 HomeTown 门票属于其他活动${other ? `：${other}` : ''}。`;
            } else if (code === 'not-authorized') {
                reason = isEnglish ? 'You are not authorized to scan for this event.' : '你没有权限扫描此活动的门票。';
            } else if (code === 'not-event-day') {
                reason = isEnglish
                    ? 'Tickets can only be scanned on the day of the event.'
                    : '门票仅可在活动当天扫描。';
            } else if (code === 'event-missing') {
                reason = isEnglish ? 'Event not found.' : '活动不存在。';
            } else if (code === 'rate-limited') {
                const ms = functionsErrorDetails<{retryAfterMs?: number}>(err)?.retryAfterMs;
                const seconds = typeof ms === 'number' ? Math.max(1, Math.ceil(ms / 1000)) : null;
                reason = isEnglish
                    ? `Too many scans from this account in the last minute. Wait ${seconds ? `${seconds} seconds` : 'a moment'}, then scan again.`
                    : `此账号最近一分钟内扫描次数过多。请${seconds ? `等待 ${seconds} 秒` : '稍候'}再扫描。`;
            } else if (err instanceof FirebaseError && err.code === 'functions/deadline-exceeded') {
                reason = isEnglish
                    ? 'No answer from the server. Check the connection and scan again. If it then shows as already redeemed by you, the first scan went through.'
                    : '服务器无响应。请检查网络后重新扫描。若随后显示已由你验证，说明第一次扫描已成功。';
            } else {
                reason = isEnglish
                    ? `Scan failed${errorSuffix(err, true)}. Please try again.`
                    : `扫描失败${errorSuffix(err, false)}，请重试。`;
            }
            show({kind: 'error', reason, shownAt: Date.now()});
            cue('issue', ticketId);
        } finally {
            inFlightRef.current = false;
            setBusy(false);
        }
    }, [eventId, isEnglish, canManage, onRedeemed, cue, show]);

    const onDecode = useCallback((raw: string): boolean => {
        if (inFlightRef.current || holdingRef.current) return false;
        const parsed = parseTicketUrl(raw);
        if (!parsed && isHometownTicketId(raw.trim())) {
            void handleTicket(raw.trim());
        } else if (parsed && parsed.eventId === eventId) {
            void handleTicket(parsed.ticketId);
        } else if (parsed && parsed.eventId !== eventId) {
            show({
                kind: 'error',
                reason: isEnglish
                    ? 'QR code is for a different event.'
                    : '二维码属于其他活动。',
                shownAt: Date.now(),
            });
            cue('issue', raw);
        }
        return false;
    }, [eventId, handleTicket, isEnglish, cue, show]);

    const scanner = useQrScanner({
        onDecode,
        onStart: () => {
            ready(true);
            viewportRef.current?.scrollIntoView({block: 'nearest', behavior: 'smooth'});
        },
        onStartError: () => ready(false),
        cameraErrorMessage: isEnglish
            ? 'Camera permission denied or not available. Use manual entry below.'
            : '无法访问摄像头，请使用下方手动输入。',
        logLabel: '[TicketScanner]',
    });

    useEffect(() => {
        if (!('shownAt' in status)) return;
        const ms = showFor(status);
        const fade = setTimeout(() => setLeaving(true), ms - FADE_MS);
        const clear = setTimeout(() => ready(scanner.cameraActive), ms);
        return () => {
            clearTimeout(fade);
            clearTimeout(clear);
            setLeaving(false);
        };
    }, [status, scanner.cameraActive, ready]);

    useEffect(() => {
        if (status.kind === 'idle' || status.kind === 'scanning') return;
        resultRef.current?.scrollIntoView({block: 'nearest', behavior: 'smooth'});
    }, [status]);

    useEffect(() => {
        if (status.kind !== 'loading') return;
        const timer = setTimeout(() => setSlow(true), SLOW_MS);
        return () => {
            clearTimeout(timer);
            setSlow(false);
        };
    }, [status]);

    const submitManual = async () => {
        const raw = manualTicketId.trim();
        if (!raw) return;
        const parsed = parseTicketUrl(raw);
        const ticketId = parsed?.ticketId ?? raw;
        lastCueRef.current = null;
        await handleTicket(ticketId);
        setManualTicketId('');
    };

    const clearStatus = () => {
        ready(scanner.cameraActive);
        lastScanRef.current = null;
        lastCueRef.current = null;
    };

    return (
        <div className="admin-tickets-scanner">
            <QrScannerViewport scanner={scanner} isEnglish={isEnglish} startDisabled={busy} viewportRef={viewportRef}>
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

            <div ref={resultRef} className="admin-tickets-scan-result">
                <ResultBanner status={status} leaving={leaving} slow={slow} isEnglish={isEnglish}/>
            </div>

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
    }
    return null;
}

function ResultBanner({status, leaving, slow, isEnglish}: {
    status: ScanStatus;
    leaving: boolean;
    slow: boolean;
    isEnglish: boolean
}) {
    if (status.kind === 'idle' || status.kind === 'scanning') return null;
    const leavingClass = leaving ? ' admin-tickets-scan-leaving' : '';
    if (status.kind === 'loading') {
        return (
            <div className="admin-tickets-scan-banner admin-tickets-scan-loading">
                <strong>{isEnglish ? 'Detecting...' : '检测中...'}</strong>
                <div>{isEnglish ? 'Ticket ID:' : '门票 ID：'} {status.ticketId}</div>
                {slow && (
                    <div className="admin-helper-text">
                        {isEnglish
                            ? 'Still checking: the server may be starting up. Wait for the result.'
                            : '仍在检测：服务器可能正在启动，请等待结果。'}
                    </div>
                )}
            </div>
        );
    }
    if (status.kind === 'success') {
        return (
            <div className={`admin-tickets-scan-banner admin-tickets-scan-success${leavingClass}`}>
                <strong>
                    {status.unlisted
                        ? (isEnglish ? '✓ Let in — not on the HomeTown list' : '✓ 已放行 — 不在 HomeTown 名单中')
                        : (isEnglish ? '✓ Redeemed' : '✓ 验证成功')}
                </strong>
                <div>{holderName(status, isEnglish)} <TicketTags ticket={status} isEnglish={isEnglish}/></div>
                {status.attendeeName && status.attendeeEmail && (
                    <div className="admin-user-email">{status.attendeeEmail}</div>
                )}
                {status.unlisted ? (
                    <div className="admin-helper-text admin-tickets-edit-warning">
                        {isEnglish
                            ? 'Check their HomeTown confirmation email is for this event and shows this number; if not, get an admin. Bought after the last import, or not a real ticket for this event. It\'s recorded now, so a second scan of it will be refused.'
                            : '请核对其 HomeTown 购票确认邮件是否为本活动且门票号一致；若不一致或无法出示，请联系管理员。可能是上次导入后购买的，也可能不是本活动的真票。此票现已记录，再次扫描将被拒绝。'}
                    </div>
                ) : status.missingFromHometown ? (
                    <div className="admin-helper-text admin-tickets-edit-warning">
                        {isEnglish
                            ? 'Not in the latest HomeTown export: it may have been refunded or transferred. Ask to see their HomeTown ticket email if in doubt.'
                            : '不在最新的 HomeTown 导出中：可能已退款或转让。如有疑问，请查看其 HomeTown 购票邮件。'}
                    </div>
                ) : (
                    <div className="admin-helper-text">
                        {status.userCheckedIn
                            ? (isEnglish ? 'User auto-checked in.' : '用户已自动签到。')
                            : (isEnglish ? 'Attendee not registered on site.' : '参加者未注册账号。')}
                    </div>
                )}
                <TicketNote ticket={status} isEnglish={isEnglish}/>
                <Countdown status={status}/>
            </div>
        );
    }
    if (status.kind === 'already') {
        return (
            <div className={`admin-tickets-scan-banner admin-tickets-scan-already${leavingClass}`}>
                <strong>{isEnglish ? '! Already redeemed' : '! 此门票已验证'}</strong>
                <div>{holderName(status, isEnglish)} <TicketTags ticket={status} isEnglish={isEnglish}/></div>
                {status.attendeeName && status.attendeeEmail && (
                    <div className="admin-user-email">{status.attendeeEmail}</div>
                )}
                <div className="admin-helper-text">
                    {isEnglish ? 'Redeemed by ' : '验证人：'}
                    {status.redeemedBy || (isEnglish ? 'unknown' : '未知')}
                    {status.redeemedAt && (
                        <> — {new Date(status.redeemedAt).toLocaleString(isEnglish ? 'en-US' : 'zh-CN', {
                            month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
                        })}</>
                    )}
                    {status.unlisted && (isEnglish
                        ? ', while it wasn\'t on the HomeTown list.'
                        : '，当时不在 HomeTown 名单中。')}
                </div>
                <TicketNote ticket={status} isEnglish={isEnglish}/>
                <Countdown status={status}/>
            </div>
        );
    }
    return (
        <div className={`admin-tickets-scan-banner admin-tickets-scan-error${leavingClass}`}>
            <strong>{isEnglish ? '✗ Error' : '✗ 错误'}</strong>
            <div>{status.reason}</div>
            <Countdown status={status}/>
        </div>
    );
}

const holderName = (ticket: ScannedTicket, isEnglish: boolean): string =>
    ticket.attendeeName || ticket.attendeeEmail
    || anonymousAttendeeName({hometown: ticket.hometown, ticketIds: [ticket.ticketId]}, isEnglish);

function TicketTags({ticket, isEnglish}: {ticket: ScannedTicket; isEnglish: boolean}) {
    return (
        <>
            {!ticket.unlisted && (
                <span
                    className={`admin-tickets-tag ${ticketTypeClass(ticket.ticketType)}`}>{ticketTypeLabel(ticket.ticketType, isEnglish)}</span>
            )}
            {ticket.hometown && <span className="admin-tickets-tag admin-tickets-tag-hometown">HomeTown</span>}
        </>
    );
}

function TicketNote({ticket, isEnglish}: {ticket: ScannedTicket; isEnglish: boolean}) {
    if (!ticket.notes) return null;
    return (
        <div className="admin-tickets-scan-note">
            <span className="admin-tickets-scan-note-label">{isEnglish ? 'Note' : '备注'}</span>
            {ticket.notes}
        </div>
    );
}

function Countdown({status}: {status: ShownStatus}) {
    return (
        <svg className="admin-tickets-scan-countdown" viewBox="0 0 36 36" aria-hidden="true">
            <circle className="admin-tickets-scan-countdown-track" cx="18" cy="18" r="15.9155"/>
            <circle
                key={status.shownAt}
                className="admin-tickets-scan-countdown-ring"
                cx="18" cy="18" r="15.9155"
                style={{animationDuration: `${showFor(status)}ms`}}
            />
        </svg>
    );
}
