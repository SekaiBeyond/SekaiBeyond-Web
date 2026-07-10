import { type QrCode, type QrExpirationMode, qrHasSpot } from '~/lib/qrCodes';
import { useSocialPlatforms } from '~/lib/socialPlatforms';
import type { UpcomingEvent } from '~/lib/upcomingEvents';
import { MapPicker } from '../../MapPicker';

/**
 * The two kinds of tracked code — mutually exclusive and fixed at creation
 * (the links already in the wild differ by kind, so a saved code never flips):
 * - 'location': a printed code placed somewhere physical; can pin a map spot,
 *   never carries a platform tag.
 * - 'social': a link shared on social platforms; tagged with a platform so
 *   scan counts compare click-through per platform, never has a map spot.
 * Not persisted — derived from whether a saved code has a platform tag.
 */
export type QrKind = 'location' | 'social';

export interface QrDraft {
    label: string;
    labelCn: string;
    targetUrl: string;
    eventId: string;
    expirationMode: QrExpirationMode;
    /** datetime-local string (local time) used while editing the custom date. */
    expiresLocal: string;
    /** Editing-only: which kind of code this is (see {@link QrKind}). */
    kind: QrKind;
    /**
     * Source platforms (social kind only). The code gets one QR link per
     * selected platform — all opening {@link targetUrl} — with scans tallied
     * per platform. Freely editable after creation to add/remove platforms.
     */
    platforms: string[];
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
        kind: 'location', platforms: [],
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
        kind: code.platforms.length > 0 ? 'social' : 'location',
        platforms: code.platforms,
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
    platforms: string[];
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
 *
 * The kind decides which extras survive: location codes keep the map spot and
 * never platform tags; social codes keep the platform list and never a spot.
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
    if (draft.kind === 'social' && draft.platforms.length === 0) {
        return {error: isEnglish ? 'Select at least one platform.' : '请至少选择一个平台。'};
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
    const social = draft.kind === 'social';
    const hasSpot = !social && qrHasSpot(draft);
    return {
        payload: {
            label,
            labelCn: draft.labelCn.trim(),
            targetUrl,
            eventId: draft.eventId,
            platforms: social ? draft.platforms : [],
            expirationMode: draft.expirationMode,
            expiresAt,
            lat: hasSpot ? draft.lat : 0,
            lng: hasSpot ? draft.lng : 0,
            spotLabel: hasSpot ? draft.spotLabel.trim() : '',
            spotLabelCn: hasSpot ? draft.spotLabelCn.trim() : '',
        },
    };
}

/**
 * Shared shape of the individual field editors below. Each edits one facet of
 * a {@link QrDraft}, so the create form and the detail page's one-at-a-time
 * inline editors render the exact same controls.
 */
interface QrFieldProps {
    draft: QrDraft;
    setDraft: (updater: (prev: QrDraft) => QrDraft) => void;
    isEnglish: boolean;
}

/** English + Chinese label inputs. */
export const QrLabelFields = ({draft, setDraft, isEnglish}: QrFieldProps) => (
    <>
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
    </>
);

/** Target URL input with the "editable without reprinting" reminder. */
export const QrTargetField = ({draft, setDraft, isEnglish}: QrFieldProps) => (
    <label className="admin-form-grid-full">
        <span>{isEnglish ? 'Where it links' : '跳转目标'}</span>
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
);

/** Linked-event picker; clearing the event also drops event-based expiry. */
export const QrEventSelect = ({draft, setDraft, isEnglish, events}: QrFieldProps & {events: UpcomingEvent[]}) => (
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
);

/** Expiration mode select plus the date input when a custom date is chosen. */
export const QrExpirationFields = ({draft, setDraft, isEnglish}: QrFieldProps) => (
    <>
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
    </>
);

/** Platform checkbox grid (social codes), with orphaned tags kept visible. */
export const QrPlatformPicker = (
    {draft, setDraft, isEnglish, onManagePlatforms}: QrFieldProps & {onManagePlatforms?: () => void},
) => {
    const {platforms} = useSocialPlatforms();
    // Tags from since-deleted platforms still get a checkbox (labelled with the
    // raw id) so they can be seen and unchecked rather than silently dropped.
    const knownIds = new Set(platforms.map(p => p.id));
    const orphanTags = draft.platforms.filter(id => !knownIds.has(id));

    const togglePlatform = (id: string) => setDraft(prev => ({
        ...prev,
        platforms: prev.platforms.includes(id)
            ? prev.platforms.filter(p => p !== id)
            : [...prev.platforms, id],
    }));

    return (
        <>
            <small className="admin-helper-text">
                {isEnglish
                    ? 'Pick the platforms you will share this link on. Each gets its own QR code and '
                    + 'link for the same URL, with scans counted separately — you can add or remove '
                    + 'platforms any time.'
                    : '选择要投放此链接的平台。每个平台都有自己的二维码和链接（跳转同一网址），扫描数'
                    + '分别统计 — 之后可随时添加或移除平台。'}
            </small>
            <div className="admin-qr-platform-grid">
                {platforms.map(p => (
                    <label key={p.id} className="admin-checkbox-label">
                        <input
                            type="checkbox"
                            checked={draft.platforms.includes(p.id)}
                            onChange={() => togglePlatform(p.id)}
                        />
                        <span>{isEnglish ? p.label : (p.labelCn ?? p.label)}</span>
                    </label>
                ))}
                {orphanTags.map(id => (
                    <label key={id} className="admin-checkbox-label">
                        <input type="checkbox" checked onChange={() => togglePlatform(id)}/>
                        <span>{id}</span>
                    </label>
                ))}
            </div>
            {onManagePlatforms && (
                <div className="admin-mt-12">
                    <button
                        type="button"
                        className="admin-toggle-btn admin-toggle-edit admin-btn-sm"
                        onClick={onManagePlatforms}
                    >
                        {isEnglish ? 'Edit social platforms' : '编辑社交平台'}
                    </button>
                </div>
            )}
        </>
    );
};

/** Map-spot picker with clear button and per-language spot notes. */
export const QrSpotPicker = ({draft, setDraft, isEnglish}: QrFieldProps) => {
    const hasSpot = qrHasSpot(draft);
    return (
        <>
            <p className="admin-helper-text admin-field-hint">
                {isEnglish
                    ? 'Pin where the code lives, or leave unset and link it later by scanning the printed code on your phone.'
                    : '标记二维码所在位置；也可留空，之后用手机扫描已打印的二维码来关联位置。'}
            </p>
            {hasSpot && (
                <div className="admin-qr-clear-row">
                    <button
                        type="button"
                        className="admin-toggle-btn admin-toggle-cancel admin-btn-sm"
                        onClick={() => setDraft(prev => ({...prev, lat: 0, lng: 0}))}
                    >
                        {isEnglish ? 'Clear spot' : '清除位置'}
                    </button>
                </div>
            )}
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
        </>
    );
};

interface QrCodeFormProps {
    draft: QrDraft;
    setDraft: (updater: (prev: QrDraft) => QrDraft) => void;
    events: UpcomingEvent[];
    isEnglish: boolean;
    /** Opens the social-platform manager. */
    onManagePlatforms?: () => void;
    /** Set when editing a saved code — the kind is fixed at creation. */
    kindLocked?: boolean;
}

/** The full form used when creating a tracked code. */
export const QrCodeForm = ({draft, setDraft, events, isEnglish, onManagePlatforms, kindLocked}: QrCodeFormProps) => {
    return (
        <>
            <div className="admin-section-mb">
                <span className="admin-field-label">{isEnglish ? 'Code type' : '二维码类型'}</span>
                {kindLocked ? (
                    <>
                        <div>
                            {draft.kind === 'location'
                                ? (isEnglish ? '📍 Location' : '📍 地点')
                                : (isEnglish ? '📣 Social media' : '📣 社交媒体')}
                        </div>
                        <small className="admin-helper-text">
                            {isEnglish
                                ? 'The type is fixed once a code is created — its links are already out there. '
                                + 'Create a new code to use the other type.'
                                : '二维码类型创建后无法更改 — 其链接可能已在使用中。如需另一种类型，请新建二维码。'}
                        </small>
                    </>
                ) : (
                    <>
                        <div className="admin-qr-mode-toggle" role="tablist">
                            <button
                                type="button"
                                role="tab"
                                aria-selected={draft.kind === 'location'}
                                className={`admin-btn admin-btn--ghost${draft.kind === 'location' ? ' admin-btn--ghost-active' : ''}`}
                                onClick={() => setDraft(prev => ({...prev, kind: 'location'}))}
                            >
                                {isEnglish ? '📍 Location' : '📍 地点'}
                            </button>
                            <button
                                type="button"
                                role="tab"
                                aria-selected={draft.kind === 'social'}
                                className={`admin-btn admin-btn--ghost${draft.kind === 'social' ? ' admin-btn--ghost-active' : ''}`}
                                onClick={() => setDraft(prev => ({...prev, kind: 'social'}))}
                            >
                                {isEnglish ? '📣 Social media' : '📣 社交媒体'}
                            </button>
                        </div>
                        <small className="admin-helper-text">
                            {draft.kind === 'location'
                                ? (isEnglish
                                    ? 'A printed code placed somewhere physical — pin it on the map and track scans by spot.'
                                    : '张贴在实体位置的二维码 — 可标记在地图上，按位置追踪扫描。')
                                : (isEnglish
                                    ? 'A link shared on social platforms — one code per platform for the same URL, so scan '
                                    + 'counts compare click-through by platform.'
                                    : '在社交平台分享的链接 — 同一链接按平台各生成一个二维码，扫描数即可对比各平台的点击表现。')}
                        </small>
                    </>
                )}
            </div>

            <div className="admin-form-grid">
                <QrLabelFields draft={draft} setDraft={setDraft} isEnglish={isEnglish}/>
                <QrTargetField draft={draft} setDraft={setDraft} isEnglish={isEnglish}/>

                {draft.kind === 'social' && (
                    <div className="admin-form-grid-full">
                        <span className="admin-field-label">
                            {isEnglish ? 'Platforms' : '平台'}
                        </span>
                        <QrPlatformPicker draft={draft} setDraft={setDraft} isEnglish={isEnglish}
                                          onManagePlatforms={onManagePlatforms}/>
                    </div>
                )}
                <QrEventSelect draft={draft} setDraft={setDraft} isEnglish={isEnglish} events={events}/>
                <QrExpirationFields draft={draft} setDraft={setDraft} isEnglish={isEnglish}/>
            </div>

            {draft.kind === 'location' && (
                <div className="admin-field-section">
                    <span className="admin-field-label">{isEnglish ? 'Map Spot (optional)' : '地图位置（可选）'}</span>
                    <QrSpotPicker draft={draft} setDraft={setDraft} isEnglish={isEnglish}/>
                </div>
            )}
        </>
    );
};
