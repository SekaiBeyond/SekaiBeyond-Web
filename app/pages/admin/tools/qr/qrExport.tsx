import { type ReactNode, useEffect, useRef, useState } from 'react';
import { QRCodeCanvas } from 'qrcode.react';
import { downloadBlob } from '~/lib/download';

const QR_LEVEL = 'M' as const;
const QR_MARGIN = 2;

const QR_EXPORT_SIZE = 1024;

type QrPreviewProps = {
    value: string;
    size: number;
};

export const QrPreview = ({value, size}: QrPreviewProps) => (
    <QRCodeCanvas value={value} size={size} level={QR_LEVEL} marginSize={QR_MARGIN}/>
);

export async function canvasToPng(canvas: HTMLCanvasElement): Promise<Blob> {
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(b => resolve(b), 'image/png'));
    if (!blob) throw new Error('encode-failed');
    return blob;
}

interface OffscreenQrCanvasesProps {
    values: string[];
    size: number;
    onCanvas: (canvas: HTMLCanvasElement, index: number) => Promise<void>;
    onDone: () => void;
    onError: () => void;
}

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

export const useQrCanvasBatch = <TItem, TResult>({size, value, onCanvas, onFinish, onFailure}: {
    size: number;
    value: (item: TItem) => string;
    onCanvas: (canvas: HTMLCanvasElement, item: TItem) => Promise<TResult>;
    onFinish: (results: TResult[], label: string) => void;
    onFailure?: () => void;
}): {
    request: (items: TItem[], label: string) => void;
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
