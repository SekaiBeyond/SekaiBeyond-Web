import { type RefObject, useCallback, useEffect, useRef, useState } from 'react';

type JsQRFn = (data: Uint8ClampedArray, w: number, h: number) => {data: string} | null;

interface UseQrScannerOptions {
    /**
     * Invoked with each decoded QR payload. Return `true` once a match has been
     * handled to stop the camera and the scan loop; return `false` to keep
     * scanning (e.g. ignore an irrelevant code).
     */
    onDecode: (raw: string) => boolean;
    /** Message shown when the camera can't be started (permissions, no device, …). */
    cameraErrorMessage: string;
    /** Prefix for console error logs, e.g. '[TicketScanner]'. */
    logLabel: string;
    /** Runs when the camera starts — use it to reset caller-owned scan state. */
    onStart?: () => void;
    /** Runs if the camera fails to start, after the error message is set. */
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

/**
 * Drives a back-camera QR scanning loop with jsQR. Owns the whole camera
 * lifecycle — `getUserMedia`, the `requestAnimationFrame` decode loop, and
 * teardown — and reports each decoded payload through `onDecode`. Callers just
 * render `videoRef`/`canvasRef` and decide what a decoded value means.
 */
export function useQrScanner(options: UseQrScannerOptions): QrScanner {
    const videoRef = useRef<HTMLVideoElement | null>(null);
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const streamRef = useRef<MediaStream | null>(null);
    const rafRef = useRef<number | null>(null);
    const cancelledRef = useRef(false);
    const jsQRRef = useRef<JsQRFn | null>(null);

    // Keep the latest options in a ref so the rAF loop never reads a stale
    // closure and `tick`/`startCamera` stay referentially stable.
    const optionsRef = useRef(options);
    optionsRef.current = options;

    const [cameraActive, setCameraActive] = useState(false);
    const [cameraError, setCameraError] = useState<string | null>(null);

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
                    if (code?.data && optionsRef.current.onDecode(code.data)) {
                        stopCamera(); // handled: tear down and stop the loop
                        return;
                    }
                }
            }
        }
        rafRef.current = requestAnimationFrame(tick);
    }, [stopCamera]);

    const startCamera = useCallback(async () => {
        // Prevent double invocation — a second call while getUserMedia is
        // in-flight would overwrite streamRef and leak the first stream.
        if (streamRef.current) return;
        setCameraError(null);
        optionsRef.current.onStart?.();
        cancelledRef.current = false;
        try {
            if (!jsQRRef.current) {
                const mod = await import('jsqr');
                jsQRRef.current = mod.default as JsQRFn;
            }
            const stream = await navigator.mediaDevices.getUserMedia({
                video: {facingMode: 'environment'},
                audio: false,
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
            console.error(`${optionsRef.current.logLabel} camera error`, err);
            setCameraError(optionsRef.current.cameraErrorMessage);
            optionsRef.current.onStartError?.();
        }
    }, [tick]);

    useEffect(() => () => {
        cancelledRef.current = true;
        stopCamera();
    }, [stopCamera]);

    return {videoRef, canvasRef, cameraActive, cameraError, startCamera, stopCamera};
}
