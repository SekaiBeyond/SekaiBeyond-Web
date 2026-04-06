import { useLanguage } from '~/components/LanguageContextProvider';

interface BilingualFormFieldProps {
    label: string;
    labelCn: string;
    value: string;
    valueCn: string;
    onChange: (value: string) => void;
    onChangeCn: (value: string) => void;
    placeholder?: string;
    placeholderCn?: string;
    multiline?: boolean;
    fullWidth?: boolean;
}

export const BilingualFormField = ({
                                       label, labelCn, value, valueCn,
                                       onChange, onChangeCn,
                                       placeholder, placeholderCn,
                                       multiline = false, fullWidth = false,
                                   }: BilingualFormFieldProps) => {
    const {isEnglish} = useLanguage();
    const Tag = multiline ? 'textarea' : 'input';
    const cls = `admin-search-input${multiline ? ' admin-textarea' : ''}`;
    const fullCls = fullWidth ? 'admin-form-grid-full' : undefined;

    return (
        <>
            <label className={fullCls}>
                <span>{isEnglish ? `${label} (English)` : `${labelCn}（英文）`}</span>
                <Tag
                    value={value}
                    onChange={e => onChange(e.target.value)}
                    className={cls}
                    placeholder={placeholder ?? (isEnglish ? label : labelCn)}
                />
            </label>
            <label className={fullCls}>
                <span>{isEnglish ? `${label} (Chinese)` : `${labelCn}（中文）`}</span>
                <Tag
                    value={valueCn}
                    onChange={e => onChangeCn(e.target.value)}
                    className={cls}
                    placeholder={placeholderCn ?? (isEnglish ? `${label} in Chinese` : `中文${labelCn}`)}
                />
            </label>
        </>
    );
};
