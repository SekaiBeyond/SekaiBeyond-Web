import { HttpsError, onCall } from "firebase-functions/v2/https";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { normalizeGroup, requireAdmin, requireAuth } from "../utils/auth";
import { recordExpiresAt } from "../utils/config";
import { db } from "../utils/firebase";
import { commitInChunks, generateSecureCode } from "../utils/helpers";
import { extendedExpiry, isMembershipActive } from "../utils/membership";
import { pastEventIds, toStringIds } from "../utils/publicProfile";
import { recordScan } from "../utils/scans";
import {
    activationKeyMatches,
    formatActivationKey,
    isLockedOut,
    isPassportYear,
    lockedUntilMillis,
    LOCKOUT_MS,
    MAX_BATCH_COUNT,
    MAX_FAILED_ATTEMPTS,
    newActivationKey,
    normalizeActivationKey,
    normalizePassportId,
    PASSPORT_ID_LENGTH,
    PASSPORT_TERM_DAYS,
} from "../utils/passports";
import { validateStorageImageUrl, validateStr } from "../utils/validation";

/**
 * Physical passports.
 *
 * A passport is bound to the first account that claims it and stays bound —
 * there is no unbind and no rebind, so `ownerUid` and `claimedAt` are written
 * exactly once in a passport's life. That is what makes the public page at
 * /p/<passportId> a stable address: whoever scans the sticker afterwards always
 * lands on the same person.
 *
 * None of these handlers writes `users/{uid}.group`. Claiming moves
 * `membershipExpiresAt` and nothing else — a president who claims a passport is
 * still a president, and a lapsed membership never demotes anyone.
 */

const PASSPORTS = "passports";
const SECRETS = "passportSecrets";
const DESIGNS = "passportDesigns";

// The owner's shelf, and the public page's shelf. A passport a year is the
// intended pace; the cap only keeps a pathological account from unbounded reads.
const MAX_SHELF = 100;
const MAX_PUBLIC_BADGES = 60;

const performerName = (snap: FirebaseFirestore.DocumentSnapshot): string => snap.data()?.displayName ?? "";

/**
 * Generate a batch of passports for one year's design.
 *
 * The plaintext activation keys exist only in this response — they are hashed
 * before storage and never re-served. If the export is lost before the slips are
 * printed, reissuePassportKey mints a replacement key per passport.
 */
export const generatePassportBatch = onCall({maxInstances: 5}, async (request) => {
    const uid = await requireAuth(request);
    const callerSnap = await requireAdmin(uid);

    const input = request.data as {year?: unknown; count?: unknown};
    if (!isPassportYear(input.year)) {
        throw new HttpsError("invalid-argument", "Invalid year.");
    }
    const year = input.year;
    const count = input.count;
    if (typeof count !== "number" || !Number.isInteger(count) || count < 1 || count > MAX_BATCH_COUNT) {
        throw new HttpsError("invalid-argument", `count must be an integer between 1 and ${MAX_BATCH_COUNT}.`);
    }

    // A passport without a design has nothing to render on the shelf or the
    // public page, so the design comes first.
    const designSnap = await db.collection(DESIGNS).doc(String(year)).get();
    if (!designSnap.exists) {
        throw new HttpsError("failed-precondition", `No passport design exists for ${year}.`, {code: "no-design"});
    }

    const batchId = db.collection(PASSPORTS).doc().id;
    const issued: {passportId: string; activationCode: string}[] = [];
    const ops: ((batch: FirebaseFirestore.WriteBatch) => void)[] = [];
    const seen = new Set<string>();

    for (let i = 0; i < count; i++) {
        let passportId = generateSecureCode(PASSPORT_ID_LENGTH);
        // Only guards against a collision inside this batch; a collision with an
        // existing document is caught by batch.create() below, which fails the
        // whole batch rather than overwriting a passport someone already owns.
        while (seen.has(passportId)) passportId = generateSecureCode(PASSPORT_ID_LENGTH);
        seen.add(passportId);

        const {key, salt, secretHash} = newActivationKey();
        issued.push({passportId, activationCode: formatActivationKey(key)});

        ops.push((batch) => {
            batch.create(db.collection(PASSPORTS).doc(passportId), {
                year,
                status: "unclaimed",
                ownerUid: null,
                claimedAt: null,
                termDays: PASSPORT_TERM_DAYS,
                batchId,
                createdAt: FieldValue.serverTimestamp(),
                createdBy: uid,
                createdByName: performerName(callerSnap),
                keyIssuedAt: FieldValue.serverTimestamp(),
                keyReissueCount: 0,
                failedAttempts: 0,
                lockedUntil: null,
                scanCount: 0,
                lastScanAt: null,
            });
            batch.create(db.collection(SECRETS).doc(passportId), {salt, secretHash});
        });
    }

    await commitInChunks(ops);

    await db.collection("records").add({
        type: "passport-batch-generate",
        performedBy: uid,
        performedByName: performerName(callerSnap),
        batchId,
        passportYear: year,
        passportCount: count,
        timestamp: FieldValue.serverTimestamp(),
        expiresAt: recordExpiresAt(),
    });

    return {batchId, year, passports: issued};
});

