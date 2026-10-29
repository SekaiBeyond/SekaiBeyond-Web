import { HttpsError, onCall } from "firebase-functions/v2/https";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { adminTransaction, requireAuth } from "../utils/auth";
import { db } from "../utils/firebase";
import { type CodeKind, codeKind, issueCode, normalizeCode } from "../utils/codes";
import { getEventInTxn } from "../utils/events";
import { validateCodeInTransaction } from "../utils/helpers";
import { claimPassportWithKey, findPassportByKey, normalizeActivationKey } from "../utils/passports";
import { validateBoolean, validateDocId, validateInstant, validateMaxUses } from "../utils/validation";
import { recordDoc, type RecordFields, recordRef } from "../utils/records";

const INVALID = "Invalid or deactivated code.";

/** The "invalid" every path reports for a code that matches nothing usable. */
const invalidCode = (status: "not-found" | "invalid-argument" | "failed-precondition" = "not-found") =>
    new HttpsError(status, INVALID, {code: "invalid"});

/** The code off a request, canonical, or the same "invalid" every path reports. */
function requireCode(request: {data: unknown}): string {
    const code = normalizeCode((request.data as {code?: unknown})?.code);
    if (!code) throw invalidCode("invalid-argument");
    return code;
}

/** A new code's active window: each bound only when set, with the TTL's expiresAt at its end. */
function windowFields(activeFrom: string | null, activeUntil: string | null) {
    return {
        ...(activeFrom ? {activeFrom} : {}),
        ...(activeUntil ? {activeUntil, expiresAt: Timestamp.fromDate(new Date(activeUntil))} : {}),
    };
}

/** An existing code's active window, replaced whole: a bound left out is cleared. */
function clearedWindow(activeFrom: string | null, activeUntil: string | null) {
    return {
        activeFrom,
        activeUntil,
        expiresAt: activeUntil ? Timestamp.fromDate(new Date(activeUntil)) : null,
    };
}

/**
 * Issues a code of `kind` into `collection` through `write`, in an admin
 * transaction. A fresh code that clashes with one already issued is drawn
 * again.
 */
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

/** A code doc read in `txn`, for the calls that change one. */
async function readCode(txn: FirebaseFirestore.Transaction, collection: string, codeId: string) {
    const ref = db.collection(collection).doc(codeId);
    const snap = await txn.get(ref);
    if (!snap.exists) throw new HttpsError("not-found", "Code not found.");
    return {ref, data: snap.data()!};
}

/**
 * The event a code's records name. Check-in codes are only for upcoming
 * events; staff codes can be for past ones too.
 */
async function codeEventFields(
    txn: FirebaseFirestore.Transaction,
    data: FirebaseFirestore.DocumentData,
    {pastToo}: {pastToo: boolean},
): Promise<{eventTitle: string; eventId: string}> {
    const eventId: string = data.eventId ?? "";
    const snap = !eventId ? null
        : pastToo ? (await getEventInTxn(txn, eventId)).snap
            : await txn.get(db.collection("upcomingEvents").doc(eventId));
    return {eventTitle: snap?.data()?.title ?? eventId, eventId};
}

/** The badge a badge code's records name. */
async function codeBadgeFields(
    txn: FirebaseFirestore.Transaction,
    data: FirebaseFirestore.DocumentData,
): Promise<{badgeId: string; badgeName: string}> {
    const badgeId: string = data.badgeId ?? "";
    const snap = badgeId ? await txn.get(db.collection("badges").doc(badgeId)) : null;
    return {badgeId, badgeName: snap?.data()?.name ?? badgeId};
}

/**
 * "That isn't one of ours", the only failure worth trying the next kind on. Any
 * other error means the code matched, and asking another collection would turn
 * a true answer into "invalid".
 */
function isUnmatchedCode(err: unknown): boolean {
    const details = err instanceof HttpsError ? err.details as {code?: string} | undefined : undefined;
    return details?.code === "invalid" || details?.code === "inactive";
}

