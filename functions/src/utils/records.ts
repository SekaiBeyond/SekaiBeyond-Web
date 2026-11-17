import { FieldValue } from "firebase-admin/firestore";
import { recordExpiresAt } from "./config";
import { db } from "./firebase";

export type RecordType =
    | "group-assign"
    | "title-set"
    | "event-staff-assign"
    | "event-staff-remove"
    | "membership-grant"
    | "membership-extend"
    | "membership-revoke"
    | "code-create"
    | "badge-code-activate"
    | "badge-code-deactivate"
    | "code-delete"
    | "event-code-activate"
    | "event-code-deactivate"
    | "event-code-time-window"
    | "staff-code-create"
    | "staff-code-activate"
    | "staff-code-deactivate"
    | "staff-code-time-window"
    | "staff-code-delete"
    | "event-attend"
    | "event-unattend"
    | "event-claim"
    | "achievement-grant"
    | "achievement-revoke"
    | "badge-claim"
    | "badge-create"
    | "badge-edit"
    | "badge-deletion-requested"
    | "badge-deletion-cancelled"
    | "badge-deleted"
    | "event-create"
    | "event-edit"
    | "event-deletion-requested"
    | "event-deletion-cancelled"
    | "event-deleted"
    | "past-event-publish"
    | "past-event-unpublish"
    | "upcoming-event-create"
    | "upcoming-event-edit"
    | "upcoming-event-deletion-requested"
    | "upcoming-event-deletion-cancelled"
    | "upcoming-event-deleted"
    | "upcoming-event-archive"
    | "upcoming-event-publish"
    | "upcoming-event-unpublish"
    | "upcoming-event-email-template-update"
    | "upcoming-event-wallet-pass-update"
    | "ticket-import"
    | "ticket-walk-in"
    | "ticket-redeem"
    | "ticket-void"
    | "ticket-unvoid"
    | "ticket-reset"
    | "ticket-type-edit"
    | "ticket-notes-edit"
    | "ticket-attendee-delete"
    | "ticket-attendee-edit"
    | "ticket-regenerate"
    | "ticket-email-send"
    | "ticket-email-queue"
    | "ticket-api-order"
    | "hometown-import"
    | "hometown-order-times"
    | "hometown-admit-unlisted"
    | "tag-create"
    | "tag-edit"
    | "tag-delete"
    | "venue-create"
    | "venue-edit"
    | "venue-delete"
    | "parking-sync"
    | "passport-generate"
    | "passport-claim"
    | "passport-delete"
    | "passport-key-reissue"
    | "passport-key-view"
    | "passport-key-export"
    | "passport-note-edit"
    | "passport-design-create"
    | "passport-design-edit"
    | "passport-design-delete"
    | "passport-email-send"
    | "passport-email-queue"
    | "passport-email-template-update"
    | "qrcode-create"
    | "qrcode-edit"
    | "qrcode-delete"
    | "qrcode-spot-set"
    | "social-platform-create"
    | "social-platform-edit"
    | "social-platform-delete"
    | "account-deletion-requested"
    | "account-deletion-cancelled"
    | "account-deleted"
    | "name-set"
    | "avatar-set"
    | "avatar-remove"
    | "banner-remove"
    | "account-password-set"
    | "account-google-bind"
    | "account-google-unbind"
    | "account-app-link"
    | "account-app-unlink"
    | "account-app-link-undo"
    | "account-app-hold-clear"
    | "account-email-change"
    | "account-email-undo"
    | "account-ban"
    | "account-unban"
    | "policy-update"
    | "config-update"
    | "con-content-update"
    | "api-key-create"
    | "api-key-rename"
    | "api-key-revoke"
    | "app-create"
    | "app-update"
    | "app-delete"
    | "scheduled-mail-drain";

export interface RecordFields {
    performedBy?: string;
    performedByName?: string;
    targetUid?: string | null;
    targetName?: string;
    targetEmail?: string;
    oldEmail?: string;
    eventId?: string;
    eventTitle?: string;
    badgeId?: string;
    badgeName?: string;
    tagName?: string;
    venueId?: string;
    venueName?: string;
    qrLabel?: string;
    passportId?: string | null;
    passportYear?: number | null;
    passportDesignName?: string;
    passportCount?: number;
    passportSentTo?: string;
    platformLabel?: string;
    conSection?: string;
    configSections?: string[];
    lotCount?: number;
    code?: string;
    oldGroup?: string;
    newGroup?: string;
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
    reason?: "staff-assignment" | "staff-code";
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
    linkEndedBy?: "email-undo" | "account-deleted" | "app-removed";
    banUntil?: string;
    banReason?: string;
}

export function recordRef(id?: string): FirebaseFirestore.DocumentReference {
    const records = db.collection("records");
    return id ? records.doc(id) : records.doc();
}

export const performer = (uid: string, snap: FirebaseFirestore.DocumentSnapshot) =>
    ({performedBy: uid, performedByName: (snap.data()?.displayName as string | undefined) ?? ""});

export function recordDoc(type: RecordType, fields: RecordFields) {
    return {
        type,
        ...fields,
        timestamp: FieldValue.serverTimestamp(),
        expiresAt: recordExpiresAt(),
    };
}