/**
 * Mint a replacement activation key for an unclaimed passport, for when a key
 * slip is lost or damaged before the passport is sold. The stored hash is the
 * only copy of the old key, so this cannot reprint the original slip — it
 * invalidates it and hands back a new one, once.
 */
export const reissuePassportKey = onCall({maxInstances: 10}, async (request) => {
    const uid = await requireAuth(request);
    const callerSnap = await requireAdmin(uid);

    const passportId = normalizePassportId((request.data as {passportId?: unknown})?.passportId);
    if (!passportId) throw new HttpsError("invalid-argument", "Invalid passportId.");

    const {key, salt, secretHash} = newActivationKey();
    const ref = db.collection(PASSPORTS).doc(passportId);

    await db.runTransaction(async (txn) => {
        const snap = await txn.get(ref);
        if (!snap.exists) throw new HttpsError("not-found", "Passport not found.");
        const status = snap.data()?.status;
        if (status !== "unclaimed") {
            throw new HttpsError(
                "failed-precondition",
                status === "claimed"
                    ? "This passport has already been claimed; its key is spent."
                    : "This passport is void.",
                {code: status === "claimed" ? "already-claimed" : "void"},
            );
        }

        txn.set(db.collection(SECRETS).doc(passportId), {salt, secretHash});
        txn.update(ref, {
            keyIssuedAt: FieldValue.serverTimestamp(),
            keyReissueCount: FieldValue.increment(1),
            // A reissue also clears a lockout: the code an attacker was guessing
            // no longer exists, and the buyer shouldn't inherit the penalty.
            failedAttempts: 0,
            lockedUntil: null,
        });
        txn.set(ref.collection("claims").doc(), {
            action: "key-reissue",
            uid: null,
            at: FieldValue.serverTimestamp(),
            performedBy: uid,
            performedByName: performerName(callerSnap),
        });
        txn.set(db.collection("records").doc(), {
            type: "passport-key-reissue",
            performedBy: uid,
            performedByName: performerName(callerSnap),
            passportId,
            passportYear: snap.data()?.year ?? null,
            timestamp: FieldValue.serverTimestamp(),
            expiresAt: recordExpiresAt(),
        });
    });

    return {passportId, activationCode: formatActivationKey(key)};
});

/** Why a claim attempt didn't go through. Kept out of the exception path so the
 * failed-attempt counter is committed rather than rolled back with it. */
type ClaimFailure =
    | {code: "invalid"}
    | {code: "no-profile"}
    | {code: "void"}
    | {code: "already-claimed"}
    | {code: "no-key"}
    | {code: "locked"; retryAfterMs: number}
    | {code: "bad-key"; attemptsLeft: number};

/**
 * Claim a passport with the key from its slip. Grants the passport's term
 * (365 days), stacked onto any membership the caller already has, and binds the
 * passport permanently.
 */
