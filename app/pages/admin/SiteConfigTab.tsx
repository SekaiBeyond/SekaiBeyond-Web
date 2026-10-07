import { useEffect, useState } from 'react';
import { useLanguage } from '~/components/LanguageContextProvider';
import { callGetSenderSettings, callSavePolicy, callSaveSiteConfig } from '~/lib/firebase';
import { useSiteConfig } from '~/lib/siteConfig';
import { renderPolicyMarkdown, usePolicy } from '~/lib/policy';
import { BILIBILI_VIDEO } from '~/constants';
import { EMAIL_RE } from './tickets/helpers';
import { TeamSection } from './TeamSection';
import { ConEditionSection } from './ConEditionSection';
import { SectionNav } from './SectionNav';
import { refreshAfterSave } from './utils';

interface SiteConfigTabProps {
    showToast: (message: string, type: 'success' | 'warning' | 'error') => void;
    readOnly?: boolean;
}

// Mirrors SENDER_PREFIX_RE in functions/src/utils/validation.ts.
const SENDER_PREFIX_RE = /^[a-z0-9]+(?:[._+-][a-z0-9]+)*$/;

function parseBvid(input: string): string {
    const match = input.trim().match(/BV[a-zA-Z0-9]+/);
    return match ? match[0] : '';
}

// A <div> rather than the editor's <label>: `.admin-form-grid label span`
// would restyle any <span> in the rendered policy.
const PolicyPreview = ({label, content}: {label: string; content: string}) => {
    const {isEnglish} = useLanguage();
    return (
        <div className="admin-policy-preview-field">
            <span>{label}</span>
            {content.trim() ? (
                <div className="policy-text admin-policy-preview"
                     dangerouslySetInnerHTML={{__html: renderPolicyMarkdown(content)}}/>
            ) : (
                <p className="policy-empty">
                    {isEnglish ? 'No policy content available.' : '暂无政策内容。'}
                </p>
            )}
        </div>
    );
};

