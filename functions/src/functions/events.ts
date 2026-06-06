import { HttpsError, onCall } from "firebase-functions/v2/https";
import { onDocumentDeleted } from "firebase-functions/v2/firestore";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { adminTransaction, checkRateLimit, requireAuth } from "../utils/auth";
import { deletionExpiresAt, recordExpiresAt } from "../utils/config";
import { db } from "../utils/firebase";
import { commitInChunks } from "../utils/helpers";
import { deleteStorageFile, logStorageCleanupError } from "../utils/storage";
import { validateDocId, validateISODate, validateStorageImageUrl, validateStr, validateUrl } from "../utils/validation";

export const requestEventDeletion = onCall({maxInstances: 10}, async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Must be signed in.");
    const uid = request.auth.uid;
    await checkRateLimit(uid);

    const eventId = validateDocId((request.data as {eventId?: string})?.eventId, "eventId");
    const deleteAt = deletionExpiresAt();

    await adminTransaction(uid, async (txn, callerSnap) => {
        const eventSnap = await txn.get(db.collection("pastEvents").doc(eventId));
        if (!eventSnap.exists) throw new HttpsError("not-found", "Event not found.");
        const data = eventSnap.data()!;

        if (data.deleteAt && data.deleteAt.toMillis() > Date.now()) {
            throw new HttpsError("already-exists", "deletion-already-pending");
        }

        txn.update(db.collection("pastEvents").doc(eventId), {deleteAt});
        txn.set(db.collection("records").doc(), {
            type: "event-deletion-requested",
            performedBy: uid,
            performedByName: callerSnap.data()?.displayName ?? "",
            eventTitle: data.title ?? eventId,
            eventId,
            timestamp: FieldValue.serverTimestamp(),
            expiresAt: recordExpiresAt(),
        });
    });

    return {deleteAt: deleteAt.toDate().toISOString()};
});
export const cancelEventDeletion = onCall({maxInstances: 10}, async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Must be signed in.");
    const uid = request.auth.uid;
    await checkRateLimit(uid);

    const eventId = validateDocId((request.data as {eventId?: string})?.eventId, "eventId");

    await adminTransaction(uid, async (txn, callerSnap) => {
        const eventSnap = await txn.get(db.collection("pastEvents").doc(eventId));
        if (!eventSnap.exists) throw new HttpsError("not-found", "Event not found.");
        const data = eventSnap.data()!;

        if (!data.deleteAt || data.deleteAt.toMillis() <= Date.now()) {
            throw new HttpsError("not-found", "No pending deletion.");
        }

        txn.update(db.collection("pastEvents").doc(eventId), {deleteAt: FieldValue.delete()});
        txn.set(db.collection("records").doc(), {
            type: "event-deletion-cancelled",
            performedBy: uid,
            performedByName: callerSnap.data()?.displayName ?? "",
            eventTitle: data.title ?? eventId,
            eventId,
            timestamp: FieldValue.serverTimestamp(),
            expiresAt: recordExpiresAt(),
        });
    });

    return {cancelled: true};
});
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

        await deleteStorageFile(data.icon ?? "", ["events/", "upcoming-events/"])
            .catch(logStorageCleanupError(`onPastEventDeleted ${eventId}`));

        try {
            await db.collection("records").add({
                type: "event-deleted",
                eventId,
                eventTitle: data.title ?? "",
                timestamp: FieldValue.serverTimestamp(),
                expiresAt: recordExpiresAt(),
            });
        } catch (err) {
            console.error(`onPastEventDeleted: record write failed for ${eventId}`, err);
        }
    }
);
export const savePastEvent = onCall({maxInstances: 10}, async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Must be signed in.");
    const uid = request.auth.uid;
    await checkRateLimit(uid);

    const input = request.data as Record<string, unknown>;
    const eventId = input.eventId ? validateDocId(input.eventId, "eventId") : null;
    const title = validateStr(input.title, "title", 200, true);
    const titleCn = validateStr(input.titleCn, "titleCn", 200);
    const tagId = validateStr(input.tagId, "tagId", 128);
    const date = validateStr(input.date, "date", 50, true);
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
        title, titleCn, tagId, date, location, locationCn, venueId,
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
        const ref = db.collection("pastEvents").doc(docId);
        if (eventId) {
            txn.update(ref, data);
        } else {
            txn.set(ref, {...data, published: false});
        }
        txn.set(db.collection("records").doc(), {
            type: eventId ? "event-edit" : "event-create",
            performedBy: uid,
            performedByName: callerSnap.data()?.displayName ?? "",
            eventTitle: title,
            eventId: docId,
            timestamp: FieldValue.serverTimestamp(),
            expiresAt: recordExpiresAt(),
        });
        return {result: {eventId: docId}, oldIcon: prevIcon};
    });

    if (oldIcon && oldIcon !== icon) {
        await deleteStorageFile(oldIcon, ["events/", "upcoming-events/"])
            .catch(logStorageCleanupError(`savePastEvent ${docId}`));
    }

    return result;
});
export const setPastEventPublished = onCall({maxInstances: 10}, async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Must be signed in.");
    const uid = request.auth.uid;
    await checkRateLimit(uid);

    const input = request.data as {eventId?: string; published?: boolean};
    const eventId = validateDocId(input.eventId, "eventId");
    if (typeof input.published !== "boolean") {
        throw new HttpsError("invalid-argument", "published must be a boolean.");
    }

    return adminTransaction(uid, async (txn, callerSnap) => {
        const ref = db.collection("pastEvents").doc(eventId);
        const snap = await txn.get(ref);
        if (!snap.exists) throw new HttpsError("not-found", "Event not found.");
        txn.update(ref, {published: input.published});
        txn.set(db.collection("records").doc(), {
            type: input.published ? "past-event-publish" : "past-event-unpublish",
            performedBy: uid,
            performedByName: callerSnap.data()?.displayName ?? "",
            eventTitle: snap.data()?.title ?? eventId,
            eventId,
            timestamp: FieldValue.serverTimestamp(),
            expiresAt: recordExpiresAt(),
        });
        return {published: input.published};
    });
});
export const saveUpcomingEvent = onCall({maxInstances: 10}, async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Must be signed in.");
    const uid = request.auth.uid;
    await checkRateLimit(uid);

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

    const startAtStr = validateISODate(input.startAt, "startAt");
    if (!startAtStr) throw new HttpsError("invalid-argument", "startAt is required.");
    const endAtStr = validateISODate(input.endAt, "endAt");
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

        // Paid events use tickets, not check-in codes — purge any claim codes
        // that exist for this event (e.g., left over from a free→paid toggle).
        // Reads must happen before writes inside the transaction.
        let codesToDelete: FirebaseFirestore.QueryDocumentSnapshot[] = [];
        if (paid && eventId) {
            const codesSnap = await txn.get(
                db.collection("claimCodes").where("eventId", "==", eventId)
            );
            codesToDelete = codesSnap.docs;
        }

        const ref = db.collection("upcomingEvents").doc(docId);
        if (eventId) {
            // Delete legacy name/nameCn fields on edit so pre-rename docs migrate cleanly.
            txn.update(ref, {
                ...data,
                published: wasPublished,
                name: FieldValue.delete(),
                nameCn: FieldValue.delete(),
            });
        } else {
            txn.set(ref, {...data, published: false});
        }

        for (const codeDoc of codesToDelete) {
            txn.delete(codeDoc.ref);
            txn.set(db.collection("records").doc(), {
                type: "event-code-deactivate",
                performedBy: uid,
                performedByName: callerSnap.data()?.displayName ?? "",
                eventTitle: title,
                eventId: docId,
                code: codeDoc.data().code ?? codeDoc.id,
                timestamp: FieldValue.serverTimestamp(),
                expiresAt: recordExpiresAt(),
            });
        }

        txn.set(db.collection("records").doc(), {
            type: eventId ? "upcoming-event-edit" : "upcoming-event-create",
            performedBy: uid,
            performedByName: callerSnap.data()?.displayName ?? "",
            eventTitle: title,
            eventId: docId,
            timestamp: FieldValue.serverTimestamp(),
            expiresAt: recordExpiresAt(),
        });
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
export const setUpcomingEventPublished = onCall({maxInstances: 10}, async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Must be signed in.");
    const uid = request.auth.uid;
    await checkRateLimit(uid);

    const input = request.data as {eventId?: string; published?: boolean};
    const eventId = validateDocId(input.eventId, "eventId");
    if (typeof input.published !== "boolean") {
        throw new HttpsError("invalid-argument", "published must be a boolean.");
    }

    return adminTransaction(uid, async (txn, callerSnap) => {
        const ref = db.collection("upcomingEvents").doc(eventId);
        const snap = await txn.get(ref);
        if (!snap.exists) throw new HttpsError("not-found", "Event not found.");
        txn.update(ref, {published: input.published});
        txn.set(db.collection("records").doc(), {
            type: input.published ? "upcoming-event-publish" : "upcoming-event-unpublish",
            performedBy: uid,
            performedByName: callerSnap.data()?.displayName ?? "",
            eventTitle: snap.data()?.title ?? snap.data()?.name ?? eventId,
            eventId,
            timestamp: FieldValue.serverTimestamp(),
            expiresAt: recordExpiresAt(),
        });
        return {published: input.published};
    });
});
export const requestUpcomingEventDeletion = onCall({maxInstances: 10}, async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Must be signed in.");
    const uid = request.auth.uid;
    await checkRateLimit(uid);

    const eventId = validateDocId((request.data as {eventId?: string})?.eventId, "eventId");
    const deleteAt = deletionExpiresAt();

    await adminTransaction(uid, async (txn, callerSnap) => {
        const eventSnap = await txn.get(db.collection("upcomingEvents").doc(eventId));
        if (!eventSnap.exists) throw new HttpsError("not-found", "Event not found.");
        const data = eventSnap.data()!;

        if (data.deleteAt && data.deleteAt.toMillis() > Date.now()) {
            throw new HttpsError("already-exists", "deletion-already-pending");
        }

        txn.update(db.collection("upcomingEvents").doc(eventId), {deleteAt});
        txn.set(db.collection("records").doc(), {
            type: "upcoming-event-deletion-requested",
            performedBy: uid,
            performedByName: callerSnap.data()?.displayName ?? "",
            eventTitle: data.title ?? data.name ?? eventId,
            eventId,
            timestamp: FieldValue.serverTimestamp(),
            expiresAt: recordExpiresAt(),
        });
    });

    return {deleteAt: deleteAt.toDate().toISOString()};
});
export const cancelUpcomingEventDeletion = onCall({maxInstances: 10}, async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Must be signed in.");
    const uid = request.auth.uid;
    await checkRateLimit(uid);

    const eventId = validateDocId((request.data as {eventId?: string})?.eventId, "eventId");

    await adminTransaction(uid, async (txn, callerSnap) => {
        const eventSnap = await txn.get(db.collection("upcomingEvents").doc(eventId));
        if (!eventSnap.exists) throw new HttpsError("not-found", "Event not found.");
        const data = eventSnap.data()!;

        if (!data.deleteAt || data.deleteAt.toMillis() <= Date.now()) {
            throw new HttpsError("not-found", "No pending deletion.");
        }

        txn.update(db.collection("upcomingEvents").doc(eventId), {deleteAt: FieldValue.delete()});
        txn.set(db.collection("records").doc(), {
            type: "upcoming-event-deletion-cancelled",
            performedBy: uid,
            performedByName: callerSnap.data()?.displayName ?? "",
            eventTitle: data.title ?? data.name ?? eventId,
            eventId,
            timestamp: FieldValue.serverTimestamp(),
            expiresAt: recordExpiresAt(),
        });
    });

    return {cancelled: true};
});
export const onUpcomingEventDeleted = onDocumentDeleted(
    {document: "upcomingEvents/{eventId}", maxInstances: 10},
    async (event) => {
        const data = event.data?.data();
        const eventId = event.params.eventId;
        if (!data) return;

        try {
            // Wipe both event check-in codes and staff claim codes — they're scoped
            // to the live event and must not survive archive/deletion. A fresh staff
            // code can be generated for the past event afterward if needed.
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

        // Skip the deleted-record write if this deletion was the tail end of an
        // archive — archiveUpcomingEvent already wrote an "upcoming-event-archive"
        // record, and the past event reuses this ID (so eventStaffEvents
        // references stay valid, and we must NOT purge them).
        let archived = false;
        try {
            archived = (await db.collection("pastEvents").doc(eventId).get()).exists;
        } catch (err) {
            console.error(`onUpcomingEventDeleted: archive check failed for ${eventId}`, err);
        }
        if (archived) return;

        // Hard delete (TTL-driven or admin abort) — purge eventStaffEvents
        // references from users so stale event IDs don't haunt assignments.
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

        // Clean up any orphaned subcollection docs (can occur if archive fails
        // after Phase C partially completed, or on TTL-driven deletion).
        try {
            const orphanedOps: ((b: FirebaseFirestore.WriteBatch) => void)[] = [];
            for (const subCol of ["attendees", "emailTemplate"]) {
                const snap = await db.collection("upcomingEvents").doc(eventId)
                    .collection(subCol).get();
                for (const d of snap.docs) {
                    orphanedOps.push(b => b.delete(d.ref));
                }
            }
            if (orphanedOps.length > 0) await commitInChunks(orphanedOps);
        } catch (err) {
            console.error(`onUpcomingEventDeleted: subcollection cleanup failed for ${eventId}`, err);
        }

        try {
            await db.collection("records").add({
                type: "upcoming-event-deleted",
                eventId,
                eventTitle: data.title ?? data.name ?? "",
                timestamp: FieldValue.serverTimestamp(),
                expiresAt: recordExpiresAt(),
            });
        } catch (err) {
            console.error(`onUpcomingEventDeleted: record write failed for ${eventId}`, err);
        }
    }
);
export const archiveUpcomingEvent = onCall({maxInstances: 10}, async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Must be signed in.");
    const uid = request.auth.uid;
    await checkRateLimit(uid);

    const input = request.data as {eventId?: string; tagId?: string};
    const eventId = validateDocId(input.eventId, "eventId");
    const tagId = validateStr(input.tagId, "tagId", 128);
    const newDocRef = db.collection("pastEvents").doc(eventId);

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
        const dateStr = new Intl.DateTimeFormat("en-CA", {
            timeZone: "America/Los_Angeles",
            year: "numeric", month: "2-digit", day: "2-digit",
        }).format(startDate);

        txn.set(newDocRef, {
            title: eventData.title ?? eventData.name ?? "",
            titleCn: eventData.titleCn ?? eventData.nameCn ?? "",
            date: dateStr,
            location: eventData.location ?? "",
            locationCn: eventData.locationCn ?? "",
            venueId: eventData.venueId ?? "",
            description: eventData.description ?? "",
            descriptionCn: eventData.descriptionCn ?? "",
            icon: "",
            tagId,
            published: false,
            // Preserve paid status so the past-events panel can show the
            // read-only Tickets/Stats view instead of the free attendee list.
            paid: eventData.paid === true,
        });
        txn.delete(db.collection("upcomingEvents").doc(eventId));
        txn.set(db.collection("records").doc(), {
            type: "upcoming-event-archive",
            performedBy: uid,
            performedByName: callerSnap.data()?.displayName ?? "",
            eventTitle: eventData.title ?? eventData.name ?? eventId,
            eventId: newDocRef.id,
            timestamp: FieldValue.serverTimestamp(),
            expiresAt: recordExpiresAt(),
        });
        return {pastEventId: newDocRef.id};
    });

    // ---- Phase C: delete original subcollections in chunks ----
    // Re-query the LIVE collections so any doc written between Phase A and
    // Phase B (a concurrent attendee import / template edit) still gets wiped.
    // Without this, late arrivals strand under upcomingEvents/{deletedId}/…
    // and onUpcomingEventDeleted's fallback cleanup is skipped because the
    // archive path wrote a pastEvents doc with the same id.
    const [liveAttendees, liveTemplate] = await Promise.all([
        attendeesSrc.get(),
        emailTemplateSrc.get(),
    ]);
    const deleteOps: ((b: FirebaseFirestore.WriteBatch) => void)[] = [];
    for (const doc of liveAttendees.docs) {
        deleteOps.push(b => b.delete(doc.ref));
    }
    for (const doc of liveTemplate.docs) {
        deleteOps.push(b => b.delete(doc.ref));
    }
    if (deleteOps.length > 0) await commitInChunks(deleteOps);

    // Event staff are intentionally retained on archive. Past-event staff are
    // tracked via eventStaffEvents (the past-event id stays in the array) — that
    // same array drives the profile Staff badge (users.ts) and the admin roster,
    // and lets admins keep/assign staff on past events. Lingering admin/scanner
    // access is avoided by gating event-staff access on *upcoming* assigned events
    // rather than raw eventStaffEvents membership (see admin/index.tsx
    // isEventStaffOnly). eventStaffEvents is purged only when the past event is
    // hard-deleted (onPastEventDeleted).

    return {pastEventId};
});
export const toggleAttendance = onCall({maxInstances: 10}, async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Must be signed in.");
    const uid = request.auth.uid;
    await checkRateLimit(uid);

    const input = request.data as {targetUid?: string; eventId?: string; grant?: boolean};
    const targetUid = validateDocId(input.targetUid, "targetUid");
    const eventId = validateDocId(input.eventId, "eventId");
    if (typeof input.grant !== "boolean") {
        throw new HttpsError("invalid-argument", "grant must be a boolean.");
    }
    const grant = input.grant;

    return adminTransaction(uid, async (txn, callerSnap) => {
        const callerGroup = callerSnap.data()!.group;
        const [targetSnap, upcomingSnap, pastSnap] = await Promise.all([
            txn.get(db.collection("users").doc(targetUid)),
            txn.get(db.collection("upcomingEvents").doc(eventId)),
            txn.get(db.collection("pastEvents").doc(eventId)),
        ]);
        if (!targetSnap.exists) throw new HttpsError("not-found", "User not found.");
        const targetData = targetSnap.data()!;
        // Hierarchy guard, but allow self-edits — admins managing their own
        // attendance shouldn't be blocked by the "above your level" check.
        if (
            targetUid !== uid
            && callerGroup !== "president"
            && !["visitor", "member", "staff"].includes(targetData.group)
        ) {
            throw new HttpsError("permission-denied", "Cannot manage users at or above your level.");
        }

        let eventSnap;
        if (upcomingSnap.exists) {
            if (upcomingSnap.data()!.paid === true) {
                throw new HttpsError(
                    "failed-precondition",
                    "Paid events use tickets — manage attendance via the Tickets tab.",
                    {code: "paid-event"},
                );
            }
            eventSnap = upcomingSnap;
        } else if (pastSnap.exists) {
            eventSnap = pastSnap;
        } else {
            throw new HttpsError("not-found", "Event not found.");
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
        txn.set(db.collection("records").doc(), {
            type: grant ? "event-attend" : "event-unattend",
            performedBy: uid,
            performedByName: callerSnap.data()!.displayName ?? "",
            targetUid,
            targetName: targetData.displayName ?? "",
            eventTitle: eventSnap.data()!.title ?? eventId,
            eventId,
            timestamp: FieldValue.serverTimestamp(),
            expiresAt: recordExpiresAt(),
        });
        return {granted: grant};
    });
});
export const assignEventStaff = onCall({maxInstances: 10}, async (request) => {
    const uid = await requireAuth(request);

    const input = request.data as {targetUid?: string; eventId?: string};
    const targetUid = validateDocId(input.targetUid, "targetUid");
    const eventId = validateDocId(input.eventId, "eventId");

    return adminTransaction(uid, async (txn, callerSnap) => {
        const [targetSnap, upcomingSnap, pastSnap] = await Promise.all([
            txn.get(db.collection("users").doc(targetUid)),
            txn.get(db.collection("upcomingEvents").doc(eventId)),
            txn.get(db.collection("pastEvents").doc(eventId)),
        ]);
        if (!targetSnap.exists) throw new HttpsError("not-found", "User not found.");
        const eventSnap = upcomingSnap.exists ? upcomingSnap : pastSnap;
        if (!eventSnap.exists) throw new HttpsError("not-found", "Event not found.");
        const isPastEvent = !upcomingSnap.exists;

        const targetData = targetSnap.data()!;
        const targetEmail: string = targetData.email ?? "";
        const existing: string[] = targetData.eventStaffEvents ?? [];
        const alreadyStaff = existing.includes(eventId);

        const eventTitle: string = eventSnap.data()?.title ?? eventSnap.data()?.name ?? eventId;
        const callerName: string = callerSnap.data()?.displayName ?? "";
        const targetName: string = targetData.displayName ?? "";
        const attendedEvents: string[] = targetData.attendedEvents ?? [];
        const alreadyAttended = attendedEvents.includes(eventId);

        // Past: pull eventId out of attendedEvents so the user doesn't show in
        // the free-event attendees list. Upcoming: auto-attend (legacy).
        const attendanceAction: "add" | "remove" | "none" = isPastEvent
            ? (alreadyAttended ? "remove" : "none")
            : (alreadyAttended ? "none" : "add");

        if (alreadyStaff && attendanceAction === "none") {
            return {added: false, attendeeRemoved: false};
        }

        const userUpdates: Record<string, unknown> = {};
        if (!alreadyStaff) userUpdates.eventStaffEvents = FieldValue.arrayUnion(eventId);
        if (attendanceAction === "add") {
            userUpdates.attendedEvents = FieldValue.arrayUnion(eventId);
        } else if (attendanceAction === "remove") {
            userUpdates.attendedEvents = FieldValue.arrayRemove(eventId);
        }
        if (Object.keys(userUpdates).length > 0) {
            txn.update(db.collection("users").doc(targetUid), userUpdates);
        }

        if (!alreadyStaff) {
            txn.set(db.collection("records").doc(), {
                type: "event-staff-assign",
                performedBy: uid,
                performedByName: callerName,
                targetUid,
                targetName,
                eventId,
                eventTitle,
                timestamp: FieldValue.serverTimestamp(),
                expiresAt: recordExpiresAt(),
            });
        }
        if (attendanceAction === "add") {
            txn.set(db.collection("records").doc(), {
                type: "event-attend",
                performedBy: uid,
                performedByName: callerName,
                targetUid,
                targetName,
                targetEmail,
                eventId,
                eventTitle,
                timestamp: FieldValue.serverTimestamp(),
                expiresAt: recordExpiresAt(),
            });
        } else if (attendanceAction === "remove") {
            txn.set(db.collection("records").doc(), {
                type: "event-unattend",
                performedBy: uid,
                performedByName: callerName,
                targetUid,
                targetName,
                targetEmail,
                eventId,
                eventTitle,
                reason: "staff-assignment",
                timestamp: FieldValue.serverTimestamp(),
                expiresAt: recordExpiresAt(),
            });
        }
        return {
            added: !alreadyStaff,
            attendeeRemoved: attendanceAction === "remove",
        };
    });
});
export const removeEventStaff = onCall({maxInstances: 10}, async (request) => {
    const uid = await requireAuth(request);

    const input = request.data as {targetUid?: string; eventId?: string};
    const targetUid = validateDocId(input.targetUid, "targetUid");
    const eventId = validateDocId(input.eventId, "eventId");

    return adminTransaction(uid, async (txn, callerSnap) => {
        const [targetSnap, upcomingSnap, pastSnap] = await Promise.all([
            txn.get(db.collection("users").doc(targetUid)),
            txn.get(db.collection("upcomingEvents").doc(eventId)),
            txn.get(db.collection("pastEvents").doc(eventId)),
        ]);
        if (!targetSnap.exists) throw new HttpsError("not-found", "User not found.");
        const targetData = targetSnap.data()!;
        const existing: string[] = targetData.eventStaffEvents ?? [];
        if (!existing.includes(eventId)) {
            return {removed: false};
        }

        const eventSnap = upcomingSnap.exists ? upcomingSnap : pastSnap;
        const eventTitle: string = eventSnap.exists
            ? (eventSnap.data()?.title ?? eventSnap.data()?.name ?? eventId)
            : eventId;

        txn.update(db.collection("users").doc(targetUid), {
            eventStaffEvents: FieldValue.arrayRemove(eventId),
        });
        txn.set(db.collection("records").doc(), {
            type: "event-staff-remove",
            performedBy: uid,
            performedByName: callerSnap.data()?.displayName ?? "",
            targetUid,
            targetName: targetData.displayName ?? "",
            eventId,
            eventTitle,
            timestamp: FieldValue.serverTimestamp(),
            expiresAt: recordExpiresAt(),
        });
        return {removed: true};
    });
});
