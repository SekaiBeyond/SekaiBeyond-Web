import { type ReactNode } from 'react';
import { buildCsv } from '~/lib/csv';
import { passportScanUrl } from '~/lib/passports';
import { buildZip, downloadBlob, type ZipEntry } from '~/lib/zip';
import { canvasToPng, useQrCanvasBatch } from '../tools/qr/qrExport';

/**
 * Print-shop exports for a set of passports: the CSV pairing stickers with key
 * slips, and the sticker artwork. Every PNG prints the passportId under the QR,
 * so a scuffed sticker can still be typed into /p/<code>.
 */

/**
 * Half the QR tool's export size: stickers are printed a couple of centimetres
 * wide, by the hundred per ZIP. {@link LABEL_HEIGHT} is proportioned against it,
 * so it defines the sticker layout.
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
    // already avoids O/0 and I/1/L.
    ctx.font = `600 ${Math.round(labelArea * 0.42)}px ui-monospace, "SF Mono", Menlo, Consolas, monospace`;
    ctx.letterSpacing = '0.12em';
    ctx.fillText(passportId, canvas.width / 2, source.height + labelArea * 0.44);

    return new Uint8Array(await (await canvasToPng(canvas)).arrayBuffer());
}

/**
 * Sticker PNG export. Render {@link node}, call {@link request} with the ids,
 * and watch {@link progress}. One id downloads a PNG, more a ZIP. The off-screen
 * rendering is {@link useQrCanvasBatch}'s; this is only the sticker and the
 * packaging.
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

/**
 * The print shop's pairing list, from the generator or a selection's Keys CSV.
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

/** Public ids only — safe to re-export at any time. */
export function buildPassportIdCsv(ids: string[], origin: string): Blob {
    return buildCsv(
        ['passportId', 'scanUrl'],
        ids.map(id => [id, passportScanUrl(id, origin)]),
    );
}
