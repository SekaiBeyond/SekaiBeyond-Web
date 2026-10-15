import { type ReactNode, useEffect, useRef, useState } from 'react';
import { QRCodeCanvas } from 'qrcode.react';
import { downloadBlob } from '~/lib/zip';

// Shared by every QR the app draws (preview, sticker PNG, passport sticker PNG),
// so a printed code encodes as the preview showed.
const QR_LEVEL = 'M' as const;
const QR_MARGIN = 2;

/**
 * The PNG export's buffer size, mounted only during a download (see {@link
 * useQrDownload}); qrcode.react multiplies it by devicePixelRatio.
 */
const QR_EXPORT_SIZE = 1024;

type QrPreviewProps = {
    /** Value encoded into the QR. */
    value: string;
    /** Displayed size in px. */
    size: number;
};

/** The on-screen QR, kept in sync with the exported PNG's encoding and margin. */
export const QrPreview = ({value, size}: QrPreviewProps) => (
    <QRCodeCanvas value={value} size={size} level={QR_LEVEL} marginSize={QR_MARGIN}/>
);

/** Read a painted canvas back as a PNG. */
export async function canvasToPng(canvas: HTMLCanvasElement): Promise<Blob> {
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(b => resolve(b), 'image/png'));
    if (!blob) throw new Error('encode-failed');
    return blob;
}

interface OffscreenQrCanvasesProps {
    /** Encoded one at a time, in order. */
    values: string[];
    /** Backing-buffer size of each canvas. */
    size: number;
    /** Handed each painted canvas; the next one mounts once it resolves. */
    onCanvas: (canvas: HTMLCanvasElement, index: number) => Promise<void>;
    onDone: () => void;
    onError: () => void;
}

/**
 * Renders QRs off-screen and hands back each painted canvas, one at a time, so
 * hundreds of {@link QR_EXPORT_SIZE}px buffers never exist at once. Reading the
 * canvas here relies on qrcode.react drawing in its own effect, which runs
 * before this owner's; this is the one place that assumption lives.
 */
const OffscreenQrCanvases = ({values, size, onCanvas, onDone, onError}: OffscreenQrCanvasesProps) => {
    const wrapRef = useRef<HTMLDivElement>(null);
    const [index, setIndex] = useState(0);

    useEffect(() => {
        if (index >= values.length) {
            onDone();
            return;
        }
        const canvas = wrapRef.current?.querySelector('canvas');
        if (!canvas) {
            onError();
            return;
        }
        let cancelled = false;
        onCanvas(canvas, index)
            .then(() => {
                if (!cancelled) setIndex(i => i + 1);
            })
            .catch(() => {
                if (!cancelled) onError();
            });
        return () => {
            cancelled = true;
        };
        // Keyed on the cursor alone: the callbacks are stable for one export, and
        // re-running per identity would draw a QR twice.
    }, [index]);

    if (index >= values.length) return null;

    return (
        <div
            ref={wrapRef}
            aria-hidden
            style={{position: 'absolute', width: 0, height: 0, overflow: 'hidden', pointerEvents: 'none'}}
        >
            <QRCodeCanvas value={values[index]} size={size} level={QR_LEVEL} marginSize={QR_MARGIN}/>
        </div>
    );
};

/**
 * Render a batch of QRs off-screen and handle each one; the base of {@link
 * useQrDownload} and the passport sticker export. Callers pass their own items:
 * `value` says what to encode and `onCanvas` gets the item back. `onCanvas` and
 * `onFinish` are read when needed, so they may close over current state.
 * `request` starts a fresh run, and its `label` comes back to `onFinish` for
 * naming the file.
 */
export const useQrCanvasBatch = <TItem, TResult>({size, value, onCanvas, onFinish, onFailure}: {
    size: number;
    value: (item: TItem) => string;
    onCanvas: (canvas: HTMLCanvasElement, item: TItem) => Promise<TResult>;
    onFinish: (results: TResult[], label: string) => void;
    onFailure?: () => void;
}): {
    request: (items: TItem[], label: string) => void;
    /** How many have been read back, for a batch long enough to show progress. */
    done: number;
    total: number;
    node: ReactNode;
} => {
    const [pending, setPending] = useState<{items: TItem[]; label: string} | null>(null);
    const [done, setDone] = useState(0);
    const results = useRef<TResult[]>([]);

    const stop = () => {
        setPending(null);
        setDone(0);
    };

    return {
        request: (items, label) => {
            if (items.length === 0) return;
            results.current = [];
            setDone(0);
            setPending({items, label});
        },
        done,
        total: pending?.items.length ?? 0,
        node: pending ? (
            <OffscreenQrCanvases
                key={pending.label}
                values={pending.items.map(value)}
                size={size}
                onCanvas={async (canvas, index) => {
                    results.current.push(await onCanvas(canvas, pending.items[index]));
                    setDone(index + 1);
                }}
                onDone={() => {
                    const finished = results.current;
                    const {label} = pending;
                    stop();
                    onFinish(finished, label);
                }}
                onError={() => {
                    stop();
                    onFailure?.();
                }}
            />
        ) : null,
    };
};

/**
 * Exports one QR as a crisp PNG without keeping a large canvas mounted: render
 * {@link node} once, then {@link request} mounts a hidden {@link
 * QR_EXPORT_SIZE}px canvas, reads it back and unmounts it.
 */
export const useQrDownload = (): {request: (value: string, filename: string) => void; node: ReactNode} => {
    const {request, node} = useQrCanvasBatch<string, Blob>({
        size: QR_EXPORT_SIZE,
        value: encoded => encoded,
        onCanvas: canvasToPng,
        onFinish: ([png], filename) => {
            if (png) downloadBlob(png, `${filename}.png`);
        },
    });

    return {request: (value, filename) => request([value], filename), node};
};
