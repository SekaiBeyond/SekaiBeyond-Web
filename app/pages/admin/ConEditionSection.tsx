import { useEffect, useState } from 'react';
import { useLanguage } from '~/components/LanguageContextProvider';
import { callSaveSiteConfig, callUploadAdminImage } from '~/lib/firebase';
import type { ConEdition } from '~/constants';
import { ImageUploadField } from './ImageUploadField';

interface ConEditionSectionProps {
    conEdition: ConEdition | null;
    refreshConfig: () => Promise<void>;
    showToast: (message: string, type: 'success' | 'warning' | 'error') => void;
    readOnly?: boolean;
}

export const ConEditionSection = ({conEdition, refreshConfig, showToast, readOnly}: ConEditionSectionProps) => {
    const {isEnglish} = useLanguage();
    const [formData, setFormData] = useState<ConEdition>({
        year: new Date().getFullYear(),
        date: new Date().toISOString().split('T')[0],
        location: '',
        locationCn: '',
        description: '',
        descriptionCn: '',
        image: '',
        highlights: [{labelEn: '', labelCn: '', icon: '✨'}],
    });
    const [saving, setSaving] = useState(false);
    const [uploading, setUploading] = useState(false);

    useEffect(() => {
        if (conEdition) {
            setFormData(conEdition);
        }
    }, [conEdition]);

    const handleImageChange = async (file: File, previewUrl: string) => {
        setUploading(true);
        setFormData(prev => ({...prev, image: previewUrl}));
        try {
            showToast(isEnglish ? 'Uploading image...' : '正在上传图片...', 'warning');
            const url = await callUploadAdminImage(file, `config/con-${formData.year}.webp`);
            setFormData(prev => ({...prev, image: url}));
            showToast(isEnglish ? 'Image uploaded.' : '图片已上传。', 'success');
        } catch {
            showToast(isEnglish ? 'Image upload failed.' : '图片上传失败。', 'error');
        } finally {
            setUploading(false);
        }
    };

    const addHighlight = () => {
        setFormData(prev => ({
            ...prev,
            highlights: [...prev.highlights, {labelEn: '', labelCn: '', icon: '✨'}]
        }));
    };

    const updateHighlight = (index: number, field: string, value: string) => {
        setFormData(prev => {
            const next = [...prev.highlights];
            next[index] = {...next[index], [field]: value};
            return {...prev, highlights: next};
        });
    };

    const removeHighlight = (index: number) => {
        setFormData(prev => ({
            ...prev,
            highlights: prev.highlights.filter((_, i) => i !== index)
        }));
    };

    const saveChanges = async () => {
        setSaving(true);
        try {
            await callSaveSiteConfig({conEdition: formData});
            await refreshConfig();
            showToast(isEnglish ? 'Convention edition saved.' : '漫展年度已保存。', 'success');
        } catch {
            showToast(isEnglish ? 'Failed to save convention edition.' : '保存漫展年度失败。', 'error');
        } finally {
            setSaving(false);
        }
    };

    const removeConfig = async () => {
        if (!confirm(isEnglish ? 'Reset to default convention configuration?' : '重置为默认漫展配置？')) return;
        setSaving(true);
        try {
            await callSaveSiteConfig({conEdition: null});
            await refreshConfig();
            showToast(isEnglish ? 'Convention configuration reset.' : '漫展配置已重置。', 'success');
        } catch {
            showToast(isEnglish ? 'Failed to reset convention configuration.' : '重置漫展配置失败。', 'error');
        } finally {
            setSaving(false);
        }
    };

    const canSave = formData.year && formData.date && formData.location && formData.description && formData.descriptionCn && formData.image && !uploading && !saving;

    return (
        <div className="admin-section">
            <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center'}}>
                <h3 className="admin-badges-title" style={{marginBottom: 0}}>
                    {isEnglish ? 'Sekai Beyond Con' : '彼世界漫展'}
                    {(saving || uploading) &&
                        <span style={{marginLeft: '12px', fontSize: '12px', color: 'var(--color-primary)'}}>
                        {uploading ? (isEnglish ? 'Uploading...' : '上传中...') : (isEnglish ? 'Saving...' : '保存中...')}
                    </span>}
                </h3>
            </div>
            <p className="admin-helper-text" style={{marginTop: '4px'}}>
                {isEnglish
                    ? 'Configure the convention edition displayed on the main page. Leaving this empty will show the default hardcoded edition.'
                    : '配置在主页上显示的漫展年度。留空将显示默认硬编码的年度。'}
            </p>

            <div className="admin-tickets-attendee-edit admin-mt-12" style={{maxWidth: '800px'}}>
                <div className="admin-form-grid" style={{gridTemplateColumns: '1fr 1fr', gap: '16px'}}>
                    <label className="admin-tickets-template-field">
                        <span>{isEnglish ? 'Year' : '年份'}</span>
                        <input
                            className="admin-input"
                            type="number"
                            value={formData.year}
                            onChange={e => !readOnly && setFormData(prev => ({
                                ...prev,
                                year: parseInt(e.target.value)
                            }))}
                            readOnly={readOnly}
                        />
                    </label>
                    <label className="admin-tickets-template-field">
                        <span>{isEnglish ? 'Date' : '日期'}</span>
                        <input
                            className="admin-input"
                            type="date"
                            value={formData.date}
                            onChange={e => !readOnly && setFormData(prev => ({...prev, date: e.target.value}))}
                            readOnly={readOnly}
                        />
                    </label>
                </div>

                <label className="admin-tickets-template-field">
                    <span>{isEnglish ? 'Location (English)' : '地点（英文）'}</span>
                    <input
                        className="admin-input"
                        value={formData.location}
                        onChange={e => !readOnly && setFormData(prev => ({...prev, location: e.target.value}))}
                        placeholder="e.g. Husky Union Building"
                        readOnly={readOnly}
                    />
                </label>

                <label className="admin-tickets-template-field">
                    <span>{isEnglish ? 'Location (Chinese) (optional)' : '地点（中文）（可选）'}</span>
                    <input
                        className="admin-input"
                        value={formData.locationCn}
                        onChange={e => !readOnly && setFormData(prev => ({...prev, locationCn: e.target.value}))}
                        placeholder="例如：哈士奇联盟大楼"
                        readOnly={readOnly}
                    />
                </label>

                <label className="admin-tickets-template-field">
                    <span>{isEnglish ? 'Description (English)' : '描述（英文）'}</span>
                    <textarea
                        className="admin-input"
                        style={{minHeight: '100px'}}
                        value={formData.description}
                        onChange={e => !readOnly && setFormData(prev => ({...prev, description: e.target.value}))}
                        readOnly={readOnly}
                    />
                </label>

                <label className="admin-tickets-template-field">
                    <span>{isEnglish ? 'Description (Chinese)' : '描述（中文）'}</span>
                    <textarea
                        className="admin-input"
                        style={{minHeight: '100px'}}
                        value={formData.descriptionCn}
                        onChange={e => !readOnly && setFormData(prev => ({...prev, descriptionCn: e.target.value}))}
                        readOnly={readOnly}
                    />
                </label>

                <div style={{marginTop: '8px'}}>
                    <ImageUploadField
                        label="Convention Poster"
                        labelCn="漫展海报"
                        preview={formData.image || null}
                        onFileChange={(file, url) => !readOnly && handleImageChange(file, url)}
                        convertToWebp
                        showToast={showToast}
                    />
                </div>

                <div style={{marginTop: '24px', borderTop: '1px solid var(--color-border)', paddingTop: '16px'}}>
                    <div style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        marginBottom: '8px'
                    }}>
                        <span style={{fontSize: '14px', fontWeight: 600}}>{isEnglish ? 'Highlights' : '亮点'}</span>
                        {!readOnly && (
                            <button className="admin-btn admin-btn--link" style={{marginBottom: 0, padding: '4px 8px'}}
                                    onClick={addHighlight}>
                                {isEnglish ? '+ Add' : '+ 添加'}
                            </button>
                        )}
                    </div>
                    {formData.highlights.map((h, i) => (
                        <div key={i}
                             style={{display: 'flex', gap: '8px', marginBottom: '8px', alignItems: 'center'}}>
                            <input
                                className="admin-input"
                                style={{flex: 0.22, minWidth: 0, textAlign: 'center'}}
                                value={h.icon}
                                onChange={e => !readOnly && updateHighlight(i, 'icon', e.target.value)}
                                placeholder="Icon"
                                readOnly={readOnly}
                            />
                            <input
                                className="admin-input"
                                style={{flex: 1}}
                                value={h.labelEn}
                                onChange={e => !readOnly && updateHighlight(i, 'labelEn', e.target.value)}
                                placeholder="Label (En)"
                                readOnly={readOnly}
                            />
                            <input
                                className="admin-input"
                                style={{flex: 1}}
                                value={h.labelCn}
                                onChange={e => !readOnly && updateHighlight(i, 'labelCn', e.target.value)}
                                placeholder="Label (Cn)"
                                readOnly={readOnly}
                            />
                            {!readOnly && (
                                <button
                                    className="admin-btn admin-btn--link"
                                    style={{
                                        color: 'var(--color-danger)',
                                        border: 'none',
                                        padding: '8px',
                                        marginBottom: 0
                                    }}
                                    onClick={() => removeHighlight(i)}
                                >
                                    ×
                                </button>
                            )}
                        </div>
                    ))}
                </div>

                {!readOnly && (
                    <div className="admin-btn-row" style={{marginTop: '24px'}}>
                        <button
                            className="admin-toggle-btn admin-toggle-save"
                            onClick={saveChanges}
                            disabled={!canSave}
                        >
                            {isEnglish ? 'Save Configuration' : '保存配置'}
                        </button>
                        <button
                            className="admin-toggle-btn admin-toggle-cancel"
                            onClick={removeConfig}
                            disabled={saving}
                        >
                            {isEnglish ? 'Reset to Default' : '重置为默认'}
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
};
