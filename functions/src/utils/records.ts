import { FieldValue } from "firebase-admin/firestore";
import { recordExpiresAt } from "./config";
import { db } from "./firebase";

/**
 * Every type of activity record the functions write. Mirrors RECORD_CATEGORIES
 * in app/pages/admin/types.ts, which files each one under a Records tab
 * category: a type missing there still shows, but as its raw slug, in no
 * filter and with no colour.
 */
export type RecordType =
// Role
    | "group-assign" | "title-set" | "event-staff-assign" | "event-staff-remove"
    // Membership
    | "membership-grant" | "membership-extend" | "membership-revoke"
    // Code
    | "code-create" | "badge-code-activate" | "badge-code-deactivate" | "code-delete"
    | "event-code-activate" | "event-code-deactivate" | "event-code-time-window"
    | "staff-code-create" | "staff-code-activate" | "staff-code-deactivate" | "staff-code-time-window"
    // Attend
    | "event-attend" | "event-unattend" | "event-claim"
    // Badge
    | "achievement-grant" | "achievement-revoke" | "badge-claim" | "badge-create" | "badge-edit"
    | "badge-deletion-requested" | "badge-deletion-cancelled" | "badge-deleted"
    // Event
    | "event-create" | "event-edit"
    | "event-deletion-requested" | "event-deletion-cancelled" | "event-deleted"
    | "past-event-publish" | "past-event-unpublish"
    | "upcoming-event-create" | "upcoming-event-edit"
    | "upcoming-event-deletion-requested" | "upcoming-event-deletion-cancelled" | "upcoming-event-deleted"
    | "upcoming-event-archive" | "upcoming-event-publish" | "upcoming-event-unpublish"
    | "upcoming-event-email-template-update"
    // Ticket
    | "ticket-import" | "ticket-redeem" | "ticket-void" | "ticket-unvoid" | "ticket-reset"
    | "ticket-type-edit" | "ticket-attendee-delete" | "ticket-attendee-edit" | "ticket-regenerate"
    | "ticket-email-send" | "ticket-email-queue"
    // Tag
    | "tag-create" | "tag-edit" | "tag-delete"
    // Location
    | "venue-create" | "venue-edit" | "venue-delete"
    | "parkinglot-create" | "parkinglot-edit" | "parkinglot-delete"
    | "parkingrate-create" | "parkingrate-edit" | "parkingrate-delete"
    // Passport
    | "passport-generate" | "passport-claim" | "passport-delete" | "passport-key-reissue"
    | "passport-key-view" | "passport-key-export"
    | "passport-design-create" | "passport-design-edit" | "passport-design-delete"
    // QR
    | "qrcode-create" | "qrcode-edit" | "qrcode-delete" | "qrcode-spot-set"
    | "social-platform-create" | "social-platform-edit" | "social-platform-delete"
    // Account
    | "account-deletion-requested" | "account-deletion-cancelled" | "account-deleted"
    | "name-set" | "avatar-set" | "avatar-remove" | "banner-remove"
    // Config
    | "policy-update" | "config-update" | "con-content-update"
    // Email
    | "scheduled-mail-drain";

/**
 * What a record says besides its type. Mirrors ActivityRecord in
 * app/pages/admin/types.ts, which is where each field is read back.
 */
export interface RecordFields {
    /** Left out when the system acts: TTL deletions and the mail drain. */
    performedBy?: string;
    performedByName?: string;
    /** Null when a claimed passport being deleted names no holder. */
    targetUid?: string | null;
    targetName?: string;
    targetEmail?: string;
    eventId?: string;
    eventTitle?: string;
    badgeId?: string;
    badgeName?: string;
    tagName?: string;
    venueId?: string;
    venueName?: string;
    lotId?: string;
    lotName?: string;
    rateId?: string;
    rateLabel?: string;
    qrLabel?: string;
    /** Null on a bulk passport action, which only counts what it touched. */
    passportId?: string | null;
    passportYear?: number | null;
    passportDesignName?: string;
    passportCount?: number;
    platformLabel?: string;
    conSection?: string;
    configSections?: string[];
    unlinkedFrom?: number;
    /**
     * Event check-in codes only. Badge activation and staff codes are
     * core-staff+, but every staff member can read records.
     */
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
    /** How a staff grant, or the attendance change that came with one, came about. */
    reason?: "staff-assignment" | "staff-code";
    addedCount?: number;
    replacedCount?: number;
    sentCount?: number;
}

/** Where a new record goes. A fixed `id` makes a retried write land on the same record. */
export function recordRef(id?: string): FirebaseFirestore.DocumentReference {
    const records = db.collection("records");
    return id ? records.doc(id) : records.doc();
}

/** A record's data: its type and fields, stamped with when it was written and when it expires. */
export function recordDoc(type: RecordType, fields: RecordFields) {
    return {
        type,
        ...fields,
        timestamp: FieldValue.serverTimestamp(),
        expiresAt: recordExpiresAt(),
    };
}
