import { useCallback, useEffect, useRef, useState } from 'react';
import { useLanguage } from '~/components/LanguageContextProvider';
import { callSetQrSpot } from '~/lib/firebase';
import { type QrCode, qrHasSpot } from '~/lib/qrCodes';

type JsQRFn = (data: Uint8ClampedArray, w: number, h: number) => {data: string} | null;
type LinkState = 'idle' | 'locating' | 'saving' | 'done' | 'error';

interface QrLinkScannerProps {
    codes: QrCode[];
    onBack: () => void;
    onLinked: () => Promise<void>;
    showToast: (message: string, type: 'success' | 'warning' | 'error') => void;
}

/** Pull a managed-code id out of a scanned `/qr?id=…` URL (or a bare id). */
function parseQrId(raw: string): string | null {
    const text = raw.trim();
    try {
        const id = new URL(text).searchParams.get('id');
        if (id) return id;
    } catch {
        // not a URL — fall through
    }
    return /^[A-Za-z0-9_-]{6,40}$/.test(text) ? text : null;
}

/**
 * Admin "link a code by scanning" flow: point the phone camera at a printed
 * managed QR, match it to one of your codes, then pin it to your current GPS
 * location in one tap. Keeps location-linking entirely inside the admin tool.
 */
export const QrLinkScanner = ({codes, onBack, onLinked, showToast}: QrLinkScannerProps) => {
    const {isEnglish} = useLanguage();
    const videoRef = useRef<HTMLVideoElement | null>(null);
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const streamRef = useRef<MediaStream | null>(null);
    const rafRef = useRef<number | null>(null);
    const cancelledRef = useRef(false);
    const jsQRRef = useRef<JsQRFn | null>(null);

    const [cameraActive, setCameraActive] = useState(false);
    const [cameraError, setCameraError] = useState<string | null>(null);
    const [matched, setMatched] = useState<QrCode | null>(null);
    const [unknownId, setUnknownId] = useState<string | null>(null);
    const [manual, setManual] = useState('');
    const [linkState, setLinkState] = useState<LinkState>('idle');
    const [linkError, setLinkError] = useState('');

    const stopCamera = useCallback(() => {
        if (rafRef.current !== null) {
            cancelAnimationFrame(rafRef.current);
            rafRef.current = null;
        }
        if (streamRef.current) {
            streamRef.current.getTracks().forEach(t => t.stop());
            streamRef.current = null;
        }
        setCameraActive(false);
    }, []);

    // Resolve a scanned/typed value to one of the admin's codes and pause the camera.
    const resolve = useCallback((raw: string): boolean => {
        const id = parseQrId(raw);
        if (!id) return false;
        const code = codes.find(c => c.id === id);
        stopCamera();
        setLinkState('idle');
        setLinkError('');
        if (code) {
            setUnknownId(null);
            setMatched(code);
        } else {
            setMatched(null);
            setUnknownId(id);
        }
        return true;
    }, [codes, stopCamera]);

    const tick = useCallback(() => {
        if (cancelledRef.current) return;
        const video = videoRef.current;
        const canvas = canvasRef.current;
        const jsQR = jsQRRef.current;
        if (video && canvas && jsQR && video.readyState === video.HAVE_ENOUGH_DATA) {
            const w = video.videoWidth;
            const h = video.videoHeight;
            if (w && h) {
                canvas.width = w;
                canvas.height = h;
                const ctx = canvas.getContext('2d', {willReadFrequently: true});
                if (ctx) {
                    ctx.drawImage(video, 0, 0, w, h);
                    const code = jsQR(ctx.getImageData(0, 0, w, h).data, w, h);
                    if (code?.data && resolve(code.data)) return; // stops camera on match
                }
            }
        }
        rafRef.current = requestAnimationFrame(tick);
    }, [resolve]);

    const startCamera = useCallback(async () => {
        setCameraError(null);
        setMatched(null);
        setUnknownId(null);
        cancelledRef.current = false;
        try {
            if (!jsQRRef.current) {
                const mod = await import('jsqr');
                jsQRRef.current = mod.default as JsQRFn;
            }
            const stream = await navigator.mediaDevices.getUserMedia({
                video: {facingMode: 'environment'},
                audio: false
            });
            streamRef.current = stream;
            const video = videoRef.current;
            if (!video) {
                stream.getTracks().forEach(t => t.stop());
                return;
            }
            video.srcObject = stream;
            await video.play();
            setCameraActive(true);
            rafRef.current = requestAnimationFrame(tick);
        } catch (err) {
            console.error('[QrLinkScanner] camera error', err);
            setCameraError(isEnglish
                ? 'Camera unavailable. Paste the code link below instead.'
                : '无法访问摄像头，请在下方粘贴二维码链接。');
        }
    }, [isEnglish, tick]);

    useEffect(() => () => {
        cancelledRef.current = true;
        stopCamera();
    }, [stopCamera]);

    const setToMyLocation = () => {
        if (!matched) return;
        setLinkError('');
        if (!('geolocation' in navigator)) {
            setLinkState('error');
            setLinkError(isEnglish ? 'Geolocation is not available on this device.' : '此设备不支持定位。');
            return;
        }
        setLinkState('locating');
        navigator.geolocation.getCurrentPosition(
            async pos => {
                const {latitude, longitude} = pos.coords;
                setLinkState('saving');
                try {
                    await callSetQrSpot({qrId: matched.id, lat: latitude, lng: longitude});
                    await onLinked();
                    setLinkState('done');
                    showToast(isEnglish
                        ? `Linked “${matched.label}” to your location.`
                        : `已将"${matched.label}"关联到你的位置。`, 'success');
                } catch (e: any) {
                    setLinkState('error');
                    setLinkError(e?.message ?? (isEnglish ? 'Failed to save location.' : '保存位置失败。'));
                }
            },
            err => {
                setLinkState('error');
                setLinkError(err.code === err.PERMISSION_DENIED
                    ? (isEnglish ? 'Location permission denied.' : '定位权限被拒绝。')
                    : (isEnglish ? 'Could not get your location.' : '无法获取你的位置。'));
            },
            {enableHighAccuracy: true, timeout: 10000},
        );
    };

    const scanNext = () => {
        setMatched(null);
        setUnknownId(null);
        setLinkState('idle');
        setLinkError('');
        void startCamera();
    };

    const busy = linkState === 'locating' || linkState === 'saving';

    return (
        <div className="admin-section">
            <div className="admin-tools-header">
                <button className="admin-back-btn" onClick={onBack} type="button">
                    {isEnglish ? '← Back to QR Codes' : '← 返回二维码列表'}
                </button>
                <h3 className="admin-tools-title">{isEnglish ? 'Link a Code by Scanning' : '扫码关联位置'}</h3>
            </div>

            <p className="admin-helper-text admin-section-mb">
                {isEnglish
                    ? 'Stand where the printed code is posted, scan it, then set its map spot to your current location.'
                    : '站在已张贴二维码的位置，扫描它，然后将其地图位置设为你的当前位置。'}
            </p>

            {!matched && !unknownId && (
                <>
                    <div className="admin-tickets-scanner-viewport">
                        <video ref={videoRef} playsInline muted className="admin-tickets-scanner-video"/>
                        <canvas ref={canvasRef} hidden/>
                        {!cameraActive && (
                            <div className="admin-tickets-scanner-placeholder">
                                {isEnglish ? 'Camera off' : '摄像头已关闭'}
                            </div>
                        )}
                    </div>
                    <div className="admin-btn-row">
                        {!cameraActive ? (
                            <button className="admin-toggle-btn admin-toggle-save" onClick={() => void startCamera()}>
                                {isEnglish ? 'Start Camera' : '启动摄像头'}
                            </button>
                        ) : (
                            <button className="admin-toggle-btn admin-toggle-cancel" onClick={stopCamera}>
                                {isEnglish ? 'Stop Camera' : '停止摄像头'}
                            </button>
                        )}
                    </div>
                    {cameraError && <p className="admin-no-results">{cameraError}</p>}

                    <div className="admin-tickets-scanner-manual">
                        <label className="admin-tickets-template-field">
                            <span>{isEnglish ? 'Or paste the code link' : '或粘贴二维码链接'}</span>
                            <div className="admin-tickets-scanner-manual-row">
                                <input
                                    type="text"
                                    className="admin-search-input"
                                    placeholder={isEnglish ? 'https://…/qr?id=…' : 'https://…/qr?id=…'}
                                    value={manual}
                                    onChange={e => setManual(e.target.value)}
                                    onKeyDown={e => {
                                        if (e.key === 'Enter' && manual.trim()) {
                                            if (!resolve(manual)) {
                                                showToast(isEnglish ? 'Not a valid QR code link.' : '不是有效的二维码链接。', 'error');
                                            }
                                            setManual('');
                                        }
                                    }}
                                />
                                <button
                                    className="admin-toggle-btn admin-toggle-save"
                                    onClick={() => {
                                        if (!resolve(manual)) {
                                            showToast(isEnglish ? 'Not a valid QR code link.' : '不是有效的二维码链接。', 'error');
                                        }
                                        setManual('');
                                    }}
                                    disabled={!manual.trim()}
                                >
                                    {isEnglish ? 'Find' : '查找'}
                                </button>
                            </div>
                        </label>
                    </div>
                </>
            )}

            {unknownId && (
                <div className="admin-qr-scan-result">
                    <p className="admin-no-results">
                        {isEnglish
                            ? 'That code isn’t one of your QR codes (or the list is stale). Try Refresh on the dashboard.'
                            : '该二维码不在你的列表中（或列表已过期）。请在面板上点击刷新。'}
                    </p>
                    <button className="admin-toggle-btn admin-toggle-edit" onClick={scanNext}>
                        {isEnglish ? 'Scan another' : '继续扫描'}
                    </button>
                </div>
            )}

            {matched && (
                <div className="admin-qr-scan-result">
                    <div className="admin-qr-scan-matched">
                        <span className="admin-qr-scan-matched-label">{isEnglish ? 'Scanned' : '已扫描'}</span>
                        <span className="admin-qr-scan-matched-title">{matched.label}</span>
                        <span className="admin-helper-text">
                            {isEnglish ? 'Current spot: ' : '当前位置：'}
                            {linkState === 'done'
                                ? (isEnglish ? 'updated to your location ✓' : '已更新为你的位置 ✓')
                                : qrHasSpot(matched)
                                    ? `${matched.lat.toFixed(5)}, ${matched.lng.toFixed(5)}`
                                    : (isEnglish ? 'not linked' : '未关联')}
                        </span>
                    </div>

                    {linkState !== 'done' && (
                        <button className="admin-toggle-btn admin-toggle-save admin-qr-scan-cta"
                                onClick={setToMyLocation} disabled={busy}>
                            {linkState === 'locating'
                                ? (isEnglish ? 'Getting location…' : '正在获取位置…')
                                : linkState === 'saving'
                                    ? (isEnglish ? 'Saving…' : '保存中…')
                                    : qrHasSpot(matched)
                                        ? (isEnglish ? '📍 Re-link to my location' : '📍 重新关联到我的位置')
                                        : (isEnglish ? '📍 Set to my current location' : '📍 设为我的当前位置')}
                        </button>
                    )}
                    {linkState === 'error' && linkError && <p className="admin-no-results">{linkError}</p>}

                    <button className="admin-toggle-btn admin-toggle-edit" onClick={scanNext}>
                        {isEnglish ? 'Scan next' : '继续扫描'}
                    </button>
                </div>
            )}
        </div>
    );
};
