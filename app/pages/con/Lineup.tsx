import type { ChangeEvent, PointerEvent } from 'react';
import { useEffect, useId, useRef, useState } from 'react';
import { FiDownload, FiPlus, FiRotateCcw, FiRotateCw, FiUpload, FiX } from 'react-icons/fi';
import { QRCodeCanvas } from 'qrcode.react';
import { SectionHeader } from '~/pages/con/SectionHeader';
import { useT } from '~/pages/con/i18n';

const CANVAS_WIDTH = 1080;
const CANVAS_HEIGHT = 1350;
const CANVAS_BACKGROUND = '#faf3f6';
const TEXT_COLOR = '#ff1678';
// The photo opening in foreground-overlay.png, measured in source-image pixels.
const PHOTO_WINDOW = {left: 460, top: 615, right: 1724, bottom: 2287, sourceWidth: 2166, sourceHeight: 2707};
const MAX_FILE_BYTES = 20 * 1024 * 1024;
const MAX_FONT_BYTES = 30 * 1024 * 1024;
const MAX_IMAGE_PIXELS = 40_000_000;
const MIN_ZOOM = 0.35;
const MAX_ZOOM = 3;
const QR_ACCENT = '#c20e59';
const SHARE_QR_MARGIN = 48;
const SHARE_QR_SIZE = 120;
const SHARE_QR = {
    left: SHARE_QR_MARGIN,
    top: CANVAS_HEIGHT - SHARE_QR_MARGIN - SHARE_QR_SIZE,
    size: SHARE_QR_SIZE,
};
const EXTRA_TEXT_FONT = 'Caveat Brush';
const EXTRA_TEXT_SIZE = 42;

type PhotoTransform = {zoom: number; rotation: number; offsetX: number; offsetY: number};
const DEFAULT_TRANSFORM: PhotoTransform = {zoom: 1, rotation: 0, offsetX: 0, offsetY: 0};
type PointerPoint = {x: number; y: number};
type GestureStart =
    | {kind: 'pan'; pointerId: number; x: number; y: number; transform: PhotoTransform}
    | {kind: 'pinch'; distance: number; angle: number; midpointX: number; midpointY: number; transform: PhotoTransform};

type CardTitlePreset = 'cosplay' | 'vendor' | 'performer' | 'panel' | 'custom';

const CARD_TITLE_PRESETS: Record<Exclude<CardTitlePreset, 'custom'>, string> = {
    cosplay: 'Cosplay Lineup',
    vendor: 'Artist Alley',
    performer: 'Performers',
    panel: 'Panel',
};

type TitleFont = {family: string; size: number};
type UploadedFont = TitleFont & {name: string; face: FontFace};

// The longest preset title, and how wide every font draws it.
const TITLE_SAMPLE = CARD_TITLE_PRESETS.cosplay;
const TITLE_SAMPLE_WIDTH = 690;
// Open-licensed (SIL OFL or Apache) Google Fonts only: visitors type their own
// titles here, which commercial webfont licenses forbid. Each size draws
// TITLE_SAMPLE at TITLE_SAMPLE_WIDTH; longer titles still shrink to fit.
const TITLE_FONTS: TitleFont[] = [
    {family: 'Caveat Brush', size: 132},
    {family: 'Water Brush', size: 132},
    {family: 'Comforter Brush', size: 150},
    {family: 'Kaushan Script', size: 116},
    {family: 'Marck Script', size: 114},
    {family: 'Yellowtail', size: 128},
    {family: 'Caveat', size: 143},
];
// None of the title fonts has Chinese glyphs, so Chinese titles fall through to this brush face.
const TITLE_CJK_FONT = 'Ma Shan Zheng';
const TITLE_FONT_STYLESHEET = 'https://fonts.googleapis.com/css2?'
    + [...TITLE_FONTS.map(font => font.family), TITLE_CJK_FONT].map(family => `family=${family.replaceAll(' ', '+')}&`).join('')
    + 'display=swap';

const titleFontStack = (family: string) => `"${family}", "${TITLE_CJK_FONT}", sans-serif`;

