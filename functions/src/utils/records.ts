import { FieldValue } from "firebase-admin/firestore";
import { recordExpiresAt } from "./config";
import { db } from "./firebase";

/**
 * Every type of record the functions write, grouped as the Records tab's
 * categories are. Mirrors RECORD_CATEGORIES in app/pages/admin/types.ts; a type
 * missing there shows as its raw slug, in no filter and with no colour.
 */
export type RecordType =
    | "group-assign" | "title-set" | "event-staff-assign" | "event-staff-remove"
    | "membership-grant" | "membership-extend" | "membership-revoke"
    | "code-create" | "badge-code-activate" | "badge-code-deactivate" | "code-delete"
    | "event-code-activate" | "event-code-deactivate" | "event-code-time-window"
    | "staff-code-create" | "staff-code-activate" | "staff-code-deactivate" | "staff-code-time-window"
    | "event-attend" | "event-unattend" | "event-claim"
    | "achievement-grant" | "achievement-revoke" | "badge-claim" | "badge-create" | "badge-edit"
    | "badge-deletion-requested" | "badge-deletion-cancelled" | "badge-deleted"
    | "event-create" | "event-edit"
    | "event-deletion-requested" | "event-deletion-cancelled" | "event-deleted"
    | "past-event-publish" | "past-event-unpublish"
    | "upcoming-event-create" | "upcoming-event-edit"
    | "upcoming-event-deletion-requested" | "upcoming-event-deletion-cancelled" | "upcoming-event-deleted"
    | "upcoming-event-archive" | "upcoming-event-publish" | "upcoming-event-unpublish"
    | "upcoming-event-email-template-update"
    | "ticket-import" | "ticket-redeem" | "ticket-void" | "ticket-unvoid" | "ticket-reset"
    | "ticket-type-edit" | "ticket-attendee-delete" | "ticket-attendee-edit" | "ticket-regenerate"
    | "ticket-email-send" | "ticket-email-queue"
    | "tag-create" | "tag-edit" | "tag-delete"
    | "venue-create" | "venue-edit" | "venue-delete"
    | "parkinglot-create" | "parkinglot-edit" | "parkinglot-delete"
    | "parkingrate-create" | "parkingrate-edit" | "parkingrate-delete"
    | "passport-generate" | "passport-claim" | "passport-delete" | "passport-key-reissue"
    | "passport-key-view" | "passport-key-export"
    | "passport-design-create" | "passport-design-edit" | "passport-design-delete"
    | "qrcode-create" | "qrcode-edit" | "qrcode-delete" | "qrcode-spot-set"
    | "social-platform-create" | "social-platform-edit" | "social-platform-delete"
    | "account-deletion-requested" | "account-deletion-cancelled" | "account-deleted"
    | "name-set" | "avatar-set" | "avatar-remove" | "banner-remove"
    | "policy-update" | "config-update" | "con-content-update"
    | "scheduled-mail-drain";

/** What a record says besides its type. Mirrors ActivityRecord in app/pages/admin/types.ts. */
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
    /** Event check-in codes only: badge and staff codes are core-staff+, and all staff read records. */
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
    /** Why a staff grant or its attendance change happened. */
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

/** A record's data, stamped with when it was written and when it expires. */
export function recordDoc(type: RecordType, fields: RecordFields) {
    return {
        type,
        ...fields,
        timestamp: FieldValue.serverTimestamp(),
        expiresAt: recordExpiresAt(),
    };
}
