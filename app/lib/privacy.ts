/**
 * The sections of a profile that other people can be shown, each switchable on
 * the Settings tab of /profile. Mirrors PROFILE_SECTIONS in
 * functions/src/utils/visibility.ts, which is where the switches are actually
 * enforced — a hidden section is emptied server-side, not merely left undrawn.
 */
export const PROFILE_SECTIONS = ['badges', 'events'] as const;

export type ProfileSection = (typeof PROFILE_SECTIONS)[number];

/** Per-section visibility. `true` means other people see that section. */
export type ProfileVisibility = Record<ProfileSection, boolean>;

/**
 * Every switch on the settings page. The passport page is not a section — it is
 * the coarser question of whether /p/<code> resolves at all — but it reads and
 * saves like one, so the page treats them alike.
 */
export type PrivacyKey = 'passportPage' | ProfileSection;

/** Unset reads as visible: every account predates these switches. */
export const readVisibility = (raw: unknown): ProfileVisibility => {
    const stored = (raw ?? {}) as Record<string, unknown>;
    return {
        badges: stored.badges !== false,
        events: stored.events !== false,
    };
};

export interface PrivacyRow {
    key: PrivacyKey;
    title: {en: string; zh: string};
    /** What the switch covers, under the title. */
    help: {en: string; zh: string};
    /** How each state reads — also the wording of the toast that confirms it. */
    on: {en: string; zh: string};
    off: {en: string; zh: string};
}

/**
 * The switches, in the order they are shown. The passport page leads because it
 * is the coarsest: it decides whether a scanned sticker shows anything at all.
 */
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
