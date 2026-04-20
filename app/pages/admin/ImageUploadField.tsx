import { useState } from 'react';
import { useLanguage } from '~/components/LanguageContextProvider';
import { convertImageToWebp, type ShowToast, validateImageFile } from './utils';
import { ImageCropModal } from './ImageCropModal';

interface ImageUploadFieldProps {
    label: string;
    labelCn: string;
    preview: string | null;
    onFileChange: (file: File, previewUrl: string) => void;
    onCleanupPreview?: (url: string) => void;
    cropAspect?: number;
    convertToWebp?: boolean;
    showToast: ShowToast;
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
                                 }: ImageUploadFieldProps) => {
    const {isEnglish} = useLanguage();
    const [pendingFile, setPendingFile] = useState<File | null>(null);
    const [converting, setConverting] = useState(false);

    const handleChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        if (cropAspect) {
            if (!validateImageFile(file, isEnglish, showToast, {allowAnyImage: true})) {
                e.target.value = '';
                return;
            }
            setPendingFile(file);
            e.target.value = '';
            return;
        }
        if (convertToWebp) {
            if (!validateImageFile(file, isEnglish, showToast, {allowAnyImage: true})) {
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

    return (
        <>
            <label>
                <span>{isEnglish ? label : labelCn}</span>
                <input
                    type="file"
                    accept={cropAspect || convertToWebp ? 'image/*' : 'image/webp'}
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
            {pendingFile && cropAspect && (
                <ImageCropModal
                    file={pendingFile}
                    aspect={cropAspect}
                    onConfirm={handleCropConfirm}
                    onCancel={() => setPendingFile(null)}
                    showToast={showToast}
                />
            )}
        </>
    );
};
