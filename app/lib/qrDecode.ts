export interface QrPoint {
    x: number;
    y: number;
}

/** A code's corners, clockwise from top-left, in the pixels of the frame it was found in. */
export type QrCorners = [QrPoint, QrPoint, QrPoint, QrPoint];

interface JsQRLocation {
    topLeftCorner: QrPoint;
    topRightCorner: QrPoint;
    bottomRightCorner: QrPoint;
    bottomLeftCorner: QrPoint;
}

export type JsQRFn = (data: Uint8ClampedArray, w: number, h: number) => {data: string; location: JsQRLocation} | null;

export function cornersOf(location: JsQRLocation): QrCorners {
    return [location.topLeftCorner, location.topRightCorner, location.bottomRightCorner, location.bottomLeftCorner];
}

let jsQRModule: Promise<JsQRFn> | null = null;

/** jsQR, fetched the first time any scanner needs it and shared after that. */
export function loadJsQR(): Promise<JsQRFn> {
    jsQRModule ??= import('jsqr').then(
        mod => mod.default as JsQRFn,
        err => {
            jsQRModule = null; // let the next scan retry a chunk that failed to load
            throw err;
        },
    );
    return jsQRModule;
}

// Longest edge of each attempt, in pixels. jsQR is slow on 12MP photos, so
// small sizes go first; large ones are for a code filling only a corner.
const DECODE_SIZES = [800, 1600, 3200];

export interface QrRect {
    x: number;
    y: number;
    width: number;
    height: number;
}

export interface QrRead {
    data: string;
    corners: QrCorners;
    /** The canvas the code was found on, which `corners` refer to. */
    frame: HTMLCanvasElement;
    /** Where the image sits on `frame`; the rest is margin added for decoding. */
    bounds: QrRect;
}

/**
 * Finds a QR code in a photo or screenshot, or null; nothing leaves the device.
 * Each attempt draws on white with a margin, since a transparent PNG would read
 * black-on-black and a tightly cropped code has no quiet zone.
 */
export async function decodeQrImage(image: Blob): Promise<QrRead | null> {
    const jsQR = await loadJsQR();
    const bitmap = await createImageBitmap(image);
    try {
        const longest = Math.max(bitmap.width, bitmap.height);
        for (const size of DECODE_SIZES) {
            const scale = Math.min(1, size / longest);
            const w = Math.round(bitmap.width * scale);
            const h = Math.round(bitmap.height * scale);
            const pad = Math.round(Math.max(w, h) * 0.05) + 8;
            const canvas = document.createElement('canvas');
            canvas.width = w + pad * 2;
            canvas.height = h + pad * 2;
            const ctx = canvas.getContext('2d', {willReadFrequently: true});
            if (!ctx) return null;
            ctx.fillStyle = '#fff';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(bitmap, pad, pad, w, h);
            const code = jsQR(ctx.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height);
            if (code?.data) {
                const bounds = {x: pad, y: pad, width: w, height: h};
                return {data: code.data, corners: cornersOf(code.location), frame: canvas, bounds};
            }
            if (scale === 1) break; // full resolution tried; larger sizes would be the same
        }
        return null;
    } finally {
        bitmap.close();
    }
}

export interface QrSnapshot {
    /** A JPEG data URL. */
    url: string;
    width: number;
    height: number;
    /** The code's corners, mapped into the snapshot. */
    corners: QrCorners;
}

const SNAPSHOT_ASPECT = 16 / 10;
const SNAPSHOT_MAX_WIDTH = 960;

/**
 * Crops a frame at 16:10 around the code read, so a scanner can show which one
 * it was. Only `bounds` is drawn; `backdrop` beyond it.
 */
export function snapshotAround(
    frame: HTMLCanvasElement,
    corners: QrCorners,
    backdrop: string,
    bounds: QrRect = {x: 0, y: 0, width: frame.width, height: frame.height},
): QrSnapshot {
    const xs = corners.map(p => p.x);
    const ys = corners.map(p => p.y);
    const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    // The code with most of its own size again around it, widened to the aspect.
    const cropH = Math.max(maxX - minX, maxY - minY) * 1.9;
    const cropW = cropH * SNAPSHOT_ASPECT;
    // Slide the crop back inside the image where it fits, so less of it is backdrop.
    const fit = (start: number, size: number, lo: number, span: number) =>
        size >= span ? lo + (span - size) / 2 : Math.min(Math.max(start, lo), lo + span - size);
    const x = fit((minX + maxX - cropW) / 2, cropW, bounds.x, bounds.width);
    const y = fit((minY + maxY - cropH) / 2, cropH, bounds.y, bounds.height);

    const scale = Math.min(1, SNAPSHOT_MAX_WIDTH / cropW);
    const out = document.createElement('canvas');
    out.width = Math.round(cropW * scale);
    out.height = Math.round(cropH * scale);
    const ctx = out.getContext('2d')!;
    ctx.fillStyle = backdrop;
    ctx.fillRect(0, 0, out.width, out.height);
    ctx.imageSmoothingQuality = 'high';
    // Draw only where the crop overlaps the image.
    const sx = Math.max(x, bounds.x);
    const sy = Math.max(y, bounds.y);
    const sw = Math.min(x + cropW, bounds.x + bounds.width) - sx;
    const sh = Math.min(y + cropH, bounds.y + bounds.height) - sy;
    if (sw > 0 && sh > 0) {
        ctx.drawImage(frame, sx, sy, sw, sh, (sx - x) * scale, (sy - y) * scale, sw * scale, sh * scale);
    }
    return {
        url: out.toDataURL('image/jpeg', 0.85),
        width: out.width,
        height: out.height,
        corners: corners.map(p => ({x: (p.x - x) * scale, y: (p.y - y) * scale})) as QrCorners,
    };
}
