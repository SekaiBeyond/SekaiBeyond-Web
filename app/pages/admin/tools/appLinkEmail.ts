import { LINK_HOLD_DAYS, LINK_SHARED_FIELDS, LINK_UNDO_DAYS } from '~/lib/appLinks';
import { sanitizeEmailHtml } from '~/lib/emailSanitize';
import { escapeHtml } from '../tickets/helpers';
import type { EmailTemplate } from '../tickets/types';

export type LinkEmailLanguage = 'en' | 'zh';

const UNDO_URL_PLACEHOLDER = /{{\s*undoUrl\s*}}/;

export const carriesUndoLink = (template: Pick<EmailTemplate, 'bodyHtml'>): boolean =>
    template.bodyHtml.search(UNDO_URL_PLACEHOLDER) !== -1;

const FRAME = `font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;max-width:520px;margin:0 auto;padding:32px 24px;`;
const HEADING = 'margin:0 0 24px;color:#ff6b9d;font-size:22px;';
const PARAGRAPH = 'margin:0 0 16px;color:#4a4a4a;font-size:15px;line-height:1.6;';
const FOOTER = 'margin:32px 0 0;color:#9a9a9a;font-size:13px;';

export const DEFAULT_LINK_EMAIL: Record<LinkEmailLanguage, {subject: string; bodyHtml: string}> = {
    en: {
        subject: '{{ appName }} was linked to your Sekai Beyond account',
        bodyHtml: `<div style="${FRAME}">
    <h1 style="${HEADING}">{{ appName }} linked</h1>
    <p style="${PARAGRAPH}">Your account is now linked to {{ appAccount }}, so {{ appName }} can see your
        {{ sharedFields }}. You can unlink it in Settings.</p>
    <p style="${PARAGRAPH}">Wasn't you? <a href="{{ undoUrl }}">Undo this link</a>. The link works for
        {{ undoDays }} days, and unlinks it, signs out every device, removes any bound Google account and replaces
        your password. Unlike unlinking in Settings, you can then link your own {{ appName }} account straight away,
        without waiting {{ holdDays }} days. This works once every {{ holdDays }} days for each app.</p>
    <p style="${PARAGRAPH}">If this wasn't you, contact {{ contactEmail }} right away.</p>
    <p style="${FOOTER}"><a href="{{ siteUrl }}" style="color:#9a9a9a;">Sekai Beyond</a></p>
</div>`,
    },
    zh: {
        subject: '您的 Sekai Beyond 账号绑定了{{ appName }}',
        bodyHtml: `<div style="${FRAME}">
    <h1 style="${HEADING}">已绑定{{ appName }}</h1>
    <p style="${PARAGRAPH}">您的账号已绑定{{ appAccount }}，{{ appName }}现在可以读取您的{{ sharedFields }}。可在“设置”中解绑。</p>
    <p style="${PARAGRAPH}">不是您本人的操作？<a href="{{ undoUrl }}">撤销此绑定</a>。链接在 {{ undoDays }} 天内有效，会解除此绑定、退出所有设备、移除已绑定的 Google 账号并替换密码。与在“设置”中解绑不同，之后您可以立即绑定自己的{{ appName }}账号，无需等待 {{ holdDays }} 天；每个应用每 {{ holdDays }} 天只能这样撤销一次。</p>
    <p style="${PARAGRAPH}">如果这不是您本人的操作，请立即联系 {{ contactEmail }}。</p>
    <p style="${FOOTER}"><a href="{{ siteUrl }}" style="color:#9a9a9a;">Sekai Beyond</a></p>
</div>`,
    },
};

const SAMPLE_APP_USER_NAME = 'Mika';

const linkedAppAccount = (appName: string, appUserName: string, language: LinkEmailLanguage): string => {
    if (language === 'zh') return appUserName ? `${appName}账号“${appUserName}”` : `一个${appName}账号`;
    return appUserName ? `the ${appName} account "${appUserName}"` : `a ${appName} account`;
};

export function renderLinkEmailSample(
    template: Pick<EmailTemplate, 'subject' | 'bodyHtml'>,
    language: LinkEmailLanguage,
    appName: string,
    contactEmail: string,
    origin: string,
): {subject: string; html: string} {
    const values = new Map<string, string>([
        ['appName', appName],
        ['appUserName', SAMPLE_APP_USER_NAME],
        ['appAccount', linkedAppAccount(appName, SAMPLE_APP_USER_NAME, language)],
        ['sharedFields', LINK_SHARED_FIELDS[language]],
        ['undoUrl', `${origin}/undo-app-link#token=sample`],
        ['undoDays', String(LINK_UNDO_DAYS)],
        ['holdDays', String(LINK_HOLD_DAYS)],
        ['siteUrl', origin],
        ...(contactEmail ? [['contactEmail', contactEmail] as [string, string]] : []),
    ]);
    const fill = (text: string, html: boolean) => text.replace(/{{\s*(\w+)\s*}}/g, (placeholder, name: string) => {
        const value = values.get(name);
        if (value === undefined) return placeholder;
        return html ? escapeHtml(value) : value;
    });
    return {subject: fill(template.subject, false), html: sanitizeEmailHtml(fill(template.bodyHtml, true))};
}
