import { type ReactNode, useEffect, useRef, useState } from 'react';
import { QRCodeCanvas } from 'qrcode.react';

const QR_LEVEL = 'M' as const;
const QR_MARGIN = 2;

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

type PendingDownload = {value: string; filename: string};

/**
 * Exports QRs to crisp PNGs without keeping a high-resolution canvas mounted.
 * Render {@link node} once in the component's tree, then call {@link request}
 * on click: a hidden {@link QR_EXPORT_SIZE}px canvas is mounted, read back as a
 * PNG, and unmounted. React flushes the canvas's own draw effect (a descendant)
 * before this hook's effect (the owner), so the buffer is painted before we
 * read it.
 */
export const useQrDownload = (): {request: (value: string, filename: string) => void; node: ReactNode} => {
    const [pending, setPending] = useState<PendingDownload | null>(null);
    const wrapRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!pending) return;
        const canvas = wrapRef.current?.querySelector('canvas');
        if (canvas) {
            const link = document.createElement('a');
            link.download = `${pending.filename}.png`;
            link.href = canvas.toDataURL('image/png');
            link.click();
        }
        setPending(null);
    }, [pending]);

    const node = pending ? (
        <div
            ref={wrapRef}
            aria-hidden
            style={{position: 'absolute', width: 0, height: 0, overflow: 'hidden', pointerEvents: 'none'}}
        >
            <QRCodeCanvas value={pending.value} size={QR_EXPORT_SIZE} level={QR_LEVEL} marginSize={QR_MARGIN}/>
        </div>
    ) : null;

    return {request: (value, filename) => setPending({value, filename}), node};
};
