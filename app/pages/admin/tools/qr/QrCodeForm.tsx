import { type QrCode, type QrExpirationMode, qrHasSpot } from '~/lib/qrCodes';
import type { UpcomingEvent } from '~/lib/upcomingEvents';
import { MapPicker } from '../../MapPicker';

export interface QrDraft {
    label: string;
    labelCn: string;
    targetUrl: string;
    eventId: string;
    expirationMode: QrExpirationMode;
    /** datetime-local string (local time) used while editing the custom date. */
    expiresLocal: string;
    lat: number;
    lng: number;
    spotLabel: string;
    spotLabelCn: string;
}

/** Format a Date as the `YYYY-MM-DDTHH:mm` value a datetime-local input expects. */
function toLocalInput(date: Date | null): string {
    if (!date) return '';
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
        + `T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function emptyDraft(): QrDraft {
    return {
        label: '', labelCn: '', targetUrl: '', eventId: '',
        expirationMode: 'none', expiresLocal: '',
        lat: 0, lng: 0, spotLabel: '', spotLabelCn: '',
    };
}

export function qrToDraft(code: QrCode): QrDraft {
    return {
        label: code.label,
        labelCn: code.labelCn,
        targetUrl: code.targetUrl,
        eventId: code.eventId,
        expirationMode: code.expirationMode,
        expiresLocal: toLocalInput(code.expiresAt),
        lat: code.lat,
        lng: code.lng,
        spotLabel: code.spotLabel,
        spotLabelCn: code.spotLabelCn,
    };
}

export interface QrSavePayload {
    label: string;
    labelCn: string;
    targetUrl: string;
    eventId: string;
    expirationMode: QrExpirationMode;
    expiresAt?: string;
    lat: number;
    lng: number;
    spotLabel: string;
    spotLabelCn: string;
}

/**
 * Translate a draft into the Cloud Function payload. Returns a validation error
 * string (localized) instead of a payload when the draft is incomplete.
 */
export function buildQrPayload(
    draft: QrDraft,
    isEnglish: boolean,
): {error: string} | {payload: QrSavePayload} {
    const label = draft.label.trim();
    const targetUrl = draft.targetUrl.trim();
    if (!label) return {error: isEnglish ? 'A label is required.' : '请填写名称。'};
    if (!/^https:\/\//i.test(targetUrl)) {
        return {error: isEnglish ? 'Target must be an https:// URL.' : '目标链接必须为 https:// 链接。'};
    }
    if (draft.expirationMode === 'event' && !draft.eventId) {
        return {error: isEnglish ? 'Select an event for event-based expiration.' : '请选择关联活动以按活动过期。'};
    }
    let expiresAt: string | undefined;
    if (draft.expirationMode === 'date') {
        if (!draft.expiresLocal) {
            return {error: isEnglish ? 'Pick an expiration date.' : '请选择过期日期。'};
        }
        const d = new Date(draft.expiresLocal);
        if (isNaN(d.getTime())) {
            return {error: isEnglish ? 'Invalid expiration date.' : '过期日期无效。'};
        }
        expiresAt = d.toISOString();
    }
    const hasSpot = qrHasSpot(draft);
    return {
        payload: {
            label,
            labelCn: draft.labelCn.trim(),
            targetUrl,
            eventId: draft.eventId,
            expirationMode: draft.expirationMode,
            expiresAt,
            lat: hasSpot ? draft.lat : 0,
            lng: hasSpot ? draft.lng : 0,
            spotLabel: draft.spotLabel.trim(),
            spotLabelCn: draft.spotLabelCn.trim(),
        },
    };
}

interface QrCodeFormProps {
    draft: QrDraft;
    setDraft: (updater: (prev: QrDraft) => QrDraft) => void;
    events: UpcomingEvent[];
    isEnglish: boolean;
}

export const QrCodeForm = ({draft, setDraft, events, isEnglish}: QrCodeFormProps) => {
    const hasSpot = qrHasSpot(draft);

    return (
        <>
            <div className="admin-form-grid">
                <label>
                    <span>{isEnglish ? 'Label (English)' : '名称（英文）'}</span>
                    <input
                        value={draft.label}
                        onChange={e => setDraft(prev => ({...prev, label: e.target.value}))}
                        className="admin-search-input"
                        placeholder={isEnglish ? 'e.g. Booth A entrance' : '例如：A 区入口'}
                    />
                </label>
                <label>
                    <span>{isEnglish ? 'Label (Chinese)' : '名称（中文）'}</span>
                    <input
                        value={draft.labelCn}
                        onChange={e => setDraft(prev => ({...prev, labelCn: e.target.value}))}
                        className="admin-search-input"
                        placeholder={isEnglish ? 'optional' : '可选'}
                    />
                </label>
                <label className="admin-form-grid-full">
                    <span>{isEnglish ? 'Target URL' : '目标链接'}</span>
                    <input
                        value={draft.targetUrl}
                        onChange={e => setDraft(prev => ({...prev, targetUrl: e.target.value}))}
                        className="admin-search-input"
                        placeholder="https://example.com"
                    />
                    <small className="admin-helper-text">
                        {isEnglish
                            ? 'Where the QR redirects. You can change this later without reprinting the code.'
                            : '二维码跳转目标。之后可随时修改，无需重新打印。'}
                    </small>
                </label>
                <label>
                    <span>{isEnglish ? 'Link to Event (optional)' : '关联活动（可选）'}</span>
                    <select
                        value={draft.eventId}
                        onChange={e => setDraft(prev => {
                            const eventId = e.target.value;
                            // Drop event-based expiry if the event link is removed.
                            const expirationMode = !eventId && prev.expirationMode === 'event'
                                ? 'none'
                                : prev.expirationMode;
                            return {...prev, eventId, expirationMode};
                        })}
                        className="admin-search-input"
                    >
                        <option value="">{isEnglish ? '— None —' : '— 无 —'}</option>
                        {events.map(ev => (
                            <option key={ev.id} value={ev.id}>
                                {isEnglish ? ev.title : (ev.titleCn || ev.title)}
                            </option>
                        ))}
                    </select>
                </label>
                <label>
                    <span>{isEnglish ? 'Expiration' : '过期方式'}</span>
                    <select
                        value={draft.expirationMode}
                        onChange={e => setDraft(prev => ({
                            ...prev,
                            expirationMode: e.target.value as QrExpirationMode
                        }))}
                        className="admin-search-input"
                    >
                        <option value="none">{isEnglish ? 'Never expires' : '永不过期'}</option>
                        {draft.eventId && (
                            <option value="event">{isEnglish ? 'When event ends' : '活动结束时'}</option>
                        )}
                        <option value="date">{isEnglish ? 'Custom date' : '自定义日期'}</option>
                    </select>
                </label>
                {draft.expirationMode === 'date' && (
                    <label>
                        <span>{isEnglish ? 'Active Until' : '有效截止'}</span>
                        <input
                            type="datetime-local"
                            value={draft.expiresLocal}
                            onChange={e => setDraft(prev => ({...prev, expiresLocal: e.target.value}))}
                            className="admin-search-input"
                        />
                    </label>
                )}
            </div>

            <div className="admin-field-section">
                <div className="admin-qr-spot-header">
                    <span className="admin-field-label">{isEnglish ? 'Map Spot (optional)' : '地图位置（可选）'}</span>
                    {hasSpot && (
                        <button
                            type="button"
                            className="admin-toggle-btn admin-toggle-cancel admin-btn-sm"
                            onClick={() => setDraft(prev => ({...prev, lat: 0, lng: 0}))}
                        >
                            {isEnglish ? 'Clear spot' : '清除位置'}
                        </button>
                    )}
                </div>
                <p className="admin-helper-text admin-field-hint">
                    {isEnglish
                        ? 'Pin where the code lives, or leave unset and link it later by scanning the printed code on your phone.'
                        : '标记二维码所在位置；也可留空，之后用手机扫描已打印的二维码来关联位置。'}
                </p>
                <MapPicker
                    value={{lat: draft.lat, lng: draft.lng}}
                    onChange={({lat, lng}) => setDraft(prev => ({...prev, lat, lng}))}
                />
                {hasSpot && (
                    <div className="admin-form-grid admin-mt-12">
                        <label>
                            <span>{isEnglish ? 'Spot note (English)' : '位置说明（英文）'}</span>
                            <input
                                value={draft.spotLabel}
                                onChange={e => setDraft(prev => ({...prev, spotLabel: e.target.value}))}
                                className="admin-search-input"
                                placeholder={isEnglish ? 'optional' : '可选'}
                            />
                        </label>
                        <label>
                            <span>{isEnglish ? 'Spot note (Chinese)' : '位置说明（中文）'}</span>
                            <input
                                value={draft.spotLabelCn}
                                onChange={e => setDraft(prev => ({...prev, spotLabelCn: e.target.value}))}
                                className="admin-search-input"
                                placeholder={isEnglish ? 'optional' : '可选'}
                            />
                        </label>
                    </div>
                )}
            </div>
        </>
    );
};
