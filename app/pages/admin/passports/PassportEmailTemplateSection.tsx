import { useLanguage } from '~/components/LanguageContextProvider';
import { callUpdatePassportEmailTemplate } from '~/lib/firebase';
import type { PassportDesign } from '~/lib/passports';
import { useSiteConfig } from '~/lib/siteConfig';
import { EmailTemplateFields, formatSavedAt, useEmailTemplate } from '../EmailTemplateEditor';
import { usesContactEmail } from '../tickets/helpers';
import type { ShowToast } from '../utils';
import {
    carriesKey,
    DEFAULT_PASSPORT_EMAIL_BODY,
    DEFAULT_PASSPORT_EMAIL_SUBJECT,
    renderPassportSamplePreview,
    renderPassportSampleSubject,
} from './passportEmail';

interface PassportEmailTemplateSectionProps {
    /** What the preview fills the design placeholders from. */
    design: PassportDesign | undefined;
    showToast: ShowToast;
    onUnsavedChange: (unsaved: boolean) => void;
}

/**
 * The one email every passport key goes out in, whatever the design. Like the
 * ticket template: emailPassports sends only what's saved here, never the
 * default.
 */
export function PassportEmailTemplateSection({design, showToast, onUnsavedChange}: PassportEmailTemplateSectionProps) {
    const {isEnglish} = useLanguage();
    const {config} = useSiteConfig();
    const editor = useEmailTemplate({
        path: 'passportEmailTemplate/default',
        defaultSubject: DEFAULT_PASSPORT_EMAIL_SUBJECT,
        defaultBody: DEFAULT_PASSPORT_EMAIL_BODY,
        write: callUpdatePassportEmailTemplate,
        showToast,
        onUnsavedChange,
    });
    const {template, saved, loading, loadFailed} = editor;

    const origin = typeof window !== 'undefined' ? window.location.origin : '';

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

            <EmailTemplateFields
                editor={editor}
                renderPreview={t => ({
                    subject: renderPassportSampleSubject(t, design, config.contactEmail, origin),
                    html: renderPassportSamplePreview(t, design, config.contactEmail, origin),
                })}
            />

            {saved.updatedAt && (
                <p className="admin-helper-text">
                    {isEnglish ? 'Last saved: ' : '上次保存：'}
                    {formatSavedAt(saved.updatedAt, isEnglish)}
                </p>
            )}
        </div>
    );
}