export const claimPassport = onCall({maxInstances: 20}, async (request) => {
    const uid = await requireAuth(request);

    const input = request.data as {passportId?: unknown; activationCode?: unknown};
    const passportId = normalizePassportId(input.passportId);
    const activationCode = normalizeActivationKey(input.activationCode);
    if (!passportId) {
        throw new HttpsError("not-found", "This passport code is not valid.", {code: "invalid"});
    }
    if (!activationCode) {
        throw new HttpsError("permission-denied", "That activation key is not correct.", {code: "bad-key"});
    }

    const passportRef = db.collection(PASSPORTS).doc(passportId);
    const secretRef = db.collection(SECRETS).doc(passportId);
    const userRef = db.collection("users").doc(uid);

    const outcome = await db.runTransaction(async (txn): Promise<
        {ok: true; membershipExpiresAt: Timestamp; daysGranted: number; year: number}
        | {ok: false; failure: ClaimFailure}
    > => {
        const [passportSnap, secretSnap, userSnap] = await Promise.all([
            txn.get(passportRef),
            txn.get(secretRef),
            txn.get(userRef),
        ]);

        if (!passportSnap.exists) return {ok: false, failure: {code: "invalid"}};
        const passport = passportSnap.data()!;
        if (passport.status === "void") return {ok: false, failure: {code: "void"}};
        if (passport.status === "claimed") return {ok: false, failure: {code: "already-claimed"}};
        if (isLockedOut(passport)) {
            return {ok: false, failure: {code: "locked", retryAfterMs: lockedUntilMillis(passport) - Date.now()}};
        }
        if (!secretSnap.exists) return {ok: false, failure: {code: "no-key"}};
        // Distinct from "invalid": the sticker is fine, the account is the problem
        // (profile creation failed on first sign-in, or the doc was deleted under
        // an open tab). Answering "invalid" here sends the holder off to retype a
        // code that was never wrong.
        if (!userSnap.exists) return {ok: false, failure: {code: "no-profile"}};

        if (!activationKeyMatches(activationCode, secretSnap.data()!)) {
            const attempts = (typeof passport.failedAttempts === "number" ? passport.failedAttempts : 0) + 1;
            const locked = attempts >= MAX_FAILED_ATTEMPTS;
            txn.update(passportRef, {
                failedAttempts: locked ? 0 : attempts,
                lockedUntil: locked ? Timestamp.fromMillis(Date.now() + LOCKOUT_MS) : null,
            });
            return {
                ok: false,
                failure: {code: "bad-key", attemptsLeft: locked ? 0 : MAX_FAILED_ATTEMPTS - attempts},
            };
        }

        const userData = userSnap.data()!;
        const daysGranted = typeof passport.termDays === "number" ? passport.termDays : PASSPORT_TERM_DAYS;
        const membershipExpiresAt = extendedExpiry(userData.membershipExpiresAt ?? null, daysGranted);

        txn.update(passportRef, {
            status: "claimed",
            ownerUid: uid,
            claimedAt: FieldValue.serverTimestamp(),
            failedAttempts: 0,
            lockedUntil: null,
        });
        // Membership only. `group` is never touched here — see the file comment.
        txn.update(userRef, {membershipExpiresAt});
        // The key has done its one job and the binding is permanent, so the hash
        // is deleted rather than left sitting in the database.
        txn.delete(secretRef);
        txn.set(passportRef.collection("claims").doc(), {
            action: "claim",
            uid,
            at: FieldValue.serverTimestamp(),
            performedBy: uid,
            performedByName: userData.displayName ?? "",
            daysGranted,
        });
        txn.set(db.collection("records").doc(), {
            type: "passport-claim",
            performedBy: uid,
            performedByName: userData.displayName ?? "",
            targetUid: uid,
            targetName: userData.displayName ?? "",
            passportId,
            passportYear: passport.year ?? null,
            newExpiresAt: membershipExpiresAt.toDate().toISOString(),
            extendDays: daysGranted,
            timestamp: FieldValue.serverTimestamp(),
            expiresAt: recordExpiresAt(),
        });

        return {
            ok: true,
            membershipExpiresAt,
            daysGranted,
            year: typeof passport.year === "number" ? passport.year : 0,
        };
    });

    if (outcome.ok) {
        return {
            membershipExpiresAt: outcome.membershipExpiresAt.toDate().toISOString(),
            daysGranted: outcome.daysGranted,
            year: outcome.year,
        };
    }

    const failure = outcome.failure;
    switch (failure.code) {
        case "invalid":
            throw new HttpsError("not-found", "This passport code is not valid.", failure);
        case "no-profile":
            throw new HttpsError(
                "failed-precondition",
                "Your account isn't set up yet. Sign out and back in, then try again.",
                failure,
            );
        case "void":
            throw new HttpsError("failed-precondition", "This passport has been voided.", failure);
        case "already-claimed":
            throw new HttpsError("already-exists", "This passport has already been activated.", failure);
        case "no-key":
            throw new HttpsError(
                "failed-precondition",
                "This passport has no activation key on file. Please contact us.",
                failure,
            );
        case "locked":
            throw new HttpsError(
                "resource-exhausted",
                "Too many incorrect keys. Please try again later.",
                failure,
            );
        case "bad-key":
            throw new HttpsError("permission-denied", "That activation key is not correct.", failure);
    }
});

