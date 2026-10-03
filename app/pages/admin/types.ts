import type { UserGroup } from '~/components/AuthProvider';
import type { BadgeDef as BaseBadgeDef } from '~/lib/types';

export interface BadgeCode {
    id: string;
    code: string;
    eventId: string;
    active: boolean;
    activeFrom: string | null;
    activeUntil: string | null;
    maxUses?: number;
}

export interface BadgeActivationCode {
    id: string;
    code: string;
    badgeId: string;
    active: boolean;
    activeFrom: string | null;
    activeUntil: string | null;
    maxUses: number;
    usedCount: number;
    createdBy: string;
    createdAt: Date;
}

export interface BadgeDef extends BaseBadgeDef {
    createdBy: string;
    createdByUid: string;
    createdByName: string;
    createdByLink: string;
    createdAt: Date;
}

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
}

export type Tab = 'users' | 'events' | 'locations' | 'badges' | 'passports' | 'records' | 'tools' | 'config' | 'con';

/**
 * Every record type, by Records tab category: the one list behind RecordType,
 * the type filter, and each row's tag and colour. Mirrors RecordType in
 * functions/src/utils/records.ts. A category is one `in` query, so keep each
 * within Firestore's 30-value cap.
 */
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
            'staff-code-create', 'staff-code-activate', 'staff-code-deactivate', 'staff-code-time-window'],
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
            'upcoming-event-email-template-update'],
    },
    ticket: {
        en: 'Ticket', zh: '门票',
        types: ['ticket-import', 'ticket-redeem', 'ticket-void', 'ticket-unvoid', 'ticket-reset',
            'ticket-type-edit', 'ticket-attendee-delete', 'ticket-attendee-edit', 'ticket-regenerate',
            'ticket-email-send', 'ticket-email-queue'],
    },
    tag: {
        en: 'Tag', zh: '标签',
        types: ['tag-create', 'tag-edit', 'tag-delete'],
    },
    location: {
        en: 'Location', zh: '场地',
        types: ['venue-create', 'venue-edit', 'venue-delete',
            'parkinglot-create', 'parkinglot-edit', 'parkinglot-delete',
            'parkingrate-create', 'parkingrate-edit', 'parkingrate-delete'],
    },
    passport: {
        en: 'Passport', zh: '通行证',
        types: ['passport-generate', 'passport-claim', 'passport-delete', 'passport-key-reissue',
            'passport-key-view', 'passport-key-export', 'passport-design-create', 'passport-design-edit',
            'passport-design-delete'],
    },
    qr: {
        en: 'QR', zh: '二维码',
        types: ['qrcode-create', 'qrcode-edit', 'qrcode-delete', 'qrcode-spot-set',
            'social-platform-create', 'social-platform-edit', 'social-platform-delete'],
    },
    account: {
        en: 'Account', zh: '账号',
        types: ['account-deletion-requested', 'account-deletion-cancelled', 'account-deleted',
            'name-set', 'avatar-set', 'avatar-remove', 'banner-remove'],
    },
    config: {
        en: 'Config', zh: '配置',
        types: ['policy-update', 'config-update', 'con-content-update'],
    },
    email: {
        en: 'Email', zh: '邮件',
        types: ['scheduled-mail-drain'],
    },
} as const satisfies Record<string, {en: string; zh: string; types: readonly string[]}>;

export type RecordCategory = keyof typeof RECORD_CATEGORIES;
export type RecordType = (typeof RECORD_CATEGORIES)[RecordCategory]['types'][number];

/** A record as the Records tab reads it. Mirrors RecordFields in functions/src/utils/records.ts. */
export interface ActivityRecord {
    id: string;
    type: RecordType;
    /** Absent on records the system writes: TTL deletions and the mail drain. */
    performedBy?: string;
    performedByName: string;
    targetUid?: string;
    targetName?: string;
    targetEmail?: string;
    eventTitle?: string;
    eventId?: string;
    badgeId?: string;
    badgeName?: string;
    tagName?: string;
    /** Location records: the item's ID, for the link, and its English name at the time. */
    venueId?: string;
    venueName?: string;
    lotId?: string;
    lotName?: string;
    rateId?: string;
    rateLabel?: string;
    qrLabel?: string;
    /** Passport records: the printed code, and its design's year and name. */
    passportId?: string;
    passportYear?: number | null;
    passportDesignName?: string;
    /** How many passports a generate, delete or key export covered. */
    passportCount?: number;
    platformLabel?: string;
    /** Comma-separated con page sections touched by a con-content-update. */
    conSection?: string;
    /** The Site Config sections a config-update saved (keys of CONFIG_SECTION_LABELS). */
    configSections?: string[];
    unlinkedFrom?: number;
    /** Event check-in codes only; see RecordFields.code. */
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
    /** Why a staff grant or its attendance change happened: 'staff-assignment'
     *  (an admin made them staff) or 'staff-code' (they redeemed a staff code). */
    reason?: string;
    addedCount?: number;
    replacedCount?: number;
    sentCount?: number;
    timestamp: Date;
}
