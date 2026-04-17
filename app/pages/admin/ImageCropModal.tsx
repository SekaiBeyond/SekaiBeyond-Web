import { useEffect, useRef, useState } from 'react';
import { useLanguage } from '~/components/LanguageContextProvider';
import { useModalEffects } from '~/lib/useModalEffects';
import { WEBP_QUALITY } from './utils';

interface ImageCropModalProps {
    file: File;
    aspect: number;
    onConfirm: (cropped: File) => void;
    onCancel: () => void;
}

const DISPLAY_SIZE = 360;
const OUTPUT_SIZE = 512;

export const ImageCropModal = ({file, aspect, onConfirm, onCancel}: ImageCropModalProps) => {
    const {isEnglish} = useLanguage();
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const dragRef = useRef<{startX: number; startY: number; ox: number; oy: number} | null>(null);
    const overlayRef = useRef<HTMLDivElement>(null);
    useModalEffects(true, overlayRef);

    const [image, setImage] = useState<HTMLImageElement | null>(null);
    const [minScale, setMinScale] = useState(1);
    const [scale, setScale] = useState(1);
    const [offset, setOffset] = useState({x: 0, y: 0});
    const [saving, setSaving] = useState(false);
    const [loadError, setLoadError] = useState(false);

    const boxW = DISPLAY_SIZE;
    const boxH = DISPLAY_SIZE / aspect;

    useEffect(() => {
        const url = URL.createObjectURL(file);
        const img = new Image();
        img.onload = () => {
            const ms = Math.max(boxW / img.width, boxH / img.height);
            setMinScale(ms);
            setScale(ms);
            setOffset({x: 0, y: 0});
            setImage(img);
        };
        img.onerror = () => setLoadError(true);
        img.src = url;
        return () => URL.revokeObjectURL(url);
    }, [file, boxW, boxH]);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas || !image) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.clearRect(0, 0, boxW, boxH);
        const drawW = image.width * scale;
        const drawH = image.height * scale;
        const dx = (boxW - drawW) / 2 + offset.x;
        const dy = (boxH - drawH) / 2 + offset.y;
        ctx.drawImage(image, dx, dy, drawW, drawH);
    }, [image, scale, offset, boxW, boxH]);

    const clampOffset = (s: number, ox: number, oy: number) => {
        if (!image) return {x: ox, y: oy};
        const drawW = image.width * s;
        const drawH = image.height * s;
        const maxX = Math.max(0, (drawW - boxW) / 2);
        const maxY = Math.max(0, (drawH - boxH) / 2);
        return {
            x: Math.min(maxX, Math.max(-maxX, ox)),
            y: Math.min(maxY, Math.max(-maxY, oy)),
        };
    };

    const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        dragRef.current = {startX: e.clientX, startY: e.clientY, ox: offset.x, oy: offset.y};
    };
    const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
        if (!dragRef.current) return;
        const dx = e.clientX - dragRef.current.startX;
        const dy = e.clientY - dragRef.current.startY;
        setOffset(clampOffset(scale, dragRef.current.ox + dx, dragRef.current.oy + dy));
    };
    const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
        if (e.currentTarget.hasPointerCapture(e.pointerId)) {
            e.currentTarget.releasePointerCapture(e.pointerId);
        }
        dragRef.current = null;
    };

    const handleScaleChange = (v: number) => {
        setScale(v);
        setOffset(o => clampOffset(v, o.x, o.y));
    };

    const handleApply = async () => {
        if (!image) return;
        setSaving(true);
        try {
            const out = document.createElement('canvas');
            const outH = Math.round(OUTPUT_SIZE / aspect);
            out.width = OUTPUT_SIZE;
            out.height = outH;
            const octx = out.getContext('2d');
            if (!octx) throw new Error('canvas-unsupported');
            const k = OUTPUT_SIZE / boxW;
            const drawW = image.width * scale * k;
            const drawH = image.height * scale * k;
            const dx = (OUTPUT_SIZE - drawW) / 2 + offset.x * k;
            const dy = (outH - drawH) / 2 + offset.y * k;
            octx.drawImage(image, dx, dy, drawW, drawH);
            const blob = await new Promise<Blob | null>(resolve =>
                out.toBlob(b => resolve(b), 'image/webp', WEBP_QUALITY)
            );
            if (!blob) throw new Error('encode-failed');
            const cropped = new File([blob], `crop-${Date.now()}.webp`, {type: 'image/webp'});
            onConfirm(cropped);
        } catch {
            alert(isEnglish ? 'Failed to process image.' : '处理图片失败。');
            setSaving(false);
        }
    };

    return (
        <div ref={overlayRef} className="modal-overlay"
             onClick={e => e.target === e.currentTarget && !saving && onCancel()}>
            <div className="modal-content image-crop-modal">
                <button className="modal-close" onClick={onCancel} type="button" disabled={saving}>×</button>
                <h2 className="redeem-heading">{isEnglish ? 'Crop Image' : '裁剪图片'}</h2>
                {loadError ? (
                    <p className="redeem-error-text">
                        {isEnglish ? 'Could not load image.' : '无法加载图片。'}
                    </p>
                ) : (
                    <>
                        <div className="image-crop-canvas-wrap" style={{width: boxW, height: boxH}}>
                            <canvas
                                ref={canvasRef}
                                width={boxW}
                                height={boxH}
                                className="image-crop-canvas"
                                onPointerDown={handlePointerDown}
                                onPointerMove={handlePointerMove}
                                onPointerUp={handlePointerUp}
                                onPointerCancel={handlePointerUp}
                            />
                            {!image && <div className="profile-spinner spinner-centered"/>}
                        </div>
                        <label className="image-crop-zoom">
                            <span>{isEnglish ? 'Zoom' : '缩放'}</span>
                            <input
                                type="range"
                                min={minScale}
                                max={minScale * 4}
                                step={minScale / 100}
                                value={scale}
                                disabled={!image}
                                onChange={e => handleScaleChange(parseFloat(e.target.value))}
                            />
                        </label>
                    </>
                )}
                <div className="admin-form-actions">
                    <button className="admin-generate-btn" onClick={handleApply}
                            disabled={saving || !image || loadError}>
                        {saving
                            ? (isEnglish ? 'Processing...' : '处理中...')
                            : (isEnglish ? 'Apply' : '应用')}
                    </button>
                    <button className="admin-back-btn" onClick={onCancel} disabled={saving}>
                        {isEnglish ? 'Cancel' : '取消'}
                    </button>
                </div>
            </div>
        </div>
    );
};
