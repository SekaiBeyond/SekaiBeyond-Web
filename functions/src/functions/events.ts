import { type CallableRequest, HttpsError, onCall } from "firebase-functions/v2/https";
import { onDocumentDeleted } from "firebase-functions/v2/firestore";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { adminTransaction, requireAdmin, requireAuth, requireCanManage } from "../utils/auth";
import { cancelDeletion, type Deletable, requestDeletion } from "../utils/deletion";
import { getEventDoc } from "../utils/events";
import { db } from "../utils/firebase";
import { commitInChunks } from "../utils/helpers";
import { deleteStorageFile, logStorageCleanupError, requireNewlyLinkedFilesExist } from "../utils/storage";
import { recordDoc, recordRef, type RecordType } from "../utils/records";
import { siteDay } from "../utils/siteTime";
import {
    validateBoolean,
    validateDay,
    validateDocId,
    validateInstant,
    validateStorageImageUrl,
    validateStr,
    validateStringArray,
    validateUrl
} from "../utils/validation";

const PAST_EVENT: Deletable = {
    collection: "pastEvents",
    idField: "eventId",
    notFound: "Event not found.",
    requested: "event-deletion-requested",
    cancelled: "event-deletion-cancelled",
    describe: (eventId, data) => ({eventTitle: data.title ?? eventId, eventId}),
};

const UPCOMING_EVENT: Deletable = {
    ...PAST_EVENT,
    collection: "upcomingEvents",
    requested: "upcoming-event-deletion-requested",
    cancelled: "upcoming-event-deletion-cancelled",
};

export const requestEventDeletion = onCall({maxInstances: 10}, request => requestDeletion(request, PAST_EVENT));
export const cancelEventDeletion = onCall({maxInstances: 10}, request => cancelDeletion(request, PAST_EVENT));

/**
 * Deletes an event's attendees, email template and settings, which Firestore
 * leaves behind with the event.
 */
async function deleteEventSubcollections(eventRef: FirebaseFirestore.DocumentReference): Promise<void> {
    const snaps = await Promise.all(["attendees", "emailTemplate", "settings"].map(sub => eventRef.collection(sub).get()));
    const ops = snaps.flatMap(snap => snap.docs.map(d => (b: FirebaseFirestore.WriteBatch) => b.delete(d.ref)));
    if (ops.length > 0) await commitInChunks(ops);
}

