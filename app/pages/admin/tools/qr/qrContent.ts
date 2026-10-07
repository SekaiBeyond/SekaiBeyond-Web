/**
 * Reads what a scanned QR code holds. A QR code carries only a string; links,
 * Wi-Fi logins, contact cards and the rest are conventional formats inside it,
 * recognised here so the scanner can lay out their parts.
 */

export type QrContentKind = 'url' | 'email' | 'phone' | 'sms' | 'geo' | 'wifi' | 'contact' | 'text';

// `security` is empty for an open network and `hidden` has no value; the
// scanner puts both into words.
export type QrFieldKey =
    | 'subject' | 'message' | 'label' | 'security' | 'password' | 'hidden'
    | 'org' | 'title' | 'phone' | 'email' | 'website' | 'address' | 'note';

export interface QrContent {
    kind: QrContentKind;
    /** The one-line gist: a link's site, a network's name, a contact's name. */
    headline: string;
    /** A line under the headline: a link's full address. */
    detail?: string;
    fields: {key: QrFieldKey; value: string}[];
    /**
     * Where the primary action goes. Only ever an https/http link, or a
     * mailto:/tel: built here from parsed parts — never the scanned string
     * itself, so a `javascript:` payload can't end up in an href.
     */
    href?: string;
}

export function parseQrContent(raw: string): QrContent {
    const text = raw.trim();
    const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(text)?.[1].toLowerCase();
    switch (scheme) {
        case 'http':
        case 'https':
            return parseWebLink(text) ?? plainText(raw);
        case 'mailto':
            return parseMailto(text);
        case 'matmsg':
            return parseMatmsg(text);
        case 'tel':
            return phone(decodeSafe(text.slice(4)));
        case 'sms':
        case 'smsto':
        case 'mmsto':
            return parseSms(text, scheme);
        case 'geo':
            return parseGeo(text) ?? plainText(raw);
        case 'wifi':
            return parseWifi(text);
        case 'mecard':
            return parseMecard(text);
        case 'begin':
            if (/^BEGIN:VCARD/i.test(text)) return parseVcard(text);
            break;
    }
    // Some generators drop the scheme from a web address.
    if (/^www\.\S+$/i.test(text)) return parseWebLink(`https://${text}`) ?? plainText(raw);
    return plainText(raw);
}

function plainText(raw: string): QrContent {
    return {kind: 'text', headline: raw, fields: []};
}

