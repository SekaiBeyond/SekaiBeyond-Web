import { sanitizeEmailHtml } from '~/lib/emailSanitize';
import type { PassportDesign } from '~/lib/passports';
import { EMAIL_RE, escapeHtml } from '../tickets/helpers';

/** The key email as saved: one for every design, told apart by its placeholders. */
export interface PassportEmailTemplate {
    subject: string;
    bodyHtml: string;
    updatedAt: Date | null;
}

export const DEFAULT_PASSPORT_EMAIL_SUBJECT = 'Your {{ designName }} passport is here';

export const DEFAULT_PASSPORT_EMAIL_BODY = `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;max-width:600px;margin:0 auto;background-color:#ffffff;border:1px solid #eaeaea;border-radius:12px;overflow:hidden;box-shadow:0 4px 6px rgba(0,0,0,0.05);">
    <div style="background-color:#ff6b9d;height:8px;"></div>

    <div style="padding:32px 24px 0;">
        {{ passportCover }}
    </div>

    <div style="padding:32px 24px;">
        <h2 style="margin:0 0 16px;color:#2a2a2a;font-size:20px;font-weight:600;">Welcome to Sekai Beyond!</h2>
        <p style="margin:0 0 24px;color:#4a4a4a;font-size:16px;line-height:1.6;">Your <strong>{{ designName }}</strong>
            passport is ready. Activating it adds <strong>{{ termDays }} days</strong> of membership to your
            account.</p>

        <div
            style="background-color:#f9f9f9;border-left:4px solid #ff6b9d;border-radius:4px;padding:20px;margin-bottom:24px;text-align:center;">
            <p style="margin:0 0 8px;color:#666666;font-size:14px;">Your activation key</p>
            <p style="margin:0;color:#2a2a2a;font-family:monospace;font-size:24px;font-weight:700;letter-spacing:2px;">
                {{ activationCode }}</p>
        </div>

        <div style="text-align:center;margin-bottom:32px;">
            <a href="{{ activateUrl }}"
               style="display:inline-block;background-color:#ff6b9d;color:#ffffff;font-size:16px;font-weight:600;padding:12px 28px;border-radius:24px;text-decoration:none;">Activate
                my passport</a>
        </div>

        <hr style="border:none;border-top:1px solid #eaeaea;margin:32px 0;"/>

        <div style="background-color:#fff0f6;border-radius:8px;padding:20px;">
            <p style="margin:0 0 12px;color:#ff6b9d;font-size:14px;font-weight:700;text-transform:uppercase;letter-spacing:1px;">How
                to activate</p>
            <ul style="margin:0;padding-left:20px;color:#4a4a4a;font-size:14px;line-height:1.6;">
                <li style="margin-bottom:8px;">Press <strong>Activate my passport</strong> and sign in with Google.
                    The key is filled in for you; press <strong>Redeem</strong> to finish.
                </li>
                <li style="margin-bottom:8px;">Or sign in on our website, open the menu under your profile picture,
                    choose <strong>Redeem Code</strong>, and enter the key above.
                </li>
                <li style="margin-bottom:8px;">The key works <strong>once</strong>, on one account, so please keep
                    it to yourself.
                </li>
                <li>Questions? Contact us at <strong><a href="mailto:{{ contactEmail }}"
                                                        style="color:#ff6b9d;text-decoration:none;">{{ contactEmail }}</a></strong>.
                </li>
            </ul>
        </div>

        <p style="margin:32px 0 0;color:#4a4a4a;font-size:15px;line-height:1.6;">See you soon,<br/><strong
            style="color:#2a2a2a;">The Sekai Beyond Team</strong></p>
    </div>
</div>`;

const ACTIVATION_CODE_PLACEHOLDER = /{{\s*activationCode\s*}}/g;
const ACTIVATE_URL_PLACEHOLDER = /{{\s*activateUrl\s*}}/g;
const CONTACT_EMAIL_PLACEHOLDER = /{{\s*contactEmail\s*}}/g;

