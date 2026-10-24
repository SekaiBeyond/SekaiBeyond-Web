import { useEffect, useState } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { useLanguage } from '~/components/LanguageContextProvider';
import { callUpdatePassportEmailTemplate, errorSuffix, getFirebaseDb } from '~/lib/firebase';
import type { PassportDesign } from '~/lib/passports';
import { useSiteConfig } from '~/lib/siteConfig';
import { ModalShell } from '../ModalShell';
import { tsToDate } from '../tickets/helpers';
import type { ShowToast } from '../utils';
import {
    carriesKey,
    DEFAULT_PASSPORT_EMAIL_BODY,
    DEFAULT_PASSPORT_EMAIL_SUBJECT,
    type PassportEmailTemplate,
    renderPassportSamplePreview,
    renderPassportSampleSubject,
    usesContactEmail,
} from './passportEmail';

interface PassportEmailTemplateSectionProps {
    /** What the preview fills the design placeholders from. */
    design: PassportDesign | undefined;
    showToast: ShowToast;
    onUnsavedChange: (unsaved: boolean) => void;
}

const EMPTY: PassportEmailTemplate = {subject: '', bodyHtml: '', updatedAt: null};

/**
 * The one email every passport key goes out in, whatever the design. Like the
 * ticket template: emailPassports sends only what's saved here, never the
 * default.
 */