let titleFontStylesheet: Promise<void> | undefined;
// Added when the share card first mounts, so the rest of the site never fetches it.
const loadTitleFontStylesheet = () => titleFontStylesheet ??= new Promise(resolve => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = TITLE_FONT_STYLESHEET;
    // A failed request still settles, so the title falls back to sans-serif instead of never drawing.
    link.onload = () => resolve();
    link.onerror = () => resolve();
    document.head.append(link);
});

// Uploaded fonts can't be measured ahead of time, so they're sized here the way the presets were.
const measureTitleSize = (family: string) => {
    const context = document.createElement('canvas').getContext('2d');
    if (!context) return TITLE_FONTS[0].size;
    context.font = `100px ${titleFontStack(family)}`;
    const width = context.measureText(TITLE_SAMPLE).width;
    return width > 0 ? Math.min(260, Math.max(52, Math.round(100 * TITLE_SAMPLE_WIDTH / width))) : TITLE_FONTS[0].size;
};

const drawCenteredText = (
    context: CanvasRenderingContext2D,
    text: string,
    centerY: number,
    maxWidth: number,
    preferredSize: number,
    minimumSize: number,
    maxHeight: number,
    fontFamily: string,
) => {
    const content = text.trim();
    if (!content) return;

    const setCanvasFont = (fontSize: number) => {
        context.font = `${fontSize}px ${fontFamily}`;
    };
    let size = preferredSize;
    context.textAlign = 'center';
    context.textBaseline = 'alphabetic';
    context.fillStyle = TEXT_COLOR;
    setCanvasFont(size);
    let metrics = context.measureText(content);
    while (size > minimumSize && (
        metrics.width > maxWidth
        || metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent > maxHeight
    )) {
        size -= 2;
        setCanvasFont(size);
        metrics = context.measureText(content);
    }
    const baseline = centerY + (metrics.actualBoundingBoxAscent - metrics.actualBoundingBoxDescent) / 2;
    context.fillText(content, CANVAS_WIDTH / 2, baseline, maxWidth);
};

const normalizeAngle = (angle: number) => ((angle + 180) % 360 + 360) % 360 - 180;

const clampZoom = (zoom: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));

// The artwork is almost exactly 4:5: fit it whole and centred, without distorting it.
const fitOverlay = (sourceWidth: number, sourceHeight: number) => {
    const scale = Math.min(CANVAS_WIDTH / sourceWidth, CANVAS_HEIGHT / sourceHeight);
    const width = sourceWidth * scale;
    const height = sourceHeight * scale;
    return {left: (CANVAS_WIDTH - width) / 2, top: (CANVAS_HEIGHT - height) / 2, width, height};
};

const measurePinch = (first: PointerPoint, second: PointerPoint) => {
    const dx = second.x - first.x;
    const dy = second.y - first.y;
    return {
        distance: Math.max(1, Math.hypot(dx, dy)),
        angle: Math.atan2(dy, dx) * 180 / Math.PI,
        midpointX: (first.x + second.x) / 2,
        midpointY: (first.y + second.y) / 2,
    };
};

