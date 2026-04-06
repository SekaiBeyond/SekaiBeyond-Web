import type { UserGroup } from '~/components/AuthProvider';

export interface BadgeCode {
    id: string;
    code: string;
    eventId: string;
    active: boolean;
    activeFrom: string | null;
    activeUntil: string | null;
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

export interface BadgeDef {
    id: string;
    name: string;
    nameCn: string;
    description: string;
    descriptionCn: string;
    imageUrl: string;
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
}

export type Tab = 'users' | 'events' | 'badges' | 'records';

export type RecordType =
    'group-assign'
    | 'code-create'
    | 'code-activate'
    | 'code-deactivate'
    | 'code-delete'
    | 'badge-grant'       // legacy: means event-attend (kept for backward compat with existing records)
    | 'badge-revoke'      // legacy: means event-unattend (kept for backward compat with existing records)
    | 'event-attend'
    | 'event-unattend'
    | 'achievement-grant'
    | 'achievement-revoke'
    | 'badge-create'
    | 'badge-edit'
    | 'badge-delete'
    | 'event-create'
    | 'event-edit'
    | 'event-delete';

export interface ActivityRecord {
    id: string;
    type: RecordType;
    performedBy: string;
    performedByName: string;
    targetUid?: string;
    targetName?: string;
    eventTitle?: string;
    eventId?: string;
    badgeId?: string;
    badgeName?: string;
    code?: string;
    oldGroup?: UserGroup;
    newGroup?: UserGroup;
    timestamp: Date;
}
