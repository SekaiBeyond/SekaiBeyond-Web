import { HttpsError, onCall } from "firebase-functions/v2/https";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { adminTransaction, requireAuth } from "../utils/auth";
import { db } from "../utils/firebase";
import { type CodeKind, codeKind, issueCode, normalizeCode } from "../utils/codes";
import { getEventDoc } from "../utils/events";
import { validateCodeInTransaction } from "../utils/helpers";
import { claimPassportWithKey, findPassportByKey, normalizeActivationKey } from "../utils/passports";
import { validateBoolean, validateDocId, validateInstant, validateMaxUses } from "../utils/validation";
import { performer, recordDoc, type RecordFields, recordRef, type RecordType } from "../utils/records";

const INVALID = "Invalid or deactivated code.";

const invalidCode = (status: "not-found" | "invalid-argument" | "failed-precondition" = "not-found") =>
    new HttpsError(status, INVALID, {code: "invalid"});

function requireCode(request: {data: unknown}): string {
    const code = normalizeCode((request.data as {code?: unknown})?.code);
    if (!code) throw invalidCode("invalid-argument");
    return code;
}

function windowFields(activeFrom: string | null, activeUntil: string | null) {
    return {
        ...(activeFrom ? {activeFrom} : {}),
        ...(activeUntil ? {activeUntil, expiresAt: Timestamp.fromDate(new Date(activeUntil))} : {}),
    };
}

function clearedWindow(activeFrom: string | null, activeUntil: string | null) {
    return {
        activeFrom,
        activeUntil,
        expiresAt: activeUntil ? Timestamp.fromDate(new Date(activeUntil)) : null,
    };
}

async function issueUniqueCode(
    uid: string,
    kind: CodeKind,
    collection: string,
    write: (
        txn: FirebaseFirestore.Transaction,
        callerSnap: FirebaseFirestore.DocumentSnapshot,
        code: string,
        codeRef: FirebaseFirestore.DocumentReference,
    ) => Promise<void>,
): Promise<{id: string; code: string}> {
    for (let attempt = 0; attempt < 5; attempt++) {
        const code = issueCode(kind);
        const codeRef = db.collection(collection).doc(code);
        const issued = await adminTransaction(uid, async (txn, callerSnap) => {
            if ((await txn.get(codeRef)).exists) return false;
            await write(txn, callerSnap, code, codeRef);
            return true;
        });
        if (issued) return {id: code, code};
    }
    throw new HttpsError("internal", "code-generation-failed");
}

async function readRedeemableCode(txn: FirebaseFirestore.Transaction, codeRef: FirebaseFirestore.DocumentReference) {
    const snap = await txn.get(codeRef);
    if (!snap.exists) throw invalidCode();
    const data = snap.data()!;
    validateCodeInTransaction(data);
    return data;
}

async function readCode(txn: FirebaseFirestore.Transaction, collection: string, codeId: string) {
    const ref = db.collection(collection).doc(codeId);
    const snap = await txn.get(ref);
    if (!snap.exists) throw new HttpsError("not-found", "Code not found.");
    return {ref, data: snap.data()!};
}

async function codeEventFields(
    txn: FirebaseFirestore.Transaction,
    data: FirebaseFirestore.DocumentData,
    {pastToo}: {pastToo: boolean},
): Promise<{eventTitle: string; eventId: string}> {
    const eventId: string = data.eventId ?? "";
    const snap = !eventId ? null
        : pastToo ? (await getEventDoc(eventId, txn)).snap
            : await txn.get(db.collection("upcomingEvents").doc(eventId));
    return {eventTitle: snap?.data()?.title ?? eventId, eventId};
}

async function codeBadgeFields(
    txn: FirebaseFirestore.Transaction,
    data: FirebaseFirestore.DocumentData,
): Promise<{badgeId: string; badgeName: string}> {
    const badgeId: string = data.badgeId ?? "";
    const snap = badgeId ? await txn.get(db.collection("badges").doc(badgeId)) : null;
    return {badgeId, badgeName: snap?.data()?.name ?? badgeId};
}

