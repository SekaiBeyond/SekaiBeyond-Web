/**
 * Profile sections switchable on /profile's Settings tab. Mirrors
 * `PROFILE_SECTIONS` in functions/src/utils/visibility.ts.
 */
const PROFILE_SECTIONS = ['badges', 'events', 'passports'] as const;

export type ProfileSection = (typeof PROFILE_SECTIONS)[number];

export type ProfileVisibility = Record<ProfileSection, boolean>;

export type PrivacyKey = 'passportPage' | ProfileSection;

export const readVisibility = (raw: unknown): ProfileVisibility => {
    const stored = (raw ?? {}) as Record<string, unknown>;
    return {
        badges: stored.badges !== false,
        events: stored.events !== false,
        passports: stored.passports !== false,
    };
};

interface PrivacyRow {
    key: PrivacyKey;
    title: {en: string; zh: string};
    help: {en: string; zh: string};
    on: {en: string; zh: string};
    off: {en: string; zh: string};
}

export const PRIVACY_ROWS: PrivacyRow[] = [
    {
        key: 'passportPage',
        title: {en: 'Passport page', zh: '通行证页面'},
        help: {
            en: 'The page anyone reaches by scanning one of your passports.',
            zh: '任何人扫描您的通行证后打开的页面。',
        },
        on: {en: 'Public — anyone who scans a passport sees it', zh: '公开 — 任何扫描通行证的人都能看到'},
        off: {en: 'Private — scanners see a notice instead', zh: '私密 — 扫描者只会看到提示'},
    },
    {
        key: 'badges',
        title: {en: 'Badges', zh: '徽章'},
        help: {
            en: 'The badges you have earned, and when you earned them.',
            zh: '您已获得的徽章，以及获得时间。',
        },
        on: {en: 'Visible to everyone', zh: '所有人可见'},
        off: {en: 'Only you', zh: '仅自己可见'},
    },
    {
        key: 'passports',
        title: {en: 'Passports', zh: '通行证'},
        help: {
            en: 'The passports you hold, shown on your profile, and when you activated them.',
            zh: '您持有的通行证（显示在您的主页上），以及激活时间。',
        },
        on: {en: 'Visible to everyone', zh: '所有人可见'},
        off: {en: 'Only you', zh: '仅自己可见'},
    },
    {
        key: 'events',
        title: {en: 'Events attended', zh: '参与活动'},
        help: {
            en: 'Which past events you went to, and which you staffed.',
            zh: '您参加过哪些往期活动，以及担任过哪些活动的工作人员。',
        },
        on: {en: 'Visible to everyone', zh: '所有人可见'},
        off: {en: 'Only you', zh: '仅自己可见'},
    },
];

/** How one switch's current state reads, for a surface that only displays it. */
export const privacyStateLabel = (row: PrivacyRow, visible: boolean, isEnglish: boolean): string =>
    isEnglish ? (visible ? row.on.en : row.off.en) : (visible ? row.on.zh : row.off.zh);

export const privacyRow = (key: PrivacyKey): PrivacyRow => PRIVACY_ROWS.find(r => r.key === key)!;
