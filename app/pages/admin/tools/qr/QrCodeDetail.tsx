import { useEffect, useRef, useState } from 'react';
import { QRCodeCanvas } from 'qrcode.react';
import { useLanguage } from '~/components/LanguageContextProvider';
import { callDeleteQrCode, callSaveQrCode } from '~/lib/firebase';
import { fetchQrScans, type QrCode, qrHasSpot, qrIsActive, qrIsSocial, qrScanUrl } from '~/lib/qrCodes';
import { type SocialPlatform, socialPlatformName, useSocialPlatforms } from '~/lib/socialPlatforms';
import type { UpcomingEvent } from '~/lib/upcomingEvents';
import { buildQrPayload, QrCodeForm, type QrDraft, qrToDraft } from './QrCodeForm';
import { QrScanTrends } from './QrScanTrends';
import { QrSpotsMap } from './QrSpotsMap';

const QR_SIZE = 240;

interface QrCodeDetailProps {
    code: QrCode;
    events: UpcomingEvent[];
    onBack: () => void;
    onChanged: () => Promise<void>;
    onManagePlatforms: () => void;
    showToast: (message: string, type: 'success' | 'warning' | 'error') => void;
    readOnly: boolean;
}

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
    const qrWrapRef = useRef<HTMLDivElement>(null);

    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState<QrDraft>(() => qrToDraft(code));
    const [saving, setSaving] = useState(false);
    const [deleting, setDeleting] = useState(false);
    const [scans, setScans] = useState<Date[] | null>(null);
    const [scansError, setScansError] = useState(false);

    const linkedEvent = events.find(e => e.id === code.eventId) ?? null;
    const active = qrIsActive(code, linkedEvent?.endAt ?? null);
    const social = qrIsSocial(code);
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    const scanValue = qrScanUrl(code.id, origin);

    const loadScans = () => {
        setScansError(false);
        fetchQrScans(code.id)
            .then(setScans)
            .catch(() => setScansError(true));
    };
    useEffect(loadScans, [code.id]);

    const downloadPng = () => {
        const canvas = qrWrapRef.current?.querySelector('canvas');
        if (!canvas) return;
        const safe = (code.label || 'qr-code').replace(/[^a-z0-9]+/gi, '-').toLowerCase();
        const link = document.createElement('a');
        link.download = `qr-${safe}.png`;
        link.href = canvas.toDataURL('image/png');
        link.click();
    };

    const copyLink = () => {
        navigator.clipboard.writeText(scanValue).catch(() => { /* clipboard may be unavailable */
        });
        showToast(isEnglish ? 'Link copied.' : '链接已复制。', 'success');
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
            setEditing(false);
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

    return (
        <div className="admin-section">
            <div className="admin-tools-header">
                <button className="admin-btn admin-btn--link" onClick={onBack} type="button">
                    {isEnglish ? '← Back to QR Codes' : '← 返回二维码列表'}
                </button>
                <h3 className="admin-tools-title">{code.label}</h3>
            </div>

            {editing ? (
                <>
                    <QrCodeForm draft={draft} setDraft={setDraft} events={events} isEnglish={isEnglish}
                                onManagePlatforms={onManagePlatforms} kindLocked/>
                    <div className="admin-btn-row admin-mt-12">
                        <button className="admin-toggle-btn admin-toggle-save" onClick={saveEdit} disabled={saving}>
                            {saving ? (isEnglish ? 'Saving...' : '保存中...') : (isEnglish ? 'Save' : '保存')}
                        </button>
                        <button
                            className="admin-toggle-btn admin-toggle-cancel"
                            onClick={() => {
                                setDraft(qrToDraft(code));
                                setEditing(false);
                            }}
                        >
                            {isEnglish ? 'Cancel' : '取消'}
                        </button>
                    </div>
                </>
            ) : (
                <>
                    <div className="admin-qr-detail-top">
                        {!social && (
                            <div className="admin-single-code admin-single-code-narrow">
                                <div ref={qrWrapRef} className="admin-single-code-qr">
                                    <QRCodeCanvas value={scanValue} size={QR_SIZE} level="M" marginSize={2}/>
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
                                <div className="admin-single-code-actions">
                                    <button className="admin-toggle-btn admin-toggle-save" onClick={downloadPng}
                                            type="button">
                                        {isEnglish ? 'Download PNG' : '下载 PNG'}
                                    </button>
                                </div>
                            </div>
                        )}

                        <div className="admin-qr-detail-meta">
                            <div className="admin-stats-tiles">
                                <div className="admin-stats-tile">
                                    <div
                                        className="admin-stats-tile-label">{isEnglish ? 'Total Scans' : '总扫描数'}</div>
                                    <div className="admin-stats-tile-value">{code.scanCount}</div>
                                    <div className="admin-stats-tile-sub">
                                        {isEnglish ? 'Last: ' : '最近：'}{fmtDate(code.lastScanAt)}
                                    </div>
                                </div>
                                <div className="admin-stats-tile">
                                    <div className="admin-stats-tile-label">{isEnglish ? 'Status' : '状态'}</div>
                                    <div className="admin-stats-tile-value">
                                        <span
                                            className={`admin-qr-badge ${active ? 'admin-qr-badge-active' : 'admin-qr-badge-expired'}`}>
                                            {active ? (isEnglish ? 'Active' : '有效') : (isEnglish ? 'Expired' : '已过期')}
                                        </span>
                                    </div>
                                </div>
                            </div>

                            <dl className="admin-qr-detail-list">
                                <div>
                                    <dt>{isEnglish ? 'Target' : '目标'}</dt>
                                    <dd><a href={code.targetUrl} target="_blank" rel="noreferrer">{code.targetUrl}</a>
                                    </dd>
                                </div>
                                <div>
                                    <dt>{isEnglish ? 'Event' : '活动'}</dt>
                                    <dd>
                                        {code.eventId
                                            ? (linkedEvent
                                                ? (isEnglish ? linkedEvent.title : (linkedEvent.titleCn || linkedEvent.title))
                                                : (isEnglish ? 'Linked event (archived)' : '关联活动（已归档）'))
                                            : (isEnglish ? 'None' : '无')}
                                    </dd>
                                </div>
                                {!social && (
                                    <div>
                                        <dt>{isEnglish ? 'Map spot' : '地图位置'}</dt>
                                        <dd>
                                            {qrHasSpot(code)
                                                ? `${code.lat.toFixed(5)}, ${code.lng.toFixed(5)}`
                                                : (isEnglish ? 'Not linked' : '未关联')}
                                        </dd>
                                    </div>
                                )}
                            </dl>

                            {!readOnly && (
                                <div className="admin-btn-row">
                                    <button className="admin-toggle-btn admin-toggle-edit"
                                            onClick={() => setEditing(true)}>
                                        {isEnglish ? 'Edit' : '编辑'}
                                    </button>
                                    <button
                                        className="admin-toggle-btn admin-toggle-revoke"
                                        onClick={remove}
                                        disabled={deleting}
                                    >
                                        {deleting ? (isEnglish ? 'Deleting...' : '删除中...') : (isEnglish ? 'Delete' : '删除')}
                                    </button>
                                </div>
                            )}
                        </div>
                    </div>

                    {social && (
                        <div className="admin-field-section">
                            <span className="admin-field-label">
                                {isEnglish ? 'Platform QR Codes' : '各平台二维码'}
                            </span>
                            <p className="admin-helper-text admin-field-hint">
                                {isEnglish
                                    ? 'Each platform has its own link and QR for the same URL — share the matching '
                                    + 'one on each platform and scans are counted separately. Use Edit to add or '
                                    + 'remove platforms.'
                                    : '每个平台都有指向同一网址的专属链接和二维码 — 在对应平台使用对应链接，扫描数'
                                    + '将分别统计。可通过"编辑"添加或移除平台。'}
                            </p>
                            <div className="admin-qr-platform-cards">
                                {code.platforms.map(pid => (
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

                    {qrHasSpot(code) && (
                        <div className="admin-field-section">
                            <span className="admin-field-label">{isEnglish ? 'Location' : '位置'}</span>
                            <QrSpotsMap codes={[code]} height={260}/>
                        </div>
                    )}

                    <div className="admin-field-section">
                        <div className="admin-qr-spot-header">
                            <span className="admin-field-label">{isEnglish ? 'Scans Over Time' : '扫描时间趋势'}</span>
                            <button className="admin-toggle-btn admin-toggle-edit admin-btn-sm" onClick={loadScans}>
                                {isEnglish ? 'Refresh' : '刷新'}
                            </button>
                        </div>
                        {scansError ? (
                            <p className="admin-no-results">{isEnglish ? 'Failed to load scans.' : '加载扫描记录失败。'}</p>
                        ) : scans === null ? (
                            <div className="profile-spinner admin-spinner-center"/>
                        ) : (
                            <QrScanTrends scans={scans}/>
                        )}
                    </div>
                </>
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
    const wrapRef = useRef<HTMLDivElement>(null);
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    const scanValue = qrScanUrl(code.id, origin, platformId);
    const name = socialPlatformName(platformId, isEnglish, platforms);
    const count = code.platformScans[platformId] ?? 0;

    const downloadPng = () => {
        const canvas = wrapRef.current?.querySelector('canvas');
        if (!canvas) return;
        const safe = `${code.label || 'qr-code'}-${platformId}`.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
        const link = document.createElement('a');
        link.download = `qr-${safe}.png`;
        link.href = canvas.toDataURL('image/png');
        link.click();
    };

    const copyLink = () => {
        navigator.clipboard.writeText(scanValue).catch(() => { /* clipboard may be unavailable */
        });
        showToast(
            isEnglish ? `${name} link copied.` : `已复制 ${name} 链接。`,
            'success',
        );
    };

    return (
        <div className="admin-qr-platform-card">
            <span className="admin-qr-platform-card-title">{name}</span>
            <span className="admin-qr-platform-card-count">
                {isEnglish ? `${count} scans` : `${count} 次扫描`}
            </span>
            <div ref={wrapRef}>
                <QRCodeCanvas value={scanValue} size={PLATFORM_QR_SIZE} level="M" marginSize={2}/>
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
        </div>
    );
};
