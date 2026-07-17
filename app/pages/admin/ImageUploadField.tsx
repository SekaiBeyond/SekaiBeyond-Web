import React, { useState } from 'react';
import { useLanguage } from '~/components/LanguageContextProvider';
import { MAX_IMAGE_SIZE_MB } from '~/constants';
import { convertImageToWebp, type ShowToast, validateImageFile } from './utils';
import { ImageCropModal } from './ImageCropModal';

interface ImageUploadFieldProps {
    // Omitted by the 'avatar' variant, whose caller renders the label itself.
    label?: string;
    labelCn?: string;
    preview: string | null;
    onFileChange: (file: File, previewUrl: string) => void;
    onCleanupPreview?: (url: string) => void;
    cropAspect?: number;
    convertToWebp?: boolean;
    showToast: ShowToast;
    // 'avatar' swaps the labelled file input for a round preview beside a styled button,
    // so the admin sees the same circular crop the site renders. The caller owns the field
    // label in this variant, since it also owns the controls that sit beside it.
    variant?: 'field' | 'avatar';
    // Shown in the avatar preview when there is no image yet — the same default the
    // public page falls back to, so an empty picker tells the truth about the result.
    placeholderSrc?: string;
}

export const ImageUploadField = ({
                                     label,
                                     labelCn,
                                     preview,
                                     onFileChange,
                                     onCleanupPreview,
                                     cropAspect,
                                     convertToWebp,
                                     showToast,
                                     variant = 'field',
                                     placeholderSrc,
                                 }: ImageUploadFieldProps) => {
    const {isEnglish} = useLanguage();
    const [pendingFile, setPendingFile] = useState<File | null>(null);
    const [converting, setConverting] = useState(false);

    const handleChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        if (cropAspect) {
            if (!validateImageFile(file, isEnglish, showToast, true)) {
                e.target.value = '';
                return;
            }
            setPendingFile(file);
            e.target.value = '';
            return;
        }
        if (convertToWebp) {
            if (!validateImageFile(file, isEnglish, showToast, true)) {
                e.target.value = '';
                return;
            }
            e.target.value = '';
            setConverting(true);
            try {
                const webp = await convertImageToWebp(file);
                if (!validateImageFile(webp, isEnglish, showToast)) return;
                if (preview?.startsWith('blob:')) onCleanupPreview?.(preview);
                onFileChange(webp, URL.createObjectURL(webp));
            } catch {
                showToast(isEnglish ? 'Failed to convert image.' : '转换图片失败。', 'error');
            } finally {
                setConverting(false);
            }
            return;
        }
        if (!validateImageFile(file, isEnglish, showToast)) {
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
            onConfirm={handleCropConfirm}
            onCancel={() => setPendingFile(null)}
            showToast={showToast}
        />
    ) : null;

    if (variant === 'avatar') {
        return (
            <>
                <div className="admin-avatar-field">
                    <img
                        className={`admin-avatar-preview${preview ? '' : ' admin-avatar-preview-default'}`}
                        src={preview || placeholderSrc || ''}
                        alt=""
                        referrerPolicy="no-referrer"
                    />
                    <div className="admin-avatar-actions">
                        {/* The input is visually hidden but still focusable, so this label is
                            the button and :focus-within draws its ring. */}
                        <label className={`admin-btn admin-btn--chip admin-avatar-choose${
                            converting ? ' admin-avatar-choose-busy' : ''}`}>
                            <input type="file" accept={accept} onChange={handleChange} disabled={converting}/>
                            {converting
                                ? (isEnglish ? 'Converting…' : '转换中…')
                                : preview
                                    ? (isEnglish ? 'Replace photo' : '更换照片')
                                    : (isEnglish ? 'Choose photo' : '选择照片')}
                        </label>
                        <p className="admin-helper-text admin-avatar-helper">
                            {isEnglish
                                ? `Any image up to ${MAX_IMAGE_SIZE_MB} MB.${cropAspect ? " You'll crop it before it's saved." : ''}`
                                : `任意图片，最大 ${MAX_IMAGE_SIZE_MB} MB。${cropAspect ? '保存前需先裁剪。' : ''}`}
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
                    disabled={converting}
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
