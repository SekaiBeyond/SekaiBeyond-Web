import { useEffect, useState } from 'react';
import { useLanguage } from '~/components/LanguageContextProvider';
import { callSavePolicy, callSaveSiteConfig } from '~/lib/firebase';
import { useSiteConfig } from '~/lib/siteConfig';
import { usePolicy } from '~/lib/policy';
import { BILIBILI_VIDEO } from '~/constants';

interface SiteConfigTabProps {
    showToast: (message: string, type: 'success' | 'warning' | 'error') => void;
}

function parseBvid(input: string): string {
    const match = input.trim().match(/BV[a-zA-Z0-9]+/);
    return match ? match[0] : '';
}

export const SiteConfigTab = ({showToast}: SiteConfigTabProps) => {
    const {isEnglish} = useLanguage();

    const {config, loading: configLoading, refresh: refreshConfig} = useSiteConfig();
    const [bvidInput, setBvidInput] = useState('');
    const [savingVideo, setSavingVideo] = useState(false);
    const [videoInitialized, setVideoInitialized] = useState(false);

    const {policy, loading: policyLoading, refresh: refreshPolicy} = usePolicy();
    const [contentEn, setContentEn] = useState('');
    const [contentCn, setContentCn] = useState('');
    const [savingPolicy, setSavingPolicy] = useState(false);
    const [policyInitialized, setPolicyInitialized] = useState(false);

    useEffect(() => {
        if (!configLoading && !videoInitialized) {
            setBvidInput(config.bilibiliVideoBvid || BILIBILI_VIDEO.bvid);
            setVideoInitialized(true);
        }
    }, [configLoading, config, videoInitialized]);

    useEffect(() => {
        if (!policyLoading && !policyInitialized) {
            setContentEn(policy.contentEn);
            setContentCn(policy.contentCn);
            setPolicyInitialized(true);
        }
    }, [policyLoading, policy, policyInitialized]);

    const saveVideo = async () => {
        const bvid = parseBvid(bvidInput);
        if (!bvid) {
            showToast(
                isEnglish ? 'Please enter a valid BV ID or Bilibili URL.' : '请输入有效的 BV 号或 B 站链接。',
                'error'
            );
            return;
        }
        setSavingVideo(true);
        try {
            await callSaveSiteConfig({bilibiliVideoBvid: bvid});
            await refreshConfig();
            showToast(isEnglish ? 'Video saved.' : '视频已保存。', 'success');
        } catch {
            showToast(isEnglish ? 'Failed to save video.' : '保存视频失败。', 'error');
        } finally {
            setSavingVideo(false);
        }
    };

    const savePolicy = async () => {
        setSavingPolicy(true);
        try {
            await callSavePolicy({contentEn: contentEn.trim(), contentCn: contentCn.trim()});
            await refreshPolicy();
            showToast(isEnglish ? 'Policy saved.' : '政策已保存。', 'success');
        } catch {
            showToast(isEnglish ? 'Failed to save policy.' : '保存政策失败。', 'error');
        } finally {
            setSavingPolicy(false);
        }
    };

    if (configLoading || policyLoading) {
        return (
            <div className="admin-section">
                <div className="policy-spinner-wrap">
                    <div className="profile-spinner"/>
                </div>
            </div>
        );
    }

    const previewBvid = parseBvid(bvidInput) || BILIBILI_VIDEO.bvid;

    return (
        <div className="admin-section">
            <h3 className="admin-badges-title">
                {isEnglish ? 'Featured Video' : '精选视频'}
            </h3>
            <p className="admin-helper-text">
                {isEnglish
                    ? 'Configure the featured video shown in the "See Us in Action" section.'
                    : '设置「精彩时刻」板块展示的视频。'}
            </p>
            <div className="admin-form-grid admin-mt-12">
                <label>
                    <span>{isEnglish ? 'Bilibili Video (BV ID or URL)' : 'B 站视频（BV 号或链接）'}</span>
                    <input
                        className="admin-search-input"
                        type="text"
                        value={bvidInput}
                        onChange={e => setBvidInput(e.target.value)}
                        placeholder="BV1GsfjB7E6J or https://www.bilibili.com/video/BV..."
                    />
                    <span className="admin-helper-text" style={{marginTop: 4, display: 'block'}}>
                        {isEnglish ? 'Will link to: ' : '将跳转至：'}
                        <code>https://www.bilibili.com/video/{previewBvid}</code>
                    </span>
                </label>
            </div>
            <div className="admin-btn-row admin-mt-12">
                <button
                    className="admin-toggle-btn admin-toggle-save"
                    onClick={saveVideo}
                    disabled={savingVideo}
                >
                    {savingVideo
                        ? (isEnglish ? 'Saving...' : '保存中...')
                        : (isEnglish ? 'Save Video' : '保存视频')}
                </button>
                <a
                    href="/#video"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="admin-toggle-btn admin-toggle-edit"
                >
                    {isEnglish ? 'Preview ↗' : '预览 ↗'}
                </a>
            </div>

            <div className="admin-divider"/>

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
                    onClick={savePolicy}
                    disabled={savingPolicy}
                >
                    {savingPolicy
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