const toggleCodeActive = (
    collection: string,
    fields: (txn: FirebaseFirestore.Transaction, data: FirebaseFirestore.DocumentData) => Promise<RecordFields>,
    types: {on: RecordType; off: RecordType},
) => onCall({maxInstances: 10}, async (request) => {
    const uid = await requireAuth(request, "staff");

    const input = request.data as {codeId?: string; active?: unknown};
    const codeId = validateDocId(input.codeId, "codeId");
    const active = validateBoolean(input.active, "active");

    await adminTransaction(uid, async (txn, callerSnap) => {
        const {ref, data} = await readCode(txn, collection, codeId);
        const recorded = await fields(txn, data);

        txn.update(ref, {active});
        txn.set(recordRef(), recordDoc(active ? types.on : types.off, {...performer(uid, callerSnap), ...recorded}));
    });
});

function isUnmatchedCode(err: unknown): boolean {
    const details = err instanceof HttpsError ? err.details as {code?: string} | undefined : undefined;
    return details?.code === "invalid" || details?.code === "inactive";
}

async function redeemPassportKey(
    uid: string,
    key: string,
    confirmEmailMismatch: boolean,
) {
    const passportId = await findPassportByKey(key);
    if (!passportId) return null;
    const grant = await claimPassportWithKey(uid, passportId, key, confirmEmailMismatch);
    const design = grant.designId
        ? (await db.collection("passportDesigns").doc(grant.designId).get()).data()
        : undefined;
    return {
        passportId,
        daysGranted: grant.daysGranted,
        membershipExpiresAt: grant.membershipExpiresAt,
        designName: design?.name ?? "",
        designNameCn: design?.nameCn ?? "",
        coverImageUrl: design?.coverImageUrl ?? "",
    };
}

export const redeemCode = onCall({maxInstances: 20}, async (request) => {
    const uid = await requireAuth(request);
    const code = requireCode(request);

    switch (codeKind(code)) {
        case "badge":
            return {kind: "badge" as const, ...await redeemBadgeCode(uid, code)};
        case "staff":
            return {kind: "staff" as const, ...await redeemStaffCode(uid, code)};
        case "event":
            throw new HttpsError("failed-precondition", "This code checks you in at an event.", {
                code: "event-code",
            });
    }

    try {
        return {kind: "staff" as const, ...await redeemStaffCode(uid, code)};
    } catch (err) {
        if (!isUnmatchedCode(err)) throw err;
    }

    const passportKey = normalizeActivationKey(code);
    if (passportKey) {
        const {confirmEmailMismatch} = request.data as {confirmEmailMismatch?: unknown};
        const claimed = await redeemPassportKey(
            uid,
            passportKey,
            confirmEmailMismatch === undefined ? false : validateBoolean(confirmEmailMismatch, "confirmEmailMismatch"),
        );
        if (claimed) return {kind: "passport-claim" as const, ...claimed};
    }

    throw invalidCode();
});

export const claimEventCode = onCall({maxInstances: 20}, async (request) => {
    const uid = await requireAuth(request);
    const code = requireCode(request);

    const codeRef = db.collection("claimCodes").doc(code);
    const userRef = db.collection("users").doc(uid);

    return db.runTransaction(async (txn) => {
        const data = await readRedeemableCode(txn, codeRef);

        const eventId: string = data.eventId;
        if (!eventId) throw invalidCode();

        const [eventSnap, userSnap] = await Promise.all([
            txn.get(db.collection("upcomingEvents").doc(eventId)),
            txn.get(userRef),
        ]);
        if (!eventSnap.exists) throw invalidCode();
        if (!userSnap.exists) throw invalidCode();

        const eventData = eventSnap.data()!;
        if (eventData.paid === true) throw invalidCode("failed-precondition");
        const eventTitle: string = eventData.title ?? "";
        const eventTitleCn: string = eventData.titleCn ?? "";
        const eventPoster: string = eventData.poster ?? "";

        const attendedEvents: string[] = userSnap.data()!.attendedEvents ?? [];
        if (attendedEvents.includes(eventId)) {
            throw new HttpsError("already-exists", "You already have this event.", {
                code: "already-have",
                eventId,
                eventTitle,
                eventTitleCn,
                eventPoster,
            });
        }

        txn.update(codeRef, {usedCount: FieldValue.increment(1)});
        txn.update(userRef, {attendedEvents: FieldValue.arrayUnion(eventId)});
        txn.set(recordRef(), recordDoc("event-claim", {
            ...performer(uid, userSnap),
            eventId,
            eventTitle: eventTitle || eventId,
            code,
        }));
        return {eventId, eventTitle, eventTitleCn, eventPoster};
    });
});

