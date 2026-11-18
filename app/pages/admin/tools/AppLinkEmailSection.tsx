import { useCallback, useState } from 'react';
import { useLanguage } from '~/components/LanguageContextProvider';
import { appNameIn } from '~/lib/appLinks';
import { callUpdateAppLinkEmailTemplate } from '~/lib/firebase';
import { useExitGuard } from '~/lib/useExitGuard';
import { Banner } from '../Banner';
import { EmailTemplateSection, formatSavedAt, useEmailTemplate } from '../EmailTemplateEditor';
import { SubTab } from '../useEventLifecycle';
import type { ShowToast } from '../utils';
import { carriesUndoLink, DEFAULT_LINK_EMAIL, type LinkEmailLanguage, renderLinkEmailSample } from './appLinkEmail';

const LANGUAGES: {id: LinkEmailLanguage; en: string; zh: string}[] = [
    {id: 'en', en: 'English', zh: '英文'},
    {id: 'zh', en: 'Chinese', zh: '中文'},
];

function useLinkEmail(language: LinkEmailLanguage, showToast: ShowToast, onUnsavedChange: (unsaved: boolean) => void) {
    const {isEnglish} = useLanguage();
    return useEmailTemplate({
        path: `appLinkEmailTemplate/${language}`,
        defaultSubject: DEFAULT_LINK_EMAIL[language].subject,
        defaultBody: DEFAULT_LINK_EMAIL[language].bodyHtml,
        write: template => callUpdateAppLinkEmailTemplate({language, ...template}),
        check: template => carriesUndoLink(template) ? null : (isEnglish
            ? 'The body needs {{ undoUrl }}, so someone whose account was linked by somebody else can undo it.'
            : '正文必须包含 {{ undoUrl }}，以便账号被他人绑定的用户可以撤销。'),
        showToast,
        onUnsavedChange,
    });
}