/** Claims the passport whose slip carries `key`. Null when no passport has it. */
async function redeemPassportKey(uid: string, key: string) {
    const passportId = await findPassportByKey(key);
    if (!passportId) return null;
    const grant = await claimPassportWithKey(uid, passportId, key);
    // Named and pictured on the screen that confirms it, the way a badge is.
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

/**
 * One door for every code a member can type: badge codes, staff codes and
 * passport keys.
 *
 * Guessing the kind here costs one rate-limit slot however many collections it
 * takes (requireAuth charges one per call), and a prefixed code needs no guess
 * at all.
 */
export const redeemCode = onCall({maxInstances: 20}, async (request) => {
    const uid = await requireAuth(request);
    const code = requireCode(request);

    switch (codeKind(code)) {
        case "badge":
            return {kind: "badge" as const, ...await redeemBadgeCode(uid, code)};
        case "staff":
            return {kind: "staff" as const, ...await redeemStaffCode(uid, code)};
        case "event":
            // Check-in codes are scanned from their claim URL, not typed, so the
            // prefix buys a straight answer.
            throw new HttpsError("failed-precondition", "This code checks you in at an event.", {
                code: "event-code",
            });
    }

    // No prefix: an old staff code, or a passport key. No bare badge codes
    // remain.
    try {
        return {kind: "staff" as const, ...await redeemStaffCode(uid, code)};
    } catch (err) {
        if (!isUnmatchedCode(err)) throw err;
    }

    const passportKey = normalizeActivationKey(code);
    if (passportKey) {
        const claimed = await redeemPassportKey(uid, passportKey);
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
        const freshCode = await txn.get(codeRef);
        if (!freshCode.exists) throw invalidCode();
        const data = freshCode.data()!;
        validateCodeInTransaction(data);

        const eventId: string = data.eventId;
        if (!eventId) throw invalidCode();

        const [eventSnap, userSnap] = await Promise.all([
            txn.get(db.collection("upcomingEvents").doc(eventId)),
            txn.get(userRef),
        ]);
        // Forces retry if the event is concurrently deleted mid-claim
        if (!eventSnap.exists) throw invalidCode();
        if (!userSnap.exists) throw invalidCode();

        const eventData = eventSnap.data()!;
        // Paid events use tickets — reject stale code URLs from before a paid toggle.
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
            performedBy: uid,
            performedByName: userSnap.data()?.displayName ?? "",
            eventId,
            eventTitle: eventTitle || eventId,
            code,
        }));
        return {eventId, eventTitle, eventTitleCn, eventPoster};
    });
});

