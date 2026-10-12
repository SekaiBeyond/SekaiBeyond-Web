import type { SocialLinkKey, SocialLinks } from '~/lib/siteConfig';

interface SocialLinkFormat {
    /** What the field asks for, as its placeholder. */
    placeholder: {en: string; zh: string};
    /** One account's ID, as a regex source. */
    id: string;
    /** Each host its links are on (less any www. or m.), with the path up to the ID. */
    paths: Record<string, string>;
    /** The account's link, in the one form the server accepts. */
    link: (id: string) => string;
}

// Mirrors SOCIAL_LINK_PATTERNS in functions/src/functions/admin.ts, which accepts
// each `link` here and nothing else.
const SOCIAL_LINK_FORMATS: Record<SocialLinkKey, SocialLinkFormat> = {
    discord: {
        placeholder: {en: 'Invite code or link', zh: '邀请码或链接'},
        id: '[A-Za-z0-9-]+',
        paths: {'discord.gg': '/', 'discord.com': '/invite/'},
        link: id => `https://discord.gg/${id}`,
    },
    instagram: {
        placeholder: {en: 'Username or link', zh: '用户名或链接'},
        id: '[A-Za-z0-9._]+',
        paths: {'instagram.com': '/'},
        link: id => `https://www.instagram.com/${id}/`,
    },
    bilibili: {
        placeholder: {en: 'UID or link', zh: 'UID 或链接'},
        id: '\\d+',
        paths: {'space.bilibili.com': '/', 'bilibili.com': '/space/'},
        link: id => `https://space.bilibili.com/${id}`,
    },
    xiaohongshu: {
        placeholder: {en: 'User ID, profile link, or share link', zh: '用户 ID、主页链接或分享链接'},
        id: '[0-9a-f]{24}',
        paths: {'xiaohongshu.com': '/user/profile/'},
        link: id => `https://www.xiaohongshu.com/user/profile/${id}`,
    },
    linkedin: {
        placeholder: {en: 'Company page name or link', zh: '公司主页名或链接'},
        id: '[A-Za-z0-9-]+',
        paths: {'linkedin.com': '/company/'},
        link: id => `https://www.linkedin.com/company/${id}/`,
    },
    github: {
        placeholder: {en: 'Username or link', zh: '用户名或链接'},
        id: '[A-Za-z0-9-]+',
        paths: {'github.com': '/'},
        link: id => `https://github.com/${id}`,
    },
};

// The Xiaohongshu app shares a profile as a short link that redirects to it. It
// holds no ID to read here, so it is saved as is and the server follows it.
const XIAOHONGSHU_SHARE_HOSTS = ['xhslink.cn', 'xhslink.com'];

export const socialLinkPlaceholder = (key: SocialLinkKey) => SOCIAL_LINK_FORMATS[key].placeholder;

function parseUrl(value: string): URL | null {
    try {
        return new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `https://${value}`);
    } catch {
        return null;
    }
}

function idInUrl(key: SocialLinkKey, url: URL): string | null {
    const format = SOCIAL_LINK_FORMATS[key];
    const prefix = format.paths[url.hostname.replace(/^(?:www|m)\./, '')];
    if (prefix === undefined) return null;
    return url.pathname.match(new RegExp(`^${prefix}(${format.id})(?:/|$)`))?.[1] ?? null;
}

export const isXiaohongshuShareLink = (link: string): boolean => {
    const url = parseUrl(link);
    return !!url && XIAOHONGSHU_SHARE_HOSTS.includes(url.hostname);
};

/**
 * The link to save for what was typed into an account's field: its ID, @ID, or
 * any link to it, rebuilt in that account's one form. '' when blank, and null
 * when it is none of those.
 */
export function toSocialLink(key: SocialLinkKey, input: string): string | null {
    const value = input.trim().replace(/^@/, '');
    if (!value) return '';
    const format = SOCIAL_LINK_FORMATS[key];
    if (new RegExp(`^${format.id}$`).test(value)) return format.link(value);

    const url = parseUrl(value);
    if (!url) return null;
    if (key === 'xiaohongshu' && XIAOHONGSHU_SHARE_HOSTS.includes(url.hostname)) {
        return url.pathname.length > 1 ? `https://${url.hostname}${url.pathname}` : null;
    }
    const id = idInUrl(key, url);
    return id ? format.link(id) : null;
}

/** What each field shows for the saved links: the ID, or the whole link when it has none to show. */
export function socialLinkInputs(links: SocialLinks): SocialLinks {
    const inputs = {...links};
    for (const key of Object.keys(SOCIAL_LINK_FORMATS) as SocialLinkKey[]) {
        const url = links[key] ? parseUrl(links[key]) : null;
        inputs[key] = (url && idInUrl(key, url)) ?? links[key];
    }
    return inputs;
}
