import { useState } from 'react';
import { useLanguage } from '~/components/LanguageContextProvider';
import { validateImageFile } from './utils';
import { ImageCropModal } from './ImageCropModal';

interface ImageUploadFieldProps {
    label: string;
    labelCn: string;
    preview: string | null;
    onFileChange: (file: File, previewUrl: string) => void;
    onCleanupPreview?: (url: string) => void;
    cropAspect?: number;
}

export const ImageUploadField = ({
                                     label, labelCn, preview, onFileChange, onCleanupPreview, cropAspect,
                                 }: ImageUploadFieldProps) => {
    const {isEnglish} = useLanguage();
    const [pendingFile, setPendingFile] = useState<File | null>(null);

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        if (cropAspect) {
            if (!validateImageFile(file, isEnglish, {allowAnyImage: true})) {
                e.target.value = '';
                return;
            }
            setPendingFile(file);
            e.target.value = '';
            return;
        }
        if (!validateImageFile(file, isEnglish)) {
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
                    accept={cropAspect ? 'image/*' : 'image/webp'}
                    onChange={handleChange}
                />
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
                />
            )}
        </>
    );
};
