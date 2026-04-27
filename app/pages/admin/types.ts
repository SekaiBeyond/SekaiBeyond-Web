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
    joinedAt: Date;
    attendedEvents: string[];
    badges: string[];
    group: UserGroup;
    title?: string;
    eventStaffEvents: string[];
}

export type Tab = 'users' | 'events' | 'badges' | 'records' | 'tools' | 'config';

export type RecordType =
    'group-assign'
    | 'code-create'
    | 'badge-code-activate'
    | 'badge-code-deactivate'
    | 'code-delete'
    | 'badge-grant'       // legacy: means event-attend (kept for backward compat with existing records)
    | 'badge-revoke'      // legacy: means event-unattend (kept for backward compat with existing records)
    | 'event-attend'
    | 'event-unattend'
    | 'event-claim'
    | 'badge-claim'
    | 'achievement-grant'
    | 'achievement-revoke'
    | 'badge-create'
    | 'badge-edit'
    | 'badge-delete'
    | 'badge-deletion-requested'
    | 'badge-deletion-cancelled'
    | 'badge-deleted'
    | 'event-create'
    | 'event-edit'
    | 'event-delete'
    | 'event-deletion-requested'
    | 'event-deletion-cancelled'
    | 'event-deleted'
    | 'past-event-publish'
    | 'past-event-unpublish'
    | 'upcoming-event-create'
    | 'upcoming-event-edit'
    | 'upcoming-event-delete'
    | 'upcoming-event-deletion-requested'
    | 'upcoming-event-deletion-cancelled'
    | 'upcoming-event-deleted'
    | 'upcoming-event-archive'
    | 'upcoming-event-publish'
    | 'upcoming-event-unpublish'
    | 'event-code-activate'
    | 'event-code-deactivate'
    | 'event-code-time-window'
    | 'tag-create'
    | 'tag-edit'
    | 'tag-delete'
    | 'account-deletion-requested'
    | 'account-deletion-cancelled'
    | 'account-deleted'
    | 'title-set'
    | 'ticket-import'
    | 'ticket-redeem'
    | 'ticket-void'
    | 'ticket-attendee-delete'
    | 'ticket-attendee-edit'
    | 'ticket-regenerate'
    | 'ticket-email-send'
    | 'event-staff-assign'
    | 'event-staff-remove'
    | 'upcoming-event-email-template-update'
    | 'policy-update'
    | 'config-update';

export interface ActivityRecord {
    id: string;
    type: RecordType;
    performedBy: string;
    performedByName: string;
    targetUid?: string;
    targetName?: string;
    targetEmail?: string;
    eventTitle?: string;
    eventId?: string;
    badgeId?: string;
    badgeName?: string;
    tagName?: string;
    code?: string;
    oldGroup?: UserGroup;
    newGroup?: UserGroup;
    oldTitle?: string;
    newTitle?: string;
    oldName?: string;
    newName?: string;
    addedCount?: number;
    replacedCount?: number;
    sentCount?: number;
    timestamp: Date;
}
