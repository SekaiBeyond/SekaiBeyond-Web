import type { UserGroup } from '~/components/AuthProvider';

export interface BadgeCode {
    id: string;
    code: string;
    active: boolean;
    activeFrom: string | null;
    activeUntil: string | null;
    maxUses?: number;
    usedCount?: number;
}

export interface BadgeActivationCode {
    id: string;
    code: string;
    active: boolean;
    activeFrom: string | null;
    activeUntil: string | null;
    maxUses: number;
    usedCount: number;
}

export interface UserBan {
    at: Date;
    until: Date | null;
    reason: string;
    byName: string;
}

export const isBanActive = (ban: UserBan | null): boolean =>
    !!ban && (!ban.until || ban.until.getTime() > Date.now());

export interface UserRecord {
    uid: string;
    displayName: string;
    email: string;
    photoURL: string;
    bannerURL: string;
    joinedAt: Date;
    attendedEvents: string[];
    badges: string[];
    group: UserGroup;
    membershipExpiresAt: Date | null;
    title?: string;
    titleCn?: string;
    eventStaffEvents: string[];
    hidePassportPage: boolean;
    ban: UserBan | null;
}

export type Tab = 'users' | 'events' | 'locations' | 'badges' | 'passports' | 'records' | 'tools' | 'config' | 'con';

export const RECORD_CATEGORIES = {
    role: {
        en: 'Role', zh: '角色',
        types: ['group-assign', 'title-set', 'event-staff-assign', 'event-staff-remove'],
    },
    membership: {
        en: 'Membership', zh: '会员',
        types: ['membership-grant', 'membership-extend', 'membership-revoke'],
    },
    code: {
        en: 'Code', zh: '兑换码',
        types: ['code-create', 'badge-code-activate', 'badge-code-deactivate', 'code-delete',
            'event-code-activate', 'event-code-deactivate', 'event-code-time-window',
            'staff-code-create', 'staff-code-activate', 'staff-code-deactivate', 'staff-code-time-window',
            'staff-code-delete'],
    },
    attend: {
        en: 'Attend', zh: '签到',
        types: ['event-attend', 'event-unattend', 'event-claim'],
    },
    badge: {
        en: 'Badge', zh: '徽章',
        types: ['achievement-grant', 'achievement-revoke', 'badge-claim', 'badge-create', 'badge-edit',
            'badge-deletion-requested', 'badge-deletion-cancelled', 'badge-deleted'],
    },
    event: {
        en: 'Event', zh: '活动',
        types: ['event-create', 'event-edit',
            'event-deletion-requested', 'event-deletion-cancelled', 'event-deleted',
            'past-event-publish', 'past-event-unpublish',
            'upcoming-event-create', 'upcoming-event-edit',
            'upcoming-event-deletion-requested', 'upcoming-event-deletion-cancelled', 'upcoming-event-deleted',
            'upcoming-event-archive', 'upcoming-event-publish', 'upcoming-event-unpublish',
            'upcoming-event-email-template-update', 'upcoming-event-wallet-pass-update'],
    },
    ticket: {
        en: 'Ticket', zh: '门票',
        types: ['ticket-import', 'ticket-walk-in', 'ticket-redeem', 'ticket-void', 'ticket-unvoid', 'ticket-reset',
            'ticket-type-edit', 'ticket-notes-edit', 'ticket-attendee-delete', 'ticket-attendee-edit', 'ticket-regenerate',
            'ticket-email-send', 'ticket-email-queue', 'ticket-api-order', 'hometown-import',
            'hometown-order-times', 'hometown-admit-unlisted'],
    },
    tag: {
        en: 'Tag', zh: '标签',
        types: ['tag-create', 'tag-edit', 'tag-delete'],
    },
    location: {
        en: 'Location', zh: '场地',
        types: ['venue-create', 'venue-edit', 'venue-delete', 'parking-sync'],
    },
    passport: {
        en: 'Passport', zh: '通行证',
        types: ['passport-generate', 'passport-claim', 'passport-delete', 'passport-key-reissue',
            'passport-key-view', 'passport-key-export', 'passport-note-edit', 'passport-design-create',
            'passport-design-edit', 'passport-design-delete', 'passport-email-send', 'passport-email-queue',
            'passport-email-template-update'],
    },
    qr: {
        en: 'QR', zh: '二维码',
        types: ['qrcode-create', 'qrcode-edit', 'qrcode-delete', 'qrcode-spot-set',
            'social-platform-create', 'social-platform-edit', 'social-platform-delete'],
    },
    account: {
        en: 'Account', zh: '账号',
        types: ['account-deletion-requested', 'account-deletion-cancelled', 'account-deleted',
            'name-set', 'avatar-set', 'avatar-remove', 'banner-remove', 'account-email-release',
            'account-password-set', 'account-google-bind', 'account-google-unbind', 'account-app-link',
            'account-app-unlink', 'account-app-link-undo', 'account-app-hold-clear', 'account-email-change', 'account-email-undo', 'account-ban', 'account-unban'],
    },
    config: {
        en: 'Config', zh: '配置',
        types: ['policy-update', 'config-update', 'con-content-update'],
    },
    email: {
        en: 'Email', zh: '邮件',
        types: ['scheduled-mail-drain'],
    },
    api: {
        en: 'API', zh: 'API',
        types: ['api-key-create', 'api-key-rename', 'api-key-revoke', 'app-create', 'app-update', 'app-delete'],
    },
} as const satisfies Record<string, {en: string; zh: string; types: readonly string[]}>;

export type RecordCategory = keyof typeof RECORD_CATEGORIES;
type RecordType = (typeof RECORD_CATEGORIES)[RecordCategory]['types'][number];

export interface ActivityRecord {
    id: string;
    type: RecordType;
    performedBy?: string;
    performedByName: string;
    targetUid?: string;
    targetName?: string;
    targetEmail?: string;
    oldEmail?: string;
    eventTitle?: string;
    eventId?: string;
    badgeId?: string;
    badgeName?: string;
    tagName?: string;
    venueId?: string;
    venueName?: string;
    qrLabel?: string;
    passportId?: string;
    passportYear?: number | null;
    passportDesignName?: string;
    passportCount?: number;
    passportSentTo?: string;
    platformLabel?: string;
    conSection?: string;
    configSections?: string[];
    lotCount?: number;
    code?: string;
    oldGroup?: UserGroup;
    newGroup?: UserGroup;
    oldExpiresAt?: string;
    newExpiresAt?: string;
    extendDays?: number | null;
    oldTitle?: string;
    newTitle?: string;
    oldTitleCn?: string;
    newTitleCn?: string;
    oldName?: string;
    newName?: string;
    oldType?: string;
    newType?: string;
    banUntil?: string;
    banReason?: string;
    reason?: string;
    addedCount?: number;
    replacedCount?: number;
    sentCount?: number;
    ticketCount?: number;
    checkedIn?: boolean;
    confirmedCount?: number;
    updatedCount?: number;
    missingCount?: number;
    syncedCount?: number;
    unmatchedCount?: number;
    enabled?: boolean;
    apiKeyName?: string;
    apiKeyHint?: string;
    apiOrderId?: string;
    appId?: string;
    appName?: string;
    appUserName?: string;
    linkEndedBy?: 'email-undo' | 'account-deleted' | 'app-removed';
    timestamp: Date;
}
