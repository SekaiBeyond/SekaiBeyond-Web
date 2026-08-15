import { useState } from 'react';
import { useLanguage } from '~/components/LanguageContextProvider';
import { callDeleteQrCode, callSaveQrCode } from '~/lib/firebase';
import { fetchQrScans, type QrCode, qrHasSpot, qrIsActive, qrIsSocial, qrScanUrl } from '~/lib/qrCodes';
import { type SocialPlatform, socialPlatformName, useSocialPlatforms } from '~/lib/socialPlatforms';
import type { UpcomingEvent } from '~/lib/upcomingEvents';
import {
    buildQrPayload,
    type QrDraft,
    QrEventSelect,
    QrExpirationFields,
    QrLabelFields,
    QrPlatformPicker,
    QrSpotPicker,
    QrTargetField,
    qrToDraft,
} from './QrCodeForm';
import { QrPreview, useQrDownload } from './qrExport';
import { ScanTrendsSection } from '../../ScanTrends';
import { QrSpotsMap } from './QrSpotsMap';

const QR_SIZE = 240;

/** The independently editable facets of a code. Only one edits at a time. */
type EditSection = 'label' | 'target' | 'event' | 'expiration' | 'platforms' | 'spot';

interface QrCodeDetailProps {
    code: QrCode;
    events: UpcomingEvent[];
    onBack: () => void;
    onChanged: () => Promise<void>;
    onManagePlatforms: () => void;
    showToast: (message: string, type: 'success' | 'warning' | 'error') => void;
    readOnly: boolean;
}

/**
 * One code's page: stats, QR image(s), settings, and scan trends together.
 * Every setting displays as a read-only value with its own Edit affordance
 * that swaps in just that field's controls — so the scan count and chart
 * never leave the screen, and only the facet being changed becomes a form.
 */
