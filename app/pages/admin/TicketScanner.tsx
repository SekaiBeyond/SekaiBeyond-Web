import { useCallback, useEffect, useRef, useState } from 'react';
import { FirebaseError } from 'firebase/app';
import { useLanguage } from '~/components/LanguageContextProvider';
import { callRedeemTicket, functionsErrorCode, functionsErrorDetails } from '~/lib/firebase';
import { useQrScanner } from '~/lib/useQrScanner';
import { type ScanOutcome, useScanSound, useScanVibration } from '~/lib/useScanFeedback';
import { QrScannerViewport } from './QrScannerViewport';
import { isHometownTicketId } from './tickets/hometown';
import { anonymousAttendeeName, ticketTypeLabel } from './tickets/types';

/** Who a ticket belongs to, as a result shows it. */
interface ScannedTicket {
    ticketId: string;
    attendeeName: string;
    attendeeEmail: string;
    ticketType: string;
    hometown: boolean;
    /** A HomeTown ticket missing from the imported list, let in with a warning. */
    unlisted: boolean;
    /** A HomeTown ticket left out of the latest export: refunded or transferred, most likely. */
    missingFromHometown: boolean;
    /** The staff note on the ticket, empty for none. */
    notes: string;
}

/** A result the operator should read before moving on, though the ticket got in. */
const hasWarning = (ticket: ScannedTicket): boolean => ticket.unlisted || ticket.missingFromHometown;

/** Something to read on an admitted ticket: a warning, or a note that isn't one. */
const hasReading = (ticket: ScannedTicket): boolean => hasWarning(ticket) || ticket.notes !== '';

type ScanStatus =
    | {kind: 'idle'}
    | {kind: 'scanning'}
    | {kind: 'loading'; ticketId: string}
    | (ScannedTicket & {
    kind: 'success';
    userCheckedIn: boolean;
    /** When it went up. A fresh one restarts the countdown to clearing it. */
    shownAt: number
})
    | (ScannedTicket & {
    kind: 'already';
    redeemedBy: string;
    redeemedAt: string | null;
    shownAt: number
})
    | {kind: 'error'; reason: string; shownAt: number};

/** A result on show, which clears itself after {@link showFor}. */
type ShownStatus = Extract<ScanStatus, {shownAt: number}>;

interface CachedRedemption extends ScannedTicket {
    /** When the server's grace window for it closes, on this device's clock. */
    until: number;
    userCheckedIn: boolean;
}

const DEDUPE_MS = 3000;
const CACHE_SIZE = 20;
/**
 * How long a repeated result for the same code stays quiet: longer than a held
 * code's per-frame and DEDUPE_MS repeats plus the round trip, so it sounds
 * once.
 */
const CUE_QUIET_MS = 5000;
/** How long each result stays up before clearing itself for the next scan. */
const CLEAR_AFTER_MS: Record<ShownStatus['kind'], number> = {
    // An admitted ticket needs nothing more from the operator.
    success: 4000,
    // A problem may need reading out to the attendee or acting on.
    already: 12000,
    error: 12000,
};
/** The last stretch of that, over which a result fades out. Matches the CSS. */
const FADE_MS = 300;
/**
 * How long a scan waits before saying it's still checking: a server that has
 * sat idle takes a few seconds to start, which shouldn't read as a freeze.
 */
const SLOW_MS = 3000;

/**
 * How long a result stays up. A ticket with a warning or a note got in, but
 * those are there to be read, so it stays up as long as a problem.
 */
const showFor = (status: ShownStatus): number =>
    status.kind === 'success' && hasReading(status) ? CLEAR_AFTER_MS.already : CLEAR_AFTER_MS[status.kind];

/**
 * Whether a result holds the line: until it clears or Next Scan is pressed, the
 * camera takes no other code, so the next person's ticket can't replace a
 * refusal or a warning before the operator has read it. A plain admission has
 * nothing to read.
 */
const holdsLine = (status: ShownStatus): boolean => status.kind !== 'success' || hasReading(status);

interface TicketScannerProps {
    eventId: string;
    /** Core staff and above, who can import the list or change the setting themselves. */
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
    // A scan waiting on the server: nothing else is sent until it answers, so an
    // earlier ticket's answer can't land over a later one's.
    const inFlightRef = useRef(false);
    // Set with a result that holds the line (holdsLine), cleared when it goes.
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

    // Every result goes up through here, setting the hold in the same step, so
    // no frame decoded before the re-render slips past it.
    const show = useCallback((next: ShownStatus) => {
        holdingRef.current = holdsLine(next);
        setStatus(next);
    }, []);

    // Back to waiting for a code, with any hold released.
    const ready = useCallback((cameraActive: boolean) => {
        holdingRef.current = false;
        setStatus(cameraActive ? {kind: 'scanning'} : {kind: 'idle'});
    }, []);