/** Binds the badge behind `code` to `uid`. `code` is already canonical. */
async function redeemBadgeCode(uid: string, code: string) {
    const codeRef = db.collection("badgeActivationCodes").doc(code);
    const userRef = db.collection("users").doc(uid);

    return db.runTransaction(async (txn) => {
        const freshCode = await txn.get(codeRef);
        if (!freshCode.exists) throw invalidCode();
        const data = freshCode.data()!;
        validateCodeInTransaction(data);

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
            performedBy: uid,
            performedByName: userSnap.data()?.displayName ?? "",
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
            performedBy: uid,
            performedByName: callerSnap.data()?.displayName ?? "",
            badgeId,
            badgeName: badgeSnap.data()!.name ?? badgeId,
        }));
    });
});
export const generateEventCode = onCall({maxInstances: 10}, async (request) => {
    const uid = await requireAuth(request, "staff");

    const input = request.data as {
        eventId?: string;
        activeFrom?: string;
        activeUntil?: string;
    };
    const eventId = validateDocId(input.eventId, "eventId");
    const activeFrom = validateInstant(input.activeFrom, "activeFrom");
    const activeUntil = validateInstant(input.activeUntil, "activeUntil");

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
            performedBy: uid,
            performedByName: callerSnap.data()?.displayName ?? "",
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
            ...windowFields(activeFrom, activeUntil),
        });
        txn.set(recordRef(), recordDoc("code-create", {...fields, code}));
    });
});
export const toggleClaimCodeActive = onCall({maxInstances: 10}, async (request) => {
    const uid = await requireAuth(request, "staff");

    const input = request.data as {codeId?: string; active?: unknown};
    const codeId = validateDocId(input.codeId, "codeId");
    const active = validateBoolean(input.active, "active");

    return adminTransaction(uid, async (txn, callerSnap) => {
        const {ref, data} = await readCode(txn, "claimCodes", codeId);
        const event = await codeEventFields(txn, data, {pastToo: false});

        txn.update(ref, {active});
        txn.set(recordRef(), recordDoc(active ? "event-code-activate" : "event-code-deactivate", {
            performedBy: uid,
            performedByName: callerSnap.data()?.displayName ?? "",
            ...event,
            code: data.code ?? "",
        }));
        return {active};
    });
});
export const saveClaimCodeTimeWindow = onCall({maxInstances: 10}, async (request) => {
    const uid = await requireAuth(request, "staff");

    const input = request.data as {codeId?: string; activeFrom?: string; activeUntil?: string};
    const codeId = validateDocId(input.codeId, "codeId");
    const activeFrom = validateInstant(input.activeFrom, "activeFrom");
    const activeUntil = validateInstant(input.activeUntil, "activeUntil");

    return adminTransaction(uid, async (txn, callerSnap) => {
        const {ref, data} = await readCode(txn, "claimCodes", codeId);
        const event = await codeEventFields(txn, data, {pastToo: false});

        txn.update(ref, clearedWindow(activeFrom, activeUntil));
        txn.set(recordRef(), recordDoc("event-code-time-window", {
            performedBy: uid,
            performedByName: callerSnap.data()?.displayName ?? "",
            ...event,
            code: data.code ?? "",
        }));
        return {saved: true};
    });
});
export const toggleBadgeCodeActive = onCall({maxInstances: 10}, async (request) => {
    const uid = await requireAuth(request, "staff");

    const input = request.data as {codeId?: string; active?: unknown};
    const codeId = validateDocId(input.codeId, "codeId");
    const active = validateBoolean(input.active, "active");

    return adminTransaction(uid, async (txn, callerSnap) => {
        const {ref, data} = await readCode(txn, "badgeActivationCodes", codeId);
        const badge = await codeBadgeFields(txn, data);

        txn.update(ref, {active});
        txn.set(recordRef(), recordDoc(active ? "badge-code-activate" : "badge-code-deactivate", {
            performedBy: uid,
            performedByName: callerSnap.data()?.displayName ?? "",
            ...badge,
        }));
        return {active};
    });
});
export const deleteBadgeActivationCode = onCall({maxInstances: 10}, async (request) => {
    const uid = await requireAuth(request, "staff");

    const codeId = validateDocId((request.data as {codeId?: string})?.codeId, "codeId");

    return adminTransaction(uid, async (txn, callerSnap) => {
        const {ref, data} = await readCode(txn, "badgeActivationCodes", codeId);
        const badge = await codeBadgeFields(txn, data);

        txn.delete(ref);
        txn.set(recordRef(), recordDoc("code-delete", {
            performedBy: uid,
            performedByName: callerSnap.data()?.displayName ?? "",
            ...badge,
        }));
        return {deleted: true};
    });
});
export const generateStaffCode = onCall({maxInstances: 10}, async (request) => {
    const uid = await requireAuth(request, "staff");

    const input = request.data as {eventId?: string; activeFrom?: string; activeUntil?: string; maxUses?: number};
    const eventId = validateDocId(input.eventId, "eventId");
    const activeFrom = validateInstant(input.activeFrom, "activeFrom");
    const activeUntil = validateInstant(input.activeUntil, "activeUntil");
    const maxUses = validateMaxUses(input.maxUses);

    return issueUniqueCode(uid, "staff", "staffClaimCodes", async (txn, callerSnap, code, codeRef) => {
        // Staff codes also work for past events, to credit staff after the
        // fact.
        const {snap: eventSnap} = await getEventInTxn(txn, eventId);
        if (!eventSnap.exists) throw new HttpsError("not-found", "Event not found.");

        const existingCodes = await txn.get(db.collection("staffClaimCodes").where("eventId", "==", eventId));
        const fields = {
            performedBy: uid,
            performedByName: callerSnap.data()?.displayName ?? "",
            eventTitle: eventSnap.data()?.title ?? eventId,
            eventId,
        };

        // Replaces every code the event had, enabled or not. Staff they
        // admitted stay staff; that lives on their user records.
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
            maxUses,
            ...windowFields(activeFrom, activeUntil),
        });
        txn.set(recordRef(), recordDoc("staff-code-create", fields));
    });
});

