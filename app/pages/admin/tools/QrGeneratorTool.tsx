import { useState } from 'react';
import { useLanguage } from '~/components/LanguageContextProvider';
import { callSaveQrCode } from '~/lib/firebase';
import { useQrCodes } from '~/lib/qrCodes';
import { useAllUpcomingEvents } from '~/lib/upcomingEvents';
import { QrDashboard } from './qr/QrDashboard';
import { QrCodeDetail } from './qr/QrCodeDetail';
import { QrLinkScanner } from './qr/QrLinkScanner';
import { QuickQrGenerator } from './qr/QuickQrGenerator';
import { SocialPlatformsManager } from './qr/SocialPlatformsManager';
import { buildQrPayload, emptyDraft, QrCodeForm, type QrDraft, } from './qr/QrCodeForm';

interface QrGeneratorToolProps {
    onBack: () => void;
    showToast: (message: string, type: 'success' | 'warning' | 'error') => void;
    readOnly?: boolean;
}

type View = 'dashboard' | 'create' | 'detail' | 'scan' | 'platforms';

export const QrGeneratorTool = ({onBack, showToast, readOnly = false}: QrGeneratorToolProps) => {
    const {isEnglish} = useLanguage();
    const {qrCodes, loading, refresh} = useQrCodes();
    const {upcomingEvents} = useAllUpcomingEvents();

    const [view, setView] = useState<View>('dashboard');
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [tracked, setTracked] = useState(false);
    const [draft, setDraft] = useState<QrDraft>(emptyDraft());
    const [saving, setSaving] = useState(false);
    // Where to return after the platforms manager, so a create draft isn't lost.
    const [platformsReturn, setPlatformsReturn] = useState<View>('dashboard');

    const selected = qrCodes.find(c => c.id === selectedId) ?? null;

    const openCreate = () => {
        setDraft(emptyDraft());
        setTracked(false);
        setView('create');
    };

    const openPlatforms = () => {
        setPlatformsReturn(view);
        setView('platforms');
    };

    const createTracked = async () => {
        const built = buildQrPayload(draft, isEnglish);
        if ('error' in built) {
            showToast(built.error, 'error');
            return;
        }
        setSaving(true);
        try {
            const res = await callSaveQrCode(built.payload);
            await refresh();
            setSelectedId(res.data.qrId);
            setView('detail');
            showToast(isEnglish ? 'QR code created.' : '二维码已创建。', 'success');
        } catch (e: any) {
            showToast(e?.message ?? (isEnglish ? 'Failed to create QR code.' : '创建二维码失败。'), 'error');
        } finally {
            setSaving(false);
        }
    };

    if (view === 'detail' && selected) {
        return (
            <QrCodeDetail
                code={selected}
                events={upcomingEvents}
                onBack={() => setView('dashboard')}
                onChanged={refresh}
                onManagePlatforms={openPlatforms}
                showToast={showToast}
                readOnly={readOnly}
            />
        );
    }

    if (view === 'scan') {
        return (
            <QrLinkScanner
                codes={qrCodes}
                onBack={() => setView('dashboard')}
                onLinked={refresh}
                showToast={showToast}
            />
        );
    }

    if (view === 'platforms') {
        return (
            <SocialPlatformsManager
                onBack={() => setView(platformsReturn)}
                showToast={showToast}
                readOnly={readOnly}
            />
        );
    }

    if (view === 'create') {
        return (
            <div className="admin-section">
                <div className="admin-tools-header">
                    <button className="admin-back-btn" onClick={() => setView('dashboard')} type="button">
                        {isEnglish ? '← Back to QR Codes' : '← 返回二维码列表'}
                    </button>
                    <h3 className="admin-tools-title">{isEnglish ? 'New QR Code' : '新建二维码'}</h3>
                </div>

                <div className="admin-qr-mode-toggle">
                    <button
                        className={`admin-qr-mode-btn${!tracked ? ' admin-qr-mode-active' : ''}`}
                        onClick={() => setTracked(false)}
                        type="button"
                    >
                        {isEnglish ? 'Quick (untracked)' : '快速（不追踪）'}
                    </button>
                    <button
                        className={`admin-qr-mode-btn${tracked ? ' admin-qr-mode-active' : ''}`}
                        onClick={() => setTracked(true)}
                        type="button"
                    >
                        {isEnglish ? 'Tracked' : '可追踪'}
                    </button>
                </div>
                <p className="admin-helper-text admin-section-mb">
                    {tracked
                        ? (isEnglish
                            ? 'Tracked codes count scans, can pin to a map spot, link to an event, and let you change the target later.'
                            : '可追踪二维码会统计扫描次数，可关联地图位置与活动，并支持之后修改跳转目标。')
                        : (isEnglish
                            ? 'A throwaway QR with the URL baked in — no scan tracking or map spot.'
                            : '一次性二维码，链接直接写入图片 — 不统计扫描，也无法关联地图。')}
                </p>

                {tracked ? (
                    <>
                        <QrCodeForm draft={draft} setDraft={setDraft} events={upcomingEvents} isEnglish={isEnglish}
                                    onManagePlatforms={openPlatforms}/>
                        <div className="admin-btn-row admin-mt-12">
                            <button
                                className="admin-toggle-btn admin-toggle-save"
                                onClick={createTracked}
                                disabled={saving}
                            >
                                {saving
                                    ? (isEnglish ? 'Creating...' : '创建中...')
                                    : (isEnglish ? 'Create QR Code' : '创建二维码')}
                            </button>
                            <button
                                className="admin-toggle-btn admin-toggle-cancel"
                                onClick={() => setView('dashboard')}
                            >
                                {isEnglish ? 'Cancel' : '取消'}
                            </button>
                        </div>
                    </>
                ) : (
                    <QuickQrGenerator events={upcomingEvents}/>
                )}
            </div>
        );
    }

    return (
        <>
            <div className="admin-tools-back-row">
                <button className="admin-back-btn" onClick={onBack} type="button">
                    {isEnglish ? '← Back to Tools' : '← 返回工具'}
                </button>
            </div>
            <QrDashboard
                codes={qrCodes}
                events={upcomingEvents}
                loading={loading}
                onSelect={id => {
                    setSelectedId(id);
                    setView('detail');
                }}
                onCreate={openCreate}
                onScanLink={() => setView('scan')}
                onRefresh={refresh}
                readOnly={readOnly}
            />
        </>
    );
};