interface PublicBadge {
    id: string;
    name: string;
    nameCn: string;
    description: string;
    descriptionCn: string;
    imageUrl: string;
    earnedAt: string | null;
}

/**
 * Resolve a scanned sticker, for anyone — no sign-in.
 *
 * This is the second unauthenticated callable in the codebase (after
 * recordQrScan). The uid-keyed checkRateLimit can't apply, so abuse protection
 * is App Check, enforced for every callable by setGlobalOptions in index.ts, plus
 * the fact that reaching a real passport means holding a 10-character printed
 * code out of 31^10.
 *
 * It must not widen uid-keyed profile reads: getPublicProfile keeps its sign-in
 * requirement, nothing here accepts a uid, and the response never carries one —
 * `isOwner` is resolved server-side instead. Badge art is inlined because the
 * `badges` collection needs auth to read, which a signed-out scanner does not have.
 *
 * Unknown ids, void passports, and passports whose owner deleted their account
 * all answer identically ("invalid"), so a valid id can't be told from a
 * fabricated one. A private passport is distinguishable, deliberately: whoever
 * is holding that sticker deserves to know it works.
 */
export const getPassportPublicProfile = onCall({maxInstances: 20}, async (request) => {
    const passportId = normalizePassportId((request.data as {passportId?: unknown})?.passportId);
    if (!passportId) return {status: "invalid" as const};

    const passportRef = db.collection(PASSPORTS).doc(passportId);
    const passportSnap = await passportRef.get();
    if (!passportSnap.exists) return {status: "invalid" as const};

    const passport = passportSnap.data()!;
    if (passport.status === "void") return {status: "invalid" as const};

    const year = typeof passport.year === "number" ? passport.year : 0;

    if (passport.status !== "claimed" || !passport.ownerUid) {
        await tallyScan(passportRef);
        // The term is per-passport data, not a constant: the activation screen
        // quotes what this sticker actually grants rather than today's default.
        return {
            status: "unclaimed" as const,
            year,
            termDays: typeof passport.termDays === "number" ? passport.termDays : PASSPORT_TERM_DAYS,
        };
    }

    const ownerUid: string = passport.ownerUid;
    const ownerSnap = await db.collection("users").doc(ownerUid).get();
    // An owner who deleted their account leaves the passport bound to a uid that
    // no longer exists. The binding is permanent, so the sticker doesn't return
    // to circulation — it simply stops resolving.
    if (!ownerSnap.exists) return {status: "invalid" as const};

    const owner = ownerSnap.data()!;
    const isOwner = request.auth?.uid === ownerUid;
    if (owner.hidePassportPage === true && !isOwner) {
        await tallyScan(passportRef);
        return {status: "private" as const};
    }

    const attended = toStringIds(owner.attendedEvents);
    const staffed = toStringIds(owner.eventStaffEvents);
    const [badges, pastEvents, shelf] = await Promise.all([
        resolveBadges(owner),
        pastEventIds(attended, staffed),
        resolveShelf(ownerUid, passportId),
    ]);

    // The owner's own visits aren't scans. The page re-resolves whenever they
    // activate or flip visibility, and counting those would report a handful of
    // scans on a sticker nobody else has ever seen.
    if (!isOwner) await tallyScan(passportRef);

    return {
        status: "claimed" as const,
        year,
        claimedAt: (passport.claimedAt as Timestamp | null)?.toDate?.()?.toISOString() ?? null,
        // The owner is looking at their own passport: give them the management
        // details a visitor has no business seeing.
        isOwner,
        hidden: owner.hidePassportPage === true,
        scanCount: isOwner && typeof passport.scanCount === "number" ? passport.scanCount : null,
        membershipExpiresAt: isOwner
            ? ((owner.membershipExpiresAt as Timestamp | null)?.toDate?.()?.toISOString() ?? null)
            : null,
        owner: {
            displayName: owner.displayName ?? "",
            photoURL: owner.photoURL ?? "",
            joinedAt: (owner.joinedAt as Timestamp | null)?.toDate?.()?.toISOString() ?? null,
            group: normalizeGroup(owner.group),
            // Only whether membership is live is public; the date is the owner's business.
            isMember: isMembershipActive(owner),
            title: owner.title ?? "",
            titleCn: owner.titleCn ?? "",
            badges,
            attendedEvents: attended.filter(id => pastEvents.has(id)),
            eventStaffEvents: staffed.filter(id => pastEvents.has(id)),
        },
        shelf,
    };
});