/** Mirrors carriesKey in functions/src/functions/passportEmails.ts, which refuses to send without it. */
export const carriesKey = (template: Pick<PassportEmailTemplate, 'subject' | 'bodyHtml'>): boolean =>
    [template.subject, template.bodyHtml].some(t =>
        t.search(ACTIVATION_CODE_PLACEHOLDER) !== -1 || t.search(ACTIVATE_URL_PLACEHOLDER) !== -1);

export const usesContactEmail = (template: Pick<PassportEmailTemplate, 'subject' | 'bodyHtml'>): boolean =>
    [template.subject, template.bodyHtml].some(t => t.search(CONTACT_EMAIL_PLACEHOLDER) !== -1);

const SAMPLE_KEY = 'ABCD-EFGH-JKMN';

/** Mirrors renderKeyEmail and fillActivationKey on the server, for a sample recipient. */
const fillSample = (
    text: string,
    design: PassportDesign | undefined,
    contactEmail: string,
    origin: string,
    htmlContext: boolean,
): string => {
    const sub = htmlContext ? escapeHtml : (s: string) => s;
    const name = design?.name ?? 'Passport';
    const cover = htmlContext && design?.coverImageUrl
        ? `<img src="${escapeHtml(design.coverImageUrl)}" alt="${escapeHtml(name)}" width="200" style="display:block;margin:0 auto;width:200px;max-width:60%;height:auto;border:0;border-radius:8px;"/>`
        : '';
    // Function replacements, as on the server, so a `$` in a name isn't read as a pattern.
    return text
        .replace(/{{\s*recipientEmail\s*}}/g, () => 'sample@example.com')
        .replace(/{{\s*designName\s*}}/g, () => sub(name))
        .replace(/{{\s*designNameCn\s*}}/g, () => sub(design?.nameCn || name))
        .replace(/{{\s*year\s*}}/g, () => String(design?.year ?? ''))
        .replace(/{{\s*termDays\s*}}/g, () => String(design?.termDays ?? ''))
        .replace(/{{\s*passportCover\s*}}/g, () => cover)
        .replace(CONTACT_EMAIL_PLACEHOLDER, placeholder => contactEmail ? sub(contactEmail) : placeholder)
        .replace(ACTIVATION_CODE_PLACEHOLDER, () => SAMPLE_KEY)
        .replace(ACTIVATE_URL_PLACEHOLDER, () => `${origin}/profile?redeem=${SAMPLE_KEY}`);
};

export const renderPassportSampleSubject = (
    template: PassportEmailTemplate, design: PassportDesign | undefined, contactEmail: string, origin: string,
): string => fillSample(template.subject, design, contactEmail, origin, false);

export const renderPassportSamplePreview = (
    template: PassportEmailTemplate, design: PassportDesign | undefined, contactEmail: string, origin: string,
): string => sanitizeEmailHtml(fillSample(template.bodyHtml, design, contactEmail, origin, true));

/**
 * The addresses in pasted text or an imported file, lowercased, in order and as
 * often as listed: an address listed twice is sent two passports. Anything with
 * an @ that isn't an address is returned as invalid, once each; everything else
 * (names, a CSV's headers and other columns) is passed over.
 */
export const parseEmailList = (text: string): {emails: string[]; invalid: string[]} => {
    const emails: string[] = [];
    const invalid = new Set<string>();
    for (const token of text.split(/[\s,;<>"'()[\]]+/)) {
        if (!token.includes('@')) continue;
        const email = token.replace(/^mailto:/i, '').toLowerCase();
        if (email.length <= 320 && EMAIL_RE.test(email)) emails.push(email);
        else invalid.add(token);
    }
    return {emails, invalid: [...invalid]};
};

/** How many times each address is in `emails`. */
export const countAddresses = (emails: string[]): Map<string, number> => {
    const counts = new Map<string, number>();
    for (const email of emails) counts.set(email, (counts.get(email) ?? 0) + 1);
    return counts;
};
