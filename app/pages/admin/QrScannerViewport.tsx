import { type ReactNode } from 'react';
import type { QrScanner } from '~/lib/useQrScanner';

interface QrScannerViewportProps {
    scanner: QrScanner;
    isEnglish: boolean;
    /** Disables the "Start Camera" button (e.g. while a scan is in flight). */
    startDisabled?: boolean;
    /** Extra controls rendered in the button row, after Start/Stop. */
    children?: ReactNode;
}

/**
 * The camera preview + Start/Stop control row shared by the admin QR scanners.
 * Pair it with {@link useQrScanner}; the caller owns what a decoded code means
 * and renders its own result UI below this.
 */
export function QrScannerViewport({scanner, isEnglish, startDisabled, children}: QrScannerViewportProps) {
    const {videoRef, canvasRef, cameraActive, cameraError, startCamera, stopCamera} = scanner;
    return (
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
                    <button
                        className="admin-toggle-btn admin-toggle-save"
                        onClick={() => void startCamera()}
                        disabled={startDisabled}
                    >
                        {isEnglish ? 'Start Camera' : '启动摄像头'}
                    </button>
                ) : (
                    <button className="admin-toggle-btn admin-toggle-cancel" onClick={stopCamera}>
                        {isEnglish ? 'Stop Camera' : '停止摄像头'}
                    </button>
                )}
                {children}
            </div>

            {cameraError && <p className="admin-no-results">{cameraError}</p>}
        </>
    );
}
