import { type CallableRequest, HttpsError, onCall } from "firebase-functions/v2/https";
import { onDocumentDeleted } from "firebase-functions/v2/firestore";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import {
    adminTransaction,
    isStaffOrAbove,
    normalizeGroup,
    requireAdmin,
    requireAuth,
    requireCanManage,
} from "../utils/auth";
import { cancelDeletion, type Deletable, requestDeletion } from "../utils/deletion";
import {
    conForDay,
    existingTagIds,
    getEventDoc,
    readConInfo,
    requireConYearFree,
    requireVenueRooms,
    staffEventsIn,
    validateConInput,
    validateRoomIds,
    validateVenueId,
} from "../utils/events";
import { db } from "../utils/firebase";
import { type BatchOp, commitInChunks, deleteOps } from "../utils/helpers";
import { deleteStorageFile, logStorageCleanupError, requireNewlyLinkedFilesExist } from "../utils/storage";
import { performer, recordDoc, recordRef, type RecordType } from "../utils/records";
import { siteDay } from "../utils/siteTime";
import { revokeEventWalletPasses, WALLETWALLET_API_KEY } from "../utils/walletPass";
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

async function deleteEventSubcollections(eventRef: FirebaseFirestore.DocumentReference): Promise<void> {
    const snaps = await Promise.all(["attendees", "emailTemplate", "settings"].map(sub => eventRef.collection(sub).get()));
    const ops = snaps.flatMap(snap => deleteOps(snap.docs));
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
            const cascadeOps: BatchOp[] = [
                ...deleteOps(codesSnap.docs),
                ...deleteOps(staffCodesSnap.docs),
                ...attendeesSnap.docs.map((d): BatchOp => b =>
                    b.update(d.ref, {attendedEvents: FieldValue.arrayRemove(eventId)})),
                ...staffSnap.docs.map((d): BatchOp => b =>
                    b.update(d.ref, {eventStaffEvents: FieldValue.arrayRemove(eventId)})),
            ];
            if (cascadeOps.length > 0) await commitInChunks(cascadeOps);
        } catch (err) {
            console.error(`onPastEventDeleted: cascade failed for ${eventId}`, err);
        }

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
const NO_LOCATION_TEXT = {location: "", locationCn: ""};

const locationTextUpdate = (venueId: string) => venueId ? NO_LOCATION_TEXT : {};

