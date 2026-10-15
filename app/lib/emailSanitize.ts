import sanitizeHtml from 'sanitize-html';

// Allowlist for ticket-email template HTML. The backend keeps a copy
// (`EMAIL_HTML_SANITIZE_OPTIONS` in functions/src/functions/tickets.ts), since
// the two are separate projects; they must stay in sync, as the server sanitizes
// on save and this drives the admin's preview.
//
// Blocks scripts, iframes, styles and event handlers, and restricts href to
// https/mailto and img src to https/data/cid. The server adds ticket QR images
// after sanitizing.
export const EMAIL_HTML_SANITIZE_OPTIONS: sanitizeHtml.IOptions = {
    allowedTags: [
        'p', 'div', 'span', 'strong', 'em', 'b', 'i', 'u', 'br', 'hr',
        'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
        'ul', 'ol', 'li',
        'a', 'img',
        'table', 'thead', 'tbody', 'tr', 'td', 'th',
        'code', 'blockquote',
    ],
    allowedAttributes: {
        '*': ['style', 'class', 'align', 'width', 'height'],
        'a': ['href', 'title', 'target', 'rel'],
        'img': ['src', 'alt', 'title', 'width', 'height'],
        'td': ['colspan', 'rowspan', 'valign'],
        'th': ['colspan', 'rowspan', 'valign'],
    },
    allowedSchemes: ['https', 'mailto'],
    allowedSchemesByTag: {
        img: ['https', 'data', 'cid'],
    },
    allowedSchemesAppliedToAttributes: ['href', 'src'],
    allowProtocolRelative: false,
    disallowedTagsMode: 'discard',
};

export const sanitizeEmailHtml = (html: string): string =>
    sanitizeHtml(html, EMAIL_HTML_SANITIZE_OPTIONS);
