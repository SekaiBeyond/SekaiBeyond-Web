import { useEffect, useState } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { useLanguage } from '~/components/LanguageContextProvider';
import { toDate } from '~/lib/collectionCache';
import { errorSuffix, getFirebaseDb } from '~/lib/firebase';
import { ModalShell } from './ModalShell';
import type { EmailTemplate } from './tickets/types';
import type { ShowToast } from './utils';

const EMPTY: EmailTemplate = {subject: '', bodyHtml: '', updatedAt: null};

type TemplateFields = Pick<EmailTemplate, 'subject' | 'bodyHtml'>;

interface UseEmailTemplateOptions {
    /** The template's doc. */
    path: string;
    /** What the fields start from while nothing is saved. Never sent in its place. */
    defaultSubject: string;
    defaultBody: string;
    /** Saves the fields; they read as saved once it resolves. */
    write: (template: TemplateFields) => Promise<unknown>;
    showToast: ShowToast;
    onUnsavedChange: (unsaved: boolean) => void;
}

type EmailTemplateState = ReturnType<typeof useEmailTemplate>;

/** A stored email template being edited: read once, then saved through `write`. */
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
    // What's stored, for the dirty check and the saved status.
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
                    // The default to start from, unsaved, so Save stays enabled.
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
        // Not keyed on isEnglish: a toggle would reload over unsaved edits.
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

/** "Mar 3, 2026, 04:05 PM": when a template was last saved. */
export const formatSavedAt = (date: Date, isEnglish: boolean): string =>
    date.toLocaleString(isEnglish ? 'en-US' : 'zh-CN', {
        year: 'numeric', month: 'short', day: 'numeric',
        hour: '2-digit', minute: '2-digit',
    });

interface EmailTemplateFieldsProps {
    editor: EmailTemplateState;
    readOnly?: boolean;
    /** The template filled in for a sample recipient, worked out only when the preview opens. */
    renderPreview: (template: EmailTemplate) => {subject: string; html: string};
}

/** The subject and body, Save, Preview and Reset to Default. */
export function EmailTemplateFields({editor, readOnly = false, renderPreview}: EmailTemplateFieldsProps) {
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
