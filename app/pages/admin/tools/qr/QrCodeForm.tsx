import { type QrCode, type QrExpirationMode, qrHasSpot } from '~/lib/qrCodes';
import {
    buildSocialUrl,
    cleanHandle,
    detectSocialUrl,
    getSocialPlatform,
    useSocialPlatforms,
} from '~/lib/socialPlatforms';
import type { UpcomingEvent } from '~/lib/upcomingEvents';
import { MapPicker } from '../../MapPicker';

/** How the editor is building {@link QrDraft.targetUrl}: a raw URL or a social profile. */
export type QrLinkMode = 'url' | 'social';

export interface QrDraft {
    label: string;
    labelCn: string;
    targetUrl: string;
    eventId: string;
    expirationMode: QrExpirationMode;
    /** datetime-local string (local time) used while editing the custom date. */
    expiresLocal: string;
    /** Editing-only: which builder produces `targetUrl`. Not persisted. */
    linkMode: QrLinkMode;
    /** Editing-only: selected platform id while in social mode. Not persisted. */
    socialPlatform: string;
    /** Editing-only: handle/profile id while in social mode. Not persisted. */
    socialHandle: string;
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
        linkMode: 'url', socialPlatform: '', socialHandle: '',
        lat: 0, lng: 0, spotLabel: '', spotLabelCn: '',
    };
}