/** Makes `uid` staff for the event behind `code`. `code` is already canonical. */
async function redeemStaffCode(uid: string, code: string) {
    const codeRef = db.collection("staffClaimCodes").doc(code);
    const userRef = db.collection("users").doc(uid);

    return db.runTransaction(async (txn) => {
        const freshCode = await txn.get(codeRef);
        if (!freshCode.exists) throw invalidCode();
        const data = freshCode.data()!;
        validateCodeInTransaction(data);

        const eventId: string = data.eventId;
        if (!eventId) throw invalidCode();

        const [{snap: eventSnap, archived: isPastEvent}, userSnap] = await Promise.all([
            getEventInTxn(txn, eventId),
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
            // As in assignEventStaff: upcoming, they count as attending; past,
            // they stay off the free attendee list and get the Staff badge.
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
        // Record the attendance change that comes with joining, as assignEventStaff does.
        const attendanceChanged = isPastEvent ? alreadyAttended : !alreadyAttended;
        if (attendanceChanged) {
            txn.set(recordRef(), recordDoc(isPastEvent ? "event-unattend" : "event-attend", fields));
        }
        return {eventTitle, eventTitleCn, eventPoster};
    });
}

export const toggleStaffCodeActive = onCall({maxInstances: 10}, async (request) => {
    const uid = await requireAuth(request, "staff");

    const input = request.data as {codeId?: string; active?: unknown};
    const codeId = validateDocId(input.codeId, "codeId");
    const active = validateBoolean(input.active, "active");

    return adminTransaction(uid, async (txn, callerSnap) => {
        const {ref, data} = await readCode(txn, "staffClaimCodes", codeId);
        const event = await codeEventFields(txn, data, {pastToo: true});

        txn.update(ref, {active});
        txn.set(recordRef(), recordDoc(active ? "staff-code-activate" : "staff-code-deactivate", {
            performedBy: uid,
            performedByName: callerSnap.data()?.displayName ?? "",
            ...event,
        }));
        return {active};
    });
});
export const saveStaffCodeTimeWindow = onCall({maxInstances: 10}, async (request) => {
    const uid = await requireAuth(request, "staff");

    const input = request.data as {codeId?: string; activeFrom?: string; activeUntil?: string; maxUses?: number};
    const codeId = validateDocId(input.codeId, "codeId");
    const activeFrom = validateInstant(input.activeFrom, "activeFrom");
    const activeUntil = validateInstant(input.activeUntil, "activeUntil");
    const maxUses = validateMaxUses(input.maxUses);

    return adminTransaction(uid, async (txn, callerSnap) => {
        const {ref, data} = await readCode(txn, "staffClaimCodes", codeId);
        const event = await codeEventFields(txn, data, {pastToo: true});

        txn.update(ref, {
            ...clearedWindow(activeFrom, activeUntil),
            ...(input.maxUses !== undefined ? {maxUses} : {}),
        });
        txn.set(recordRef(), recordDoc("staff-code-time-window", {
            performedBy: uid,
            performedByName: callerSnap.data()?.displayName ?? "",
            ...event,
        }));
        return {saved: true};
    });
});
/**
 * Deletes a staff code for good, but only a disabled one, so a code in use is
 * switched off first. Staff it admitted stay staff.
 */
export const deleteStaffCode = onCall({maxInstances: 10}, async (request) => {
    const uid = await requireAuth(request, "staff");

    const codeId = validateDocId((request.data as {codeId?: string})?.codeId, "codeId");

    return adminTransaction(uid, async (txn, callerSnap) => {
        const {ref, data} = await readCode(txn, "staffClaimCodes", codeId);
        if (data.active !== false) {
            throw new HttpsError("failed-precondition", "Disable the code before deleting it.", {code: "active"});
        }
        const event = await codeEventFields(txn, data, {pastToo: true});

        txn.delete(ref);
        txn.set(recordRef(), recordDoc("staff-code-delete", {
            performedBy: uid,
            performedByName: callerSnap.data()?.displayName ?? "",
            ...event,
        }));
        return {deleted: true};
    });
});