/** A failed tally must never keep the scanned page from rendering. */
async function tallyScan(ref: FirebaseFirestore.DocumentReference): Promise<void> {
    try {
        await recordScan(ref);
    } catch (err) {
        console.error(`tallyScan: failed to record scan for passport ${ref.id}`, err);
    }
}

async function resolveBadges(owner: FirebaseFirestore.DocumentData): Promise<PublicBadge[]> {
    const ids: string[] = Array.isArray(owner.badges)
        ? owner.badges.filter((b: unknown): b is string => typeof b === "string").slice(0, MAX_PUBLIC_BADGES)
        : [];
    if (ids.length === 0) return [];

    const earnedAt = (owner.badgeEarnedAt ?? {}) as Record<string, Timestamp>;
    const snaps = await db.getAll(...ids.map(id => db.collection("badges").doc(id)));
    const out: PublicBadge[] = [];
    for (const snap of snaps) {
        if (!snap.exists) continue;
        const data = snap.data()!;
        out.push({
            id: snap.id,
            name: data.name ?? "",
            nameCn: data.nameCn ?? "",
            description: data.description ?? "",
            descriptionCn: data.descriptionCn ?? "",
            imageUrl: data.imageUrl ?? "",
            earnedAt: earnedAt[snap.id]?.toDate?.()?.toISOString() ?? null,
        });
    }
    return out;
}

/**
 * The owner's collection, by year. Sibling passport ids are deliberately left
 * out: each one is a URL to this same page, and a visitor holding one sticker
 * has no reason to be handed the rest. The client joins these against the
 * publicly readable passportDesigns for the artwork.
 *
 * Which card is the scanned one is resolved here, against the document id,
 * rather than left to the client to infer from the year — an owner who holds two
 * passports of the same year would otherwise see both marked current.
 */
async function resolveShelf(
    ownerUid: string,
    scannedId: string,
): Promise<{year: number; claimedAt: string | null; isCurrent: boolean}[]> {
    const snap = await db.collection(PASSPORTS)
        .where("ownerUid", "==", ownerUid)
        .limit(MAX_SHELF)
        .get();
    return snap.docs
        .map(doc => ({id: doc.id, data: doc.data()}))
        .filter(({data}) => data.status === "claimed")
        .map(({id, data}) => ({
            year: typeof data.year === "number" ? data.year : 0,
            claimedAt: (data.claimedAt as Timestamp | null)?.toDate?.()?.toISOString() ?? null,
            isCurrent: id === scannedId,
        }))
        .sort((a, b) => b.year - a.year);
}

/**
 * Void an unclaimed passport — a sticker destroyed in packing, a pack whose
 * slip and sticker were mismatched, stock written off. A claimed passport can
 * never be voided: the binding is permanent and its page belongs to its owner.
 * Membership a passport already granted is unaffected; use setMembership to
 * adjust that.
 */
