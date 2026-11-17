import { useEffect } from 'react';
import { useLanguage } from '~/components/LanguageContextProvider';
import { callUpdateEventEmailTemplate } from '~/lib/firebase';
import type { UpcomingEvent } from '~/lib/upcomingEvents';
import { Banner } from '../Banner';
import { EmailTemplateSection, formatSavedAt, useEmailTemplate } from '../EmailTemplateEditor';
import type { ShowToast } from '../utils';
import {
    DEFAULT_TEMPLATE_BODY_EN,
    DEFAULT_TEMPLATE_SUBJECT,
    isTemplateSaved,
    renderSamplePreview,
    renderSampleSubject,
} from './helpers';

interface TemplateSectionProps {
    event: UpcomingEvent;
    readOnly: boolean;
    showToast: ShowToast;
    onUnsavedChange: (unsaved: boolean) => void;
    onSavedChange: (saved: boolean) => void;
    walletButton: boolean;
}

export function TemplateSection({
                                    event,
                                    readOnly,
                                    showToast,
                                    onUnsavedChange,
                                    onSavedChange,
                                    walletButton,
                                }: TemplateSectionProps) {
    const {isEnglish} = useLanguage();
    const editor = useEmailTemplate({
        path: `upcomingEvents/${event.id}/emailTemplate/default`,
        defaultSubject: DEFAULT_TEMPLATE_SUBJECT,
        defaultBody: DEFAULT_TEMPLATE_BODY_EN,
        write: template => callUpdateEventEmailTemplate({eventId: event.id, ...template}),
        showToast,
        onUnsavedChange,
    });
    const {loading, loadFailed} = editor;

    const saved = isTemplateSaved(editor.saved);

    useEffect(() => {
        if (!loading && !loadFailed) onSavedChange(saved);
    }, [loading, loadFailed, saved, onSavedChange]);

    return (
        <EmailTemplateSection
            editor={editor}
            readOnly={readOnly}
            failedText={isEnglish
                ? 'Could not load this event’s email template. Reload the page before editing it.'
                : '无法加载此活动的邮件模板。请重新加载页面后再编辑。'}
            status={saved ? (
                <p className="admin-helper-text">
                    {isEnglish ? 'Saved' : '已保存'}
                    {editor.saved.updatedAt && `${isEnglish ? ': ' : '：'}${formatSavedAt(editor.saved.updatedAt, isEnglish)}`}
                </p>
            ) : (
                <Banner tone="warning">
                    <strong>{isEnglish ? 'Not saved yet.' : '尚未保存。'}</strong>
                    <p>
                        {isEnglish
                            ? 'The default is filled in below. Until a template is saved, no ticket email goes out for this event, and ticket API orders that ask for one are refused. Save it as it is, or edit it first.'
                            : '下方已填入默认模板。保存模板之前，此活动不会发出任何门票邮件，要求发送邮件的门票 API 订单也会被拒绝。可直接保存，也可修改后保存。'}
                    </p>
                </Banner>
            )}
            placeholders={isEnglish
                ? 'Supported placeholders: {{ attendeeName }}, {{ attendeeEmail }}, {{ eventTitle }}, {{ eventDate }}, {{ eventHeader }} (renders cropped header image as <img>), {{ ticketCount }}, {{ ticketIds[] }} (renders one QR per ticket), {{ contactEmail }} (the Contact Email in Site Config; also works in mailto: links).'
                : '可用占位符：{{ attendeeName }}、{{ attendeeEmail }}、{{ eventTitle }}、{{ eventDate }}、{{ eventHeader }}（将裁剪的页眉图作为 <img> 渲染）、{{ ticketCount }}、{{ ticketIds[] }}（为每张门票渲染一个二维码）、{{ contactEmail }}（网站设置中的联系邮箱，也可用于 mailto: 链接）。'}
            renderPreview={(template, contactEmail) => ({
                subject: renderSampleSubject(template, event, contactEmail),
                html: renderSamplePreview(template, event, contactEmail, walletButton),
            })}
        />
    );
}