export const onPastEventDeleted = onDocumentDeleted(
    {document: "pastEvents/{eventId}", maxInstances: 10},
    async (event) => {
        const data = event.data?.data();
        const eventId = event.params.eventId;
        if (!data?.deleteAt) return;

        try {
            const [codesSnap, staffCodesSnap, attendeesSnap, staffSnap] = await Promise.all([
                db.collection("claimCodes").where("eventId", "==", eventId).get(),
                db.collection("staffClaimCodes").where("eventId", "==", eventId).get(),
                db.collection("users").where("attendedEvents", "array-contains", eventId).get(),
                db.collection("users").where("eventStaffEvents", "array-contains", eventId).get(),
            ]);
            const cascadeOps: ((b: FirebaseFirestore.WriteBatch) => void)[] = [
                ...codesSnap.docs.map(d => (b: FirebaseFirestore.WriteBatch) => b.delete(d.ref)),
                ...staffCodesSnap.docs.map(d => (b: FirebaseFirestore.WriteBatch) => b.delete(d.ref)),
                ...attendeesSnap.docs.map(d => (b: FirebaseFirestore.WriteBatch) =>
                    b.update(d.ref, {attendedEvents: FieldValue.arrayRemove(eventId)})
                ),
                ...staffSnap.docs.map(d => (b: FirebaseFirestore.WriteBatch) =>
                    b.update(d.ref, {eventStaffEvents: FieldValue.arrayRemove(eventId)})
                ),
            ];
            if (cascadeOps.length > 0) await commitInChunks(cascadeOps);
        } catch (err) {
            console.error(`onPastEventDeleted: cascade failed for ${eventId}`, err);
        }

        // Firestore leaves subcollections behind: here, the attendees and
        // template a paid event's archive copied over.
        try {
            await deleteEventSubcollections(db.collection("pastEvents").doc(eventId));
        } catch (err) {
            console.error(`onPastEventDeleted: subcollection cleanup failed for ${eventId}`, err);
        }

        await deleteStorageFile(data.icon ?? "", ["events/", "upcoming-events/"])
            .catch(logStorageCleanupError(`onPastEventDeleted ${eventId}`));

        try {
            await recordRef().set(recordDoc("event-deleted", {
                eventId,
                eventTitle: data.title ?? "",
            }));
        } catch (err) {
            console.error(`onPastEventDeleted: record write failed for ${eventId}`, err);
        }
    }
);
export const savePastEvent = onCall({maxInstances: 10}, async (request) => {
    const uid = await requireAuth(request, "staff");

    const input = request.data as Record<string, unknown>;
    const eventId = input.eventId ? validateDocId(input.eventId, "eventId") : null;
    const title = validateStr(input.title, "title", 200, true);
    const titleCn = validateStr(input.titleCn, "titleCn", 200);
    const tagIds = validateStringArray(input.tagIds, "tagIds", 20, 128);
    const date = validateDay(input.date, "date");
    const location = validateStr(input.location, "location", 200);
    const locationCn = validateStr(input.locationCn, "locationCn", 200);
    const venueId = validateStr(input.venueId, "venueId", 128);
    const description = validateStr(input.description, "description", 2000);
    const descriptionCn = validateStr(input.descriptionCn, "descriptionCn", 2000);
    const icon = validateStr(input.icon, "icon", 500);
    validateStorageImageUrl(icon, "icon");
    const recapLink = validateStr(input.recapLink, "recapLink", 500);
    validateUrl(recapLink, "recapLink");
    const recapLinkCn = validateStr(input.recapLinkCn, "recapLinkCn", 500);
    validateUrl(recapLinkCn, "recapLinkCn");

    const data = {
        title, titleCn, tagIds, date, location, locationCn, venueId,
        description, descriptionCn, icon, recapLink, recapLinkCn,
    };
    const docId = eventId ?? db.collection("pastEvents").doc().id;

    const {result, oldIcon} = await adminTransaction(uid, async (txn, callerSnap) => {
        let prevIcon = "";
        if (eventId) {
            const existing = await txn.get(db.collection("pastEvents").doc(eventId));
            if (!existing.exists) throw new HttpsError("not-found", "Event not found.");
            prevIcon = existing.data()?.icon ?? "";
        }
        await requireNewlyLinkedFilesExist([icon], [prevIcon]);
        const ref = db.collection("pastEvents").doc(docId);
        if (eventId) {
            txn.update(ref, data);
        } else {
            txn.set(ref, {...data, published: false});
        }
        txn.set(recordRef(), recordDoc(eventId ? "event-edit" : "event-create", {
            performedBy: uid,
            performedByName: callerSnap.data()?.displayName ?? "",
            eventTitle: title,
            eventId: docId,
        }));
        return {result: {eventId: docId}, oldIcon: prevIcon};
    });

    if (oldIcon && oldIcon !== icon) {
        await deleteStorageFile(oldIcon, ["events/", "upcoming-events/"])
            .catch(logStorageCleanupError(`savePastEvent ${docId}`));
    }

    return result;
});

/** Shows or hides an event on the site. */
async function setEventPublished(
    request: CallableRequest,
    collection: "pastEvents" | "upcomingEvents",
    recordTypes: {publish: RecordType; unpublish: RecordType},
): Promise<{published: boolean}> {
    const uid = await requireAuth(request, "staff");

    const input = request.data as {eventId?: string; published?: unknown};
    const eventId = validateDocId(input.eventId, "eventId");
    const published = validateBoolean(input.published, "published");

    return adminTransaction(uid, async (txn, callerSnap) => {
        const ref = db.collection(collection).doc(eventId);
        const snap = await txn.get(ref);
        if (!snap.exists) throw new HttpsError("not-found", "Event not found.");
        txn.update(ref, {published});
        txn.set(recordRef(), recordDoc(published ? recordTypes.publish : recordTypes.unpublish, {
            performedBy: uid,
            performedByName: callerSnap.data()?.displayName ?? "",
            eventTitle: snap.data()?.title ?? eventId,
            eventId,
        }));
        return {published};
    });
}

