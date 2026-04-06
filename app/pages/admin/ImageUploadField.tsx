import { useLanguage } from '~/components/LanguageContextProvider';
import { validateImageFile } from './utils';

interface ImageUploadFieldProps {
    label: string;
    labelCn: string;
    preview: string | null;
    onFileChange: (file: File, previewUrl: string) => void;
    onCleanupPreview?: (url: string) => void;
}

export const ImageUploadField = ({
                                     label, labelCn, preview, onFileChange, onCleanupPreview,
                                 }: ImageUploadFieldProps) => {
    const {isEnglish} = useLanguage();

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        if (!validateImageFile(file, isEnglish)) {
            e.target.value = '';
            return;
        }
        if (preview?.startsWith('blob:')) onCleanupPreview?.(preview);
        onFileChange(file, URL.createObjectURL(file));
    };

    return (
        <label>
            <span>{isEnglish ? label : labelCn}</span>
            <input type="file" accept="image/webp" onChange={handleChange}/>
            {preview && (
                <img src={preview} alt="" className="admin-badge-image-preview"/>
            )}
        </label>
    );
};
