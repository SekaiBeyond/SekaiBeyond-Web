import { HttpsError, onCall } from "firebase-functions/v2/https";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { ADMIN_GROUPS, adminTransaction, checkRateLimit, requireAuth } from "../utils/auth";
import { db } from "../utils/firebase";
import { codeKind, issueCode, normalizeCode } from "../utils/codes";
import { validateCodeInTransaction } from "../utils/helpers";
import { claimPassportWithKey, findPassportByKey, normalizeActivationKey } from "../utils/passports";
import { validateDocId, validateISODate, validateMaxUses } from "../utils/validation";
import { recordDoc, type RecordFields, recordRef } from "../utils/records";

const INVALID = "Invalid or deactivated code.";

/** The code off a request, canonical, or the same "invalid" every path reports. */
function requireCode(request: {data: unknown}): string {
    const code = normalizeCode((request.data as {code?: unknown})?.code);
    if (!code) throw new HttpsError("invalid-argument", INVALID, {code: "invalid"});
    return code;
}

/**
 * "That isn't one of ours" — the only failure worth trying the next kind on.
 * Anything else (expired, used up, already held) describes a code we did match,
 * and re-asking a different collection would replace a true answer with
 * "invalid".
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
 * One door for every code a member can type: badge codes, staff codes, and the
 * key on a passport's slip are all redeemed here.
 *
 * The client used to do this dispatch itself by calling each claim function in
 * turn, which spent a rate-limit slot per guess (requireAuth charges one each
 * time) and let five mistypes lock someone out for a minute. Guessing from here
 * costs one slot however many collections it takes, and the guessing stops
 * entirely for a code whose prefix names its kind.
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
            // Check-in codes are scanned from their claim URL rather than typed,
            // so the prefix buys a straight answer instead of "invalid".
            throw new HttpsError("failed-precondition", "This code checks you in at an event.", {
                code: "event-code",
            });
    }

    // No prefix: a staff code issued before prefixes existed, or a passport key.
    // Every bare badge code is gone, so only staff codes still need the guess.
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

    throw new HttpsError("not-found", INVALID, {code: "invalid"});
});

export const claimEventCode = onCall({maxInstances: 20}, async (request) => {
    const uid = await requireAuth(request);
    const code = requireCode(request);

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
        code = issueCode("badge");
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
                // No code on badge-code records: activation codes are
                // core-staff+ only, and every staff member can read records.
                // Check-in codes, which all staff can read anyway, keep theirs.
                txn.set(recordRef(), recordDoc("code-create", {
                    performedBy: uid,
                    performedByName: callerSnap.data()?.displayName ?? "",
                    badgeId,
                    badgeName: badgeSnap.data()!.name ?? badgeId,
                }));
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
        code = issueCode("event");
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
                for (const oldDoc of existingCodes.docs) {
                    txn.update(oldDoc.ref, {active: false});
                    txn.set(recordRef(), recordDoc("event-code-deactivate", {
                        performedBy: uid,
                        performedByName: callerSnap.data()?.displayName ?? "",
                        eventTitle: eventSnap.data()?.title ?? eventId,
                        eventId,
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
                    ...(activeFrom ? {activeFrom} : {}),
                    ...(activeUntil ? {activeUntil} : {}),
                    ...(expiresAt ? {expiresAt} : {}),
                });
                txn.set(recordRef(), recordDoc("code-create", {
                    performedBy: uid,
                    performedByName: callerSnap.data()?.displayName ?? "",
                    eventTitle: eventSnap.data()?.title ?? eventId,
                    eventId,
                    code,
                }));
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
        txn.set(recordRef(), recordDoc(input.active ? "event-code-activate" : "event-code-deactivate", {
            performedBy: uid,
            performedByName: callerSnap.data()?.displayName ?? "",
            eventTitle: eventSnap?.data()?.title ?? codeData.eventId ?? "",
            eventId: codeData.eventId ?? "",
            code: codeData.code ?? "",
        }));
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
        txn.set(recordRef(), recordDoc("event-code-time-window", {
            performedBy: uid,
            performedByName: callerSnap.data()?.displayName ?? "",
            eventTitle: eventSnap?.data()?.title ?? codeData.eventId ?? "",
            eventId: codeData.eventId ?? "",
            code: codeData.code ?? "",
        }));
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
        txn.set(recordRef(), recordDoc(input.active ? "badge-code-activate" : "badge-code-deactivate", {
            performedBy: uid,
            performedByName: callerSnap.data()?.displayName ?? "",
            badgeId: codeData.badgeId ?? "",
            badgeName: badgeSnap?.data()?.name ?? codeData.badgeId ?? "",
        }));
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
        txn.set(recordRef(), recordDoc("code-delete", {
            performedBy: uid,
            performedByName: callerSnap.data()?.displayName ?? "",
            badgeId: codeData.badgeId ?? "",
            badgeName: badgeSnap?.data()?.name ?? codeData.badgeId ?? "",
        }));
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
        code = issueCode("staff");
        const codeRef = db.collection("staffClaimCodes").doc(code);

        try {
            await db.runTransaction(async (txn) => {
                const callerSnap = await txn.get(db.collection("users").doc(uid));
                if (!ADMIN_GROUPS.includes(callerSnap.data()?.group)) {
                    throw new HttpsError("permission-denied", "Insufficient permissions.");
                }

                // Staff codes can be generated for past events too (to credit
                // staff retroactively), so resolve the event from either collection.
                const [upcomingSnap, pastSnap] = await Promise.all([
                    txn.get(db.collection("upcomingEvents").doc(eventId)),
                    txn.get(db.collection("pastEvents").doc(eventId)),
                ]);
                const eventSnap = upcomingSnap.exists ? upcomingSnap : pastSnap;
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
                    txn.set(recordRef(), recordDoc("staff-code-deactivate", {
                        performedBy: uid,
                        performedByName: callerSnap.data()?.displayName ?? "",
                        eventTitle: eventSnap.data()?.title ?? eventId,
                        eventId,
                    }));
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
                txn.set(recordRef(), recordDoc("staff-code-create", {
                    performedBy: uid,
                    performedByName: callerSnap.data()?.displayName ?? "",
                    eventTitle: eventSnap.data()?.title ?? eventId,
                    eventId,
                }));
            });
            return {id: code, code};
        } catch (err) {
            if (err instanceof Error && err.message === "duplicate") continue;
            throw err;
        }
    }

    throw new HttpsError("internal", "code-generation-failed");
});

/** Makes `uid` staff for the event behind `code`. `code` is already canonical. */
async function redeemStaffCode(uid: string, code: string) {
    const codeRef = db.collection("staffClaimCodes").doc(code);
    const userRef = db.collection("users").doc(uid);

    return db.runTransaction(async (txn) => {
        const freshCode = await txn.get(codeRef);
        if (!freshCode.exists) throw new HttpsError("not-found", "Invalid or deactivated code.", {code: "invalid"});
        const data = freshCode.data()!;
        validateCodeInTransaction(data);

        const eventId: string = data.eventId;
        if (!eventId) throw new HttpsError("not-found", "Invalid or deactivated code.", {code: "invalid"});

        const [upcomingSnap, pastSnap, userSnap] = await Promise.all([
            txn.get(db.collection("upcomingEvents").doc(eventId)),
            txn.get(db.collection("pastEvents").doc(eventId)),
            txn.get(userRef),
        ]);
        const eventSnap = upcomingSnap.exists ? upcomingSnap : pastSnap;
        if (!eventSnap.exists) throw new HttpsError("not-found", "Invalid or deactivated code.", {code: "invalid"});
        if (!userSnap.exists) throw new HttpsError("not-found", "Invalid or deactivated code.", {code: "invalid"});
        const isPastEvent = !upcomingSnap.exists;

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
            // Upcoming: auto-attend. Past: keep them out of the free attendee list
            // (matches assignEventStaff — staff are credited via the Staff badge).
            attendedEvents: isPastEvent
                ? FieldValue.arrayRemove(eventId)
                : FieldValue.arrayUnion(eventId),
        });
        // The code itself stays out of the record: staff codes are core-staff+
        // only, and every staff member can read records.
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
        // As assignEventStaff does, say when joining moved them onto or off the
        // attendee list, so the change doesn't go unexplained.
        const attendanceChanged = isPastEvent ? alreadyAttended : !alreadyAttended;
        if (attendanceChanged) {
            txn.set(recordRef(), recordDoc(isPastEvent ? "event-unattend" : "event-attend", fields));
        }
        return {eventId, eventTitle, eventTitleCn, eventPoster};
    });
}

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
        txn.set(recordRef(), recordDoc(input.active ? "staff-code-activate" : "staff-code-deactivate", {
            performedBy: uid,
            performedByName: callerSnap.data()?.displayName ?? "",
            eventTitle: eventSnap?.data()?.title ?? codeData.eventId ?? "",
            eventId: codeData.eventId ?? "",
        }));
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
        txn.set(recordRef(), recordDoc("staff-code-time-window", {
            performedBy: uid,
            performedByName: callerSnap.data()?.displayName ?? "",
            eventTitle: eventSnap?.data()?.title ?? codeData.eventId ?? "",
            eventId: codeData.eventId ?? "",
        }));
        return {saved: true};
    });
});
