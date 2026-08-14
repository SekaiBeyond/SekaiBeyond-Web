import { type ReactNode, useEffect, useRef, useState } from 'react';
import { QRCodeCanvas } from 'qrcode.react';
import { downloadBlob } from '~/lib/zip';

// Error correction and quiet-zone width, shared by every QR this app draws —
// the on-screen preview, the QR sticker PNG, and the passport sticker PNG — so a
// printed code always encodes the way the preview showed it.
export const QR_LEVEL = 'M' as const;
export const QR_MARGIN = 2;

/**
 * Backing-buffer resolution used when a QR is exported to PNG. Rendered only
 * for the duration of a download (see {@link useQrDownload}) so pages never
 * hold a large canvas in memory; qrcode.react further multiplies this by
 * devicePixelRatio, keeping the file crisp when scaled up or printed.
 */
export const QR_EXPORT_SIZE = 1024;

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
 * Renders QRs off-screen and hands each painted canvas back, one at a time.
 *
 * Two things live here rather than in either exporter. Only one canvas is ever
 * alive: hundreds of {@link QR_EXPORT_SIZE}px buffers held at once would be
 * hundreds of megabytes, and nothing on screen needs them. And the ordering that
 * makes reading a canvas safe at all — qrcode.react draws in its own effect, and
 * a descendant's effect runs before its owner's, so the buffer is always painted
 * before this component's effect reads it — is an assumption about React that
 * deserves exactly one place to be stated and, if it ever changes, fixed.
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
        // Deliberately keyed on the cursor alone: the callbacks are stable for one
        // export, and re-running per identity change would double-render a QR.
        // eslint-disable-next-line react-hooks/exhaustive-deps
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
 * Render a batch of QRs off-screen and do something with each one. The building
 * block under {@link useQrDownload} and the passport sticker exporter, which
 * differ only in what they encode and what they do with a painted canvas.
 *
 * Callers hand over their own items rather than bare strings — `value` says what
 * to encode, and `onCanvas` gets the item back, so a passport's composer still
 * has the id it prints under the QR. `onCanvas` and `onFinish` are read when a
 * canvas is ready rather than captured at mount, so they may close over current
 * state; `request` starts a fresh run and remounts the renderer. The `label`
 * given to `request` names the run and comes back to `onFinish`, which is what
 * every caller wants to name its file.
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
 * Exports one QR to a crisp PNG without keeping a high-resolution canvas
 * mounted. Render {@link node} once in the component's tree, then call
 * {@link request} on click: a hidden {@link QR_EXPORT_SIZE}px canvas is mounted,
 * read back as a PNG, and unmounted.
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
