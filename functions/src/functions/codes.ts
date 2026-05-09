import { HttpsError, onCall } from "firebase-functions/v2/https";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { ADMIN_GROUPS, adminTransaction, checkRateLimit, requireAuth } from "../utils/auth";
import { recordExpiresAt } from "../utils/config";
import { db } from "../utils/firebase";
import { generateSecureCode, validateCodeInTransaction } from "../utils/helpers";
import { validateDocId, validateISODate, validateMaxUses } from "../utils/validation";

export const claimEventCode = onCall({maxInstances: 20}, async (request) => {
    const uid = await requireAuth(request);

    const code = (request.data as {code?: string})?.code?.trim().toUpperCase();
    if (!code || !/^[A-Z0-9]{6,20}$/.test(code)) {
        throw new HttpsError("invalid-argument", "Invalid or deactivated code.", {code: "invalid"});
    }

    const codeRef = db.collection("claimCodes").doc(code);
    const userRef = db.collection("users").doc(uid);

    return db.runTransaction(async (txn) => {
        const freshCode = await txn.get(codeRef);
        if (!freshCode.exists) throw new HttpsError("not-found", "Invalid or deactivated code.", {code: "invalid"});
        const data = freshCode.data()!;
        validateCodeInTransaction(data);

        const eventId: string = data.eventId;
        if (!eventId) throw new HttpsError("not-found", "Invalid or deactivated code.", {code: "invalid"});

        const [eventSnap, userSnap] = await Promise.all([
            txn.get(db.collection("upcomingEvents").doc(eventId)),
            txn.get(userRef),
        ]);
        // Forces retry if the event is concurrently deleted mid-claim
        if (!eventSnap.exists) throw new HttpsError("not-found", "Invalid or deactivated code.", {code: "invalid"});
        if (!userSnap.exists) throw new HttpsError("not-found", "Invalid or deactivated code.", {code: "invalid"});

        const eventData = eventSnap.data()!;
        // Paid events use tickets — reject stale code URLs from before a paid toggle.
        if (eventData.paid === true) {
            throw new HttpsError("failed-precondition", "Invalid or deactivated code.", {code: "invalid"});
        }
        const eventTitle: string = eventData.title ?? eventData.name ?? "";
        const eventTitleCn: string = eventData.titleCn ?? eventData.nameCn ?? "";
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
        txn.set(db.collection("records").doc(), {
            type: "event-claim",
            performedBy: uid,
            performedByName: userSnap.data()?.displayName ?? "",
            eventId,
            eventTitle: eventTitle || eventId,
            code,
            timestamp: FieldValue.serverTimestamp(),
            expiresAt: recordExpiresAt(),
        });
        return {eventId, eventTitle, eventTitleCn, eventPoster};
    });
});
export const claimBadgeActivationCode = onCall({maxInstances: 20}, async (request) => {
    const uid = await requireAuth(request);

    const code = (request.data as {code?: string})?.code?.trim().toUpperCase();
    if (!code || !/^[A-Z0-9]{6,20}$/.test(code)) {
        throw new HttpsError("invalid-argument", "Invalid or deactivated code.", {code: "invalid"});
    }

    const codeRef = db.collection("badgeActivationCodes").doc(code);
    const userRef = db.collection("users").doc(uid);

    return db.runTransaction(async (txn) => {
        const freshCode = await txn.get(codeRef);
        if (!freshCode.exists) throw new HttpsError("not-found", "Invalid or deactivated code.", {code: "invalid"});
        const data = freshCode.data()!;
        validateCodeInTransaction(data);

        const badgeId: string = data.badgeId;
        if (!badgeId) throw new HttpsError("not-found", "Invalid or deactivated code.", {code: "invalid"});

        const [badgeSnap, userSnap] = await Promise.all([
            txn.get(db.collection("badges").doc(badgeId)),
            txn.get(userRef),
        ]);
        if (!badgeSnap.exists) throw new HttpsError("not-found", "Invalid or deactivated code.", {code: "invalid"});
        if (!userSnap.exists) throw new HttpsError("not-found", "Invalid or deactivated code.", {code: "invalid"});
        const badgeData = badgeSnap.data()!;

        const userBadges: string[] = userSnap.data()!.badges ?? [];
        if (userBadges.includes(badgeId)) {
            throw new HttpsError("already-exists", "You already have this badge.", {code: "already-have"});
        }

        txn.update(codeRef, {usedCount: FieldValue.increment(1)});
        txn.update(userRef, {
            badges: FieldValue.arrayUnion(badgeId),
            [`badgeEarnedAt.${badgeId}`]: FieldValue.serverTimestamp(),
        });
        txn.set(db.collection("records").doc(), {
            type: "badge-claim",
            performedBy: uid,
            performedByName: userSnap.data()?.displayName ?? "",
            badgeId,
            badgeName: badgeData.name ?? badgeId,
            code,
            timestamp: FieldValue.serverTimestamp(),
            expiresAt: recordExpiresAt(),
        });

        return {
            badgeId,
            badgeName: badgeData.name ?? "",
            badgeNameCn: badgeData.nameCn ?? "",
            badgeDescription: badgeData.description ?? "",
            badgeDescriptionCn: badgeData.descriptionCn ?? "",
            badgeImageUrl: badgeData.imageUrl ?? "",
        };
    });
});
export const generateBadgeActivationCode = onCall({maxInstances: 10}, async (request) => {
    if (!request.auth) {
        throw new HttpsError("unauthenticated", "Must be signed in.");
    }

    const uid = request.auth.uid;
    await checkRateLimit(uid);

    const input = request.data as {
        badgeId?: string;
        maxUses?: number;
        activeFrom?: string;
        activeUntil?: string;
    };
    const badgeId = validateDocId(input.badgeId, "badgeId");
    const maxUses = validateMaxUses(input.maxUses);
    const activeFrom = validateISODate(input.activeFrom, "activeFrom");
    const activeUntil = validateISODate(input.activeUntil, "activeUntil");
    const expiresAt = activeUntil ? Timestamp.fromDate(new Date(activeUntil)) : null;

    let code = "";

    for (let attempt = 0; attempt < 5; attempt++) {
        code = generateSecureCode(12);
        const codeRef = db.collection("badgeActivationCodes").doc(code);

        try {
            await db.runTransaction(async (txn) => {
                // Verify admin inside the transaction for atomicity
                const callerSnap = await txn.get(db.collection("users").doc(uid));
                if (!ADMIN_GROUPS.includes(callerSnap.data()?.group)) {
                    throw new HttpsError("permission-denied", "Insufficient permissions.");
                }

                const badgeSnap = await txn.get(db.collection("badges").doc(badgeId));
                if (!badgeSnap.exists) {
                    throw new HttpsError("not-found", "Badge not found.");
                }

                const existing = await txn.get(codeRef);
                if (existing.exists) {
                    throw new Error("duplicate");
                }
                txn.set(codeRef, {
                    code,
                    badgeId,
                    createdBy: uid,
                    createdAt: FieldValue.serverTimestamp(),
                    active: true,
                    maxUses,
                    usedCount: 0,
                    ...(activeFrom ? {activeFrom} : {}),
                    ...(activeUntil ? {activeUntil} : {}),
                    ...(expiresAt ? {expiresAt} : {}),
                });
                txn.set(db.collection("records").doc(), {
                    type: "code-create",
                    performedBy: uid,
                    performedByName: callerSnap.data()?.displayName ?? "",
                    badgeId,
                    badgeName: badgeSnap.data()!.name ?? badgeId,
                    code,
                    timestamp: FieldValue.serverTimestamp(),
                    expiresAt: recordExpiresAt(),
                });
            });
            return {id: codeRef.id, code};
        } catch (err) {
            if (err instanceof Error && err.message === "duplicate") {
                if (attempt === 4) throw new HttpsError("internal", "code-generation-failed");
                continue;
            }
            throw err;
        }
    }

    throw new HttpsError("internal", "code-generation-failed");
});
export const generateEventCode = onCall({maxInstances: 10}, async (request) => {
    if (!request.auth) {
        throw new HttpsError("unauthenticated", "Must be signed in.");
    }

    const uid = request.auth.uid;
    await checkRateLimit(uid);

    const input = request.data as {
        eventId?: string;
        activeFrom?: string;
        activeUntil?: string;
    };
    const eventId = validateDocId(input.eventId, "eventId");
    const activeFrom = validateISODate(input.activeFrom, "activeFrom");
    const activeUntil = validateISODate(input.activeUntil, "activeUntil");
    const expiresAt = activeUntil ? Timestamp.fromDate(new Date(activeUntil)) : null;

    let code = "";

    for (let attempt = 0; attempt < 5; attempt++) {
        code = generateSecureCode(12);
        const codeRef = db.collection("claimCodes").doc(code);

        try {
            await db.runTransaction(async (txn) => {
                // Verify admin inside the transaction for atomicity
                const callerSnap = await txn.get(db.collection("users").doc(uid));
                if (!ADMIN_GROUPS.includes(callerSnap.data()?.group)) {
                    throw new HttpsError("permission-denied", "Insufficient permissions.");
                }

                const eventSnap = await txn.get(db.collection("upcomingEvents").doc(eventId));
                if (!eventSnap.exists) {
                    throw new HttpsError("not-found", "Event not found.");
                }
                if (eventSnap.data()?.paid === true) {
                    throw new HttpsError("failed-precondition",
                        "Paid events use tickets, not check-in codes.");
                }

                const [existing, existingCodes] = await Promise.all([
                    txn.get(codeRef),
                    txn.get(
                        db.collection("claimCodes")
                            .where("eventId", "==", eventId)
                            .where("active", "==", true)
                    ),
                ]);
                if (existing.exists) {
                    throw new Error("duplicate");
                }
                // Deactivate old codes
                for (const oldDoc of existingCodes.docs) {
                    txn.update(oldDoc.ref, {active: false});
                    txn.set(db.collection("records").doc(), {
                        type: "event-code-deactivate",
                        performedBy: uid,
                        performedByName: callerSnap.data()?.displayName ?? "",
                        eventTitle: eventSnap.data()?.title ?? eventSnap.data()?.name ?? eventId,
                        eventId,
                        code: oldDoc.data().code ?? oldDoc.id,
                        timestamp: FieldValue.serverTimestamp(),
                        expiresAt: recordExpiresAt(),
                    });
                }
                txn.set(codeRef, {
                    code,
                    eventId,
                    createdBy: uid,
                    createdAt: FieldValue.serverTimestamp(),
                    active: true,
                    usedCount: 0,
                    ...(activeFrom ? {activeFrom} : {}),
                    ...(activeUntil ? {activeUntil} : {}),
                    ...(expiresAt ? {expiresAt} : {}),
                });
                txn.set(db.collection("records").doc(), {
                    type: "code-create",
                    performedBy: uid,
                    performedByName: callerSnap.data()?.displayName ?? "",
                    eventTitle: eventSnap.data()?.title ?? eventSnap.data()?.name ?? eventId,
                    eventId,
                    code,
                    timestamp: FieldValue.serverTimestamp(),
                    expiresAt: recordExpiresAt(),
                });
            });
            return {id: codeRef.id, code};
        } catch (err) {
            if (err instanceof Error && err.message === "duplicate") {
                if (attempt === 4) throw new HttpsError("internal", "code-generation-failed");
                continue;
            }
            throw err;
        }
    }

    throw new HttpsError("internal", "code-generation-failed");
});
export const toggleClaimCodeActive = onCall({maxInstances: 10}, async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Must be signed in.");
    const uid = request.auth.uid;
    await checkRateLimit(uid);

    const input = request.data as {codeId?: string; active?: boolean};
    const codeId = validateDocId(input.codeId, "codeId");
    if (typeof input.active !== "boolean") {
        throw new HttpsError("invalid-argument", "active must be a boolean.");
    }

    return adminTransaction(uid, async (txn, callerSnap) => {
        const codeSnap = await txn.get(db.collection("claimCodes").doc(codeId));
        if (!codeSnap.exists) throw new HttpsError("not-found", "Code not found.");
        const codeData = codeSnap.data()!;

        const eventSnap = codeData.eventId
            ? await txn.get(db.collection("upcomingEvents").doc(codeData.eventId))
            : null;

        txn.update(db.collection("claimCodes").doc(codeId), {active: input.active});
        txn.set(db.collection("records").doc(), {
            type: input.active ? "event-code-activate" : "event-code-deactivate",
            performedBy: uid,
            performedByName: callerSnap.data()?.displayName ?? "",
            eventTitle: eventSnap?.data()?.title ?? eventSnap?.data()?.name ?? codeData.eventId ?? "",
            eventId: codeData.eventId ?? "",
            code: codeData.code ?? "",
            timestamp: FieldValue.serverTimestamp(),
            expiresAt: recordExpiresAt(),
        });
        return {active: input.active};
    });
});
export const saveClaimCodeTimeWindow = onCall({maxInstances: 10}, async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Must be signed in.");
    const uid = request.auth.uid;
    await checkRateLimit(uid);

    const input = request.data as {codeId?: string; activeFrom?: string; activeUntil?: string};
    const codeId = validateDocId(input.codeId, "codeId");
    const activeFrom = validateISODate(input.activeFrom, "activeFrom");
    const activeUntil = validateISODate(input.activeUntil, "activeUntil");

    return adminTransaction(uid, async (txn, callerSnap) => {
        const codeSnap = await txn.get(db.collection("claimCodes").doc(codeId));
        if (!codeSnap.exists) throw new HttpsError("not-found", "Code not found.");
        const codeData = codeSnap.data()!;

        const eventSnap = codeData.eventId
            ? await txn.get(db.collection("upcomingEvents").doc(codeData.eventId))
            : null;

        txn.update(db.collection("claimCodes").doc(codeId), {
            activeFrom: activeFrom ?? null,
            activeUntil: activeUntil ?? null,
            expiresAt: activeUntil ? Timestamp.fromDate(new Date(activeUntil)) : null,
        });
        txn.set(db.collection("records").doc(), {
            type: "event-code-time-window",
            performedBy: uid,
            performedByName: callerSnap.data()?.displayName ?? "",
            eventTitle: eventSnap?.data()?.title ?? eventSnap?.data()?.name ?? codeData.eventId ?? "",
            eventId: codeData.eventId ?? "",
            code: codeData.code ?? "",
            timestamp: FieldValue.serverTimestamp(),
            expiresAt: recordExpiresAt(),
        });
        return {saved: true};
    });
});
export const toggleBadgeCodeActive = onCall({maxInstances: 10}, async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Must be signed in.");
    const uid = request.auth.uid;
    await checkRateLimit(uid);

    const input = request.data as {codeId?: string; active?: boolean};
    const codeId = validateDocId(input.codeId, "codeId");
    if (typeof input.active !== "boolean") {
        throw new HttpsError("invalid-argument", "active must be a boolean.");
    }

    return adminTransaction(uid, async (txn, callerSnap) => {
        const codeSnap = await txn.get(db.collection("badgeActivationCodes").doc(codeId));
        if (!codeSnap.exists) throw new HttpsError("not-found", "Code not found.");
        const codeData = codeSnap.data()!;

        const badgeSnap = codeData.badgeId
            ? await txn.get(db.collection("badges").doc(codeData.badgeId))
            : null;

        txn.update(db.collection("badgeActivationCodes").doc(codeId), {active: input.active});
        txn.set(db.collection("records").doc(), {
            type: input.active ? "badge-code-activate" : "badge-code-deactivate",
            performedBy: uid,
            performedByName: callerSnap.data()?.displayName ?? "",
            badgeId: codeData.badgeId ?? "",
            badgeName: badgeSnap?.data()?.name ?? codeData.badgeId ?? "",
            code: codeData.code ?? "",
            timestamp: FieldValue.serverTimestamp(),
            expiresAt: recordExpiresAt(),
        });
        return {active: input.active};
    });
});
export const deleteBadgeActivationCode = onCall({maxInstances: 10}, async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Must be signed in.");
    const uid = request.auth.uid;
    await checkRateLimit(uid);

    const codeId = validateDocId((request.data as {codeId?: string})?.codeId, "codeId");

    return adminTransaction(uid, async (txn, callerSnap) => {
        const codeSnap = await txn.get(db.collection("badgeActivationCodes").doc(codeId));
        if (!codeSnap.exists) throw new HttpsError("not-found", "Code not found.");
        const codeData = codeSnap.data()!;

        const badgeSnap = codeData.badgeId
            ? await txn.get(db.collection("badges").doc(codeData.badgeId))
            : null;

        txn.delete(db.collection("badgeActivationCodes").doc(codeId));
        txn.set(db.collection("records").doc(), {
            type: "code-delete",
            performedBy: uid,
            performedByName: callerSnap.data()?.displayName ?? "",
            badgeId: codeData.badgeId ?? "",
            badgeName: badgeSnap?.data()?.name ?? codeData.badgeId ?? "",
            code: codeData.code ?? "",
            timestamp: FieldValue.serverTimestamp(),
            expiresAt: recordExpiresAt(),
        });
        return {deleted: true};
    });
});
export const generateStaffCode = onCall({maxInstances: 10}, async (request) => {
    if (!request.auth) {
        throw new HttpsError("unauthenticated", "Must be signed in.");
    }
    const uid = request.auth.uid;
    await checkRateLimit(uid);

    const input = request.data as {eventId?: string; activeFrom?: string; activeUntil?: string; maxUses?: number};
    const eventId = validateDocId(input.eventId, "eventId");
    const activeFrom = validateISODate(input.activeFrom, "activeFrom");
    const activeUntil = validateISODate(input.activeUntil, "activeUntil");
    const maxUses = validateMaxUses(input.maxUses);
    const expiresAt = activeUntil ? Timestamp.fromDate(new Date(activeUntil)) : null;

    let code = "";

    for (let attempt = 0; attempt < 5; attempt++) {
        code = generateSecureCode(12);
        const codeRef = db.collection("staffClaimCodes").doc(code);

        try {
            await db.runTransaction(async (txn) => {
                const callerSnap = await txn.get(db.collection("users").doc(uid));
                if (!ADMIN_GROUPS.includes(callerSnap.data()?.group)) {
                    throw new HttpsError("permission-denied", "Insufficient permissions.");
                }

                const eventSnap = await txn.get(db.collection("upcomingEvents").doc(eventId));
                if (!eventSnap.exists) throw new HttpsError("not-found", "Event not found.");

                const [existing, existingCodes] = await Promise.all([
                    txn.get(codeRef),
                    txn.get(
                        db.collection("staffClaimCodes")
                            .where("eventId", "==", eventId)
                            .where("active", "==", true)
                    ),
                ]);
                if (existing.exists) throw new Error("duplicate");

                for (const oldDoc of existingCodes.docs) {
                    txn.update(oldDoc.ref, {active: false});
                    txn.set(db.collection("records").doc(), {
                        type: "staff-code-deactivate",
                        performedBy: uid,
                        performedByName: callerSnap.data()?.displayName ?? "",
                        eventTitle: eventSnap.data()?.title ?? eventSnap.data()?.name ?? eventId,
                        eventId,
                        code: oldDoc.data().code ?? oldDoc.id,
                        timestamp: FieldValue.serverTimestamp(),
                        expiresAt: recordExpiresAt(),
                    });
                }
                txn.set(codeRef, {
                    code,
                    eventId,
                    createdBy: uid,
                    createdAt: FieldValue.serverTimestamp(),
                    active: true,
                    usedCount: 0,
                    maxUses,
                    ...(activeFrom ? {activeFrom} : {}),
                    ...(activeUntil ? {activeUntil} : {}),
                    ...(expiresAt ? {expiresAt} : {}),
                });
                txn.set(db.collection("records").doc(), {
                    type: "staff-code-create",
                    performedBy: uid,
                    performedByName: callerSnap.data()?.displayName ?? "",
                    eventTitle: eventSnap.data()?.title ?? eventSnap.data()?.name ?? eventId,
                    eventId,
                    code,
                    timestamp: FieldValue.serverTimestamp(),
                    expiresAt: recordExpiresAt(),
                });
            });
            return {id: code, code};
        } catch (err) {
            if (err instanceof Error && err.message === "duplicate") continue;
            throw err;
        }
    }

    throw new HttpsError("internal", "code-generation-failed");
});
export const claimStaffCode = onCall({maxInstances: 20}, async (request) => {
    const uid = await requireAuth(request);

    const code = (request.data as {code?: string})?.code?.trim().toUpperCase();
    if (!code || !/^[A-Z0-9]{6,20}$/.test(code)) {
        throw new HttpsError("invalid-argument", "Invalid or deactivated code.", {code: "invalid"});
    }

    const codeRef = db.collection("staffClaimCodes").doc(code);
    const userRef = db.collection("users").doc(uid);

    return db.runTransaction(async (txn) => {
        const freshCode = await txn.get(codeRef);
        if (!freshCode.exists) throw new HttpsError("not-found", "Invalid or deactivated code.", {code: "invalid"});
        const data = freshCode.data()!;
        validateCodeInTransaction(data);

        const eventId: string = data.eventId;
        if (!eventId) throw new HttpsError("not-found", "Invalid or deactivated code.", {code: "invalid"});

        const [eventSnap, userSnap] = await Promise.all([
            txn.get(db.collection("upcomingEvents").doc(eventId)),
            txn.get(userRef),
        ]);
        if (!eventSnap.exists) throw new HttpsError("not-found", "Invalid or deactivated code.", {code: "invalid"});
        if (!userSnap.exists) throw new HttpsError("not-found", "Invalid or deactivated code.", {code: "invalid"});

        const eventData = eventSnap.data()!;
        const eventTitle: string = eventData.title ?? eventData.name ?? "";
        const eventTitleCn: string = eventData.titleCn ?? eventData.nameCn ?? "";
        const eventPoster: string = eventData.poster ?? "";

        const staffEvents: string[] = userSnap.data()!.eventStaffEvents ?? [];
        if (staffEvents.includes(eventId)) {
            throw new HttpsError("already-exists", "You are already staff for this event.", {
                code: "already-have",
                eventId,
                eventTitle,
                eventTitleCn,
                eventPoster,
            });
        }

        txn.update(codeRef, {usedCount: FieldValue.increment(1)});
        txn.update(userRef, {
            eventStaffEvents: FieldValue.arrayUnion(eventId),
            attendedEvents: FieldValue.arrayUnion(eventId),
        });
        txn.set(db.collection("records").doc(), {
            type: "event-staff-assign",
            performedBy: uid,
            performedByName: userSnap.data()?.displayName ?? "",
            targetUid: uid,
            targetName: userSnap.data()?.displayName ?? "",
            eventId,
            eventTitle: eventTitle || eventId,
            code,
            timestamp: FieldValue.serverTimestamp(),
            expiresAt: recordExpiresAt(),
        });
        return {eventId, eventTitle, eventTitleCn, eventPoster};
    });
});
export const toggleStaffCodeActive = onCall({maxInstances: 10}, async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Must be signed in.");
    const uid = request.auth.uid;
    await checkRateLimit(uid);

    const input = request.data as {codeId?: string; active?: boolean};
    const codeId = validateDocId(input.codeId, "codeId");
    if (typeof input.active !== "boolean") {
        throw new HttpsError("invalid-argument", "active must be a boolean.");
    }

    return adminTransaction(uid, async (txn, callerSnap) => {
        const codeSnap = await txn.get(db.collection("staffClaimCodes").doc(codeId));
        if (!codeSnap.exists) throw new HttpsError("not-found", "Code not found.");
        const codeData = codeSnap.data()!;

        const eventSnap = codeData.eventId
            ? await txn.get(db.collection("upcomingEvents").doc(codeData.eventId))
            : null;

        txn.update(db.collection("staffClaimCodes").doc(codeId), {active: input.active});
        txn.set(db.collection("records").doc(), {
            type: input.active ? "staff-code-activate" : "staff-code-deactivate",
            performedBy: uid,
            performedByName: callerSnap.data()?.displayName ?? "",
            eventTitle: eventSnap?.data()?.title ?? eventSnap?.data()?.name ?? codeData.eventId ?? "",
            eventId: codeData.eventId ?? "",
            code: codeData.code ?? "",
            timestamp: FieldValue.serverTimestamp(),
            expiresAt: recordExpiresAt(),
        });
        return {active: input.active};
    });
});
export const saveStaffCodeTimeWindow = onCall({maxInstances: 10}, async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Must be signed in.");
    const uid = request.auth.uid;
    await checkRateLimit(uid);

    const input = request.data as {codeId?: string; activeFrom?: string; activeUntil?: string; maxUses?: number};
    const codeId = validateDocId(input.codeId, "codeId");
    const activeFrom = validateISODate(input.activeFrom, "activeFrom");
    const activeUntil = validateISODate(input.activeUntil, "activeUntil");
    const maxUses = validateMaxUses(input.maxUses);

    return adminTransaction(uid, async (txn, callerSnap) => {
        const codeSnap = await txn.get(db.collection("staffClaimCodes").doc(codeId));
        if (!codeSnap.exists) throw new HttpsError("not-found", "Code not found.");
        const codeData = codeSnap.data()!;

        const eventSnap = codeData.eventId
            ? await txn.get(db.collection("upcomingEvents").doc(codeData.eventId))
            : null;

        const updates: Record<string, unknown> = {
            activeFrom: activeFrom ?? null,
            activeUntil: activeUntil ?? null,
            expiresAt: activeUntil ? Timestamp.fromDate(new Date(activeUntil)) : null,
        };
        if (input.maxUses !== undefined) {
            updates.maxUses = maxUses;
        }
        txn.update(db.collection("staffClaimCodes").doc(codeId), updates);
        txn.set(db.collection("records").doc(), {
            type: "staff-code-time-window",
            performedBy: uid,
            performedByName: callerSnap.data()?.displayName ?? "",
            eventTitle: eventSnap?.data()?.title ?? eventSnap?.data()?.name ?? codeData.eventId ?? "",
            eventId: codeData.eventId ?? "",
            code: codeData.code ?? "",
            timestamp: FieldValue.serverTimestamp(),
            expiresAt: recordExpiresAt(),
        });
        return {saved: true};
    });
});