export const savePastEvent = onCall({maxInstances: 10}, async (request) => {
    const uid = await requireAuth(request, "staff");

    const input = request.data as Record<string, unknown>;
    const eventId = input.eventId ? validateDocId(input.eventId, "eventId") : null;
    const title = validateStr(input.title, "title", 200, true);
    const titleCn = validateStr(input.titleCn, "titleCn", 200);
    const tagIds = validateStringArray(input.tagIds, "tagIds", 20, 128).map(id => validateDocId(id, "tagId"));
    const date = validateDay(input.date, "date");
    const venueId = validateVenueId(input.venueId);
    const roomIds = validateRoomIds(input.roomIds, venueId);
    const description = validateStr(input.description, "description", 2000);
    const descriptionCn = validateStr(input.descriptionCn, "descriptionCn", 2000);
    const icon = validateStr(input.icon, "icon", 500);
    validateStorageImageUrl(icon, "icon");
    const recapLink = validateStr(input.recapLink, "recapLink", 500);
    validateUrl(recapLink, "recapLink");
    const recapLinkCn = validateStr(input.recapLinkCn, "recapLinkCn", 500);
    validateUrl(recapLinkCn, "recapLinkCn");
    const markedCon = validateConInput(input.con);

    const data = {
        title, titleCn, tagIds, date, venueId,
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
        const con = markedCon ? conForDay(date) : null;
        if (con) await requireConYearFree(txn, con.year, docId);
        const venueRoomIds = await requireVenueRooms(txn, venueId, roomIds);
        const keptTagIds = con ? [] : await existingTagIds(txn, tagIds);
        await requireNewlyLinkedFilesExist([icon], [prevIcon]);
        const saved = {...data, roomIds: venueRoomIds, con, tagIds: keptTagIds};
        const ref = db.collection("pastEvents").doc(docId);
        if (eventId) {
            txn.update(ref, {...saved, ...locationTextUpdate(venueId)});
        } else {
            txn.set(ref, {...saved, ...NO_LOCATION_TEXT, published: false});
        }
        txn.set(recordRef(), recordDoc(eventId ? "event-edit" : "event-create", {
            ...performer(uid, callerSnap),
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
            ...performer(uid, callerSnap),
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
    const venueId = validateVenueId(input.venueId);
    const roomIds = validateRoomIds(input.roomIds, venueId);
    const poster = validateStr(input.poster, "poster", 500);
    const emailHeaderBg = validateStr(input.emailHeaderBg, "emailHeaderBg", 500);
    const posterCredit = validateStr(input.posterCredit, "posterCredit", 200);
    const buyTicket = validateStr(input.buyTicket, "buyTicket", 500);
    const learnMore = validateStr(input.learnMore, "learnMore", 500);
    const customButtonText = validateStr(input.customButtonText, "customButtonText", 100);
    const customButtonTextCn = validateStr(input.customButtonTextCn, "customButtonTextCn", 100);
    const customButtonLink = validateStr(input.customButtonLink, "customButtonLink", 500);
    const paid = input.paid === true;
    const markedCon = validateConInput(input.con);

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
        title, titleCn, description, descriptionCn, venueId,
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
        const con = markedCon ? conForDay(siteDay(startAt.toMillis())) : null;
        if (con) await requireConYearFree(txn, con.year, docId);
        const venueRoomIds = await requireVenueRooms(txn, venueId, roomIds);
        await requireNewlyLinkedFilesExist([poster, emailHeaderBg], [prevPoster, prevEmailHeaderBg]);

        let codesToDelete: FirebaseFirestore.QueryDocumentSnapshot[] = [];
        if (paid && eventId) {
            const codesSnap = await txn.get(
                db.collection("claimCodes").where("eventId", "==", eventId)
            );
            codesToDelete = codesSnap.docs;
        }

        const ref = db.collection("upcomingEvents").doc(docId);
        if (eventId) {
            txn.update(ref, {
                ...data, ...locationTextUpdate(venueId),
                roomIds: venueRoomIds,
                con,
                published: wasPublished
            });
        } else {
            txn.set(ref, {...data, ...NO_LOCATION_TEXT, roomIds: venueRoomIds, con, published: false});
        }

        for (const codeDoc of codesToDelete) {
            txn.delete(codeDoc.ref);
            txn.set(recordRef(), recordDoc("event-code-deactivate", {
                ...performer(uid, callerSnap),
                eventTitle: title,
                eventId: docId,
                code: codeDoc.data().code ?? codeDoc.id,
            }));
        }

        txn.set(recordRef(), recordDoc(eventId ? "upcoming-event-edit" : "upcoming-event-create", {
            ...performer(uid, callerSnap),
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
    {document: "upcomingEvents/{eventId}", maxInstances: 10, timeoutSeconds: 300, secrets: [WALLETWALLET_API_KEY]},
    async (event) => {
        const data = event.data?.data();
        const eventId = event.params.eventId;
        if (!data) return;

        try {
            const [codesSnap, staffCodesSnap] = await Promise.all([
                db.collection("claimCodes").where("eventId", "==", eventId).get(),
                db.collection("staffClaimCodes").where("eventId", "==", eventId).get(),
            ]);
            const cascadeOps = [...deleteOps(codesSnap.docs), ...deleteOps(staffCodesSnap.docs)];
            if (cascadeOps.length > 0) await commitInChunks(cascadeOps);
        } catch (err) {
            console.error(`onUpcomingEventDeleted: cascade failed for ${eventId}`, err);
        }

        let archived = false;
        let keepPoster = false;
        try {
            const pastSnap = await db.collection("pastEvents").doc(eventId).get();
            archived = pastSnap.exists;
            keepPoster = archived && !!data.poster && pastSnap.data()?.icon === data.poster;
        } catch (err) {
            console.error(`onUpcomingEventDeleted: archive check failed for ${eventId}`, err);
            keepPoster = !!data.con;
        }

        if (!keepPoster) {
            await deleteStorageFile(data.poster ?? "", ["upcoming-events/"])
                .catch(logStorageCleanupError(`onUpcomingEventDeleted ${eventId}`));
        }
        await deleteStorageFile(data.emailHeaderBg ?? "", ["upcoming-events/headers/"])
            .catch(logStorageCleanupError(`onUpcomingEventDeleted ${eventId} header`));

        if (archived) return;

        try {
            const staffSnap = await db.collection("users")
                .where("eventStaffEvents", "array-contains", eventId).get();
            const staffOps = staffSnap.docs.map((d): BatchOp => b =>
                b.update(d.ref, {eventStaffEvents: FieldValue.arrayRemove(eventId)}));
            if (staffOps.length > 0) await commitInChunks(staffOps);
        } catch (err) {
            console.error(`onUpcomingEventDeleted: eventStaffEvents cascade failed for ${eventId}`, err);
        }

        try {
            const attendees = await db.collection("upcomingEvents").doc(eventId).collection("attendees").get();
            const revoked = await revokeEventWalletPasses(attendees.docs);
            if (revoked > 0) console.log(`onUpcomingEventDeleted: revoked ${revoked} wallet pass(es) for ${eventId}`);
        } catch (err) {
            console.error(`onUpcomingEventDeleted: wallet pass revoke failed for ${eventId}`, err);
        }

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

function reconcileCopy(
    copied: FirebaseFirestore.QuerySnapshot,
    live: FirebaseFirestore.QuerySnapshot,
    dest: FirebaseFirestore.CollectionReference,
): BatchOp[] {
    const copiedAt = new Map(copied.docs.map(d => [d.id, d.updateTime]));
    const ops: BatchOp[] = [];
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
    const tagIds = validateStringArray(input.tagIds, "tagIds", 20, 128).map(id => validateDocId(id, "tagId"));
    const newDocRef = db.collection("pastEvents").doc(eventId);

    await requireAdmin(uid);

    const eventSnap = await db.collection("upcomingEvents").doc(eventId).get();
    if (!eventSnap.exists) throw new HttpsError("not-found", "Event not found.");
    const endAt: number | undefined = eventSnap.data()!.endAt?.toMillis?.();
    if (endAt !== undefined && endAt > Date.now()) {
        throw new HttpsError("failed-precondition", "Only an event that has ended can be archived.");
    }

    const attendeesSrc = db.collection("upcomingEvents").doc(eventId).collection("attendees");
    const emailTemplateSrc = db.collection("upcomingEvents").doc(eventId).collection("emailTemplate");

    const [attendeesSnap, emailTemplateSnap] = await Promise.all([
        attendeesSrc.get(),
        emailTemplateSrc.get(),
    ]);

    const pastAttendeesCol = newDocRef.collection("attendees");
    const pastEmailTemplateCol = newDocRef.collection("emailTemplate");

    const copyOps: BatchOp[] = [];

    for (const doc of attendeesSnap.docs) {
        copyOps.push(b => b.set(pastAttendeesCol.doc(doc.id), doc.data()));
    }
    for (const doc of emailTemplateSnap.docs) {
        copyOps.push(b => b.set(pastEmailTemplateCol.doc(doc.id), doc.data()));
    }

    if (copyOps.length > 0) await commitInChunks(copyOps);

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
        const con = readConInfo(eventData.con);
        const keptTagIds = con ? [] : await existingTagIds(txn, tagIds);

        txn.set(newDocRef, {
            title: eventData.title ?? "",
            titleCn: eventData.titleCn ?? "",
            date: dateStr,
            location: eventData.location ?? "",
            locationCn: eventData.locationCn ?? "",
            venueId: eventData.venueId ?? "",
            roomIds: Array.isArray(eventData.roomIds) ? eventData.roomIds : [],
            description: eventData.description ?? "",
            descriptionCn: eventData.descriptionCn ?? "",
            icon: con ? (eventData.poster ?? "") : "",
            tagIds: keptTagIds,
            con,
            published: false,
            paid: eventData.paid === true,
        });
        txn.delete(db.collection("upcomingEvents").doc(eventId));
        txn.set(recordRef(), recordDoc("upcoming-event-archive", {
            ...performer(uid, callerSnap),
            eventTitle: eventData.title ?? eventId,
            eventId: newDocRef.id,
        }));
        return {pastEventId: newDocRef.id};
    });

    const [liveAttendees, liveTemplate, liveSettings] = await Promise.all([
        attendeesSrc.get(),
        emailTemplateSrc.get(),
        db.collection("upcomingEvents").doc(eventId).collection("settings").get(),
    ]);
    const moveOps = [
        ...reconcileCopy(attendeesSnap, liveAttendees, pastAttendeesCol),
        ...reconcileCopy(emailTemplateSnap, liveTemplate, pastEmailTemplateCol),
        ...deleteOps(liveSettings.docs),
    ];
    if (moveOps.length > 0) await commitInChunks(moveOps);

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
            ...performer(uid, callerSnap),
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

        const attendanceAction: "add" | "remove" | "none" = isPastEvent
            ? (alreadyAttended ? "remove" : "none")
            : (alreadyAttended ? "none" : "add");

        if (alreadyStaff && attendanceAction === "none") {
            return {added: false, attendeeRemoved: false};
        }

        txn.update(db.collection("users").doc(targetUid), {
            ...(alreadyStaff ? {} : {eventStaffEvents: FieldValue.arrayUnion(eventId)}),
            ...(attendanceAction === "add" ? {attendedEvents: FieldValue.arrayUnion(eventId)} : {}),
            ...(attendanceAction === "remove" ? {attendedEvents: FieldValue.arrayRemove(eventId)} : {}),
        });

        const fields = {
            ...performer(uid, callerSnap),
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
export const getEventStaff = onCall({maxInstances: 10}, async (request) => {
    const uid = await requireAuth(request, "staff");
    const eventId = validateDocId((request.data as {eventId?: unknown} | null)?.eventId, "eventId");

    const [caller, {snap: eventSnap, archived}] = await Promise.all([
        db.collection("users").doc(uid).get(),
        getEventDoc(eventId),
    ]);
    if (!isStaffOrAbove(caller.get("group")) && (archived || !staffEventsIn(caller).includes(eventId))) {
        throw new HttpsError("permission-denied", "Not authorized to read this event's staff.");
    }
    if (!eventSnap.exists) throw new HttpsError("not-found", "Event not found.");

    const text = (value: unknown): string => typeof value === "string" ? value : "";
    const staff = await db.collection("users")
        .where("eventStaffEvents", "array-contains", eventId)
        .select("displayName", "photoURL", "group", "title", "titleCn")
        .get();
    return {
        staff: staff.docs.map(doc => ({
            uid: doc.id,
            displayName: text(doc.get("displayName")),
            photoURL: text(doc.get("photoURL")),
            group: normalizeGroup(doc.get("group")),
            title: text(doc.get("title")),
            titleCn: text(doc.get("titleCn")),
        })),
    };
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

        const eventTitle: string = eventSnap.data()?.title ?? eventId;

        txn.update(db.collection("users").doc(targetUid), {
            eventStaffEvents: FieldValue.arrayRemove(eventId),
        });
        txn.set(recordRef(), recordDoc("event-staff-remove", {
            ...performer(uid, callerSnap),
            targetUid,
            targetName: targetData.displayName ?? "",
            eventId,
            eventTitle,
        }));
        return {removed: true};
    });
});