async function redeemBadgeCode(uid: string, code: string) {
    const codeRef = db.collection("badgeActivationCodes").doc(code);
    const userRef = db.collection("users").doc(uid);

    return db.runTransaction(async (txn) => {
        const data = await readRedeemableCode(txn, codeRef);

        const badgeId: string = data.badgeId;
        if (!badgeId) throw invalidCode();

        const [badgeSnap, userSnap] = await Promise.all([
            txn.get(db.collection("badges").doc(badgeId)),
            txn.get(userRef),
        ]);
        if (!badgeSnap.exists) throw invalidCode();
        if (!userSnap.exists) throw invalidCode();
        const badgeData = badgeSnap.data()!;

        const userBadges: string[] = userSnap.data()!.badges ?? [];
        if (userBadges.includes(badgeId)) {
            throw new HttpsError("already-exists", "You already have this badge.", {
                code: "already-have",
                kind: "badge",
            });
        }

        txn.update(codeRef, {usedCount: FieldValue.increment(1)});
        txn.update(userRef, {
            badges: FieldValue.arrayUnion(badgeId),
            [`badgeEarnedAt.${badgeId}`]: FieldValue.serverTimestamp(),
        });
        txn.set(recordRef(), recordDoc("badge-claim", {
            ...performer(uid, userSnap),
            badgeId,
            badgeName: badgeData.name ?? badgeId,
        }));

        return {
            badgeId,
            badgeName: badgeData.name ?? "",
            badgeNameCn: badgeData.nameCn ?? "",
            badgeDescription: badgeData.description ?? "",
            badgeDescriptionCn: badgeData.descriptionCn ?? "",
            badgeImageUrl: badgeData.imageUrl ?? "",
        };
    });
}

export const generateBadgeActivationCode = onCall({maxInstances: 10}, async (request) => {
    const uid = await requireAuth(request, "staff");

    const input = request.data as {
        badgeId?: string;
        maxUses?: number;
        activeFrom?: string;
        activeUntil?: string;
    };
    const badgeId = validateDocId(input.badgeId, "badgeId");
    const maxUses = validateMaxUses(input.maxUses);
    const activeFrom = validateInstant(input.activeFrom, "activeFrom");
    const activeUntil = validateInstant(input.activeUntil, "activeUntil");

    return issueUniqueCode(uid, "badge", "badgeActivationCodes", async (txn, callerSnap, code, codeRef) => {
        const badgeSnap = await txn.get(db.collection("badges").doc(badgeId));
        if (!badgeSnap.exists) {
            throw new HttpsError("not-found", "Badge not found.");
        }

        txn.set(codeRef, {
            code,
            badgeId,
            createdBy: uid,
            createdAt: FieldValue.serverTimestamp(),
            active: true,
            maxUses,
            usedCount: 0,
            ...windowFields(activeFrom, activeUntil),
        });
        txn.set(recordRef(), recordDoc("code-create", {
            ...performer(uid, callerSnap),
            badgeId,
            badgeName: badgeSnap.data()!.name ?? badgeId,
        }));
    });
});
export const generateEventCode = onCall({maxInstances: 10}, async (request) => {
    const uid = await requireAuth(request, "staff");

    const eventId = validateDocId((request.data as {eventId?: string})?.eventId, "eventId");

    return issueUniqueCode(uid, "event", "claimCodes", async (txn, callerSnap, code, codeRef) => {
        const eventSnap = await txn.get(db.collection("upcomingEvents").doc(eventId));
        if (!eventSnap.exists) {
            throw new HttpsError("not-found", "Event not found.");
        }
        if (eventSnap.data()?.paid === true) {
            throw new HttpsError("failed-precondition",
                "Paid events use tickets, not check-in codes.");
        }

        const existingCodes = await txn.get(
            db.collection("claimCodes")
                .where("eventId", "==", eventId)
                .where("active", "==", true)
        );
        const fields = {
            ...performer(uid, callerSnap),
            eventTitle: eventSnap.data()?.title ?? eventId,
            eventId,
        };
        for (const oldDoc of existingCodes.docs) {
            txn.update(oldDoc.ref, {active: false});
            txn.set(recordRef(), recordDoc("event-code-deactivate", {
                ...fields,
                code: oldDoc.data().code ?? oldDoc.id,
            }));
        }
        txn.set(codeRef, {
            code,
            eventId,
            createdBy: uid,
            createdAt: FieldValue.serverTimestamp(),
            active: true,
            usedCount: 0,
        });
        txn.set(recordRef(), recordDoc("code-create", {...fields, code}));
    });
});
export const toggleClaimCodeActive = toggleCodeActive("claimCodes",
    async (txn, data) => ({...await codeEventFields(txn, data, {pastToo: false}), code: data.code ?? ""}),
    {on: "event-code-activate", off: "event-code-deactivate"});
