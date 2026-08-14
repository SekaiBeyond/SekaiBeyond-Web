import { type ReactNode } from 'react';
import { passportScanUrl } from '~/lib/passports';
import { buildZip, downloadBlob, type ZipEntry } from '~/lib/zip';
import { canvasToPng, useQrCanvasBatch } from '../tools/qr/qrExport';

/**
 * Print-shop exports for a batch of passports: the CSV pairing each sticker with
 * its key slip, and the sticker artwork itself.
 *
 * Every PNG carries the human-readable passportId under the QR, so a sticker
 * that gets scuffed past scanning can still be typed into /p/<code> by hand.
 */

/**
 * Half the QR tool's export size, deliberately. A sticker is printed at a couple
 * of centimetres, a batch is up to 200 of them in one ZIP, and this is also the
 * width {@link LABEL_HEIGHT} is proportioned against — so it is the resolution
 * the sticker layout is defined at, not just a buffer size.
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

    return new Uint8Array(await (await canvasToPng(canvas)).arrayBuffer());
}

/**
 * Sticker-PNG export. Render {@link node} in the tree, call {@link request} with
 * the ids to export, and watch {@link progress} for a long batch.
 *
 * A single id downloads as one PNG; anything longer is zipped. The off-screen
 * rendering and its one-canvas-at-a-time discipline belong to
 * {@link useQrCanvasBatch}; what is passport-specific is only the sticker
 * composition and how the results are packaged.
 */
export const usePassportPngExport = (onFailure: () => void): {
    request: (ids: string[], filename: string) => void;
    progress: {done: number; total: number} | null;
    node: ReactNode;
} => {
    const origin = typeof window !== 'undefined' ? window.location.origin : '';

    const {request, done, total, node} = useQrCanvasBatch<string, ZipEntry>({
        size: QR_SIZE,
        value: id => passportScanUrl(id, origin),
        onCanvas: async (canvas, id) => ({
            name: `passport-${id}.png`,
            data: await composePassportPng(canvas, id),
        }),
        onFinish: (files, filename) => {
            if (files.length === 1) {
                downloadBlob(new Blob([files[0].data], {type: 'image/png'}), files[0].name);
            } else if (files.length > 1) {
                downloadBlob(buildZip(files), `${filename}.zip`);
            }
        },
        onFailure,
    });

    return {
        request,
        progress: total > 0 ? {done, total} : null,
        node,
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
