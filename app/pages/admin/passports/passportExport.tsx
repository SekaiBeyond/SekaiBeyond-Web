import { type ReactNode, useEffect, useRef, useState } from 'react';
import { QRCodeCanvas } from 'qrcode.react';
import { passportScanUrl } from '~/lib/passports';
import { buildZip, downloadBlob, type ZipEntry } from '~/lib/zip';
import { QR_LEVEL, QR_MARGIN } from '../tools/qr/qrExport';

/**
 * Print-shop exports for a batch of passports: the CSV pairing each sticker with
 * its key slip, and the sticker artwork itself.
 *
 * Every PNG carries the human-readable passportId under the QR, so a sticker
 * that gets scuffed past scanning can still be typed into /p/<code> by hand.
 */

const QR_SIZE = 512;
const LABEL_HEIGHT = 96;

/** One passport's sticker: the QR over its printed code, on white. */
async function composePassportPng(source: HTMLCanvasElement, passportId: string): Promise<Uint8Array<ArrayBuffer>> {
    const canvas = document.createElement('canvas');
    canvas.width = source.width;
    canvas.height = source.height + Math.round(LABEL_HEIGHT * (source.width / QR_SIZE));
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('canvas-unsupported');

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(source, 0, 0);

    const labelArea = canvas.height - source.height;
    ctx.fillStyle = '#000000';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    // Wide letter-spacing keeps the code readable at sticker size; the alphabet
    // already excludes the glyph pairs that get misread (O/0, I/1/L).
    ctx.font = `600 ${Math.round(labelArea * 0.42)}px ui-monospace, "SF Mono", Menlo, Consolas, monospace`;
    ctx.letterSpacing = '0.12em';
    ctx.fillText(passportId, canvas.width / 2, source.height + labelArea * 0.44);

    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(b => resolve(b), 'image/png'));
    if (!blob) throw new Error('encode-failed');
    return new Uint8Array(await blob.arrayBuffer());
}

interface PassportPngBatchProps {
    ids: string[];
    origin: string;
    onProgress: (done: number) => void;
    onDone: (files: ZipEntry[]) => void;
    onError: () => void;
}

/**
 * Renders the batch's QRs one at a time, reading each canvas back as a composed
 * PNG before mounting the next. Hundreds of {@link QR_SIZE}px canvases held at
 * once would be hundreds of megabytes; this keeps exactly one alive.
 *
 * qrcode.react draws in its own effect, and a descendant's effect runs before
 * this component's, so the canvas is always painted before it is read (the same
 * ordering useQrDownload relies on).
 */
const PassportPngBatch = ({ids, origin, onProgress, onDone, onError}: PassportPngBatchProps) => {
    const wrapRef = useRef<HTMLDivElement>(null);
    const filesRef = useRef<ZipEntry[]>([]);
    const [index, setIndex] = useState(0);

    useEffect(() => {
        if (index >= ids.length) {
            onDone(filesRef.current);
            return;
        }
        const canvas = wrapRef.current?.querySelector('canvas');
        if (!canvas) {
            onError();
            return;
        }
        let cancelled = false;
        composePassportPng(canvas, ids[index])
            .then(data => {
                if (cancelled) return;
                filesRef.current.push({name: `passport-${ids[index]}.png`, data});
                onProgress(index + 1);
                setIndex(i => i + 1);
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

    if (index >= ids.length) return null;

    return (
        <div
            ref={wrapRef}
            aria-hidden
            style={{position: 'absolute', width: 0, height: 0, overflow: 'hidden', pointerEvents: 'none'}}
        >
            <QRCodeCanvas
                value={passportScanUrl(ids[index], origin)}
                size={QR_SIZE}
                level={QR_LEVEL}
                marginSize={QR_MARGIN}
            />
        </div>
    );
};

interface ExportRequest {
    ids: string[];
    /** A single id downloads as one PNG; anything longer is zipped. */
    filename: string;
}

/**
 * Sticker-PNG export. Render {@link node} in the tree, call {@link request} with
 * the ids to export, and watch {@link progress} for a long batch.
 */
export const usePassportPngExport = (onFailure: () => void): {
    request: (ids: string[], filename: string) => void;
    progress: {done: number; total: number} | null;
    node: ReactNode;
} => {
    const [pending, setPending] = useState<ExportRequest | null>(null);
    const [done, setDone] = useState(0);

    const origin = typeof window !== 'undefined' ? window.location.origin : '';

    const finish = (files: ZipEntry[]) => {
        if (files.length === 1) {
            downloadBlob(new Blob([files[0].data], {type: 'image/png'}), files[0].name);
        } else if (files.length > 1) {
            downloadBlob(buildZip(files), `${pending?.filename ?? 'passports'}.zip`);
        }
        setPending(null);
        setDone(0);
    };

    return {
        request: (ids, filename) => {
            if (ids.length === 0) return;
            setDone(0);
            setPending({ids, filename});
        },
        progress: pending ? {done, total: pending.ids.length} : null,
        node: pending ? (
            <PassportPngBatch
                key={pending.filename}
                ids={pending.ids}
                origin={origin}
                onProgress={setDone}
                onDone={finish}
                onError={() => {
                    setPending(null);
                    setDone(0);
                    onFailure();
                }}
            />
        ) : null,
    };
};

const csvCell = (value: string): string =>
    /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;

/** A print-shop CSV: CRLF rows, and a BOM so Excel opens it as UTF-8 rather
 * than guessing. */
const buildCsv = (header: string[], rows: string[][]): Blob =>
    new Blob(
        [`﻿${[header, ...rows].map(row => row.map(csvCell).join(',')).join('\r\n')}\r\n`],
        {type: 'text/csv;charset=utf-8'},
    );

/**
 * The print shop's pairing list. This is the only artifact that ever holds the
 * plaintext activation keys — once the generator screen is left they are gone
 * from everywhere but this file.
 */
export function buildPassportCsv(
    rows: {passportId: string; activationCode: string}[],
    origin: string,
): Blob {
    return buildCsv(
        ['passportId', 'activationCode', 'scanUrl'],
        rows.map(row => [row.passportId, row.activationCode, passportScanUrl(row.passportId, origin)]),
    );
}

/** Public ids only — safe to re-export at any time, unlike the keys. */
export function buildPassportIdCsv(ids: string[], origin: string): Blob {
    return buildCsv(
        ['passportId', 'scanUrl'],
        ids.map(id => [id, passportScanUrl(id, origin)]),
    );
}