export const Lineup = () => {
    const t = useT();
    const qrHeading = t({en: 'MAKE YOUR OWN', zh: '制作你的分享卡'});
    const qrPrompt = t({en: 'Scan to start', zh: '扫码开始制作'});
    const inputId = useId();
    const fontInputId = `${inputId}-font-file`;
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const qrCanvasRef = useRef<HTMLCanvasElement>(null);
    const photoLoadToken = useRef(0);
    const fontUploadToken = useRef(0);
    const activePointers = useRef(new Map<number, PointerPoint>());
    const gestureStart = useRef<GestureStart | null>(null);
    // Mirrors `transform` for gesture handlers, which can run before a re-render.
    const transformRef = useRef<PhotoTransform>(DEFAULT_TRANSFORM);
    const [photo, setPhoto] = useState<ImageBitmap | null>(null);
    const [overlay, setOverlay] = useState<HTMLImageElement | null>(null);
    const [overlayLoading, setOverlayLoading] = useState(true);
    const [overlayError, setOverlayError] = useState(false);
    const [titleFont, setTitleFont] = useState<TitleFont>(TITLE_FONTS[0]);
    const [uploadedFont, setUploadedFont] = useState<UploadedFont | null>(null);
    const [fontOpening, setFontOpening] = useState(false);
    const [fontError, setFontError] = useState('');
    const [readyFamily, setReadyFamily] = useState<string | null>(null);
    const [fontLoads, setFontLoads] = useState(0);
    const [titlePreset, setTitlePreset] = useState<CardTitlePreset>('cosplay');
    const [customTitle, setCustomTitle] = useState('');
    const [extraTextEnabled, setExtraTextEnabled] = useState(false);
    const [extraText, setExtraText] = useState('');
    const [transform, setTransform] = useState<PhotoTransform>(DEFAULT_TRANSFORM);
    const [fineTuneOpen, setFineTuneOpen] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [shareUrl, setShareUrl] = useState('');

    useEffect(() => {
        // Keep the QR pointed at this deployment (localhost, preview, or live)
        // while always opening directly at the share-card editor.
        setShareUrl(`${window.location.origin}${window.location.pathname}#lineup`);
    }, []);

    useEffect(() => () => photo?.close(), [photo]);

    useEffect(() => {
        let cancelled = false;
        const image = new Image();
        image.onload = () => {
            if (cancelled) return;
            setOverlay(image);
            setOverlayLoading(false);
        };
        image.onerror = () => {
            if (cancelled) return;
            setOverlayError(true);
            setOverlayLoading(false);
        };
        image.src = '/foreground-overlay.png';

        return () => {
            cancelled = true;
            image.onload = null;
            image.onerror = null;
        };
    }, []);

    const title = titlePreset === 'custom' ? customTitle : CARD_TITLE_PRESETS[titlePreset];

    useEffect(() => {
        let cancelled = false;
        // Loading against the title also fetches the CJK font's glyph slices for a
        // Chinese title. The canvas can't repaint itself when they arrive, so every
        // finished load bumps a counter that redraws the card.
        void loadTitleFontStylesheet()
            .then(() => Promise.all([
                document.fonts.load(`${titleFont.size}px ${titleFontStack(titleFont.family)}`, title.trim() || 'A'),
                ...(extraTextEnabled
                    ? [document.fonts.load(`${EXTRA_TEXT_SIZE}px ${titleFontStack(EXTRA_TEXT_FONT)}`, extraText.trim() || 'A')]
                    : []),
            ]))
            .catch(() => [])
            .then(() => {
                if (cancelled) return;
                setReadyFamily(titleFont.family);
                setFontLoads(count => count + 1);
            });
        return () => {
            cancelled = true;
        };
    }, [titleFont, title, extraTextEnabled, extraText]);

    useEffect(() => () => {
        if (uploadedFont) document.fonts.delete(uploadedFont.face);
    }, [uploadedFont]);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const context = canvas.getContext('2d');
        if (!context) return;

        context.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
        // Export an opaque card so transparent pixels in PNG photos or AI cutouts
        // cannot show up as black in dark-mode image viewers or social apps.
        context.fillStyle = CANVAS_BACKGROUND;
        context.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

        // The overlay's place on the card. Until it loads, its measured size stands in.
        const frame = fitOverlay(
            overlay?.naturalWidth ?? PHOTO_WINDOW.sourceWidth,
            overlay?.naturalHeight ?? PHOTO_WINDOW.sourceHeight,
        );

        if (photo) {
            // Fit the whole photo into the frame's transparent opening by default.
            const windowWidth = (PHOTO_WINDOW.right - PHOTO_WINDOW.left) / PHOTO_WINDOW.sourceWidth * frame.width;
            const windowHeight = (PHOTO_WINDOW.bottom - PHOTO_WINDOW.top) / PHOTO_WINDOW.sourceHeight * frame.height;
            const windowCenterX = frame.left + (PHOTO_WINDOW.left + PHOTO_WINDOW.right) / 2 / PHOTO_WINDOW.sourceWidth * frame.width;
            const windowCenterY = frame.top + (PHOTO_WINDOW.top + PHOTO_WINDOW.bottom) / 2 / PHOTO_WINDOW.sourceHeight * frame.height;
            const fitScale = Math.min(windowWidth / photo.width, windowHeight / photo.height);
            const scale = fitScale * transform.zoom;
            context.save();
            context.translate(windowCenterX + transform.offsetX, windowCenterY + transform.offsetY);
            context.rotate(transform.rotation * Math.PI / 180);
            context.drawImage(photo, -photo.width * scale / 2, -photo.height * scale / 2,
                photo.width * scale, photo.height * scale);
            context.restore();
        }

        if (overlay) context.drawImage(overlay, frame.left, frame.top, frame.width, frame.height);

        if (readyFamily === titleFont.family) {
            // 760 wide keeps a long title clear of the artwork's top-left corner bracket (x 63–134).
            drawCenteredText(context, title, 160, 760, titleFont.size, 52, 210, titleFontStack(titleFont.family));
            if (extraTextEnabled) {
                drawCenteredText(
                    context,
                    extraText,
                    280,
                    850,
                    EXTRA_TEXT_SIZE,
                    24,
                    58,
                    titleFontStack(EXTRA_TEXT_FONT),
                );
            }
        }

        const qrCanvas = qrCanvasRef.current;
        if (shareUrl && qrCanvas) {
            // Let the quiet zone show the artwork through, keeping the QR integrated
            // with the pale lower edge instead of adding another block to the card.
            context.drawImage(qrCanvas, SHARE_QR.left, SHARE_QR.top, SHARE_QR.size, SHARE_QR.size);

            context.textAlign = 'left';
            context.textBaseline = 'middle';
            context.fillStyle = QR_ACCENT;
            context.font = '700 26px sans-serif';
            context.fillText(qrHeading, SHARE_QR.left + SHARE_QR.size + 16, SHARE_QR.top + 48, 370);
            context.font = '500 18px sans-serif';
            context.fillText(qrPrompt, SHARE_QR.left + SHARE_QR.size + 16, SHARE_QR.top + 76, 370);
        }
    }, [photo, overlay, transform, titleFont, readyFamily, fontLoads, title, extraTextEnabled, extraText, shareUrl, qrHeading, qrPrompt]);

    const onFontSelected = async (event: ChangeEvent<HTMLInputElement>) => {
        const file = event.currentTarget.files?.[0];
        // Clearing the input lets someone choose the same file again.
        event.currentTarget.value = '';
        if (!file) return;

        const token = ++fontUploadToken.current;
        setFontError('');
        if (file.size > MAX_FONT_BYTES) {
            setFontOpening(false);
            setFontError(t({en: 'That font file is larger than 30 MB.', zh: '字体文件超过 30 MB。'}));
            return;
        }

        setFontOpening(true);
        // Read into memory so the file never leaves this device. An ArrayBuffer
        // source also needs no blob: URL, which our CSP's font-src doesn't allow.
        const family = `Uploaded Font ${token}`;
        let face: FontFace;
        try {
            face = await new FontFace(family, await file.arrayBuffer()).load();
        } catch {
            if (token !== fontUploadToken.current) return;
            setFontOpening(false);
            setFontError(t({
                en: "That file isn't a font this browser can read. Try a TTF, OTF, WOFF, or WOFF2 file.",
                zh: '无法读取这个字体文件，请换成 TTF、OTF、WOFF 或 WOFF2 格式。',
            }));
            return;
        }
        if (token !== fontUploadToken.current) return;

        document.fonts.add(face);
        const font = {family, size: measureTitleSize(family), name: file.name.replace(/\.[^.]+$/, ''), face};
        setFontOpening(false);
        setUploadedFont(font);
        setTitleFont(font);
    };

    const onPhotoSelected = async (event: ChangeEvent<HTMLInputElement>) => {
        const file = event.currentTarget.files?.[0];
        // Clearing the input lets someone choose the same file again.
        event.currentTarget.value = '';
        if (!file) return;

        const token = ++photoLoadToken.current;
        setError('');
        if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
            setLoading(false);
            setError(t({
                en: 'Choose a JPG, PNG, or WebP image.',
                zh: '请选择 JPG、PNG 或 WebP 图片。',
            }));
            return;
        }
        if (file.size > MAX_FILE_BYTES) {
            setLoading(false);
            setError(t({
                en: 'This image is over 20 MB. Choose a smaller file.',
                zh: '图片超过 20 MB，请选择较小的文件。',
            }));
            return;
        }

        setLoading(true);
        try {
            const bitmap = await createImageBitmap(file);
            if (token !== photoLoadToken.current) {
                bitmap.close();
                return;
            }
            if (bitmap.width * bitmap.height > MAX_IMAGE_PIXELS) {
                bitmap.close();
                setError(t({
                    en: 'This image has too many pixels to edit safely. Choose a smaller image.',
                    zh: '图片分辨率过高，无法安全编辑，请选择分辨率较小的图片。',
                }));
                return;
            }

            setPhoto(bitmap);
            applyTransform(DEFAULT_TRANSFORM);
        } catch {
            setError(t({
                en: 'This image could not be opened. Try a JPG, PNG, or WebP file.',
                zh: '无法打开这张图片，请尝试 JPG、PNG 或 WebP 文件。',
            }));
        } finally {
            if (token === photoLoadToken.current) setLoading(false);
        }
    };

    const applyTransform = (next: PhotoTransform) => {
        transformRef.current = next;
        setTransform(next);
    };

    const beginGesture = () => {
        const points = [...activePointers.current.entries()].slice(0, 2);
        if (points.length >= 2) {
            const [first, second] = points.map(([, point]) => point);
            gestureStart.current = {kind: 'pinch', ...measurePinch(first, second), transform: transformRef.current};
        } else if (points.length === 1) {
            const [pointerId, point] = points[0];
            gestureStart.current = {kind: 'pan', pointerId, x: point.x, y: point.y, transform: transformRef.current};
        } else {
            gestureStart.current = null;
        }
    };

    const startGesture = (event: PointerEvent<HTMLCanvasElement>) => {
        if (!photo || (event.pointerType === 'mouse' && event.button !== 0)) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        activePointers.current.set(event.pointerId, {x: event.clientX, y: event.clientY});
        beginGesture();
    };

    const moveGesture = (event: PointerEvent<HTMLCanvasElement>) => {
        if (!activePointers.current.has(event.pointerId)) return;
        activePointers.current.set(event.pointerId, {x: event.clientX, y: event.clientY});
        const start = gestureStart.current;
        if (!start) return;

        const bounds = event.currentTarget.getBoundingClientRect();
        if (start.kind === 'pan') {
            const point = activePointers.current.get(start.pointerId);
            if (!point) return;
            applyTransform({
                ...start.transform,
                offsetX: start.transform.offsetX + (point.x - start.x) * CANVAS_WIDTH / bounds.width,
                offsetY: start.transform.offsetY + (point.y - start.y) * CANVAS_HEIGHT / bounds.height,
            });
            return;
        }

        const points = [...activePointers.current.values()].slice(0, 2);
        if (points.length < 2) return;
        const {distance, angle, midpointX, midpointY} = measurePinch(points[0], points[1]);
        applyTransform({
            zoom: clampZoom(start.transform.zoom * distance / start.distance),
            rotation: normalizeAngle(start.transform.rotation + normalizeAngle(angle - start.angle)),
            offsetX: start.transform.offsetX + (midpointX - start.midpointX) * CANVAS_WIDTH / bounds.width,
            offsetY: start.transform.offsetY + (midpointY - start.midpointY) * CANVAS_HEIGHT / bounds.height,
        });
    };

    const endGesture = (event: PointerEvent<HTMLCanvasElement>) => {
        if (!activePointers.current.has(event.pointerId)) return;
        activePointers.current.delete(event.pointerId);
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId);
        }
        beginGesture();
    };

    const resetPhoto = () => {
        applyTransform(DEFAULT_TRANSFORM);
    };

    const downloadPng = () => {
        const canvas = canvasRef.current;
        if (!canvas || !photo) return;

        canvas.toBlob(blob => {
            if (!blob) {
                setError(t({
                    en: 'The image could not be exported. Please try again.',
                    zh: '导出失败，请重试。',
                }));
                return;
            }
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = 'sekai-beyond-share-card.png';
            link.click();
            window.setTimeout(() => URL.revokeObjectURL(url), 1000);
        }, 'image/png');
    };

    const fontOption = (font: TitleFont, label: string) => (
        <label key={font.family} className="sbc-lineup-font-option">
            <input
                className="sbc-sr-only"
                type="radio"
                name={`${inputId}-font`}
                value={font.family}
                checked={titleFont.family === font.family}
                onChange={() => setTitleFont(font)}
            />
            {/* Scaled like the card title, so every option reads at about the same width. */}
            <span style={{fontFamily: titleFontStack(font.family), fontSize: `${font.size / 100}rem`}}>{label}</span>
        </label>
    );

    return (
        <section id="lineup" className="sbc-section sbc-lineup-section">
            <SectionHeader
                title={{en: 'Share Card', zh: '活动分享卡'}}
                subtitle={{
                    en: 'Make a card for cosplay, vendors, performers, panels, or anything you want to share.',
                    zh: '为 Cosplay、摊主、表演者、Panel 或任何想分享的内容制作卡片。',
                }}
            />

            <div className="sbc-lineup-editor">
                <div className="sbc-lineup-preview-column">
                    <div className="sbc-lineup-preview" aria-label={t({en: 'Image preview', zh: '图片预览'})}>
                        <canvas
                            ref={canvasRef}
                            className={`sbc-lineup-canvas${photo ? ' sbc-lineup-canvas--draggable' : ''}`}
                            width={CANVAS_WIDTH}
                            height={CANVAS_HEIGHT}
                            aria-label={t({en: '4 by 5 share card canvas', zh: '4:5 分享卡片画布'})}
                            onPointerDown={startGesture}
                            onPointerMove={moveGesture}
                            onPointerUp={endGesture}
                            onPointerCancel={endGesture}
                        />
                        {!photo && (
                            <div className="sbc-lineup-empty" aria-hidden="true">
                                <span className="sbc-lineup-empty-mark">✦</span>
                                <span>{t({en: 'Your photo will appear here', zh: '上传后，照片会显示在这里'})}</span>
                                <small>4:5 · 1080 × 1350</small>
                            </div>
                        )}
                    </div>
                    {/* Always rendered so the preview doesn't shrink when a photo arrives; hidden until then. */}
                    <p className={`sbc-lineup-hint${photo ? '' : ' sbc-lineup-hint--idle'}`}>
                        {t({
                            en: 'Drag to move. On touch screens, use two fingers to move, zoom, and rotate.',
                            zh: '拖动即可移动；手机上可用双指移动、缩放和旋转。',
                        })}
                    </p>
                </div>

                <div className="sbc-lineup-controls">
                    <div className="sbc-lineup-upload-card">
                        <div className="sbc-lineup-upload-copy">
                            <strong>{t({
                                en: photo ? 'Photo ready to edit' : 'Start with a photo',
                                zh: photo ? '照片已就绪' : '从一张照片开始'
                            })}</strong>
                            <span>{t({
                                en: 'JPG, PNG, or WebP · up to 20 MB',
                                zh: 'JPG、PNG 或 WebP · 最大 20 MB'
                            })}</span>
                        </div>
                        <div className="sbc-lineup-file-actions">
                            <label className="btn sbc-lineup-upload-button" htmlFor={inputId}>
                                <FiUpload aria-hidden="true"/>
                                {t({en: photo ? 'Change photo' : 'Choose photo', zh: photo ? '更换照片' : '选择照片'})}
                            </label>
                            <button type="button" className="btn btn-primary sbc-lineup-download"
                                    disabled={!photo || loading || overlayLoading || overlayError || readyFamily !== titleFont.family}
                                    onClick={downloadPng}>
                                <FiDownload aria-hidden="true"/>
                                {t({en: 'Save PNG', zh: '保存 PNG'})}
                            </button>
                        </div>
                        <input
                            id={inputId}
                            className="sbc-lineup-file-input"
                            type="file"
                            accept="image/jpeg,image/png,image/webp"
                            onChange={onPhotoSelected}
                        />
                    </div>

                    {loading && <p className="sbc-lineup-status" role="status">{t({
                        en: 'Opening photo…',
                        zh: '正在读取照片…'
                    })}</p>}
                    {overlayLoading && (
                        <p className="sbc-lineup-status" role="status">
                            {t({en: 'Loading the share card design…', zh: '正在加载分享卡片设计…'})}
                        </p>
                    )}
                    {overlayError && (
                        <p className="sbc-lineup-error" role="alert">
                            {t({
                                en: 'The share card design could not be loaded. Refresh the page to try again.',
                                zh: '无法加载分享卡片设计，请刷新页面重试。'
                            })}
                        </p>
                    )}
                    {error && <p className="sbc-lineup-error" role="alert">{error}</p>}

                    <div className="sbc-lineup-text-options">
                        <label className="sbc-lineup-control">
                            <span className="sbc-lineup-control-heading">
                                <span>{t({en: 'Card title', zh: '卡片标题'})}</span>
                            </span>
                            <select
                                className="sbc-lineup-select"
                                value={titlePreset}
                                aria-label={t({en: 'Card title', zh: '卡片标题'})}
                                onChange={event => setTitlePreset(event.currentTarget.value as CardTitlePreset)}
                            >
                                <option value="cosplay">{t({en: 'Cosplay Lineup', zh: 'Cosplay 阵容'})}</option>
                                <option value="vendor">{t({
                                    en: 'Vendor / Artist Alley',
                                    zh: '摊主 / 创作者市集'
                                })}</option>
                                <option value="performer">{t({en: 'Performer', zh: '表演者'})}</option>
                                <option value="panel">{t({en: 'Panel', zh: 'Panel 专题'})}</option>
                                <option value="custom">{t({en: 'Custom title…', zh: '自定义标题…'})}</option>
                            </select>
                        </label>

                        {titlePreset === 'custom' && (
                            <label className="sbc-lineup-control">
                                <span className="sbc-lineup-control-heading">{t({
                                    en: 'Your title',
                                    zh: '自定义标题'
                                })}</span>
                                <input
                                    className="sbc-lineup-text-input"
                                    type="text"
                                    maxLength={36}
                                    value={customTitle}
                                    placeholder={t({en: 'Type a title', zh: '输入标题'})}
                                    onChange={event => setCustomTitle(event.currentTarget.value)}
                                />
                            </label>
                        )}

                        <fieldset className="sbc-lineup-font-picker">
                            <legend className="sbc-lineup-control-heading">{t({
                                en: 'Title font',
                                zh: '标题字体'
                            })}</legend>
                            <div className="sbc-lineup-font-options">
                                {TITLE_FONTS.map(font => fontOption(font, font.family))}
                                {/* An added font takes the upload tile's place, keeping the grid at two rows. */}
                                {uploadedFont ? fontOption(uploadedFont, uploadedFont.name) : (
                                    <label
                                        className="sbc-lineup-font-option sbc-lineup-font-upload sbc-lineup-font-file-trigger"
                                        htmlFor={fontInputId}>
                                        <FiPlus aria-hidden="true"/>
                                        {t({en: 'Your own font', zh: '自己的字体'})}
                                    </label>
                                )}
                            </div>
                            <input
                                id={fontInputId}
                                className="sbc-sr-only sbc-lineup-font-file"
                                type="file"
                                accept=".ttf,.otf,.woff,.woff2"
                                onChange={onFontSelected}
                            />
                            {fontOpening && <p className="sbc-lineup-status" role="status">{t({
                                en: 'Opening font…',
                                zh: '正在读取字体…'
                            })}</p>}
                            {fontError && <p className="sbc-lineup-error" role="alert">{fontError}</p>}
                            <p className="sbc-lineup-font-note">
                                {t({
                                    en: 'Your own font can be a TTF, OTF, WOFF, or WOFF2 file. It stays on your device.',
                                    zh: '自己的字体支持 TTF、OTF、WOFF 或 WOFF2 文件，文件只留在你的设备上。',
                                })}
                                {uploadedFont && (
                                    <>
                                        {' '}
                                        <label className="sbc-lineup-font-change sbc-lineup-font-file-trigger"
                                               htmlFor={fontInputId}>
                                            {t({en: 'Choose another file', zh: '换一个文件'})}
                                        </label>
                                    </>
                                )}
                            </p>
                        </fieldset>

                        <div className="sbc-lineup-extra-text">
                            <button
                                type="button"
                                className="sbc-lineup-add-text-button"
                                aria-expanded={extraTextEnabled}
                                onClick={() => setExtraTextEnabled(enabled => !enabled)}
                            >
                                {extraTextEnabled ? <FiX aria-hidden="true"/> : <FiPlus aria-hidden="true"/>}
                                {t({
                                    en: extraTextEnabled ? 'Remove extra text' : 'Add text',
                                    zh: extraTextEnabled ? '移除补充文字' : '添加文字'
                                })}
                            </button>
                            {extraTextEnabled && (
                                <label className="sbc-lineup-control">
                                    <span className="sbc-lineup-control-heading">{t({
                                        en: 'Extra text',
                                        zh: '补充文字'
                                    })}</span>
                                    <input
                                        className="sbc-lineup-text-input"
                                        type="text"
                                        maxLength={36}
                                        value={extraText}
                                        placeholder={t({en: 'e.g. Booth B12', zh: '例如：摊位 B12'})}
                                        onChange={event => setExtraText(event.currentTarget.value)}
                                    />
                                </label>
                            )}
                        </div>
                    </div>

                    {photo && (
                        <button
                            type="button"
                            className="sbc-lineup-fine-tune-toggle"
                            aria-expanded={fineTuneOpen}
                            onClick={() => setFineTuneOpen(open => !open)}
                        >
                            {t({
                                en: fineTuneOpen ? 'Hide fine-tune sliders' : 'Fine-tune sliders',
                                zh: fineTuneOpen ? '收起精细调整' : '精细调整滑杆'
                            })}
                        </button>
                    )}

                    <div
                        className={`sbc-lineup-adjustments${photo ? '' : ' sbc-lineup-adjustments--disabled'}${fineTuneOpen ? ' sbc-lineup-adjustments--open' : ''}`}>
                        <div className="sbc-lineup-adjustment-grid">
                            <label className="sbc-lineup-control">
                                <span className="sbc-lineup-control-heading">
                                    <span>{t({en: 'Size', zh: '大小'})}</span>
                                    <output>{Math.round(transform.zoom * 100)}%</output>
                                </span>
                                <input
                                    type="range"
                                    min={MIN_ZOOM}
                                    max={MAX_ZOOM}
                                    step="0.01"
                                    value={transform.zoom}
                                    disabled={!photo}
                                    aria-label={t({en: 'Photo size', zh: '照片大小'})}
                                    onChange={event => applyTransform({
                                        ...transformRef.current,
                                        zoom: Number(event.currentTarget.value)
                                    })}
                                />
                            </label>

                            <label className="sbc-lineup-control">
                                <span className="sbc-lineup-control-heading">
                                    <span>{t({en: 'Rotation', zh: '旋转'})}</span>
                                    <output>{transform.rotation}°</output>
                                </span>
                                <input
                                    type="range"
                                    min="-180"
                                    max="180"
                                    step="1"
                                    value={transform.rotation}
                                    disabled={!photo}
                                    aria-label={t({en: 'Photo rotation', zh: '照片旋转角度'})}
                                    onChange={event => applyTransform({
                                        ...transformRef.current,
                                        rotation: Number(event.currentTarget.value)
                                    })}
                                />
                            </label>
                        </div>

                        <div className="sbc-lineup-control-actions">
                            <button type="button" className="sbc-lineup-secondary-button" disabled={!photo}
                                    onClick={() => applyTransform({
                                        ...transformRef.current,
                                        rotation: normalizeAngle(transformRef.current.rotation - 90)
                                    })}>
                                <FiRotateCcw aria-hidden="true"/>
                                {t({en: 'Rotate left', zh: '向左旋转'})}
                            </button>
                            <button type="button" className="sbc-lineup-secondary-button" disabled={!photo}
                                    onClick={() => applyTransform({
                                        ...transformRef.current,
                                        rotation: normalizeAngle(transformRef.current.rotation + 90)
                                    })}>
                                <FiRotateCw aria-hidden="true"/>
                                {t({en: 'Rotate right', zh: '向右旋转'})}
                            </button>
                            <button type="button" className="sbc-lineup-reset-button" disabled={!photo}
                                    onClick={resetPhoto}>
                                {t({en: 'Reset', zh: '重置'})}
                            </button>
                        </div>
                    </div>
                    <p className="sbc-lineup-privacy">
                        {t({
                            en: 'Your photo, custom text, and font file are processed only in this page. They are never uploaded or saved by us; refreshing clears them.',
                            zh: '照片、自定义文字和字体文件只在当前页面内处理，不会上传或被我们保存；刷新页面后会清空。',
                        })}
                    </p>
                </div>
            </div>
            <QRCodeCanvas
                ref={qrCanvasRef}
                className="sbc-lineup-qr-source"
                value={shareUrl || ' '}
                size={512}
                level="M"
                marginSize={4}
                fgColor={QR_ACCENT}
                bgColor="rgba(250, 243, 246, 0)"
                aria-hidden="true"
            />
        </section>
    );
};
