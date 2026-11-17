import { useLanguage } from '~/components/LanguageContextProvider';
import { callUpdatePassportEmailTemplate } from '~/lib/firebase';
import type { PassportDesign } from '~/lib/passports';
import { EmailTemplateSection, formatSavedAt, useEmailTemplate } from '../EmailTemplateEditor';
import type { ShowToast } from '../utils';
import {
    carriesKey,
    DEFAULT_PASSPORT_EMAIL_BODY,
    DEFAULT_PASSPORT_EMAIL_SUBJECT,
    renderPassportSamplePreview,
    renderPassportSampleSubject,
} from './passportEmail';

interface PassportEmailTemplateSectionProps {
    design: PassportDesign | undefined;
    showToast: ShowToast;
    onUnsavedChange: (unsaved: boolean) => void;
}

export function PassportEmailTemplateSection({design, showToast, onUnsavedChange}: PassportEmailTemplateSectionProps) {
    const {isEnglish} = useLanguage();
    const editor = useEmailTemplate({
        path: 'passportEmailTemplate/default',
        defaultSubject: DEFAULT_PASSPORT_EMAIL_SUBJECT,
        defaultBody: DEFAULT_PASSPORT_EMAIL_BODY,
        write: callUpdatePassportEmailTemplate,
        showToast,
        onUnsavedChange,
    });
    const {template, saved} = editor;

    const origin = typeof window !== 'undefined' ? window.location.origin : '';

    return (
        <EmailTemplateSection
            editor={editor}
            failedText={isEnglish
                ? 'Could not load the passport email template. Reload the page before editing it.'
                : '无法加载通行证邮件模板。请重新加载页面后再编辑。'}
            placeholders={isEnglish
                ? 'Supported placeholders: {{ activationCode }} (the key, as XXXX-XXXX-XXXX), {{ activateUrl }} (a link that opens Redeem Code with the key filled in; use it as a button’s href), {{ designName }}, {{ designNameCn }}, {{ year }}, {{ termDays }} (days of membership it grants), {{ passportCover }} (renders the design’s cover art as <img>), {{ recipientEmail }}, {{ contactEmail }} (the Contact Email in Site Config; also works in mailto: links).'
                : '可用占位符：{{ activationCode }}（激活码，格式为 XXXX-XXXX-XXXX）、{{ activateUrl }}（打开「兑换激活码」并已填好激活码的链接，可作为按钮的 href）、{{ designName }}、{{ designNameCn }}、{{ year }}、{{ termDays }}（授予的会员天数）、{{ passportCover }}（将设计封面作为 <img> 渲染）、{{ recipientEmail }}、{{ contactEmail }}（网站设置中的联系邮箱，也可用于 mailto: 链接）。'}
            warning={!carriesKey(template) && (
                <p className="admin-helper-text admin-tickets-edit-warning">
                    {isEnglish
                        ? 'This template has neither {{ activationCode }} nor {{ activateUrl }}, so no one could activate the passport it sends. Sending is refused until it has one.'
                        : '此模板既没有 {{ activationCode }} 也没有 {{ activateUrl }}，收件人将无法激活通行证。加入其中之一之前将无法发送。'}
                </p>
            )}
            footer={saved.updatedAt && (
                <p className="admin-helper-text">
                    {isEnglish ? 'Last saved: ' : '上次保存：'}
                    {formatSavedAt(saved.updatedAt, isEnglish)}
                </p>
            )}
            renderPreview={(t, contactEmail) => ({
                subject: renderPassportSampleSubject(t, design, contactEmail, origin),
                html: renderPassportSamplePreview(t, design, contactEmail, origin),
            })}
        />
    );
}
