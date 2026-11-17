import { type RefObject, useCallback, useEffect, useRef, useState } from 'react';
import { cornersOf, type JsQRFn, loadJsQR, type QrCorners } from './qrDecode';

interface UseQrScannerOptions {
    onDecode: (raw: string, corners: QrCorners) => boolean;
    cameraErrorMessage: string;
    logLabel: string;
    onStart?: () => void;
    onStartError?: () => void;
}

export interface QrScanner {
    videoRef: RefObject<HTMLVideoElement | null>;
    canvasRef: RefObject<HTMLCanvasElement | null>;
    cameraActive: boolean;
    cameraError: string | null;
    startCamera: () => Promise<void>;
    stopCamera: () => void;
}

export function useQrScanner(options: UseQrScannerOptions): QrScanner {
    const videoRef = useRef<HTMLVideoElement | null>(null);
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const streamRef = useRef<MediaStream | null>(null);
    const rafRef = useRef<number | null>(null);
    const sessionRef = useRef(0);
    const startingRef = useRef(false);
    const jsQRRef = useRef<JsQRFn | null>(null);

    const optionsRef = useRef(options);
    optionsRef.current = options;

    const [cameraActive, setCameraActive] = useState(false);
    const [cameraError, setCameraError] = useState<string | null>(null);

    const stopCamera = useCallback(() => {
        sessionRef.current++;
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

    const tick = useCallback(() => {
        if (!streamRef.current) return;
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
                    if (code?.data && optionsRef.current.onDecode(code.data, cornersOf(code.location))) {
                        stopCamera();
                        return;
                    }
                }
            }
        }
        rafRef.current = requestAnimationFrame(tick);
    }, [stopCamera]);

    const startCamera = useCallback(async () => {
        if (streamRef.current || startingRef.current) return;
        startingRef.current = true;
        const session = sessionRef.current;
        const stopped = () => sessionRef.current !== session;
        setCameraError(null);
        optionsRef.current.onStart?.();
        try {
            jsQRRef.current ??= await loadJsQR();
            if (stopped()) return;
            const stream = await navigator.mediaDevices.getUserMedia({
                video: {facingMode: 'environment'},
                audio: false,
            });
            if (stopped()) {
                stream.getTracks().forEach(t => t.stop());
                return;
            }
            streamRef.current = stream;
            const video = videoRef.current;
            if (!video) {
                stopCamera();
                return;
            }
            video.srcObject = stream;
            await video.play();
            if (stopped()) return;
            setCameraActive(true);
            rafRef.current = requestAnimationFrame(tick);
        } catch (err) {
            if (stopped()) return;
            stopCamera();
            console.error(`${optionsRef.current.logLabel} camera error`, err);
            setCameraError(optionsRef.current.cameraErrorMessage);
            optionsRef.current.onStartError?.();
        } finally {
            startingRef.current = false;
        }
    }, [tick, stopCamera]);

    useEffect(() => stopCamera, [stopCamera]);

    return {videoRef, canvasRef, cameraActive, cameraError, startCamera, stopCamera};
}
