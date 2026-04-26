import { useEffect, useState } from 'react';
import { useLanguage } from '~/components/LanguageContextProvider';
import { callSavePolicy } from '~/lib/firebase';
import { usePolicy } from '~/lib/policy';

interface PolicyTabProps {
    showToast: (message: string, type: 'success' | 'warning' | 'error') => void;
}

export const PolicyTab = ({showToast}: PolicyTabProps) => {
    const {isEnglish} = useLanguage();
    const {policy, loading, refresh} = usePolicy();
    const [contentEn, setContentEn] = useState('');
    const [contentCn, setContentCn] = useState('');
    const [saving, setSaving] = useState(false);
    const [initialized, setInitialized] = useState(false);

    useEffect(() => {
        if (!loading && !initialized) {
            setContentEn(policy.contentEn);
            setContentCn(policy.contentCn);
            setInitialized(true);
        }
    }, [loading, policy, initialized]);

    const save = async () => {
        setSaving(true);
        try {
            await callSavePolicy({contentEn: contentEn.trim(), contentCn: contentCn.trim()});
            await refresh();
            showToast(isEnglish ? 'Policy saved.' : '政策已保存。', 'success');
        } catch {
            showToast(isEnglish ? 'Failed to save policy.' : '保存政策失败。', 'error');
        } finally {
            setSaving(false);
        }
    };

    if (loading) {
        return (
            <div className="admin-section">
                <div className="policy-spinner-wrap">
                    <div className="profile-spinner"/>
                </div>
            </div>
        );
    }

    return (
        <div className="admin-section">
            <h3 className="admin-badges-title">
                {isEnglish ? 'Policy Content' : '政策内容'}
            </h3>
            <p className="admin-helper-text">
                {isEnglish
                    ? 'This content is displayed on the public Policy page.'
                    : '此内容显示在公开政策页面上。'}
            </p>
            <div className="admin-form-grid admin-mt-12">
                <label>
                    <span>{isEnglish ? 'Content (English)' : '内容（英文）'}</span>
                    <textarea
                        className="admin-search-input policy-textarea"
                        value={contentEn}
                        onChange={e => setContentEn(e.target.value)}
                        placeholder={isEnglish ? 'Enter policy content in English...' : '请输入英文政策内容...'}
                    />
                </label>
                <label>
                    <span>{isEnglish ? 'Content (Chinese)' : '内容（中文）'}</span>
                    <textarea
                        className="admin-search-input policy-textarea"
                        value={contentCn}
                        onChange={e => setContentCn(e.target.value)}
                        placeholder={isEnglish ? 'Enter policy content in Chinese...' : '请输入中文政策内容...'}
                    />
                </label>
            </div>
            <div className="admin-btn-row admin-mt-12">
                <button
                    className="admin-toggle-btn admin-toggle-save"
                    onClick={save}
                    disabled={saving}
                >
                    {saving
                        ? (isEnglish ? 'Saving...' : '保存中...')
                        : (isEnglish ? 'Save Policy' : '保存政策')}
                </button>
                <a
                    href="/policy"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="admin-toggle-btn admin-toggle-edit"
                >
                    {isEnglish ? 'Preview ↗' : '预览 ↗'}
                </a>
            </div>
        </div>
    );
};
