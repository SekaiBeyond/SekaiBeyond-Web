import sanitizeHtml from 'sanitize-html';

// Allowlist for ticket-email template HTML.
//
// Single source of truth — the backend (functions/src/index.ts) keeps a
// duplicate copy (`EMAIL_HTML_SANITIZE_OPTIONS`) because Cloud Functions and
// the web app are separate tsc projects with their own node_modules. The two
// MUST stay in sync: server-side sanitize runs at save time in
// updateEventEmailTemplate, and the client uses this file for preview so the
// admin sees exactly what will be sent.
//
// Blocks <script>/<iframe>/<style>/event handlers and restricts href to
// https/mailto, img src to https/data. QR images for tickets are injected
// post-sanitize as cid: references on the server (Gmail strips data: URLs in
// img src, so QRs ship as multipart/related attachments).
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
        img: ['https', 'data'],
    },
    allowedSchemesAppliedToAttributes: ['href', 'src'],
    allowProtocolRelative: false,
    disallowedTagsMode: 'discard',
};

export const sanitizeEmailHtml = (html: string): string =>
    sanitizeHtml(html, EMAIL_HTML_SANITIZE_OPTIONS);
