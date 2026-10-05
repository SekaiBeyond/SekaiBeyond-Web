import { useEffect, useId, useRef, useState } from 'react';
import type { ChangeEvent, PointerEvent } from 'react';
import { FiDownload, FiPlus, FiRotateCcw, FiRotateCw, FiUpload, FiX } from 'react-icons/fi';
import { SectionHeader } from '~/pages/con/SectionHeader';
import { useT } from '~/pages/con/i18n';

const CANVAS_WIDTH = 1080;
const CANVAS_HEIGHT = 1350;
const CANVAS_BACKGROUND = '#faf3f6';
const CARD_FONT_FAMILY = 'Sekai Salt';
// The photo opening in foreground-overlay.png, measured in source-image pixels.
const PHOTO_WINDOW = {left: 460, top: 615, right: 1724, bottom: 2287, sourceWidth: 2166, sourceHeight: 2707};
const MAX_FILE_BYTES = 20 * 1024 * 1024;
const MAX_IMAGE_PIXELS = 40_000_000;
const MIN_ZOOM = 0.35;
const MAX_ZOOM = 3;

type PhotoTransform = {zoom: number; rotation: number; offsetX: number; offsetY: number};
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

const drawCenteredText = (
    context: CanvasRenderingContext2D,
    text: string,
    centerY: number,
    maxWidth: number,
    preferredSize: number,
    minimumSize: number,
    maxHeight: number,
    fontFamily = CARD_FONT_FAMILY,
) => {
    const content = text.trim();
    if (!content) return;

    const setCanvasFont = (fontSize: number) => {
        context.font = fontFamily === 'sans-serif'
            ? `${fontSize}px sans-serif`
            : `${fontSize}px "${fontFamily}", sans-serif`;
    };
    let size = preferredSize;
    context.textAlign = 'center';
    context.textBaseline = 'alphabetic';
    context.fillStyle = '#ff1678';
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

export const Lineup = () => {
    const t = useT();
    const inputId = useId();
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const loadToken = useRef(0);
    const activePointers = useRef(new Map<number, PointerPoint>());
    const gestureStart = useRef<GestureStart | null>(null);
    const transformRef = useRef<PhotoTransform>({zoom: 1, rotation: 0, offsetX: 0, offsetY: 0});
    const [photo, setPhoto] = useState<ImageBitmap | null>(null);
    const [overlay, setOverlay] = useState<HTMLImageElement | null>(null);
    const [overlayLoading, setOverlayLoading] = useState(true);
    const [overlayError, setOverlayError] = useState(false);
    const [fontReady, setFontReady] = useState(false);
    const [titlePreset, setTitlePreset] = useState<CardTitlePreset>('cosplay');
    const [customTitle, setCustomTitle] = useState('');
    const [extraTextEnabled, setExtraTextEnabled] = useState(false);
    const [extraText, setExtraText] = useState('');
    const [zoom, setZoom] = useState(1);
    const [rotation, setRotation] = useState(0);
    const [offsetX, setOffsetX] = useState(0);
    const [offsetY, setOffsetY] = useState(0);
    const [fineTuneOpen, setFineTuneOpen] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

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

    useEffect(() => {
        let cancelled = false;
        void document.fonts.load(`180px "${CARD_FONT_FAMILY}"`)
            .catch(() => [])
            .then(() => {
                if (!cancelled) setFontReady(true);
            });
        return () => {
            cancelled = true;
        };
    }, []);

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

        if (photo) {
            // Fit the whole photo into the frame's transparent opening by default.
            // Its size and center are derived from the supplied high-res overlay.
            const overlayScale = overlay
                ? Math.min(CANVAS_WIDTH / overlay.naturalWidth, CANVAS_HEIGHT / overlay.naturalHeight)
                : Math.min(CANVAS_WIDTH / PHOTO_WINDOW.sourceWidth, CANVAS_HEIGHT / PHOTO_WINDOW.sourceHeight);
            const overlayWidth = overlay ? overlay.naturalWidth * overlayScale : CANVAS_WIDTH;
            const overlayHeight = overlay ? overlay.naturalHeight * overlayScale : CANVAS_HEIGHT;
            const overlayLeft = (CANVAS_WIDTH - overlayWidth) / 2;
            const overlayTop = (CANVAS_HEIGHT - overlayHeight) / 2;
            const windowWidth = (PHOTO_WINDOW.right - PHOTO_WINDOW.left) / PHOTO_WINDOW.sourceWidth * overlayWidth;
            const windowHeight = (PHOTO_WINDOW.bottom - PHOTO_WINDOW.top) / PHOTO_WINDOW.sourceHeight * overlayHeight;
            const windowCenterX = overlayLeft + (PHOTO_WINDOW.left + PHOTO_WINDOW.right) / 2 / PHOTO_WINDOW.sourceWidth * overlayWidth;
            const windowCenterY = overlayTop + (PHOTO_WINDOW.top + PHOTO_WINDOW.bottom) / 2 / PHOTO_WINDOW.sourceHeight * overlayHeight;
            const fitScale = Math.min(windowWidth / photo.width, windowHeight / photo.height);
            const scale = fitScale * zoom;
            context.save();
            context.translate(windowCenterX + offsetX, windowCenterY + offsetY);
            context.rotate(rotation * Math.PI / 180);
            context.drawImage(photo, -photo.width * scale / 2, -photo.height * scale / 2,
                photo.width * scale, photo.height * scale);
            context.restore();
        }

        if (overlay) {
            // The supplied artwork is high resolution and almost exactly 4:5.
            // Fit it proportionally into the export canvas without distorting it.
            const overlayScale = Math.min(
                CANVAS_WIDTH / overlay.naturalWidth,
                CANVAS_HEIGHT / overlay.naturalHeight,
            );
            const width = overlay.naturalWidth * overlayScale;
            const height = overlay.naturalHeight * overlayScale;
            context.drawImage(overlay, (CANVAS_WIDTH - width) / 2, (CANVAS_HEIGHT - height) / 2, width, height);
        }

        if (fontReady) {
            const title = titlePreset === 'custom' ? customTitle : CARD_TITLE_PRESETS[titlePreset];
            drawCenteredText(context, title, 160, 930, 145, 52, 210);
            if (extraTextEnabled) drawCenteredText(context, extraText, 280, 850, 56, 32, 76, 'sans-serif');
        }
    }, [photo, overlay, zoom, rotation, offsetX, offsetY, fontReady, titlePreset, customTitle, extraTextEnabled, extraText]);

    const onPhotoSelected = async (event: ChangeEvent<HTMLInputElement>) => {
        const file = event.currentTarget.files?.[0];
        // Clearing the input lets someone choose the same file again.
        event.currentTarget.value = '';
        if (!file) return;

        const token = ++loadToken.current;
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
            if (token !== loadToken.current) {
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
            applyTransform({zoom: 1, rotation: 0, offsetX: 0, offsetY: 0});
        } catch {
            setError(t({
                en: 'This image could not be opened. Try a JPG, PNG, or WebP file.',
                zh: '无法打开这张图片，请尝试 JPG、PNG 或 WebP 文件。',
            }));
        } finally {
            if (token === loadToken.current) setLoading(false);
        }
    };

    const applyTransform = (transform: PhotoTransform) => {
        transformRef.current = transform;
        setZoom(transform.zoom);
        setRotation(transform.rotation);
        setOffsetX(transform.offsetX);
        setOffsetY(transform.offsetY);
    };

    const beginGesture = () => {
        const points = [...activePointers.current.entries()].slice(0, 2);
        const transform = transformRef.current;
        if (points.length >= 2) {
            const [first, second] = points.map(([, point]) => point);
            const dx = second.x - first.x;
            const dy = second.y - first.y;
            gestureStart.current = {
                kind: 'pinch',
                distance: Math.max(1, Math.hypot(dx, dy)),
                angle: Math.atan2(dy, dx) * 180 / Math.PI,
                midpointX: (first.x + second.x) / 2,
                midpointY: (first.y + second.y) / 2,
                transform,
            };
        } else if (points.length === 1) {
            const [pointerId, point] = points[0];
            gestureStart.current = {kind: 'pan', pointerId, x: point.x, y: point.y, transform};
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
        const [first, second] = points;
        const dx = second.x - first.x;
        const dy = second.y - first.y;
        const distance = Math.max(1, Math.hypot(dx, dy));
        const angle = Math.atan2(dy, dx) * 180 / Math.PI;
        const midpointX = (first.x + second.x) / 2;
        const midpointY = (first.y + second.y) / 2;
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
        applyTransform({zoom: 1, rotation: 0, offsetX: 0, offsetY: 0});
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
                    {photo && (
                        <p className="sbc-lineup-hint">
                            {t({
                                en: 'Drag to move. On touch screens, use two fingers to move, zoom, and rotate.',
                                zh: '拖动即可移动；手机上可用双指移动、缩放和旋转。',
                            })}
                        </p>
                    )}
                </div>

                <div className="sbc-lineup-controls">
                    <div className="sbc-lineup-upload-card">
                        <div className="sbc-lineup-upload-copy">
                            <strong>{t({en: photo ? 'Photo ready to edit' : 'Start with a photo', zh: photo ? '照片已就绪' : '从一张照片开始'})}</strong>
                            <span>{t({en: 'JPG, PNG, or WebP · up to 20 MB', zh: 'JPG、PNG 或 WebP · 最大 20 MB'})}</span>
                        </div>
                        <div className="sbc-lineup-file-actions">
                            <label className="btn sbc-lineup-upload-button" htmlFor={inputId}>
                                <FiUpload aria-hidden="true"/>
                                {t({en: photo ? 'Change photo' : 'Choose photo', zh: photo ? '更换照片' : '选择照片'})}
                            </label>
                            <button type="button" className="btn btn-primary sbc-lineup-download"
                                    disabled={!photo || loading || overlayLoading || overlayError}
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

                    {loading && <p className="sbc-lineup-status" role="status">{t({en: 'Opening photo…', zh: '正在读取照片…'})}</p>}
                    {overlayLoading && (
                        <p className="sbc-lineup-status" role="status">
                            {t({en: 'Loading the share card design…', zh: '正在加载分享卡片设计…'})}
                        </p>
                    )}
                    {overlayError && (
                        <p className="sbc-lineup-error" role="alert">
                            {t({en: 'The share card design could not be loaded. Refresh the page to try again.', zh: '无法加载分享卡片设计，请刷新页面重试。'})}
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
                                <option value="vendor">{t({en: 'Vendor / Artist Alley', zh: '摊主 / 创作者市集'})}</option>
                                <option value="performer">{t({en: 'Performer', zh: '表演者'})}</option>
                                <option value="panel">{t({en: 'Panel', zh: 'Panel 专题'})}</option>
                                <option value="custom">{t({en: 'Custom title…', zh: '自定义标题…'})}</option>
                            </select>
                        </label>

                        {titlePreset === 'custom' && (
                            <label className="sbc-lineup-control">
                                <span className="sbc-lineup-control-heading">{t({en: 'Your title', zh: '自定义标题'})}</span>
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

                        <div className="sbc-lineup-extra-text">
                            <button
                                type="button"
                                className="sbc-lineup-add-text-button"
                                aria-expanded={extraTextEnabled}
                                onClick={() => setExtraTextEnabled(enabled => !enabled)}
                            >
                                {extraTextEnabled ? <FiX aria-hidden="true"/> : <FiPlus aria-hidden="true"/>}
                                {t({en: extraTextEnabled ? 'Remove extra text' : 'Add text', zh: extraTextEnabled ? '移除补充文字' : '添加文字'})}
                            </button>
                            {extraTextEnabled && (
                                <label className="sbc-lineup-control">
                                    <span className="sbc-lineup-control-heading">{t({en: 'Extra text', zh: '补充文字'})}</span>
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
                            {t({en: fineTuneOpen ? 'Hide fine-tune sliders' : 'Fine-tune sliders', zh: fineTuneOpen ? '收起精细调整' : '精细调整滑杆'})}
                        </button>
                    )}

                    <div className={`sbc-lineup-adjustments${photo ? '' : ' sbc-lineup-adjustments--disabled'}${fineTuneOpen ? ' sbc-lineup-adjustments--open' : ''}`}>
                        <div className="sbc-lineup-adjustment-grid">
                            <label className="sbc-lineup-control">
                                <span className="sbc-lineup-control-heading">
                                    <span>{t({en: 'Size', zh: '大小'})}</span>
                                    <output>{Math.round(zoom * 100)}%</output>
                                </span>
                                <input
                                    type="range"
                                    min={MIN_ZOOM}
                                    max={MAX_ZOOM}
                                    step="0.01"
                                    value={zoom}
                                    disabled={!photo}
                                    aria-label={t({en: 'Photo size', zh: '照片大小'})}
                                    onChange={event => applyTransform({...transformRef.current, zoom: Number(event.currentTarget.value)})}
                                />
                            </label>

                            <label className="sbc-lineup-control">
                                <span className="sbc-lineup-control-heading">
                                    <span>{t({en: 'Rotation', zh: '旋转'})}</span>
                                    <output>{rotation}°</output>
                                </span>
                                <input
                                    type="range"
                                    min="-180"
                                    max="180"
                                    step="1"
                                    value={rotation}
                                    disabled={!photo}
                                    aria-label={t({en: 'Photo rotation', zh: '照片旋转角度'})}
                                    onChange={event => applyTransform({...transformRef.current, rotation: Number(event.currentTarget.value)})}
                                />
                            </label>
                        </div>

                        <div className="sbc-lineup-control-actions">
                            <button type="button" className="sbc-lineup-secondary-button" disabled={!photo}
                                    onClick={() => applyTransform({...transformRef.current, rotation: normalizeAngle(transformRef.current.rotation - 90)})}>
                                <FiRotateCcw aria-hidden="true"/>
                                {t({en: 'Rotate left', zh: '向左旋转'})}
                            </button>
                            <button type="button" className="sbc-lineup-secondary-button" disabled={!photo}
                                    onClick={() => applyTransform({...transformRef.current, rotation: normalizeAngle(transformRef.current.rotation + 90)})}>
                                <FiRotateCw aria-hidden="true"/>
                                {t({en: 'Rotate right', zh: '向右旋转'})}
                            </button>
                            <button type="button" className="sbc-lineup-reset-button" disabled={!photo} onClick={resetPhoto}>
                                {t({en: 'Reset', zh: '重置'})}
                            </button>
                        </div>
                    </div>
                    <p className="sbc-lineup-privacy">
                        {t({
                            en: 'Your photo and custom text are processed only in this page. They are never uploaded or saved by us; refreshing clears them.',
                            zh: '照片和自定义文字只在当前页面内处理，不会上传或被我们保存；刷新页面后会清空。',
                        })}
                    </p>
                </div>
            </div>
        </section>
    );
};
