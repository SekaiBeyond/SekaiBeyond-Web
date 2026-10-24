import sanitizeHtml from 'sanitize-html';

// Must stay in sync with `EMAIL_HTML_SANITIZE_OPTIONS` in functions/src/utils/emailTemplate.ts.
const EMAIL_HTML_SANITIZE_OPTIONS: sanitizeHtml.IOptions = {
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