export function PassportEmailTemplateSection({design, showToast, onUnsavedChange}: PassportEmailTemplateSectionProps) {
    const {isEnglish} = useLanguage();
    const {config} = useSiteConfig();
    const [template, setTemplate] = useState<PassportEmailTemplate>(EMPTY);
    const [initialTemplate, setInitialTemplate] = useState<PassportEmailTemplate>(EMPTY);
    const [loading, setLoading] = useState(true);
    const [loadFailed, setLoadFailed] = useState(false);
    const [saving, setSaving] = useState(false);
    const [showPreview, setShowPreview] = useState(false);

    const origin = typeof window !== 'undefined' ? window.location.origin : '';

    useEffect(() => {
        let cancelled = false;
        const load = async () => {
            setLoading(true);
            setLoadFailed(false);
            try {
                const snap = await getDoc(doc(getFirebaseDb(), 'passportEmailTemplate', 'default'));
                if (cancelled) return;
                if (snap.exists()) {
                    const data = snap.data();
                    const saved: PassportEmailTemplate = {
                        subject: (data.subject as string) ?? '',
                        bodyHtml: (data.bodyHtml as string) ?? '',
                        updatedAt: tsToDate(data.updatedAt),
                    };
                    setTemplate(saved);
                    setInitialTemplate(saved);
                } else {
                    // The default to start from, unsaved, so Save stays enabled.
                    setTemplate({
                        subject: DEFAULT_PASSPORT_EMAIL_SUBJECT,
                        bodyHtml: DEFAULT_PASSPORT_EMAIL_BODY,
                        updatedAt: null,
                    });
                    setInitialTemplate(EMPTY);
                }
            } catch (err) {
                console.error('[passport email template] load', err);
                if (!cancelled) setLoadFailed(true);
                showToast(
                    isEnglish
                        ? `Failed to load the email template${errorSuffix(err, true)}.`
                        : `加载邮件模板失败${errorSuffix(err, false)}。`,
                    'error',
                );
            } finally {
                if (!cancelled) setLoading(false);
            }
        };
        void load();
        return () => {
            cancelled = true;
        };
        // Not keyed on isEnglish: a toggle would reload over unsaved edits.
    }, [showToast]);

    const isDirty = template.subject !== initialTemplate.subject
        || template.bodyHtml !== initialTemplate.bodyHtml;

    useEffect(() => {
        onUnsavedChange(isDirty);
    }, [isDirty, onUnsavedChange]);

    const isAtDefault = template.subject === DEFAULT_PASSPORT_EMAIL_SUBJECT
        && template.bodyHtml === DEFAULT_PASSPORT_EMAIL_BODY;

    const resetToDefault = () => {
        if (isAtDefault) return;
        const ok = window.confirm(isEnglish
            ? 'Reset the template fields to the default content? Unsaved changes will be lost. (You still need to click Save to persist.)'
            : '将模板内容恢复为默认值？未保存的修改将丢失。（仍需点击保存才会生效。）');
        if (!ok) return;
        setTemplate(t => ({...t, subject: DEFAULT_PASSPORT_EMAIL_SUBJECT, bodyHtml: DEFAULT_PASSPORT_EMAIL_BODY}));
    };

    const save = async () => {
        if (!isDirty) return;
        if (!template.subject.trim()) {
            showToast(isEnglish ? 'Subject is required.' : '邮件主题必填。', 'error');
            return;
        }
        setSaving(true);
        try {
            await callUpdatePassportEmailTemplate({subject: template.subject, bodyHtml: template.bodyHtml});
            setInitialTemplate({...template, updatedAt: new Date()});
            showToast(isEnglish ? 'Template saved.' : '模板已保存。', 'success');
        } catch (err) {
            showToast(isEnglish
                    ? `Failed to save template${errorSuffix(err, true)}.`
                    : `保存模板失败${errorSuffix(err, false)}。`,
                'error');
        } finally {
            setSaving(false);
        }
    };

    if (loading) {
        return <div className="spinner spinner-centered"/>;
    }

    // No editor after a failed read, so the stored template can't be saved over.
    if (loadFailed) {
        return (
            <p className="admin-no-results">
                {isEnglish
                    ? 'Could not load the passport email template. Reload the page before editing it.'
                    : '无法加载通行证邮件模板。请重新加载页面后再编辑。'}
            </p>
        );
    }

    return (
        <div className="admin-tickets-template">
            <h3>{isEnglish ? 'Email template' : '邮件模板'}</h3>
            <p className="admin-helper-text">
                {isEnglish
                    ? 'Supported placeholders: {{ activationCode }} (the key, as XXXX-XXXX-XXXX), {{ activateUrl }} (a link that opens Redeem Code with the key filled in; use it as a button’s href), {{ designName }}, {{ designNameCn }}, {{ year }}, {{ termDays }} (days of membership it grants), {{ passportCover }} (renders the design’s cover art as <img>), {{ recipientEmail }}, {{ contactEmail }} (the Contact Email in Site Config; also works in mailto: links).'
                    : '可用占位符：{{ activationCode }}（激活码，格式为 XXXX-XXXX-XXXX）、{{ activateUrl }}（打开「兑换激活码」并已填好激活码的链接，可作为按钮的 href）、{{ designName }}、{{ designNameCn }}、{{ year }}、{{ termDays }}（授予的会员天数）、{{ passportCover }}（将设计封面作为 <img> 渲染）、{{ recipientEmail }}、{{ contactEmail }}（网站设置中的联系邮箱，也可用于 mailto: 链接）。'}
            </p>

            {!carriesKey(template) && (
                <p className="admin-helper-text admin-tickets-edit-warning">
                    {isEnglish
                        ? 'This template has neither {{ activationCode }} nor {{ activateUrl }}, so no one could activate the passport it sends. Sending is refused until it has one.'
                        : '此模板既没有 {{ activationCode }} 也没有 {{ activateUrl }}，收件人将无法激活通行证。加入其中之一之前将无法发送。'}
                </p>
            )}

            {!config.contactEmail && usesContactEmail(template) && (
                <p className="admin-helper-text admin-tickets-edit-warning">
                    {isEnglish
                        ? 'This template uses {{ contactEmail }}, but Site Config has no Contact Email. Sending is refused until one is set.'
                        : '此模板使用了 {{ contactEmail }}，但网站设置中尚未填写联系邮箱。填写之前将无法发送。'}
                </p>
            )}

            <label className="admin-tickets-template-field">
                <span>{isEnglish ? 'Subject' : '邮件主题'}</span>
                <input
                    type="text"
                    className="admin-input"
                    value={template.subject}
                    onChange={(e) => setTemplate(t => ({...t, subject: e.target.value}))}
                    maxLength={500}
                />
            </label>

            <label className="admin-tickets-template-field">
                <span>{isEnglish ? 'Body (HTML)' : '正文（HTML）'}</span>
                <textarea
                    className="admin-tickets-template-textarea"
                    value={template.bodyHtml}
                    onChange={(e) => setTemplate(t => ({...t, bodyHtml: e.target.value}))}
                    maxLength={20000}
                    rows={10}
                />
            </label>

            <div className="admin-btn-row">
                <button
                    className="admin-toggle-btn admin-toggle-save"
                    onClick={save}
                    disabled={saving || !isDirty}
                >
                    {saving
                        ? (isEnglish ? 'Saving...' : '保存中...')
                        : (isEnglish ? 'Save Template' : '保存模板')}
                </button>
                <button
                    className="admin-toggle-btn admin-toggle-edit"
                    onClick={() => setShowPreview(true)}
                >
                    {isEnglish ? 'Preview' : '预览'}
                </button>
                <button
                    className="admin-toggle-btn admin-toggle-cancel"
                    onClick={resetToDefault}
                    disabled={saving || isAtDefault}
                    title={isEnglish ? 'Restore the default template content' : '恢复默认模板内容'}
                >
                    {isEnglish ? 'Reset to Default' : '恢复默认'}
                </button>
            </div>

            {initialTemplate.updatedAt && (
                <p className="admin-helper-text">
                    {isEnglish ? 'Last saved: ' : '上次保存：'}
                    {initialTemplate.updatedAt.toLocaleString(isEnglish ? 'en-US' : 'zh-CN', {
                        year: 'numeric', month: 'short', day: 'numeric',
                        hour: '2-digit', minute: '2-digit',
                    })}
                </p>
            )}

            {showPreview && (
                <ModalShell
                    title={isEnglish ? 'Preview' : '预览'}
                    onClose={() => setShowPreview(false)}
                >
                    <div className="admin-tickets-preview-subject">
                        <strong>{isEnglish ? 'Subject: ' : '主题：'}</strong>
                        {renderPassportSampleSubject(template, design, config.contactEmail, origin)}
                    </div>
                    <div
                        className="admin-tickets-preview-body"
                        dangerouslySetInnerHTML={{
                            __html: renderPassportSamplePreview(template, design, config.contactEmail, origin),
                        }}
                    />
                </ModalShell>
            )}
        </div>
    );
}