export const QrCodeDetail = ({
                                 code,
                                 events,
                                 onBack,
                                 onChanged,
                                 onManagePlatforms,
                                 showToast,
                                 readOnly
                             }: QrCodeDetailProps) => {
    const {isEnglish} = useLanguage();
    const {platforms} = useSocialPlatforms();
    const {request: requestDownload, node: downloadNode} = useQrDownload();

    const [editing, setEditing] = useState<EditSection | null>(null);
    // Holds the whole draft while a section edits (saves send the full payload);
    // stale and unused when nothing is being edited.
    const [draft, setDraft] = useState<QrDraft>(() => qrToDraft(code));
    const [saving, setSaving] = useState(false);
    const [deleting, setDeleting] = useState(false);

    const linkedEvent = events.find(e => e.id === code.eventId) ?? null;
    const active = qrIsActive(code, linkedEvent?.endAt ?? null);
    const social = qrIsSocial(code);
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    const scanValue = qrScanUrl(code.id, origin);

    // "Unsaved changes" is judged on the payload that would be saved, not raw
    // draft state — cosmetic leftovers (an expiry date remembered after
    // switching modes off, a cleared spot's note) don't count, and a draft
    // that can't build a payload always does.
    const payloadJson = (d: QrDraft): string | null => {
        const built = buildQrPayload(d, isEnglish);
        return 'error' in built ? null : JSON.stringify(built.payload);
    };
    const dirty = editing !== null && payloadJson(draft) !== payloadJson(qrToDraft(code));

    const confirmDiscard = () =>
        !dirty || confirm(isEnglish ? 'Discard unsaved changes?' : '放弃未保存的更改？');

    const openEdit = (section: EditSection) => {
        if (!confirmDiscard()) return;
        setDraft(qrToDraft(code));
        setEditing(section);
    };
    const closeEdit = () => setEditing(null);

    const back = () => {
        if (!confirmDiscard()) return;
        onBack();
    };

    const downloadPng = () => {
        const safe = (code.label || 'qr-code').replace(/[^a-z0-9]+/gi, '-').toLowerCase();
        requestDownload(scanValue, `qr-${safe}`);
    };

    const copyLink = () => {
        navigator.clipboard.writeText(scanValue)
            .then(() => showToast(isEnglish ? 'Link copied.' : '链接已复制。', 'success'))
            .catch(() => showToast(isEnglish ? 'Failed to copy.' : '复制失败。', 'error'));
    };

    const saveEdit = async () => {
        const built = buildQrPayload(draft, isEnglish);
        if ('error' in built) {
            showToast(built.error, 'error');
            return;
        }
        setSaving(true);
        try {
            await callSaveQrCode({qrId: code.id, ...built.payload});
            await onChanged();
            setEditing(null);
            showToast(isEnglish ? 'QR code updated.' : '二维码已更新。', 'success');
        } catch (e: any) {
            showToast(e?.message ?? (isEnglish ? 'Failed to save.' : '保存失败。'), 'error');
        } finally {
            setSaving(false);
        }
    };

    const remove = async () => {
        if (!confirm(isEnglish
            ? `Delete QR code "${code.label}"? Its scan history will be removed and the printed code will stop working.`
            : `删除二维码"${code.label}"？其扫描记录将被清除，已打印的二维码将失效。`)) return;
        setDeleting(true);
        try {
            await callDeleteQrCode({qrId: code.id});
            await onChanged();
            showToast(isEnglish ? 'QR code deleted.' : '二维码已删除。', 'warning');
            onBack();
        } catch (e: any) {
            showToast(e?.message ?? (isEnglish ? 'Failed to delete.' : '删除失败。'), 'error');
            setDeleting(false);
        }
    };

    const fmtDate = (d: Date | null): string =>
        d ? d.toLocaleString(isEnglish ? 'en-US' : 'zh-CN', {
            month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
        }) : (isEnglish ? 'Never' : '从未');

    // Small inline "Edit" affordance shown beside a facet's name.
    const editButton = (section: EditSection) =>
        !readOnly && editing !== section ? (
            <button type="button" className="admin-qr-row-edit" onClick={() => openEdit(section)}>
                {isEnglish ? 'Edit' : '编辑'}
            </button>
        ) : null;

    // Save/Cancel for whichever section is open (all sections share one draft).
    const editorActions = (
        <div className="admin-btn-row">
            <button
                className="admin-toggle-btn admin-toggle-save admin-btn-sm"
                onClick={saveEdit}
                disabled={saving || !dirty}
            >
                {saving ? (isEnglish ? 'Saving...' : '保存中...') : (isEnglish ? 'Save' : '保存')}
            </button>
            <button
                className="admin-toggle-btn admin-toggle-cancel admin-btn-sm"
                onClick={closeEdit}
                disabled={saving}
            >
                {isEnglish ? 'Cancel' : '取消'}
            </button>
        </div>
    );

    const expirationText = code.expirationMode === 'date'
        ? (code.expiresAt
            ? (isEnglish ? `Until ${fmtDate(code.expiresAt)}` : `至 ${fmtDate(code.expiresAt)}`)
            : (isEnglish ? 'Custom date (unset)' : '自定义日期（未设置）'))
        : code.expirationMode === 'event'
            ? (isEnglish ? 'When the linked event ends' : '关联活动结束时')
            : (isEnglish ? 'Never expires' : '永不过期');

    const title = !isEnglish && code.labelCn ? code.labelCn : code.label;
    const subtitle = code.labelCn && code.labelCn !== code.label
        ? (title === code.label ? code.labelCn : code.label)
        : null;

    return (
        <div className="admin-section">
            <div className="admin-tools-back-row">
                <button className="admin-btn admin-btn--link" onClick={back} type="button">
                    {isEnglish ? '← Back to QR Codes' : '← 返回二维码列表'}
                </button>
            </div>
            <div className="admin-qr-detail-head">
                <div className="admin-qr-detail-title-row">
                    <h3 className="admin-qr-detail-title">{title}</h3>
                    <span
                        className={`admin-qr-badge admin-qr-badge-lg ${active ? 'admin-qr-badge-active' : 'admin-qr-badge-expired'}`}>
                        {active ? (isEnglish ? 'Active' : '有效') : (isEnglish ? 'Expired' : '已过期')}
                    </span>
                    {social && (
                        <span className="admin-qr-chip admin-qr-chip-platform">
                            {isEnglish ? 'Social' : '社交'}
                        </span>
                    )}
                </div>
                {subtitle && <p className="admin-qr-detail-subtitle">{subtitle}</p>}
            </div>

            <div className="admin-qr-detail-top">
                {!social && (
                    <div className="admin-qr-detail-code">
                        <div className="admin-qr-paper">
                            <QrPreview value={scanValue} size={QR_SIZE}/>
                        </div>
                        <div className="admin-code-url">
                            <input
                                readOnly
                                value={scanValue}
                                onClick={e => (e.target as HTMLInputElement).select()}
                                className="admin-code-input"
                            />
                            <button className="admin-btn admin-btn--purple" onClick={copyLink} type="button">
                                {isEnglish ? 'Copy' : '复制'}
                            </button>
                        </div>
                        <button className="admin-toggle-btn admin-toggle-save" onClick={downloadPng}
                                type="button">
                            {isEnglish ? 'Download PNG' : '下载 PNG'}
                        </button>
                        {downloadNode}
                    </div>
                )}

                <div className="admin-qr-detail-meta">
                    <div className="admin-stats-tiles">
                        <div className="admin-stats-tile">
                            <div
                                className="admin-stats-tile-label">{isEnglish ? 'Total Scans' : '总扫描数'}</div>
                            <div className="admin-stats-tile-value">{code.scanCount}</div>
                        </div>
                        <div className="admin-stats-tile">
                            <div className="admin-stats-tile-label">{isEnglish ? 'Last Scan' : '最近扫描'}</div>
                            <div className="admin-stats-tile-value admin-stats-tile-value--sm">
                                {fmtDate(code.lastScanAt)}
                            </div>
                        </div>
                        {social && (
                            <div className="admin-stats-tile">
                                <div className="admin-stats-tile-label">{isEnglish ? 'Platforms' : '平台数'}</div>
                                <div className="admin-stats-tile-value">{code.platforms.length}</div>
                            </div>
                        )}
                    </div>

                    <dl className="admin-qr-detail-list">
                        <div>
                            <dt>{isEnglish ? 'Label' : '名称'}{editButton('label')}</dt>
                            <dd>
                                {editing === 'label' ? (
                                    <div className="admin-qr-inline-edit">
                                        <QrLabelFields draft={draft} setDraft={setDraft} isEnglish={isEnglish}/>
                                        {editorActions}
                                    </div>
                                ) : (
                                    <>
                                        {code.label}
                                        {code.labelCn && ` / ${code.labelCn}`}
                                    </>
                                )}
                            </dd>
                        </div>
                        <div>
                            <dt>{isEnglish ? 'Target' : '目标'}{editButton('target')}</dt>
                            <dd>
                                {editing === 'target' ? (
                                    <div className="admin-qr-inline-edit">
                                        <QrTargetField draft={draft} setDraft={setDraft} isEnglish={isEnglish}/>
                                        {editorActions}
                                    </div>
                                ) : (
                                    <a href={code.targetUrl} target="_blank" rel="noreferrer">{code.targetUrl}</a>
                                )}
                            </dd>
                        </div>
                        <div>
                            <dt>{isEnglish ? 'Event' : '活动'}{editButton('event')}</dt>
                            <dd>
                                {editing === 'event' ? (
                                    <div className="admin-qr-inline-edit">
                                        <QrEventSelect draft={draft} setDraft={setDraft} isEnglish={isEnglish}
                                                       events={events}/>
                                        {editorActions}
                                    </div>
                                ) : (
                                    code.eventId
                                        ? (linkedEvent
                                            ? (isEnglish ? linkedEvent.title : (linkedEvent.titleCn || linkedEvent.title))
                                            : (isEnglish ? 'Linked event (archived)' : '关联活动（已归档）'))
                                        : (isEnglish ? 'None' : '无')
                                )}
                            </dd>
                        </div>
                        <div>
                            <dt>{isEnglish ? 'Expiration' : '过期方式'}{editButton('expiration')}</dt>
                            <dd>
                                {editing === 'expiration' ? (
                                    <div className="admin-qr-inline-edit">
                                        <QrExpirationFields draft={draft} setDraft={setDraft} isEnglish={isEnglish}/>
                                        {editorActions}
                                    </div>
                                ) : (
                                    expirationText
                                )}
                            </dd>
                        </div>
                    </dl>
                </div>
            </div>

            {social && (
                <div className="admin-field-section admin-qr-section">
                    <div className="admin-qr-spot-header">
                        <span className="admin-field-label">
                            {isEnglish ? 'Platform QR Codes' : '各平台二维码'}
                        </span>
                        {!readOnly && editing !== 'platforms' && (
                            <button className="admin-toggle-btn admin-toggle-edit admin-btn-sm"
                                    onClick={() => openEdit('platforms')} type="button">
                                {isEnglish ? 'Edit platforms' : '编辑平台'}
                            </button>
                        )}
                    </div>
                    {editing === 'platforms' ? (
                        <div className="admin-qr-inline-edit">
                            <QrPlatformPicker draft={draft} setDraft={setDraft} isEnglish={isEnglish}
                                              onManagePlatforms={onManagePlatforms}/>
                            {editorActions}
                        </div>
                    ) : (
                        <p className="admin-helper-text admin-field-hint">
                            {isEnglish
                                ? 'Each platform has its own link and QR for the same URL — share the matching '
                                + 'one on each platform and scans are counted separately.'
                                : '每个平台都有指向同一网址的专属链接和二维码 — 在对应平台使用对应链接，扫描数'
                                + '将分别统计。'}
                        </p>
                    )}
                    <div className="admin-qr-platform-cards">
                        {/* While the picker is open the cards preview the checkbox
                            state, so toggling a platform shows/hides its QR live
                            (a just-checked one shows 0 scans until saved). */}
                        {(editing === 'platforms' ? draft.platforms : code.platforms).map(pid => (
                            <PlatformQrCard
                                key={pid}
                                code={code}
                                platformId={pid}
                                isEnglish={isEnglish}
                                platforms={platforms}
                                showToast={showToast}
                            />
                        ))}
                    </div>
                </div>
            )}

            {!social && (readOnly ? qrHasSpot(code) : true) && (
                <div className="admin-field-section admin-qr-section">
                    <div className="admin-qr-spot-header">
                        <span className="admin-field-label">{isEnglish ? 'Location' : '位置'}</span>
                        {!readOnly && editing !== 'spot' && (
                            <button className="admin-toggle-btn admin-toggle-edit admin-btn-sm"
                                    onClick={() => openEdit('spot')} type="button">
                                {qrHasSpot(code)
                                    ? (isEnglish ? 'Edit' : '编辑')
                                    : (isEnglish ? 'Set location' : '设置位置')}
                            </button>
                        )}
                    </div>
                    {editing === 'spot' ? (
                        <div className="admin-qr-inline-edit">
                            <QrSpotPicker draft={draft} setDraft={setDraft} isEnglish={isEnglish}/>
                            {editorActions}
                        </div>
                    ) : qrHasSpot(code) ? (
                        <>
                            <QrSpotsMap codes={[code]} height={260}/>
                            {code.spotLabel && (
                                <p className="admin-helper-text admin-field-hint">
                                    {isEnglish ? code.spotLabel : (code.spotLabelCn || code.spotLabel)}
                                </p>
                            )}
                        </>
                    ) : (
                        <p className="admin-helper-text admin-field-hint">
                            {isEnglish
                                ? 'Not linked to a map spot yet — use "Set location", or scan the printed code on '
                                + 'your phone to link it from where it hangs.'
                                : '尚未关联地图位置 — 可点击"设置位置"，或用手机扫描已打印的二维码，在现场直接关联。'}
                        </p>
                    )}
                </div>
            )}

            <ScanTrendsSection id={code.id} fetchScans={fetchQrScans} platforms={code.platforms}/>

            {!readOnly && (
                <div className="admin-qr-danger-row">
                    <button
                        className="admin-toggle-btn admin-toggle-revoke admin-btn-sm"
                        onClick={remove}
                        disabled={deleting}
                    >
                        {deleting
                            ? (isEnglish ? 'Deleting...' : '删除中...')
                            : (isEnglish ? 'Delete QR code' : '删除二维码')}
                    </button>
                </div>
            )}
        </div>
    );
};