export const setPastEventPublished = onCall({maxInstances: 10}, request =>
    setEventPublished(request, "pastEvents", {publish: "past-event-publish", unpublish: "past-event-unpublish"}));
export const saveUpcomingEvent = onCall({maxInstances: 10}, async (request) => {
    const uid = await requireAuth(request, "staff");

    const input = request.data as Record<string, unknown>;
    const eventId = input.eventId ? validateDocId(input.eventId, "eventId") : null;
    const title = validateStr(input.title, "title", 200, true);
    const titleCn = validateStr(input.titleCn, "titleCn", 200);
    const description = validateStr(input.description, "description", 2000);
    const descriptionCn = validateStr(input.descriptionCn, "descriptionCn", 2000);
    const location = validateStr(input.location, "location", 200);
    const locationCn = validateStr(input.locationCn, "locationCn", 200);
    const venueId = validateStr(input.venueId, "venueId", 128);
    const poster = validateStr(input.poster, "poster", 500);
    const emailHeaderBg = validateStr(input.emailHeaderBg, "emailHeaderBg", 500);
    const posterCredit = validateStr(input.posterCredit, "posterCredit", 200);
    const buyTicket = validateStr(input.buyTicket, "buyTicket", 500);
    const learnMore = validateStr(input.learnMore, "learnMore", 500);
    const customButtonText = validateStr(input.customButtonText, "customButtonText", 100);
    const customButtonTextCn = validateStr(input.customButtonTextCn, "customButtonTextCn", 100);
    const customButtonLink = validateStr(input.customButtonLink, "customButtonLink", 500);
    const paid = input.paid === true;

    validateStorageImageUrl(poster, "poster");
    validateStorageImageUrl(emailHeaderBg, "emailHeaderBg");
    validateUrl(buyTicket, "buyTicket");
    validateUrl(learnMore, "learnMore");
    validateUrl(customButtonLink, "customButtonLink");

    const startAtStr = validateInstant(input.startAt, "startAt");
    if (!startAtStr) throw new HttpsError("invalid-argument", "startAt is required.");
    const endAtStr = validateInstant(input.endAt, "endAt");
    if (!endAtStr) throw new HttpsError("invalid-argument", "endAt is required.");
    const startAt = Timestamp.fromDate(new Date(startAtStr));
    const endAt = Timestamp.fromDate(new Date(endAtStr));
    if (endAt.toMillis() <= startAt.toMillis()) {
        throw new HttpsError("invalid-argument", "End time must be after start time.");
    }

    const data = {
        title, titleCn, description, descriptionCn, location, locationCn, venueId,
        startAt, endAt, poster, emailHeaderBg, posterCredit, buyTicket, learnMore,
        customButtonText, customButtonTextCn, customButtonLink, paid,
    };
    const docId = eventId ?? db.collection("upcomingEvents").doc().id;

    const {result, oldPoster, oldEmailHeaderBg} = await adminTransaction(uid, async (txn, callerSnap) => {
        let prevPoster = "";
        let prevEmailHeaderBg = "";
        let wasPublished = false;
        if (eventId) {
            const existing = await txn.get(db.collection("upcomingEvents").doc(eventId));
            if (!existing.exists) throw new HttpsError("not-found", "Event not found.");
            prevPoster = existing.data()?.poster ?? "";
            prevEmailHeaderBg = existing.data()?.emailHeaderBg ?? "";
            wasPublished = existing.data()?.published ?? false;
        }
        await requireNewlyLinkedFilesExist([poster, emailHeaderBg], [prevPoster, prevEmailHeaderBg]);

        // Paid events use tickets, so purge claim codes left from a free→paid
        // switch. Reads before writes, as transactions require.
        let codesToDelete: FirebaseFirestore.QueryDocumentSnapshot[] = [];
        if (paid && eventId) {
            const codesSnap = await txn.get(
                db.collection("claimCodes").where("eventId", "==", eventId)
            );
            codesToDelete = codesSnap.docs;
        }

        const ref = db.collection("upcomingEvents").doc(docId);
        if (eventId) {
            txn.update(ref, {...data, published: wasPublished});
        } else {
            txn.set(ref, {...data, published: false});
        }

        for (const codeDoc of codesToDelete) {
            txn.delete(codeDoc.ref);
            txn.set(recordRef(), recordDoc("event-code-deactivate", {
                performedBy: uid,
                performedByName: callerSnap.data()?.displayName ?? "",
                eventTitle: title,
                eventId: docId,
                code: codeDoc.data().code ?? codeDoc.id,
            }));
        }

        txn.set(recordRef(), recordDoc(eventId ? "upcoming-event-edit" : "upcoming-event-create", {
            performedBy: uid,
            performedByName: callerSnap.data()?.displayName ?? "",
            eventTitle: title,
            eventId: docId,
        }));
        return {result: {eventId: docId}, oldPoster: prevPoster, oldEmailHeaderBg: prevEmailHeaderBg};
    });

    if (oldPoster && oldPoster !== poster) {
        await deleteStorageFile(oldPoster, ["upcoming-events/"])
            .catch(logStorageCleanupError(`saveUpcomingEvent ${docId}`));
    }
    if (oldEmailHeaderBg && oldEmailHeaderBg !== emailHeaderBg) {
        await deleteStorageFile(oldEmailHeaderBg, ["upcoming-events/headers/"])
            .catch(logStorageCleanupError(`saveUpcomingEvent ${docId} header`));
    }

    return result;
});
export const setUpcomingEventPublished = onCall({maxInstances: 10}, request =>
    setEventPublished(request, "upcomingEvents", {
        publish: "upcoming-event-publish",
        unpublish: "upcoming-event-unpublish",
    }));
