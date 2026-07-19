import { useEffect, useState } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { useLanguage } from '~/components/LanguageContextProvider';
import { callUpdateEventEmailTemplate, getFirebaseDb } from '~/lib/firebase';
import { ModalShell } from '../ModalShell';
import type { UpcomingEvent } from '~/lib/upcomingEvents';
import type { ShowToast } from '../utils';
import { DEFAULT_TEMPLATE_BODY_EN, DEFAULT_TEMPLATE_SUBJECT, renderSamplePreview, tsToDate, } from './helpers';
import type { EmailTemplate } from './types';

interface TemplateSectionProps {
    event: UpcomingEvent;
    readOnly: boolean;
    showToast: ShowToast;
}

export function TemplateSection({event, readOnly, showToast}: TemplateSectionProps) {
    const {isEnglish} = useLanguage();
    const [template, setTemplate] = useState<EmailTemplate>({
        subject: '', bodyHtml: '', bodyCnHtml: '', updatedAt: null, updatedBy: '',
    });
    const [initialTemplate, setInitialTemplate] = useState<EmailTemplate>({
        subject: '', bodyHtml: '', bodyCnHtml: '', updatedAt: null, updatedBy: '',
    });
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [showPreview, setShowPreview] = useState(false);

    useEffect(() => {
        let cancelled = false;
        const load = async () => {
            setLoading(true);
            try {
                const db = getFirebaseDb();
                const snap = await getDoc(
                    doc(db, 'upcomingEvents', event.id, 'emailTemplate', 'default'),
                );
                if (cancelled) return;
                if (snap.exists()) {
                    const data = snap.data();
                    // bodyCnHtml is intentionally dropped from the editor — the
                    // template UI is English-only. Any legacy CN content is
                    // cleared on the next save (see save() below).
                    const t: EmailTemplate = {
                        subject: (data.subject as string) ?? '',
                        bodyHtml: (data.bodyHtml as string) ?? '',
                        bodyCnHtml: '',
                        updatedAt: tsToDate(data.updatedAt),
                        updatedBy: (data.updatedBy as string) ?? '',
                    };
                    setTemplate(t);
                    setInitialTemplate(t);
                } else {
                    // No saved template yet: pre-fill the editor with defaults so
                    // the admin can save-as-is or tweak. initialTemplate stays
                    // empty so isDirty=true and Save is enabled.
                    setTemplate({
                        subject: DEFAULT_TEMPLATE_SUBJECT,
                        bodyHtml: DEFAULT_TEMPLATE_BODY_EN,
                        bodyCnHtml: '',
                        updatedAt: null,
                        updatedBy: '',
                    });
                    setInitialTemplate({
                        subject: '', bodyHtml: '', bodyCnHtml: '', updatedAt: null, updatedBy: '',
                    });
                }
            } catch (err) {
                console.error('[template] load', err);
                showToast(
                    isEnglish ? 'Failed to load template.' : '加载模板失败。',
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
    }, [event.id, isEnglish, showToast]);

    const isDirty = template.subject !== initialTemplate.subject
        || template.bodyHtml !== initialTemplate.bodyHtml;

    const isAtDefault = template.subject === DEFAULT_TEMPLATE_SUBJECT
        && template.bodyHtml === DEFAULT_TEMPLATE_BODY_EN;

    const resetToDefault = () => {
        if (readOnly) return;
        if (isAtDefault) return;
        const ok = window.confirm(isEnglish
            ? 'Reset the template fields to the default content? Unsaved changes will be lost. (You still need to click Save to persist.)'
            : '将模板内容恢复为默认值？未保存的修改将丢失。（仍需点击保存才会生效。）');
        if (!ok) return;
        setTemplate(t => ({
            ...t,
            subject: DEFAULT_TEMPLATE_SUBJECT,
            bodyHtml: DEFAULT_TEMPLATE_BODY_EN,
        }));
    };

    const save = async () => {
        if (readOnly || !isDirty) return;
        if (!template.subject.trim()) {
            showToast(isEnglish ? 'Subject is required.' : '邮件主题必填。', 'error');
            return;
        }
        setSaving(true);
        try {
            await callUpdateEventEmailTemplate({
                eventId: event.id,
                subject: template.subject,
                bodyHtml: template.bodyHtml,
                bodyCnHtml: '',
            });
            setInitialTemplate({...template, updatedAt: new Date()});
            showToast(isEnglish ? 'Template saved.' : '模板已保存。', 'success');
        } catch {
            showToast(isEnglish ? 'Failed to save template.' : '保存模板失败。', 'error');
        } finally {
            setSaving(false);
        }
    };

    if (loading) {
        return <div className="profile-spinner admin-spinner-center"/>;
    }

    return (
        <div className="admin-tickets-template">
            <p className="admin-helper-text">
                {isEnglish
                    ? 'Supported placeholders: {{ attendeeName }}, {{ attendeeEmail }}, {{ eventTitle }}, {{ eventDate }}, {{ eventHeader }} (renders cropped header image as <img>), {{ ticketCount }}, {{ ticketIds[] }} (renders one QR per ticket).'
                    : '可用占位符：{{ attendeeName }}、{{ attendeeEmail }}、{{ eventTitle }}、{{ eventDate }}、{{ eventHeader }}（将裁剪的页眉图作为 <img> 渲染）、{{ ticketCount }}、{{ ticketIds[] }}（为每张门票渲染一个二维码）。'}
            </p>

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
                        {template.subject.replace(/{{\s*eventTitle\s*}}/g, event.title)
                            .replace(/{{\s*eventTitleCn\s*}}/g, event.titleCn)
                            .replace(/{{\s*attendeeName\s*}}/g, 'Sample Attendee')}
                    </div>
                    <div
                        className="admin-tickets-preview-body"
                        dangerouslySetInnerHTML={{__html: renderSamplePreview(template, event)}}
                    />
                </ModalShell>
            )}
        </div>
    );
}