const PLATFORM_QR_SIZE = 160;

interface PlatformQrCardProps {
    code: QrCode;
    platformId: string;
    isEnglish: boolean;
    platforms: SocialPlatform[];
    showToast: (message: string, type: 'success' | 'warning' | 'error') => void;
}

/** One platform's QR + link for a social code, with its own scan tally. */
const PlatformQrCard = ({code, platformId, isEnglish, platforms, showToast}: PlatformQrCardProps) => {
    const {request: requestDownload, node: downloadNode} = useQrDownload();
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    const scanValue = qrScanUrl(code.id, origin, platformId);
    const name = socialPlatformName(platformId, isEnglish, platforms);
    const count = code.platformScans[platformId] ?? 0;

    const downloadPng = () => {
        const safe = `${code.label || 'qr-code'}-${platformId}`.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
        requestDownload(scanValue, `qr-${safe}`);
    };

    const copyLink = () => {
        navigator.clipboard.writeText(scanValue)
            .then(() => showToast(
                isEnglish ? `${name} link copied.` : `已复制 ${name} 链接。`,
                'success',
            ))
            .catch(() => showToast(isEnglish ? 'Failed to copy.' : '复制失败。', 'error'));
    };

    return (
        <div className="admin-qr-platform-card">
            <span className="admin-qr-platform-card-title">{name}</span>
            <span className="admin-qr-platform-card-count">
                {isEnglish ? `${count} scans` : `${count} 次扫描`}
            </span>
            <div className="admin-qr-paper admin-qr-paper--sm">
                <QrPreview value={scanValue} size={PLATFORM_QR_SIZE}/>
            </div>
            <div className="admin-tag-actions">
                <button className="admin-toggle-btn admin-toggle-edit admin-btn-sm" onClick={copyLink} type="button">
                    {isEnglish ? 'Copy link' : '复制链接'}
                </button>
                <button className="admin-toggle-btn admin-toggle-save admin-btn-sm" onClick={downloadPng}
                        type="button">
                    PNG
                </button>
            </div>
            {downloadNode}
        </div>
    );
};
