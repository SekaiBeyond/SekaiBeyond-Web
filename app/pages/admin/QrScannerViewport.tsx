import { type ReactNode, type Ref } from 'react';
import { FiCamera } from 'react-icons/fi';
import type { QrScanner } from '~/lib/useQrScanner';

interface QrScannerViewportProps {
    scanner: QrScanner;
    isEnglish: boolean;
    startDisabled?: boolean;
    viewportRef?: Ref<HTMLDivElement>;
    children?: ReactNode;
}

export function QrScannerViewport({scanner, isEnglish, startDisabled, viewportRef, children}: QrScannerViewportProps) {
    const {videoRef, canvasRef, cameraActive, cameraError, startCamera, stopCamera} = scanner;
    return (
        <>
            <div ref={viewportRef} className="admin-tickets-scanner-viewport">
                <video ref={videoRef} playsInline muted className="admin-tickets-scanner-video"/>
                <canvas ref={canvasRef} hidden/>
                {!cameraActive && (
                    <button
                        type="button"
                        className="admin-tickets-scanner-start"
                        onClick={() => void startCamera()}
                        disabled={startDisabled}
                    >
                        <span className="admin-tickets-scanner-start-icon"><FiCamera aria-hidden/></span>
                        {isEnglish ? 'Tap to start camera' : '点击启动摄像头'}
                    </button>
                )}
            </div>

            {(cameraActive || children) && (
                <div className="admin-btn-row">
                    {cameraActive && (
                        <button className="admin-toggle-btn admin-toggle-cancel" onClick={stopCamera}>
                            {isEnglish ? 'Stop Camera' : '停止摄像头'}
                        </button>
                    )}
                    {children}
                </div>
            )}

            {cameraError && <p className="admin-no-results">{cameraError}</p>}
        </>
    );
}