    // Once per showing of a code: a repeat inside CUE_QUIET_MS restarts the
    // quiet.
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

        // A ticket this device just let in reads as success without a round trip,
        // but only inside the server's grace window; after it, a shared screenshot
        // must get "already redeemed".
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
                // Let in, but the operator should look up at the warning.
                cue(hasWarning(scanned) ? 'issue' : 'success', ticketId);

                // The server says how much of the window is left, as a duration so
                // this phone's clock doesn't matter. Without it, the entry expires
                // at once.
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
                // Scans have a per-minute budget of their own, per account.
                const ms = functionsErrorDetails<{retryAfterMs?: number}>(err)?.retryAfterMs;
                const seconds = typeof ms === 'number' ? Math.max(1, Math.ceil(ms / 1000)) : null;
                reason = isEnglish
                    ? `Too many scans from this account in the last minute. Wait ${seconds ? `${seconds} seconds` : 'a moment'}, then scan again.`
                    : `此账号最近一分钟内扫描次数过多。请${seconds ? `等待 ${seconds} 秒` : '稍候'}再扫描。`;
            } else if (err instanceof FirebaseError && err.code === 'functions/deadline-exceeded') {
                // The server may still have let it in, which a rescan will say.
                reason = isEnglish
                    ? 'No answer from the server. Check the connection and scan again. If it then shows as already redeemed by you, the first scan went through.'
                    : '服务器无响应。请检查网络后重新扫描。若随后显示已由你验证，说明第一次扫描已成功。';
            } else {
                reason = isEnglish ? 'Scan failed. Please try again.' : '扫描失败，请重试。';
            }
            show({kind: 'error', reason, shownAt: Date.now()});
            cue('issue', ticketId);
        } finally {
            inFlightRef.current = false;
            setBusy(false);
        }
    }, [eventId, isEnglish, canManage, onRedeemed, cue, show]);

    // Redeem a code for this event, warn on another event's, ignore the rest. A
    // HomeTown QR is just its number, naming no event, so it's taken as this
    // one's. Nothing is read while a scan is out or a result holds the line.
    // Always false, to keep scanning.
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
            // On a phone the camera opens part below the fold; bring all of it,
            // and its buttons, into view.
            viewportRef.current?.scrollIntoView({block: 'nearest', behavior: 'smooth'});
        },
        onStartError: () => ready(false),
        cameraErrorMessage: isEnglish
            ? 'Camera permission denied or not available. Use manual entry below.'
            : '无法访问摄像头，请使用下方手动输入。',
        logLabel: '[TicketScanner]',
    });

    // A result clears itself for the next in line, keeping the cue state so a
    // held code stays quiet. Each frame of a held code restarts the timer, so
    // it clears once the code is put away.
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

    // On a phone the result lands under the camera, below the fold. Scrolled up
    // only as far as it takes, so the camera stays in view above it; one already
    // on screen doesn't move the page.
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
        // Typed in on purpose, so it sounds even if the camera just read the same.
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
        // not a URL — caller falls back to raw string
    }
    return null;
}

function ResultBanner({status, leaving, slow, isEnglish}: {
    status: ScanStatus;
    leaving: boolean;
    /** A scan still out after SLOW_MS. */
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

/** Who a result names: whatever they gave, else an unlisted HomeTown ticket's number. */
const holderName = (ticket: ScannedTicket, isEnglish: boolean): string =>
    ticket.attendeeName || ticket.attendeeEmail
    || anonymousAttendeeName({hometown: ticket.hometown, ticketIds: [ticket.ticketId]}, isEnglish);

/** The ticket's type, which an unlisted HomeTown ticket doesn't know yet, and where it was sold. */
function TicketTags({ticket, isEnglish}: {ticket: ScannedTicket; isEnglish: boolean}) {
    return (
        <>
            {!ticket.unlisted && (
                <span
                    className={`admin-tickets-tag admin-tickets-tag-type-${ticket.ticketType.toLowerCase().replace(/\s+/g, '-')}`}>{ticketTypeLabel(ticket.ticketType, isEnglish)}</span>
            )}
            {ticket.hometown && <span className="admin-tickets-tag admin-tickets-tag-hometown">HomeTown</span>}
        </>
    );
}

/** The note staff left on the ticket in the admin panel, if any. */
function TicketNote({ticket, isEnglish}: {ticket: ScannedTicket; isEnglish: boolean}) {
    if (!ticket.notes) return null;
    return (
        <div className="admin-tickets-scan-note">
            <span className="admin-tickets-scan-note-label">{isEnglish ? 'Note' : '备注'}</span>
            {ticket.notes}
        </div>
    );
}

/**
 * A ring that runs down with a result's auto-clear. The radius makes the
 * circumference 100, which the CSS dashes by.
 */
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