export const voidPassport = onCall({maxInstances: 10}, async (request) => {
    const uid = await requireAuth(request);
    const callerSnap = await requireAdmin(uid);

    const passportId = normalizePassportId((request.data as {passportId?: unknown})?.passportId);
    if (!passportId) throw new HttpsError("invalid-argument", "Invalid passportId.");

    const ref = db.collection(PASSPORTS).doc(passportId);

    await db.runTransaction(async (txn) => {
        const snap = await txn.get(ref);
        if (!snap.exists) throw new HttpsError("not-found", "Passport not found.");
        const status = snap.data()?.status;
        if (status === "void") {
            throw new HttpsError("failed-precondition", "This passport is already void.", {code: "void"});
        }
        if (status === "claimed") {
            throw new HttpsError(
                "failed-precondition",
                "A claimed passport can't be voided — it is permanently bound to its owner.",
                {code: "already-claimed"},
            );
        }

        txn.update(ref, {status: "void", failedAttempts: 0, lockedUntil: null});
        txn.delete(db.collection(SECRETS).doc(passportId));
        txn.set(ref.collection("claims").doc(), {
            action: "void",
            uid: null,
            at: FieldValue.serverTimestamp(),
            performedBy: uid,
            performedByName: performerName(callerSnap),
        });
        txn.set(db.collection("records").doc(), {
            type: "passport-void",
            performedBy: uid,
            performedByName: performerName(callerSnap),
            passportId,
            passportYear: snap.data()?.year ?? null,
            timestamp: FieldValue.serverTimestamp(),
            expiresAt: recordExpiresAt(),
        });
    });

    return {passportId, status: "void" as const};
});

/** Hide or show the caller's own passport page. Self only, no admin path. */
export const setPassportPrivacy = onCall({maxInstances: 10}, async (request) => {
    const uid = await requireAuth(request);

    const hide = (request.data as {hide?: unknown})?.hide;
    if (typeof hide !== "boolean") {
        throw new HttpsError("invalid-argument", "hide must be a boolean.");
    }

    await db.collection("users").doc(uid).update({hidePassportPage: hide});
    return {hidePassportPage: hide};
});

/**
 * One year's cover art — publicly readable, so no secrets here. A design carries
 * nothing else: the year is the passport's name wherever it is shown, so the art
 * is the whole document and is therefore required.
 */
export const savePassportDesign = onCall({maxInstances: 10}, async (request) => {
    const uid = await requireAuth(request);
    const callerSnap = await requireAdmin(uid);

    const input = request.data as Record<string, unknown>;
    if (!isPassportYear(input.year)) {
        throw new HttpsError("invalid-argument", "Invalid year.");
    }
    const year = input.year;
    const coverImageUrl = validateStr(input.coverImageUrl, "coverImageUrl", 2000, true);
    validateStorageImageUrl(coverImageUrl, "coverImageUrl");

    const ref = db.collection(DESIGNS).doc(String(year));
    const existed = (await ref.get()).exists;

    await ref.set({
        year,
        coverImageUrl,
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: uid,
        ...(existed ? {} : {createdAt: FieldValue.serverTimestamp()}),
    }, {merge: true});

    await db.collection("records").add({
        type: existed ? "passport-design-edit" : "passport-design-create",
        performedBy: uid,
        performedByName: performerName(callerSnap),
        passportYear: year,
        timestamp: FieldValue.serverTimestamp(),
        expiresAt: recordExpiresAt(),
    });

    return {year};
});

/** Remove a design. Refused once passports of that year exist — they would be
 * left with nothing to render. */
export const deletePassportDesign = onCall({maxInstances: 10}, async (request) => {
    const uid = await requireAuth(request);
    const callerSnap = await requireAdmin(uid);

    const raw = (request.data as {year?: unknown})?.year;
    if (!isPassportYear(raw)) throw new HttpsError("invalid-argument", "Invalid year.");
    const year = raw;

    const ref = db.collection(DESIGNS).doc(String(year));
    const snap = await ref.get();
    if (!snap.exists) throw new HttpsError("not-found", "Design not found.");

    const inUse = await db.collection(PASSPORTS).where("year", "==", year).limit(1).get();
    if (!inUse.empty) {
        throw new HttpsError(
            "failed-precondition",
            `Passports have already been generated for ${year}.`,
            {code: "in-use"},
        );
    }

    await ref.delete();
    await db.collection("records").add({
        type: "passport-design-delete",
        performedBy: uid,
        performedByName: performerName(callerSnap),
        passportYear: year,
        timestamp: FieldValue.serverTimestamp(),
        expiresAt: recordExpiresAt(),
    });

    return {deleted: true};
});