function parseWebLink(text: string): QrContent | null {
    let url: URL;
    try {
        url = new URL(text);
    } catch {
        return null;
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    // The hostname comes back from URL in punycode, so a lookalike domain
    // shows up as xn--… rather than passing for the real one.
    return {kind: 'url', headline: url.hostname, detail: text, fields: [], href: url.href};
}

function decodeSafe(value: string): string {
    try {
        return decodeURIComponent(value);
    } catch {
        return value;
    }
}

/** `a?b` → [a, b], splitting at the first `sep` only. */
function splitOnce(value: string, sep: string): [string, string] {
    const at = value.indexOf(sep);
    return at === -1 ? [value, ''] : [value.slice(0, at), value.slice(at + 1)];
}

/**
 * A URI's query, percent-decoded. Unlike URLSearchParams it leaves `+` alone:
 * mailto: and sms: bodies mean a literal plus by it, not a space.
 */
function queryParams(query: string): Map<string, string> {
    const params = new Map<string, string>();
    for (const pair of query.split('&')) {
        const [key, value] = splitOnce(pair, '=');
        if (key) params.set(decodeSafe(key).toLowerCase(), decodeSafe(value));
    }
    return params;
}

const EMAIL_RE = /^[^\s@?&#]+@[^\s@?&#]+$/;

function email(to: string, subject?: string, body?: string): QrContent {
    const fields: QrContent['fields'] = [];
    if (subject) fields.push({key: 'subject', value: subject});
    if (body) fields.push({key: 'message', value: body});
    let href: string | undefined;
    if (EMAIL_RE.test(to)) {
        const params = [
            subject && `subject=${encodeURIComponent(subject)}`,
            body && `body=${encodeURIComponent(body)}`,
        ].filter(Boolean).join('&');
        href = `mailto:${to}${params ? `?${params}` : ''}`;
    }
    return {kind: 'email', headline: to, fields, href};
}

// mailto:someone@example.com?subject=Hi&body=…
function parseMailto(text: string): QrContent {
    const [address, query] = splitOnce(text.slice('mailto:'.length), '?');
    const params = queryParams(query);
    return email(decodeSafe(address), params.get('subject'), params.get('body'));
}

// MATMSG:TO:someone@example.com;SUB:Hi;BODY:…;;
function parseMatmsg(text: string): QrContent {
    const f = parseKeyValueFields(text.slice('matmsg:'.length));
    return email(f.get('TO')?.[0] ?? '', f.get('SUB')?.[0], f.get('BODY')?.[0]);
}

function phone(number: string): QrContent {
    const dialable = number.replace(/[^\d+*#,;]/g, '');
    return {kind: 'phone', headline: number, fields: [], href: dialable ? `tel:${dialable}` : undefined};
}

// sms:+15551234567?body=…   SMSTO:+15551234567:…
function parseSms(text: string, scheme: string): QrContent {
    const rest = text.slice(scheme.length + 1);
    let number: string;
    let body: string | undefined;
    if (scheme === 'sms') {
        const [n, query] = splitOnce(rest, '?');
        number = decodeSafe(n.replace(/;$/, ''));
        body = queryParams(query).get('body');
    } else {
        [number, body] = splitOnce(rest, ':');
    }
    return {kind: 'sms', headline: number, fields: body ? [{key: 'message', value: body}] : []};
}

// geo:35.6595,139.7005?q=Shibuya   geo:35.6595,139.7005;u=35
function parseGeo(text: string): QrContent | null {
    const [coords, query] = splitOnce(text.slice('geo:'.length), '?');
    const [lat, lng] = coords.split(';')[0].split(',').map(Number);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
        return null;
    }
    const label = queryParams(query).get('q');
    return {
        kind: 'geo',
        headline: `${lat}, ${lng}`,
        fields: label ? [{key: 'label', value: label}] : [],
        href: `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`,
    };
}

// WIFI:T:WPA;S:network;P:password;H:false;;
function parseWifi(text: string): QrContent {
    const f = parseKeyValueFields(text.slice('wifi:'.length));
    const security = f.get('T')?.[0];
    const password = f.get('P')?.[0];
    const fields: QrContent['fields'] = [];
    // An open network may still name itself with T:nopass, or leave T out.
    fields.push({key: 'security', value: !security || /^nopass$/i.test(security) ? '' : security});
    if (password) fields.push({key: 'password', value: password});
    if (/^true$/i.test(f.get('H')?.[0] ?? '')) fields.push({key: 'hidden', value: ''});
    return {kind: 'wifi', headline: f.get('S')?.[0] ?? '', fields};
}

// MECARD:N:Doe,Jane;TEL:+15551234567;EMAIL:jane@example.com;;
function parseMecard(text: string): QrContent {
    const f = parseKeyValueFields(text.slice('mecard:'.length));
    const [last = '', first = ''] = (f.get('N')?.[0] ?? '').split(',');
    return contact({
        name: [first, last].map(s => s.trim()).filter(Boolean).join(' '),
        org: f.get('ORG')?.[0],
        phones: f.get('TEL') ?? [],
        emails: f.get('EMAIL') ?? [],
        websites: f.get('URL') ?? [],
        address: f.get('ADR')?.[0],
        note: f.get('NOTE')?.[0],
    });
}

function parseVcard(text: string): QrContent {
    const props = new Map<string, string[]>();
    // Long lines are folded by starting the continuation with a space or tab.
    for (const line of text.replace(/\r?\n[ \t]/g, '').split(/\r?\n/)) {
        const colon = line.indexOf(':');
        if (colon === -1) continue;
        // `item1.TEL;TYPE=CELL` → TEL
        const name = line.slice(0, colon).split(';')[0].split('.').pop()!.toUpperCase();
        const values = props.get(name) ?? [];
        values.push(line.slice(colon + 1));
        props.set(name, values);
    }
    const first = (name: string) => props.get(name)?.[0];
    const all = (name: string) => (props.get(name) ?? []).map(unescapeVcard).filter(Boolean);
    // N is family;given;additional;prefix;suffix — only used when FN is missing.
    const n = splitUnescaped(first('N') ?? '', ';').map(unescapeVcard);
    const nameFromN = [n[3], n[1], n[2], n[0], n[4]].filter(Boolean).join(' ');
    return contact({
        name: unescapeVcard(first('FN') ?? '') || nameFromN,
        org: splitUnescaped(first('ORG') ?? '', ';').map(unescapeVcard).filter(Boolean).join(', '),
        title: unescapeVcard(first('TITLE') ?? ''),
        phones: all('TEL'),
        emails: all('EMAIL'),
        websites: all('URL'),
        // ADR is pobox;extended;street;city;region;postcode;country.
        address: splitUnescaped(first('ADR') ?? '', ';').map(unescapeVcard).filter(Boolean).join(', '),
        note: unescapeVcard(first('NOTE') ?? ''),
    });
}

interface ContactParts {
    name?: string;
    org?: string;
    title?: string;
    phones: string[];
    emails: string[];
    websites: string[];
    address?: string;
    note?: string;
}

function contact(c: ContactParts): QrContent {
    const fields: QrContent['fields'] = [];
    const add = (key: QrFieldKey, value: string | undefined) => {
        if (value) fields.push({key, value});
    };
    // Without a name the organisation becomes the headline, so not a field too.
    if (c.name) add('org', c.org);
    add('title', c.title);
    c.phones.forEach(v => add('phone', v));
    c.emails.forEach(v => add('email', v));
    c.websites.forEach(v => add('website', v));
    add('address', c.address);
    add('note', c.note);
    return {kind: 'contact', headline: c.name || c.org || '', fields};
}

/**
 * Splits the `KEY:value;KEY:value;;` body shared by Wi-Fi, MECARD and MATMSG
 * codes. Values escape `\ ; , :` with a backslash. Keys can repeat (a contact
 * with two phone numbers), so each maps to a list.
 */
function parseKeyValueFields(body: string): Map<string, string[]> {
    const fields = new Map<string, string[]>();
    for (const part of splitUnescaped(body, ';')) {
        // Keys never contain a colon, so the first one always ends the key,
        // even when a sloppy generator left a colon in the value unescaped.
        const colon = part.indexOf(':');
        if (colon === -1) continue;
        const key = part.slice(0, colon).toUpperCase();
        const values = fields.get(key) ?? [];
        values.push(part.slice(colon + 1).replace(/\\(.)/g, '$1'));
        fields.set(key, values);
    }
    return fields;
}

/** Splits on `sep` wherever it isn't backslash-escaped, keeping the escapes in each piece. */
function splitUnescaped(value: string, sep: string): string[] {
    const parts: string[] = [];
    let current = '';
    for (let i = 0; i < value.length; i++) {
        const ch = value[i];
        if (ch === '\\' && i + 1 < value.length) {
            current += ch + value[++i];
        } else if (ch === sep) {
            parts.push(current);
            current = '';
        } else {
            current += ch;
        }
    }
    parts.push(current);
    return parts;
}

function unescapeVcard(value: string): string {
    return value.replace(/\\(.)/g, (_, ch: string) => (ch === 'n' || ch === 'N' ? '\n' : ch)).trim();
}