export function qrToDraft(code: QrCode): QrDraft {
    // Reopen recognised profile links in social mode so they round-trip.
    const social = detectSocialUrl(code.targetUrl);
    return {
        label: code.label,
        labelCn: code.labelCn,
        targetUrl: code.targetUrl,
        eventId: code.eventId,
        expirationMode: code.expirationMode,
        expiresLocal: toLocalInput(code.expiresAt),
        linkMode: social ? 'social' : 'url',
        socialPlatform: social?.platformId ?? '',
        socialHandle: social?.handle ?? '',
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
    if (draft.linkMode === 'social') {
        if (!draft.socialPlatform) {
            return {error: isEnglish ? 'Choose a social platform.' : '请选择社交平台。'};
        }
        if (!cleanHandle(draft.socialHandle)) {
            return {error: isEnglish ? 'Enter a handle or profile ID.' : '请填写账号或主页 ID。'};
        }
    }
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
    /** Opens the social-platform manager; the link only shows in social mode. */
    onManagePlatforms?: () => void;
}

export const QrCodeForm = ({draft, setDraft, events, isEnglish, onManagePlatforms}: QrCodeFormProps) => {
    const {platforms} = useSocialPlatforms();
    const hasSpot = qrHasSpot(draft);
    const selectedPlatform = getSocialPlatform(draft.socialPlatform, platforms);
    const builtSocialUrl = buildSocialUrl(draft.socialPlatform, draft.socialHandle, platforms);

    const setLinkMode = (mode: QrLinkMode) => setDraft(prev => {
        if (mode === prev.linkMode) return prev;
        if (mode === 'social') {
            // Seed the picker from an already-pasted profile URL when possible.
            const detected = detectSocialUrl(prev.targetUrl, platforms);
            const socialPlatform = detected?.platformId ?? prev.socialPlatform;
            const socialHandle = detected?.handle ?? prev.socialHandle;
            return {
                ...prev,
                linkMode: 'social',
                socialPlatform,
                socialHandle,
                targetUrl: buildSocialUrl(socialPlatform, socialHandle, platforms) || prev.targetUrl,
            };
        }
        return {...prev, linkMode: 'url'};
    });

    const setPlatform = (socialPlatform: string) => setDraft(prev => ({
        ...prev,
        socialPlatform,
        targetUrl: buildSocialUrl(socialPlatform, prev.socialHandle, platforms),
    }));

    const setHandle = (socialHandle: string) => setDraft(prev => ({
        ...prev,
        socialHandle,
        targetUrl: buildSocialUrl(prev.socialPlatform, socialHandle, platforms),
    }));

    return (
        <>
            <div className="admin-form-grid">
                <label>
                    <span>{isEnglish ? 'Label (English)' : '名称（英文）'}</span>
                    <input
                        value={draft.label}
                        onChange={e => setDraft(prev => ({...prev, label: e.target.value}))}
                        className="admin-input"
                        placeholder={isEnglish ? 'e.g. Booth A entrance' : '例如：A 区入口'}
                    />
                </label>
                <label>
                    <span>{isEnglish ? 'Label (Chinese)' : '名称（中文）'}</span>
                    <input
                        value={draft.labelCn}
                        onChange={e => setDraft(prev => ({...prev, labelCn: e.target.value}))}
                        className="admin-input"
                        placeholder={isEnglish ? 'optional' : '可选'}
                    />
                </label>
                <div className="admin-form-grid-full">
                    <span className="admin-field-label">{isEnglish ? 'Where it links' : '跳转目标'}</span>
                    <div className="admin-qr-mode-toggle" role="tablist">
                        <button
                            type="button"
                            role="tab"
                            aria-selected={draft.linkMode === 'url'}
                            className={`admin-btn admin-btn--ghost${draft.linkMode === 'url' ? ' admin-btn--ghost-active' : ''}`}
                            onClick={() => setLinkMode('url')}
                        >
                            {isEnglish ? 'Custom URL' : '自定义链接'}
                        </button>
                        <button
                            type="button"
                            role="tab"
                            aria-selected={draft.linkMode === 'social'}
                            className={`admin-btn admin-btn--ghost${draft.linkMode === 'social' ? ' admin-btn--ghost-active' : ''}`}
                            onClick={() => setLinkMode('social')}
                        >
                            {isEnglish ? 'Social profile' : '社交主页'}
                        </button>
                    </div>

                    {draft.linkMode === 'url' ? (
                        <label>
                            <input
                                value={draft.targetUrl}
                                onChange={e => setDraft(prev => ({...prev, targetUrl: e.target.value}))}
                                className="admin-input"
                                placeholder="https://example.com"
                            />
                            <small className="admin-helper-text">
                                {isEnglish
                                    ? 'Where the QR redirects. You can change this later without reprinting the code.'
                                    : '二维码跳转目标。之后可随时修改，无需重新打印。'}
                            </small>
                        </label>
                    ) : (
                        <div className="admin-form-grid">
                            <label>
                                <span>{isEnglish ? 'Platform' : '平台'}</span>
                                <select
                                    value={draft.socialPlatform}
                                    onChange={e => setPlatform(e.target.value)}
                                    className="admin-input"
                                >
                                    <option value="">{isEnglish ? '— Select —' : '— 选择 —'}</option>
                                    {platforms.map(p => (
                                        <option key={p.id} value={p.id}>
                                            {isEnglish ? p.label : (p.labelCn ?? p.label)}
                                        </option>
                                    ))}
                                </select>
                            </label>
                            <label>
                                <span>{isEnglish ? 'Handle / profile' : '账号 / 主页'}</span>
                                <input
                                    value={draft.socialHandle}
                                    onChange={e => setHandle(e.target.value)}
                                    className="admin-input"
                                    placeholder={selectedPlatform?.placeholder ?? ''}
                                    disabled={!draft.socialPlatform}
                                />
                            </label>
                            <small className="admin-helper-text admin-form-grid-full">
                                {builtSocialUrl
                                    ? `${isEnglish ? 'Links to: ' : '将跳转到：'}${builtSocialUrl}`
                                    : (isEnglish
                                        ? 'Pick a platform and enter the handle — we build the profile link for you.'
                                        : '选择平台并填写账号，我们会自动生成主页链接。')}
                            </small>
                            {onManagePlatforms && (
                                <div className="admin-form-grid-full">
                                    <button
                                        type="button"
                                        className="admin-toggle-btn admin-toggle-edit admin-btn-sm"
                                        onClick={onManagePlatforms}
                                    >
                                        {isEnglish ? 'Edit social platforms' : '编辑社交平台'}
                                    </button>
                                </div>
                            )}
                        </div>
                    )}
                </div>
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
                        className="admin-input"
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
                        className="admin-input"
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
                            className="admin-input"
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
                                className="admin-input"
                                placeholder={isEnglish ? 'optional' : '可选'}
                            />
                        </label>
                        <label>
                            <span>{isEnglish ? 'Spot note (Chinese)' : '位置说明（中文）'}</span>
                            <input
                                value={draft.spotLabelCn}
                                onChange={e => setDraft(prev => ({...prev, spotLabelCn: e.target.value}))}
                                className="admin-input"
                                placeholder={isEnglish ? 'optional' : '可选'}
                            />
                        </label>
                    </div>
                )}
            </div>
        </>
    );
};