export const saveClaimCodeTimeWindow = onCall({maxInstances: 10}, async (request) => {
    const uid = await requireAuth(request, "staff");

    const input = request.data as {codeId?: string; activeFrom?: string; activeUntil?: string};
    const codeId = validateDocId(input.codeId, "codeId");
    const activeFrom = validateInstant(input.activeFrom, "activeFrom");
    const activeUntil = validateInstant(input.activeUntil, "activeUntil");

    await adminTransaction(uid, async (txn, callerSnap) => {
        const {ref, data} = await readCode(txn, "claimCodes", codeId);
        const event = await codeEventFields(txn, data, {pastToo: false});

        txn.update(ref, clearedWindow(activeFrom, activeUntil));
        txn.set(recordRef(), recordDoc("event-code-time-window", {
            ...performer(uid, callerSnap),
            ...event,
            code: data.code ?? "",
        }));
    });
});
export const toggleBadgeCodeActive = toggleCodeActive("badgeActivationCodes", codeBadgeFields,
    {on: "badge-code-activate", off: "badge-code-deactivate"});
export const deleteBadgeActivationCode = onCall({maxInstances: 10}, async (request) => {
    const uid = await requireAuth(request, "staff");

    const codeId = validateDocId((request.data as {codeId?: string})?.codeId, "codeId");

    await adminTransaction(uid, async (txn, callerSnap) => {
        const {ref, data} = await readCode(txn, "badgeActivationCodes", codeId);
        const badge = await codeBadgeFields(txn, data);

        txn.delete(ref);
        txn.set(recordRef(), recordDoc("code-delete", {
            ...performer(uid, callerSnap),
            ...badge,
        }));
    });
});
export const generateStaffCode = onCall({maxInstances: 10}, async (request) => {
    const uid = await requireAuth(request, "staff");

    const eventId = validateDocId((request.data as {eventId?: string})?.eventId, "eventId");

    return issueUniqueCode(uid, "staff", "staffClaimCodes", async (txn, callerSnap, code, codeRef) => {
        const {snap: eventSnap} = await getEventDoc(eventId, txn);
        if (!eventSnap.exists) throw new HttpsError("not-found", "Event not found.");

        const existingCodes = await txn.get(db.collection("staffClaimCodes").where("eventId", "==", eventId));
        const fields = {
            ...performer(uid, callerSnap),
            eventTitle: eventSnap.data()?.title ?? eventId,
            eventId,
        };

        for (const oldDoc of existingCodes.docs) {
            txn.delete(oldDoc.ref);
            txn.set(recordRef(), recordDoc("staff-code-delete", fields));
        }
        txn.set(codeRef, {
            code,
            eventId,
            createdBy: uid,
            createdAt: FieldValue.serverTimestamp(),
            active: true,
            usedCount: 0,
        });
        txn.set(recordRef(), recordDoc("staff-code-create", fields));
    });
});