export const SiteConfigTab = ({showToast, readOnly = false}: SiteConfigTabProps) => {
    const {isEnglish} = useLanguage();

    const {config, loading: configLoading, failed: configFailed, refresh: refreshConfig} = useSiteConfig();
    const [bvidInput, setBvidInput] = useState('');
    const [savingVideo, setSavingVideo] = useState(false);
    const [emailInput, setEmailInput] = useState('');
    const [savingEmail, setSavingEmail] = useState(false);
    const [senderInput, setSenderInput] = useState('');
    const [savingSender, setSavingSender] = useState(false);
    // The domain lives on the server (from PUBLIC_ORIGIN). Until it loads, or if
    // it can't, the field still works and only the "@domain" hint is missing.
    const [senderSettings, setSenderSettings] = useState<{domain: string, defaultPrefix: string} | null>(null);
    const [configInitialized, setConfigInitialized] = useState(false);

    const {policy, loading: policyLoading, failed: policyFailed, refresh: refreshPolicy} = usePolicy();
    const [contentEn, setContentEn] = useState('');
    const [contentCn, setContentCn] = useState('');
    const [savingPolicy, setSavingPolicy] = useState(false);
    const [policyInitialized, setPolicyInitialized] = useState(false);
    const [previewingPolicy, setPreviewingPolicy] = useState(false);

    useEffect(() => {
        if (!configLoading && !configInitialized) {
            setBvidInput(config.bilibiliVideoBvid || BILIBILI_VIDEO.bvid);
            setEmailInput(config.contactEmail);
            setSenderInput(config.senderPrefix);
            setConfigInitialized(true);
        }
    }, [configLoading, config, configInitialized]);

    useEffect(() => {
        callGetSenderSettings()
            .then(res => setSenderSettings(res.data))
            .catch(err => console.error('[SiteConfigTab] sender settings', err));
    }, []);

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
            await refreshAfterSave(refreshConfig, showToast, isEnglish);
            showToast(isEnglish ? 'Video saved.' : '视频已保存。', 'success');
        } catch {
            showToast(isEnglish ? 'Failed to save video.' : '保存视频失败。', 'error');
        } finally {
            setSavingVideo(false);
        }
    };

    const saveEmail = async () => {
        const email = emailInput.trim().toLowerCase();
        if (email && !EMAIL_RE.test(email)) {
            showToast(isEnglish ? 'Please enter a valid email address.' : '请输入有效的邮箱地址。', 'error');
            return;
        }
        setSavingEmail(true);
        try {
            await callSaveSiteConfig({contactEmail: email});
            await refreshAfterSave(refreshConfig, showToast, isEnglish);
            setEmailInput(email);
            showToast(isEnglish ? 'Contact email saved.' : '联系邮箱已保存。', 'success');
        } catch {
            showToast(isEnglish ? 'Failed to save contact email.' : '保存联系邮箱失败。', 'error');
        } finally {
            setSavingEmail(false);
        }
    };

    const saveSender = async () => {
        const prefix = senderInput.trim().toLowerCase();
        if (prefix && (prefix.length > 64 || !SENDER_PREFIX_RE.test(prefix))) {
            showToast(
                isEnglish ? 'Use letters, digits, and . _ + - between them.' : '请只使用字母、数字，以及夹在其间的 . _ + -。',
                'error'
            );
            return;
        }
        setSavingSender(true);
        try {
            await callSaveSiteConfig({senderPrefix: prefix});
            await refreshAfterSave(refreshConfig, showToast, isEnglish);
            setSenderInput(prefix);
            showToast(isEnglish ? 'Sender saved.' : '发件邮箱已保存。', 'success');
        } catch {
            showToast(isEnglish ? 'Failed to save sender.' : '保存发件邮箱失败。', 'error');
        } finally {
            setSavingSender(false);
        }
    };

    const savePolicy = async () => {
        setSavingPolicy(true);
        try {
            await callSavePolicy({contentEn: contentEn.trim(), contentCn: contentCn.trim()});
            await refreshAfterSave(refreshPolicy, showToast, isEnglish);
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
                    <div className="spinner"/>
                </div>
            </div>
        );
    }

    // Editing here would mean saving the built-in defaults over whatever is
    // actually stored — the con edition and the policy each save whole — so the
    // tab stays closed until both reads succeed.
    if (configFailed || policyFailed) {
        return (
            <div className="admin-section">
                <h3 className="admin-badges-title">
                    {isEnglish ? 'Could not load site config' : '无法加载网站配置'}
                </h3>
                <p className="admin-helper-text">
                    {isEnglish
                        ? 'The saved settings could not be read, so this tab would be showing the site’s built-in defaults. Reload the page before editing — saving now would overwrite what is stored.'
                        : '无法读取已保存的设置，此标签页显示的将是网站内置的默认值。请重新加载页面后再编辑——此时保存会覆盖已存储的内容。'}
                </p>
            </div>
        );
    }

    const previewBvid = parseBvid(bvidInput) || BILIBILI_VIDEO.bvid;
    const defaultSender = senderSettings && `${senderSettings.defaultPrefix}@${senderSettings.domain}`;

    return (
        <>
            <div id="admin-sec-video" className="admin-section">
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
                            className="admin-input"
                            type="text"
                            value={bvidInput}
                            onChange={e => !readOnly && setBvidInput(e.target.value)}
                            readOnly={readOnly}
                            placeholder="BV1GsfjB7E6J or https://www.bilibili.com/video/BV..."
                        />
                        <span className="admin-helper-text" style={{marginTop: 4, display: 'block'}}>
                            {isEnglish ? 'Will link to: ' : '将跳转至：'}
                            <code>https://www.bilibili.com/video/{previewBvid}</code>
                        </span>
                    </label>
                    <div>
                        <span style={{fontSize: 13, fontWeight: 600, color: 'var(--color-text)'}}>
                            {isEnglish ? 'Cover Preview' : '封面预览'}
                        </span>
                        {config.bilibiliVideoCoverUrl
                            ? <img
                                className="admin-video-cover-preview"
                                src={config.bilibiliVideoCoverUrl}
                                alt={isEnglish ? 'Video cover' : '视频封面'}
                            />
                            : <div className="admin-video-cover-placeholder">
                                {isEnglish ? 'Cover will appear after saving' : '保存后将显示封面'}
                            </div>
                        }
                    </div>
                </div>
                {!readOnly && (
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
                    </div>
                )}
            </div>

            <div className="admin-divider"/>

            <div id="admin-sec-contact" className="admin-section">
                <h3 className="admin-badges-title">
                    {isEnglish ? 'Contact Email' : '联系邮箱'}
                </h3>
                <p className="admin-helper-text">
                    {isEnglish
                        ? 'Where the site\'s "Contact Us" and "Email us" links send visitors, on the home page and the con page. Leave it blank to hide those links.'
                        : '主页和漫展页面上「联系我们」「发邮件」等链接所使用的邮箱。留空则隐藏这些链接。'}
                </p>
                <div className="admin-form-grid admin-mt-12">
                    <label>
                        <span>{isEnglish ? 'Email' : '邮箱'}</span>
                        <input
                            className="admin-input"
                            type="email"
                            value={emailInput}
                            onChange={e => !readOnly && setEmailInput(e.target.value)}
                            readOnly={readOnly}
                            placeholder="name@example.com"
                        />
                    </label>
                </div>
                {!readOnly && (
                    <div className="admin-btn-row admin-mt-12">
                        <button
                            className="admin-toggle-btn admin-toggle-save"
                            onClick={saveEmail}
                            disabled={savingEmail || emailInput.trim().toLowerCase() === config.contactEmail}
                        >
                            {savingEmail
                                ? (isEnglish ? 'Saving...' : '保存中...')
                                : (isEnglish ? 'Save Email' : '保存邮箱')}
                        </button>
                    </div>
                )}
            </div>

            <div className="admin-divider"/>

            <div id="admin-sec-sender" className="admin-section">
                <h3 className="admin-badges-title">
                    {isEnglish ? 'Sender Email' : '发件邮箱'}
                </h3>
                <p className="admin-helper-text">
                    {isEnglish
                        ? `The part before the @ in the From address on every email the site sends, such as tickets. Leave it blank to send from ${defaultSender ?? 'the default address'}.`
                        : `网站发出的所有邮件（如门票）的发件地址中 @ 之前的部分。留空则使用 ${defaultSender ?? '默认地址'} 发送。`}
                </p>
                <div className="admin-form-grid admin-mt-12">
                    <label>
                        <span>{isEnglish ? 'Prefix' : '前缀'}</span>
                        <div className="admin-input-affix">
                            <input
                                className="admin-input"
                                type="text"
                                value={senderInput}
                                onChange={e => !readOnly && setSenderInput(e.target.value)}
                                readOnly={readOnly}
                                placeholder={senderSettings?.defaultPrefix}
                            />
                            {senderSettings && <span>@{senderSettings.domain}</span>}
                        </div>
                    </label>
                </div>
                {!readOnly && (
                    <div className="admin-btn-row admin-mt-12">
                        <button
                            className="admin-toggle-btn admin-toggle-save"
                            onClick={saveSender}
                            disabled={savingSender || senderInput.trim().toLowerCase() === config.senderPrefix}
                        >
                            {savingSender
                                ? (isEnglish ? 'Saving...' : '保存中...')
                                : (isEnglish ? 'Save Sender' : '保存发件邮箱')}
                        </button>
                    </div>
                )}
            </div>

            <div className="admin-divider"/>

            <div id="admin-sec-team">
                <TeamSection refreshConfig={refreshConfig} showToast={showToast} readOnly={readOnly}/>
            </div>

            <div className="admin-divider"/>

            <div id="admin-sec-con-edition">
                <ConEditionSection conEdition={config.conEdition} refreshConfig={refreshConfig}
                                   showToast={showToast} readOnly={readOnly}/>
            </div>

            <div className="admin-divider"/>

            <div id="admin-sec-policy" className="admin-section">
                <h3 className="admin-badges-title">
                    {isEnglish ? 'Policy Content' : '政策内容'}
                </h3>
                <p className="admin-helper-text">
                    {isEnglish
                        ? 'This content is displayed on the public Policy page. Write it in Markdown.'
                        : '此内容显示在公开政策页面上，请使用 Markdown 编写。'}
                </p>
                <div className="admin-form-grid admin-mt-12">
                    {previewingPolicy ? (
                        <>
                            <PolicyPreview label={isEnglish ? 'Content (English)' : '内容（英文）'} content={contentEn}/>
                            <PolicyPreview label={isEnglish ? 'Content (Chinese)' : '内容（中文）'} content={contentCn}/>
                        </>
                    ) : (
                        <>
                            <label>
                                <span>{isEnglish ? 'Content (English)' : '内容（英文）'}</span>
                                <textarea
                                    className="admin-input policy-textarea"
                                    value={contentEn}
                                    onChange={e => !readOnly && setContentEn(e.target.value)}
                                    readOnly={readOnly}
                                    placeholder={isEnglish ? 'Enter policy content in English (Markdown)...' : '请输入英文政策内容（Markdown）...'}
                                />
                            </label>
                            <label>
                                <span>{isEnglish ? 'Content (Chinese)' : '内容（中文）'}</span>
                                <textarea
                                    className="admin-input policy-textarea"
                                    value={contentCn}
                                    onChange={e => !readOnly && setContentCn(e.target.value)}
                                    readOnly={readOnly}
                                    placeholder={isEnglish ? 'Enter policy content in Chinese (Markdown)...' : '请输入中文政策内容（Markdown）...'}
                                />
                            </label>
                        </>
                    )}
                </div>
                <div className="admin-btn-row admin-mt-12">
                    {!readOnly && (
                        <button
                            className="admin-toggle-btn admin-toggle-save"
                            onClick={savePolicy}
                            disabled={savingPolicy}
                        >
                            {savingPolicy
                                ? (isEnglish ? 'Saving...' : '保存中...')
                                : (isEnglish ? 'Save Policy' : '保存政策')}
                        </button>
                    )}
                    <button
                        className="admin-toggle-btn admin-toggle-edit"
                        onClick={() => setPreviewingPolicy(p => !p)}
                        aria-pressed={previewingPolicy}
                    >
                        {previewingPolicy
                            ? (isEnglish ? 'Show Markdown' : '显示 Markdown')
                            : (isEnglish ? 'Preview' : '预览')}
                    </button>
                </div>
            </div>

            <SectionNav
                sections={[
                    {id: 'admin-sec-video', label: isEnglish ? 'Featured Video' : '精选视频'},
                    {id: 'admin-sec-contact', label: isEnglish ? 'Contact Email' : '联系邮箱'},
                    {id: 'admin-sec-sender', label: isEnglish ? 'Sender Email' : '发件邮箱'},
                    {id: 'admin-sec-team', label: isEnglish ? 'Our Team' : '我们的团队'},
                    {id: 'admin-sec-con-edition', label: isEnglish ? 'Sekai Beyond Con' : '彼世界动漫游戏展'},
                    {id: 'admin-sec-policy', label: isEnglish ? 'Policy Content' : '政策内容'},
                ]}
            />
        </>
    );
};