export function AppLinkEmailSection({sampleApp, showToast, onClose}: {
    sampleApp: {id: string; nameEn: string; nameCn: string} | undefined;
    showToast: ShowToast;
    onClose: () => void;
}) {
    const {isEnglish} = useLanguage();
    const [language, setLanguage] = useState<LinkEmailLanguage>(isEnglish ? 'en' : 'zh');
    const [unsaved, setUnsaved] = useState<Record<LinkEmailLanguage, boolean>>({en: false, zh: false});
    const onUnsavedEn = useCallback((value: boolean) => setUnsaved(prev => ({...prev, en: value})), []);
    const onUnsavedZh = useCallback((value: boolean) => setUnsaved(prev => ({...prev, zh: value})), []);
    const editors = {
        en: useLinkEmail('en', showToast, onUnsavedEn),
        zh: useLinkEmail('zh', showToast, onUnsavedZh),
    };
    const editor = editors[language];

    useExitGuard(unsaved.en || unsaved.zh, isEnglish
        ? 'The link notice email has unsaved changes. Leave anyway?'
        : '绑定通知邮件有未保存的修改，确定要离开吗？');

    const languageName = (id: LinkEmailLanguage) => {
        const entry = LANGUAGES.find(l => l.id === id)!;
        return isEnglish ? entry.en : entry.zh;
    };
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    const sampleAppName = sampleApp ? appNameIn(sampleApp, sampleApp.id, language === 'en') : 'SKBY Manager';

    return (
        <div className="admin-section-mb">
            <EmailTemplateSection
                key={language}
                editor={editor}
                title={isEnglish ? 'Link Notice Email' : '绑定通知邮件'}
                failedText={isEnglish
                    ? 'Could not load the link notice email. Reload the page before editing it.'
                    : '无法加载绑定通知邮件。请重新加载页面后再编辑。'}
                status={
                    <>
                        <p className="admin-helper-text">
                            {isEnglish
                                ? 'Members get this email when they link an account in an app to theirs here, in the language they use the site in. The same email goes out for every app; {{ appName }} says which.'
                                : '用户将应用中的账号绑定到本站账号时会收到此邮件，语言与其浏览网站时使用的语言相同。所有应用共用同一封邮件，由 {{ appName }} 显示是哪个应用。'}
                        </p>
                        <div className="admin-sub-tabs">
                            {LANGUAGES.map(l => (
                                <SubTab key={l.id} active={language === l.id} onClick={() => setLanguage(l.id)}>
                                    {isEnglish ? l.en : l.zh}{unsaved[l.id] ? ' •' : ''}
                                </SubTab>
                            ))}
                        </div>
                        {editor.saved.updatedAt ? (
                            <p className="admin-helper-text">
                                {isEnglish ? 'Saved: ' : '已保存：'}
                                {formatSavedAt(editor.saved.updatedAt, isEnglish)}
                            </p>
                        ) : (
                            <Banner tone="warning">
                                <strong>{isEnglish ? 'Not saved yet.' : '尚未保存。'}</strong>
                                <p>
                                    {isEnglish
                                        ? `Until the ${languageName(language)} email is saved, members who use the site in ${languageName(language)} get the built-in one, which reads much like the default below.`
                                        : `保存${languageName(language)}邮件之前，使用${languageName(language)}浏览网站的用户会收到内置邮件，其内容与下方默认模板相同。`}
                                </p>
                            </Banner>
                        )}
                    </>
                }
                placeholders={isEnglish
                    ? 'Supported placeholders: {{ appName }} (in this email’s language), {{ appUserName }} (their name in the app; blank if the app gave none), {{ appAccount }} (“the SKBY Manager account "Mika"”, or “a SKBY Manager account” without a name), {{ sharedFields }} (what the app can now see), {{ undoUrl }} (required: the link that undoes it, for someone whose account was linked by somebody else; use it as a link’s href), {{ undoDays }} (how long that link works), {{ holdDays }}, {{ siteUrl }}, {{ contactEmail }} (the Contact Email in Site Config; also works in mailto: links).'
                    : '可用占位符：{{ appName }}（使用此邮件的语言）、{{ appUserName }}（用户在应用中的名称；应用未提供时为空）、{{ appAccount }}（“SKBY Manager账号“Mika””，没有名称时为“一个SKBY Manager账号”）、{{ sharedFields }}（应用现在可以读取的信息）、{{ undoUrl }}（必填：撤销绑定的链接，供账号被他人绑定的用户使用，可作为链接的 href）、{{ undoDays }}（该链接的有效天数）、{{ holdDays }}、{{ siteUrl }}、{{ contactEmail }}（网站设置中的联系邮箱，也可用于 mailto: 链接）。'}
                warning={!carriesUndoLink(editor.template) && (
                    <p className="admin-helper-text admin-tickets-edit-warning">
                        {isEnglish
                            ? 'This email has no {{ undoUrl }}, so someone whose account was linked by somebody else couldn’t undo it. It can’t be saved until it has one.'
                            : '此邮件没有 {{ undoUrl }}，账号被他人绑定的用户将无法撤销。加入之前无法保存。'}
                    </p>
                )}
                noContactEmailText={isEnglish
                    ? 'This email uses {{ contactEmail }}, but Site Config has no Contact Email. Until one is set, members get the built-in email instead.'
                    : '此邮件使用了 {{ contactEmail }}，但网站设置中尚未填写联系邮箱。填写之前，用户会收到内置邮件。'}
                footer={
                    <div className="admin-btn-row">
                        <button className="admin-toggle-btn admin-toggle-cancel" onClick={onClose} type="button">
                            {isEnglish ? 'Close' : '关闭'}
                        </button>
                    </div>
                }
                renderPreview={(template, contactEmail) =>
                    renderLinkEmailSample(template, language, sampleAppName, contactEmail, origin)}
            />
        </div>
    );
}
