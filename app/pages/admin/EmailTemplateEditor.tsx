import { type ReactNode, useEffect, useState } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { useLanguage } from '~/components/LanguageContextProvider';
import { toDate } from '~/lib/collectionCache';
import { errorSuffix, getFirebaseDb } from '~/lib/firebase';
import { useSiteConfig } from '~/lib/siteConfig';
import { ModalShell } from './ModalShell';
import { usesContactEmail } from './tickets/helpers';
import type { EmailTemplate } from './tickets/types';
import type { ShowToast } from './utils';

const EMPTY: EmailTemplate = {subject: '', bodyHtml: '', updatedAt: null};

type TemplateFields = Pick<EmailTemplate, 'subject' | 'bodyHtml'>;

interface UseEmailTemplateOptions {
    path: string;
    defaultSubject: string;
    defaultBody: string;
    write: (template: TemplateFields) => Promise<unknown>;
    showToast: ShowToast;
    onUnsavedChange: (unsaved: boolean) => void;
}

type EmailTemplateState = ReturnType<typeof useEmailTemplate>;

export function useEmailTemplate({
                                     path,
                                     defaultSubject,
                                     defaultBody,
                                     write,
                                     showToast,
                                     onUnsavedChange,
                                 }: UseEmailTemplateOptions) {
    const {isEnglish} = useLanguage();
    const [template, setTemplate] = useState<EmailTemplate>(EMPTY);
    const [saved, setSaved] = useState<EmailTemplate>(EMPTY);
    const [loading, setLoading] = useState(true);
    const [loadFailed, setLoadFailed] = useState(false);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        let cancelled = false;
        const load = async () => {
            setLoading(true);
            setLoadFailed(false);
            try {
                const data = (await getDoc(doc(getFirebaseDb(), path))).data();
                if (cancelled) return;
                if (data) {
                    const stored: EmailTemplate = {
                        subject: data.subject ?? '',
                        bodyHtml: data.bodyHtml ?? '',
                        updatedAt: toDate(data.updatedAt),
                    };
                    setTemplate(stored);
                    setSaved(stored);
                } else {
                    setTemplate({subject: defaultSubject, bodyHtml: defaultBody, updatedAt: null});
                    setSaved(EMPTY);
                }
            } catch (err) {
                console.error(`[email template] load ${path}`, err);
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
    }, [path, defaultSubject, defaultBody, showToast]);

    const isDirty = template.subject !== saved.subject || template.bodyHtml !== saved.bodyHtml;

    useEffect(() => {
        onUnsavedChange(isDirty);
    }, [isDirty, onUnsavedChange]);

    const isAtDefault = template.subject === defaultSubject && template.bodyHtml === defaultBody;

    const resetToDefault = () => {
        if (isAtDefault) return;
        const ok = window.confirm(isEnglish
            ? 'Reset the template fields to the default content? Unsaved changes will be lost. (You still need to click Save to persist.)'
            : '将模板内容恢复为默认值？未保存的修改将丢失。（仍需点击保存才会生效。）');
        if (!ok) return;
        setTemplate(t => ({...t, subject: defaultSubject, bodyHtml: defaultBody}));
    };

    const save = async () => {
        if (!isDirty) return;
        if (!template.subject.trim()) {
            showToast(isEnglish ? 'Subject is required.' : '邮件主题必填。', 'error');
            return;
        }
        setSaving(true);
        try {
            await write({subject: template.subject, bodyHtml: template.bodyHtml});
            setSaved({...template, updatedAt: new Date()});
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

    return {template, setTemplate, saved, loading, loadFailed, saving, isDirty, isAtDefault, resetToDefault, save};
}

export const formatSavedAt = (date: Date, isEnglish: boolean): string =>
    date.toLocaleString(isEnglish ? 'en-US' : 'zh-CN', {
        year: 'numeric', month: 'short', day: 'numeric',
        hour: '2-digit', minute: '2-digit',
    });

type RenderPreview = (template: EmailTemplate, contactEmail: string) => {subject: string; html: string};

export function EmailTemplateSection({editor, failedText, status, placeholders, warning, footer, readOnly, renderPreview}: {
    editor: EmailTemplateState;
    failedText: string;
    status?: ReactNode;
    placeholders: string;
    warning?: ReactNode;
    footer?: ReactNode;
    readOnly?: boolean;
    renderPreview: RenderPreview;
}) {
    const {isEnglish} = useLanguage();
    const {config} = useSiteConfig();

    if (editor.loading) return <div className="spinner spinner-centered"/>;
    if (editor.loadFailed) return <p className="admin-no-results">{failedText}</p>;

    return (
        <div className="admin-tickets-template">
            <h3>{isEnglish ? 'Email template' : '邮件模板'}</h3>
            {status}
            <p className="admin-helper-text">{placeholders}</p>
            {warning}
            {!config.contactEmail && usesContactEmail(editor.template) && (
                <p className="admin-helper-text admin-tickets-edit-warning">
                    {isEnglish
                        ? 'This template uses {{ contactEmail }}, but Site Config has no Contact Email. Sending is refused until one is set.'
                        : '此模板使用了 {{ contactEmail }}，但网站设置中尚未填写联系邮箱。填写之前将无法发送。'}
                </p>
            )}
            <EmailTemplateFields
                editor={editor}
                readOnly={readOnly}
                renderPreview={template => renderPreview(template, config.contactEmail)}
            />
            {footer}
        </div>
    );
}

function EmailTemplateFields({editor, readOnly = false, renderPreview}: {
    editor: EmailTemplateState;
    readOnly?: boolean;
    renderPreview: (template: EmailTemplate) => {subject: string; html: string};
}) {
    const {isEnglish} = useLanguage();
    const [showPreview, setShowPreview] = useState(false);
    const {template, setTemplate, saving, isDirty, isAtDefault, save, resetToDefault} = editor;
    const preview = showPreview ? renderPreview(template) : null;

    return (
        <>
            <label className="admin-tickets-template-field">
                <span>{isEnglish ? 'Subject' : '邮件主题'}</span>
                <input
                    type="text"
                    className="admin-input"
                    value={template.subject}
                    onChange={(e) => setTemplate(t => ({...t, subject: e.target.value}))}
                    maxLength={500}
                    readOnly={readOnly}
                />
            </label>

            <label className="admin-tickets-template-field">
                <span>{isEnglish ? 'Body (HTML)' : '正文（HTML）'}</span>
                <textarea
                    className="admin-tickets-template-textarea"
                    value={template.bodyHtml}
                    onChange={(e) => setTemplate(t => ({...t, bodyHtml: e.target.value}))}
                    maxLength={20000}
                    readOnly={readOnly}
                    rows={10}
                />
            </label>

            <div className="admin-btn-row">
                <button
                    className="admin-toggle-btn admin-toggle-save"
                    onClick={save}
                    disabled={readOnly || saving || !isDirty}
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
                    disabled={readOnly || saving || isAtDefault}
                    title={isEnglish ? 'Restore the default template content' : '恢复默认模板内容'}
                >
                    {isEnglish ? 'Reset to Default' : '恢复默认'}
                </button>
            </div>

            {preview && (
                <ModalShell
                    title={isEnglish ? 'Preview' : '预览'}
                    onClose={() => setShowPreview(false)}
                >
                    <div className="admin-tickets-preview-subject">
                        <strong>{isEnglish ? 'Subject: ' : '主题：'}</strong>
                        {preview.subject}
                    </div>
                    <div
                        className="admin-tickets-preview-body"
                        dangerouslySetInnerHTML={{__html: preview.html}}
                    />
                </ModalShell>
            )}
        </>
    );
}