async function redeemStaffCode(uid: string, code: string) {
    const codeRef = db.collection("staffClaimCodes").doc(code);
    const userRef = db.collection("users").doc(uid);

    return db.runTransaction(async (txn) => {
        const data = await readRedeemableCode(txn, codeRef);

        const eventId: string = data.eventId;
        if (!eventId) throw invalidCode();

        const [{snap: eventSnap, archived: isPastEvent}, userSnap] = await Promise.all([
            getEventDoc(eventId, txn),
            txn.get(userRef),
        ]);
        if (!eventSnap.exists) throw invalidCode();
        if (!userSnap.exists) throw invalidCode();

        const eventData = eventSnap.data()!;
        const eventTitle: string = eventData.title ?? "";
        const eventTitleCn: string = eventData.titleCn ?? "";
        const eventPoster: string = eventData.poster ?? eventData.icon ?? "";

        const staffEvents: string[] = userSnap.data()!.eventStaffEvents ?? [];
        if (staffEvents.includes(eventId)) {
            throw new HttpsError("already-exists", "You are already staff for this event.", {
                code: "already-have",
                kind: "staff",
                eventId,
                eventTitle,
                eventTitleCn,
                eventPoster,
            });
        }

        const alreadyAttended = (userSnap.data()!.attendedEvents ?? []).includes(eventId);
        const userName: string = userSnap.data()!.displayName ?? "";

        txn.update(codeRef, {usedCount: FieldValue.increment(1)});
        txn.update(userRef, {
            eventStaffEvents: FieldValue.arrayUnion(eventId),
            attendedEvents: isPastEvent
                ? FieldValue.arrayRemove(eventId)
                : FieldValue.arrayUnion(eventId),
        });
        const fields: RecordFields = {
            performedBy: uid,
            performedByName: userName,
            targetUid: uid,
            targetName: userName,
            eventId,
            eventTitle: eventTitle || eventId,
            reason: "staff-code",
        };
        txn.set(recordRef(), recordDoc("event-staff-assign", fields));
        const attendanceChanged = isPastEvent ? alreadyAttended : !alreadyAttended;
        if (attendanceChanged) {
            txn.set(recordRef(), recordDoc(isPastEvent ? "event-unattend" : "event-attend", fields));
        }
        return {eventTitle, eventTitleCn, eventPoster};
    });
}

export const toggleStaffCodeActive = toggleCodeActive("staffClaimCodes",
    (txn, data) => codeEventFields(txn, data, {pastToo: true}),
    {on: "staff-code-activate", off: "staff-code-deactivate"});
export const saveStaffCodeTimeWindow = onCall({maxInstances: 10}, async (request) => {
    const uid = await requireAuth(request, "staff");

    const input = request.data as {codeId?: string; activeFrom?: string; activeUntil?: string; maxUses?: number};
    const codeId = validateDocId(input.codeId, "codeId");
    const activeFrom = validateInstant(input.activeFrom, "activeFrom");
    const activeUntil = validateInstant(input.activeUntil, "activeUntil");
    const maxUses = validateMaxUses(input.maxUses);

    await adminTransaction(uid, async (txn, callerSnap) => {
        const {ref, data} = await readCode(txn, "staffClaimCodes", codeId);
        const event = await codeEventFields(txn, data, {pastToo: true});

        txn.update(ref, {
            ...clearedWindow(activeFrom, activeUntil),
            ...(input.maxUses !== undefined ? {maxUses} : {}),
        });
        txn.set(recordRef(), recordDoc("staff-code-time-window", {
            ...performer(uid, callerSnap),
            ...event,
        }));
    });
});
export const deleteStaffCode = onCall({maxInstances: 10}, async (request) => {
    const uid = await requireAuth(request, "staff");

    const codeId = validateDocId((request.data as {codeId?: string})?.codeId, "codeId");

    await adminTransaction(uid, async (txn, callerSnap) => {
        const {ref, data} = await readCode(txn, "staffClaimCodes", codeId);
        if (data.active !== false) {
            throw new HttpsError("failed-precondition", "Disable the code before deleting it.", {code: "active"});
        }
        const event = await codeEventFields(txn, data, {pastToo: true});

        txn.delete(ref);
        txn.set(recordRef(), recordDoc("staff-code-delete", {
            ...performer(uid, callerSnap),
            ...event,
        }));
    });
});