export const requestUpcomingEventDeletion = onCall({maxInstances: 10},
    request => requestDeletion(request, UPCOMING_EVENT));
export const cancelUpcomingEventDeletion = onCall({maxInstances: 10},
    request => cancelDeletion(request, UPCOMING_EVENT));
export const onUpcomingEventDeleted = onDocumentDeleted(
    {document: "upcomingEvents/{eventId}", maxInstances: 10},
    async (event) => {
        const data = event.data?.data();
        const eventId = event.params.eventId;
        if (!data) return;

        try {
            // Check-in and staff codes belong to the live event and must not survive
            // archive or deletion.
            const [codesSnap, staffCodesSnap] = await Promise.all([
                db.collection("claimCodes").where("eventId", "==", eventId).get(),
                db.collection("staffClaimCodes").where("eventId", "==", eventId).get(),
            ]);
            const cascadeOps = [
                ...codesSnap.docs.map(d =>
                    (b: FirebaseFirestore.WriteBatch) => b.delete(d.ref)),
                ...staffCodesSnap.docs.map(d =>
                    (b: FirebaseFirestore.WriteBatch) => b.delete(d.ref)),
            ];
            if (cascadeOps.length > 0) await commitInChunks(cascadeOps);
        } catch (err) {
            console.error(`onUpcomingEventDeleted: cascade failed for ${eventId}`, err);
        }

        await deleteStorageFile(data.poster ?? "", ["upcoming-events/"])
            .catch(logStorageCleanupError(`onUpcomingEventDeleted ${eventId}`));
        await deleteStorageFile(data.emailHeaderBg ?? "", ["upcoming-events/headers/"])
            .catch(logStorageCleanupError(`onUpcomingEventDeleted ${eventId} header`));

        // The tail end of an archive: archiveUpcomingEvent already wrote its
        // record, and the past event reuses this id, so eventStaffEvents must not
        // be purged.
        let archived = false;
        try {
            archived = (await db.collection("pastEvents").doc(eventId).get()).exists;
        } catch (err) {
            console.error(`onUpcomingEventDeleted: archive check failed for ${eventId}`, err);
        }
        if (archived) return;

        // A hard delete: purge the id from eventStaffEvents.
        try {
            const staffSnap = await db.collection("users")
                .where("eventStaffEvents", "array-contains", eventId).get();
            const staffOps = staffSnap.docs.map(d =>
                (b: FirebaseFirestore.WriteBatch) =>
                    b.update(d.ref, {eventStaffEvents: FieldValue.arrayRemove(eventId)})
            );
            if (staffOps.length > 0) await commitInChunks(staffOps);
        } catch (err) {
            console.error(`onUpcomingEventDeleted: eventStaffEvents cascade failed for ${eventId}`, err);
        }

        // Firestore leaves subcollections behind. An archive never gets here:
        // its Phase C clears its own.
        try {
            await deleteEventSubcollections(db.collection("upcomingEvents").doc(eventId));
        } catch (err) {
            console.error(`onUpcomingEventDeleted: subcollection cleanup failed for ${eventId}`, err);
        }

        try {
            await recordRef().set(recordDoc("upcoming-event-deleted", {
                eventId,
                eventTitle: data.title ?? "",
            }));
        } catch (err) {
            console.error(`onUpcomingEventDeleted: record write failed for ${eventId}`, err);
        }
    }
);

