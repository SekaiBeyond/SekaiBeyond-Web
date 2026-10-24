import sanitizeHtml from "sanitize-html";
import { HttpsError } from "firebase-functions/v2/https";
import { db } from "./firebase";

/**
 * What the admin-edited emails share: ticket emails and passport key emails are
 * each a saved subject and HTML body with {{ placeholders }}, filled per
 * recipient at send time.
 */

export interface EmailTemplateDoc {
    subject: string;
    bodyHtml: string;
}

// Mirrored by app/lib/emailSanitize.ts, which the admin preview renders through.
export const EMAIL_HTML_SANITIZE_OPTIONS: sanitizeHtml.IOptions = {
    allowedTags: [
        "p", "div", "span", "strong", "em", "b", "i", "u", "br", "hr",
        "h1", "h2", "h3", "h4", "h5", "h6",
        "ul", "ol", "li",
        "a", "img",
        "table", "thead", "tbody", "tr", "td", "th",
        "code", "blockquote",
    ],
    allowedAttributes: {
        "*": ["style", "class", "align", "width", "height"],
        "a": ["href", "title", "target", "rel"],
        "img": ["src", "alt", "title", "width", "height"],
        "td": ["colspan", "rowspan", "valign"],
        "th": ["colspan", "rowspan", "valign"],
    },
    allowedSchemes: ["https", "mailto"],
    allowedSchemesByTag: {
        img: ["https", "data", "cid"],
    },
    allowedSchemesAppliedToAttributes: ["href", "src"],
    allowProtocolRelative: false,
    disallowedTagsMode: "discard",
};

export const escapeHtml = (s: string): string => s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

// Site Config's Contact Email. Escaped like every other value, so it also works
// in an href (mailto:{{ contactEmail }}).
export const CONTACT_EMAIL_PLACEHOLDER = /{{\s*contactEmail\s*}}/g;

/** A rendered subject on one line, so a newline in a filled-in value can't inject headers. */
export const subjectLine = (s: string): string => s.replace(/[\x00-\x1F\x7F]+/g, " ").trim();

/**
 * The template saved at `ref`. Missing or blank is refused, never filled from a
 * default: what goes out is what an admin saved and previewed.
 */
export async function readSavedTemplate(ref: FirebaseFirestore.DocumentReference): Promise<EmailTemplateDoc> {
    const data = (await ref.get()).data() ?? {};
    const template: EmailTemplateDoc = {
        subject: typeof data.subject === "string" ? data.subject : "",
        bodyHtml: typeof data.bodyHtml === "string" ? data.bodyHtml : "",
    };
    if (!template.subject.trim() || !template.bodyHtml.trim()) {
        throw new HttpsError("failed-precondition", "The email template hasn't been saved.", {code: "no-template"});
    }
    return template;
}

/**
 * Site Config's Contact Email for a template that uses it. Refuses rather than
 * send "contact us at " with an empty mailto. Read per call, so a Site Config
 * fix applies to the next send.
 */
export async function contactEmailFor(template: EmailTemplateDoc): Promise<string> {
    const contactEmail = ((await db.collection("config").doc("main").get())
        .get("contactEmail") as string | undefined) ?? "";
    const usesContactEmail = [template.subject, template.bodyHtml]
        .some(t => t.search(CONTACT_EMAIL_PLACEHOLDER) !== -1);
    if (usesContactEmail && !contactEmail) {
        throw new HttpsError("failed-precondition",
            "The template uses {{ contactEmail }}, but Site Config has no Contact Email.",
            {code: "no-contact-email"});
    }
    return contactEmail;
}
