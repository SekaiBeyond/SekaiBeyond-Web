import React, { useState } from 'react';
import { useLanguage } from '~/components/LanguageContextProvider';
import { useUploadLimits } from '~/lib/uploadLimits';
import { convertImageToWebp, type ShowToast, validateImageFile } from './utils';
import { ImageCropModal } from './ImageCropModal';

interface ImageUploadFieldProps {
    label?: string;
    labelCn?: string;
    preview: string | null;
    onFileChange: (file: File, previewUrl: string) => void;
    onCleanupPreview?: (url: string) => void;
    cropAspect?: number;
    cropWidth?: number;
    convertToWebp?: boolean;
    showToast: ShowToast;
    variant?: 'field' | 'avatar' | 'cover' | 'icon';
    placeholderSrc?: string;
    iconPreview?: React.ReactNode;
    onRemove?: () => void;
    disabled?: boolean;
}

export const ImageUploadField = ({
                                     label,
                                     labelCn,
                                     preview,
                                     onFileChange,
                                     onCleanupPreview,
                                     cropAspect,
                                     cropWidth,
                                     convertToWebp,
                                     showToast,
                                     variant = 'field',
                                     placeholderSrc,
                                     iconPreview,
                                     onRemove,
                                     disabled = false,
                                 }: ImageUploadFieldProps) => {
    const {isEnglish} = useLanguage();
    const {imageMb} = useUploadLimits();
    const [pendingFile, setPendingFile] = useState<File | null>(null);
    const [converting, setConverting] = useState(false);

    const handleChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        if (cropAspect) {
            if (!validateImageFile(file, imageMb, isEnglish, showToast, true)) {
                e.target.value = '';
                return;
            }
            setPendingFile(file);
            e.target.value = '';
            return;
        }
        if (convertToWebp) {
            if (!validateImageFile(file, imageMb, isEnglish, showToast, true)) {
                e.target.value = '';
                return;
            }
            e.target.value = '';
            setConverting(true);
            try {
                const webp = await convertImageToWebp(file);
                if (!validateImageFile(webp, imageMb, isEnglish, showToast)) return;
                if (preview?.startsWith('blob:')) onCleanupPreview?.(preview);
                onFileChange(webp, URL.createObjectURL(webp));
            } catch {
                showToast(isEnglish ? 'Failed to convert image.' : '转换图片失败。', 'error');
            } finally {
                setConverting(false);
            }
            return;
        }
        if (!validateImageFile(file, imageMb, isEnglish, showToast)) {
            e.target.value = '';
            return;
        }
        if (preview?.startsWith('blob:')) onCleanupPreview?.(preview);
        onFileChange(file, URL.createObjectURL(file));
    };

    const handleCropConfirm = (cropped: File) => {
        if (preview?.startsWith('blob:')) onCleanupPreview?.(preview);
        onFileChange(cropped, URL.createObjectURL(cropped));
        setPendingFile(null);
    };

    const accept = cropAspect || convertToWebp ? 'image/*' : 'image/webp';

    const cropModal = pendingFile && cropAspect ? (
        <ImageCropModal
            imageSource={pendingFile}
            aspect={cropAspect}
            outputWidth={cropWidth}
            onConfirm={handleCropConfirm}
            onCancel={() => setPendingFile(null)}
            showToast={showToast}
        />
    ) : null;

    if (variant !== 'field') {
        const cover = variant === 'cover';
        const image = cover || variant === 'icon';
        const busy = converting || disabled;
        const frame = cover && cropAspect ? {aspectRatio: String(cropAspect)} : undefined;
        const hint = {
            en: `Any image up to ${imageMb} MB.` + (cropAspect
                ? cover ? " You'll crop it to this frame before it's saved." : " You'll crop it before it's saved."
                : cover ? ' Shown at 3:4, trimmed to fill.' : ''),
            zh: `任意图片，最大 ${imageMb} MB。` + (cropAspect
                ? cover ? '保存前需按此框裁剪。' : '保存前需先裁剪。'
                : cover ? '按 3:4 显示，超出部分会被裁切。' : ''),
        };
        return (
            <>
                <div className={`admin-avatar-field${cover ? ' admin-avatar-field--cover' : ''}`}>
                    {variant === 'icon' ? iconPreview : cover ? (
                        preview ? (
                            <img className="admin-cover-preview" src={preview} alt="" style={frame}/>
                        ) : (
                            <div className="admin-cover-preview admin-cover-preview--empty" style={frame}>
                                {isEnglish ? 'No image yet' : '尚无图片'}
                            </div>
                        )
                    ) : (
                        <img
                            className={`admin-avatar-preview${preview ? '' : ' admin-avatar-preview-default'}`}
                            src={preview || placeholderSrc || ''}
                            alt=""
                            referrerPolicy="no-referrer"
                        />
                    )}
                    <div className="admin-avatar-actions">
                        <div className="admin-btn-row">
                            <label className={`admin-btn admin-btn--chip admin-avatar-choose${
                                busy ? ' admin-avatar-choose-busy' : ''}`}>
                                <input type="file" accept={accept} onChange={handleChange} disabled={busy}/>
                                {converting
                                    ? (isEnglish ? 'Converting…' : '转换中…')
                                    : image
                                        ? preview
                                            ? (isEnglish ? 'Replace image' : '更换图片')
                                            : (isEnglish ? 'Choose image' : '选择图片')
                                        : preview
                                            ? (isEnglish ? 'Replace photo' : '更换照片')
                                            : (isEnglish ? 'Choose photo' : '选择照片')}
                            </label>
                            {preview && onRemove && (
                                <button className="admin-btn admin-btn--chip" onClick={onRemove} disabled={busy}
                                        type="button">
                                    {isEnglish ? 'Remove' : '移除'}
                                </button>
                            )}
                        </div>
                        <p className="admin-helper-text admin-avatar-helper">
                            {isEnglish ? hint.en : hint.zh}
                        </p>
                    </div>
                </div>
                {cropModal}
            </>
        );
    }

    return (
        <>
            <label>
                <span>{isEnglish ? label : labelCn}</span>
                <input
                    type="file"
                    accept={accept}
                    onChange={handleChange}
                    disabled={converting || disabled}
                />
                {converting && (
                    <span className="admin-helper-text">
                        {isEnglish ? 'Converting…' : '转换中…'}
                    </span>
                )}
                {preview && (
                    <img src={preview} alt="" className="admin-badge-image-preview"/>
                )}
            </label>
            {cropModal}
        </>
    );
};