/**
 * Writes that bring `dest` from the `copied` snapshot up to `live`, then empty
 * `live`'s collection. Unchanged docs aren't rewritten. Each copy is queued
 * before its original's delete, and commitInChunks stops at the first failed
 * chunk, so no original goes before its copy lands.
 */
function reconcileCopy(
    copied: FirebaseFirestore.QuerySnapshot,
    live: FirebaseFirestore.QuerySnapshot,
    dest: FirebaseFirestore.CollectionReference,
): ((b: FirebaseFirestore.WriteBatch) => void)[] {
    const copiedAt = new Map(copied.docs.map(d => [d.id, d.updateTime]));
    const ops: ((b: FirebaseFirestore.WriteBatch) => void)[] = [];
    for (const doc of live.docs) {
        if (!copiedAt.get(doc.id)?.isEqual(doc.updateTime)) {
            ops.push(b => b.set(dest.doc(doc.id), doc.data()));
        }
        ops.push(b => b.delete(doc.ref));
    }
    const liveIds = new Set(live.docs.map(d => d.id));
    for (const doc of copied.docs) {
        if (!liveIds.has(doc.id)) ops.push(b => b.delete(dest.doc(doc.id)));
    }
    return ops;
}

export const archiveUpcomingEvent = onCall({maxInstances: 10}, async (request) => {
    const uid = await requireAuth(request, "staff");

    const input = request.data as {eventId?: string; tagIds?: unknown};
    const eventId = validateDocId(input.eventId, "eventId");
    const tagIds = validateStringArray(input.tagIds, "tagIds", 20, 128);
    const newDocRef = db.collection("pastEvents").doc(eventId);

    // Phase A writes before Phase B's transaction checks the caller, so check
    // first: otherwise anyone signed in could copy attendees into an orphaned
    // pastEvents path.
    await requireAdmin(uid);

    // ---- Phase A: stream-copy subcollections to pastEvents ----
    const attendeesSrc = db.collection("upcomingEvents").doc(eventId).collection("attendees");
    const emailTemplateSrc = db.collection("upcomingEvents").doc(eventId).collection("emailTemplate");

    const [attendeesSnap, emailTemplateSnap] = await Promise.all([
        attendeesSrc.get(),
        emailTemplateSrc.get(),
    ]);

    const pastAttendeesCol = newDocRef.collection("attendees");
    const pastEmailTemplateCol = newDocRef.collection("emailTemplate");

    const copyOps: ((b: FirebaseFirestore.WriteBatch) => void)[] = [];

    for (const doc of attendeesSnap.docs) {
        copyOps.push(b => b.set(pastAttendeesCol.doc(doc.id), doc.data()));
    }
    for (const doc of emailTemplateSnap.docs) {
        copyOps.push(b => b.set(pastEmailTemplateCol.doc(doc.id), doc.data()));
    }

    if (copyOps.length > 0) await commitInChunks(copyOps);

    // ---- Phase B: archive transaction (atomic) ----
    const {pastEventId} = await adminTransaction(uid, async (txn, callerSnap) => {
        const [eventSnap, pastCollisionSnap] = await Promise.all([
            txn.get(db.collection("upcomingEvents").doc(eventId)),
            txn.get(newDocRef),
        ]);
        if (!eventSnap.exists) throw new HttpsError("not-found", "Event not found.");
        if (pastCollisionSnap.exists) {
            throw new HttpsError("already-exists", "A past event with this ID already exists.");
        }
        const eventData = eventSnap.data()!;

        const startDate: Date = eventData.startAt?.toDate?.() ?? new Date();
        const dateStr = siteDay(startDate.getTime());

        txn.set(newDocRef, {
            title: eventData.title ?? "",
            titleCn: eventData.titleCn ?? "",
            date: dateStr,
            location: eventData.location ?? "",
            locationCn: eventData.locationCn ?? "",
            venueId: eventData.venueId ?? "",
            description: eventData.description ?? "",
            descriptionCn: eventData.descriptionCn ?? "",
            icon: "",
            tagIds,
            published: false,
            // So the past-events panel shows the read-only Tickets/Stats view.
            paid: eventData.paid === true,
        });
        txn.delete(db.collection("upcomingEvents").doc(eventId));
        txn.set(recordRef(), recordDoc("upcoming-event-archive", {
            performedBy: uid,
            performedByName: callerSnap.data()?.displayName ?? "",
            eventTitle: eventData.title ?? eventId,
            eventId: newDocRef.id,
        }));
        return {pastEventId: newDocRef.id};
    });

    // ---- Phase C: carry over late changes, then delete the originals ----
    //
    // Tickets can change until Phase B deletes the event, so Phase A's copy may
    // be stale. After Phase B the transactional writers refuse, so the live
    // collections are final but for a batch already past its event check.
    // Reconcile before deleting: otherwise late changes are lost, and anything
    // left strands under upcomingEvents/{deletedId}, which
    // onUpcomingEventDeleted skips once a pastEvents doc exists.
    const [liveAttendees, liveTemplate, liveSettings] = await Promise.all([
        attendeesSrc.get(),
        emailTemplateSrc.get(),
        // Door settings (setHometownAdmitUnlisted) only matter while the event
        // runs, so they go without a copy.
        db.collection("upcomingEvents").doc(eventId).collection("settings").get(),
    ]);
    const moveOps = [
        ...reconcileCopy(attendeesSnap, liveAttendees, pastAttendeesCol),
        ...reconcileCopy(emailTemplateSnap, liveTemplate, pastEmailTemplateCol),
        ...liveSettings.docs.map(d => (b: FirebaseFirestore.WriteBatch) => b.delete(d.ref)),
    ];
    if (moveOps.length > 0) await commitInChunks(moveOps);

    // Event staff are kept on archive: eventStaffEvents keeps the past event's id
    // for the profile Staff badge and the admin roster. Admin and scanner access
    // is gated on upcoming events (isEventStaffOnly in admin/index.tsx), so it
    // lapses on its own. The id is purged only when the past event is
    // hard-deleted.

    return {pastEventId};
});
export const toggleAttendance = onCall({maxInstances: 10}, async (request) => {
    const uid = await requireAuth(request, "staff");

    const input = request.data as {targetUid?: string; eventId?: string; grant?: unknown};
    const targetUid = validateDocId(input.targetUid, "targetUid");
    const eventId = validateDocId(input.eventId, "eventId");
    const grant = validateBoolean(input.grant, "grant");

    return adminTransaction(uid, async (txn, callerSnap) => {
        const [targetSnap, {snap: eventSnap, archived}] = await Promise.all([
            txn.get(db.collection("users").doc(targetUid)),
            getEventDoc(eventId, txn),
        ]);
        if (!targetSnap.exists) throw new HttpsError("not-found", "User not found.");
        const targetData = targetSnap.data()!;
        // Self-edits are exempt from the hierarchy check.
        if (targetUid !== uid) requireCanManage(callerSnap.data()!.group, targetData.group);

        if (!eventSnap.exists) throw new HttpsError("not-found", "Event not found.");
        if (!archived && eventSnap.data()!.paid === true) {
            throw new HttpsError(
                "failed-precondition",
                "Paid events use tickets — manage attendance via the Tickets tab.",
                {code: "paid-event"},
            );
        }

        if (grant) {
            const staffEvents: string[] = targetData.eventStaffEvents ?? [];
            if (staffEvents.includes(eventId)) {
                throw new HttpsError(
                    "failed-precondition",
                    "User is event staff for this event. Remove them as staff before adding as attendee.",
                    {code: "has-staff"},
                );
            }
        }

        txn.update(db.collection("users").doc(targetUid), {
            attendedEvents: grant ? FieldValue.arrayUnion(eventId) : FieldValue.arrayRemove(eventId),
        });
        txn.set(recordRef(), recordDoc(grant ? "event-attend" : "event-unattend", {
            performedBy: uid,
            performedByName: callerSnap.data()!.displayName ?? "",
            targetUid,
            targetName: targetData.displayName ?? "",
            eventTitle: eventSnap.data()!.title ?? eventId,
            eventId,
        }));
        return {granted: grant};
    });
});
export const assignEventStaff = onCall({maxInstances: 10}, async (request) => {
    const uid = await requireAuth(request, "staff");

    const input = request.data as {targetUid?: string; eventId?: string};
    const targetUid = validateDocId(input.targetUid, "targetUid");
    const eventId = validateDocId(input.eventId, "eventId");

    return adminTransaction(uid, async (txn, callerSnap) => {
        const [targetSnap, {snap: eventSnap, archived: isPastEvent}] = await Promise.all([
            txn.get(db.collection("users").doc(targetUid)),
            getEventDoc(eventId, txn),
        ]);
        if (!targetSnap.exists) throw new HttpsError("not-found", "User not found.");
        if (!eventSnap.exists) throw new HttpsError("not-found", "Event not found.");

        const targetData = targetSnap.data()!;
        const existing: string[] = targetData.eventStaffEvents ?? [];
        const alreadyStaff = existing.includes(eventId);

        const attendedEvents: string[] = targetData.attendedEvents ?? [];
        const alreadyAttended = attendedEvents.includes(eventId);

        // Past: drop the event from attendedEvents, so staff don't show among a
        // free event's attendees. Upcoming: staff count as attending.
        const attendanceAction: "add" | "remove" | "none" = isPastEvent
            ? (alreadyAttended ? "remove" : "none")
            : (alreadyAttended ? "none" : "add");

        if (alreadyStaff && attendanceAction === "none") {
            return {added: false, attendeeRemoved: false};
        }

        // Past the early return, at least one of these changes.
        txn.update(db.collection("users").doc(targetUid), {
            ...(alreadyStaff ? {} : {eventStaffEvents: FieldValue.arrayUnion(eventId)}),
            ...(attendanceAction === "add" ? {attendedEvents: FieldValue.arrayUnion(eventId)} : {}),
            ...(attendanceAction === "remove" ? {attendedEvents: FieldValue.arrayRemove(eventId)} : {}),
        });

        const fields = {
            performedBy: uid,
            performedByName: callerSnap.data()?.displayName ?? "",
            targetUid,
            targetName: targetData.displayName ?? "",
            eventId,
            eventTitle: eventSnap.data()?.title ?? eventId,
        };
        if (!alreadyStaff) {
            txn.set(recordRef(), recordDoc("event-staff-assign", fields));
        }
        if (attendanceAction !== "none") {
            txn.set(recordRef(), recordDoc(attendanceAction === "add" ? "event-attend" : "event-unattend", {
                ...fields,
                reason: "staff-assignment",
            }));
        }
        return {
            added: !alreadyStaff,
            attendeeRemoved: attendanceAction === "remove",
        };
    });
});
export const removeEventStaff = onCall({maxInstances: 10}, async (request) => {
    const uid = await requireAuth(request, "staff");

    const input = request.data as {targetUid?: string; eventId?: string};
    const targetUid = validateDocId(input.targetUid, "targetUid");
    const eventId = validateDocId(input.eventId, "eventId");

    return adminTransaction(uid, async (txn, callerSnap) => {
        const [targetSnap, {snap: eventSnap}] = await Promise.all([
            txn.get(db.collection("users").doc(targetUid)),
            getEventDoc(eventId, txn),
        ]);
        if (!targetSnap.exists) throw new HttpsError("not-found", "User not found.");
        const targetData = targetSnap.data()!;
        const existing: string[] = targetData.eventStaffEvents ?? [];
        if (!existing.includes(eventId)) {
            return {removed: false};
        }

        // An event deleted since keeps its ID in the record.
        const eventTitle: string = eventSnap.data()?.title ?? eventId;

        txn.update(db.collection("users").doc(targetUid), {
            eventStaffEvents: FieldValue.arrayRemove(eventId),
        });
        txn.set(recordRef(), recordDoc("event-staff-remove", {
            performedBy: uid,
            performedByName: callerSnap.data()?.displayName ?? "",
            targetUid,
            targetName: targetData.displayName ?? "",
            eventId,
            eventTitle,
        }));
        return {removed: true};
    });
});
