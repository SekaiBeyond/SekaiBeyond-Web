import { HttpsError, onCall } from "firebase-functions/v2/https";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { adminTransaction, normalizeGroup, requireAdmin, requireAuth } from "../utils/auth";
import { recordExpiresAt } from "../utils/config";
import { db } from "../utils/firebase";
import { commitInChunks, generateSecureCode } from "../utils/helpers";
import { extendedExpiry, MAX_GRANT_DAYS, startedAtAfter } from "../utils/membership";
import {
    activationKeyMatches,
    formatActivationKey,
    isLockedOut,
    isPassportYear,
    lockedUntilMillis,
    LOCKOUT_MS,
    MAX_DELETE_COUNT,
    MAX_FAILED_ATTEMPTS,
    MAX_GENERATE_COUNT,
    newActivationKey,
    normalizeActivationKey,
    normalizePassportId,
    PASSPORT_ID_LENGTH,
    PASSPORT_TERM_DAYS,
} from "../utils/passports";
import { sanitizeDisplayText, validateDocId, validateStorageImageUrl, validateStr } from "../utils/validation";

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

/** How many deleted passports' trails are read at once. They are separate reads
 * — a subcollection can't be queried across parents by passport — and almost all
 * of them come back empty, so they go out in parallel a chunk at a time rather
 * than one after another. */
const TRAIL_READ_CHUNK = 25;

const performerName = (snap: FirebaseFirestore.DocumentSnapshot): string => snap.data()?.displayName ?? "";

/**
 * Mint passports from one design — one, or as many as MAX_GENERATE_COUNT at a
 * time. Each one is an independent document: how many were made in the same call
 * is not recorded, and nothing downstream groups them.
 *
 * The keys come back in bulk only in this response. If the export is lost before
 * the slips are printed, revealPassportKey serves them again one passport at a
 * time.
 */
export const generatePassports = onCall({maxInstances: 5}, async (request) => {
    const uid = await requireAuth(request);
    const callerSnap = await requireAdmin(uid);

    const input = request.data as {designId?: unknown; count?: unknown};
    const designId = validateDocId(input.designId, "designId");
    const count = input.count;
    if (typeof count !== "number" || !Number.isInteger(count) || count < 1 || count > MAX_GENERATE_COUNT) {
        throw new HttpsError("invalid-argument", `count must be an integer between 1 and ${MAX_GENERATE_COUNT}.`);
    }

    // A passport without a design has nothing to render on the profile shelf or
    // the public page, so the design comes first.
    const designSnap = await db.collection(DESIGNS).doc(designId).get();
    if (!designSnap.exists) {
        throw new HttpsError("failed-precondition", "That passport design doesn't exist.", {code: "no-design"});
    }
    // Copied onto every passport: a design's year is fixed once it is created,
    // and the shelf sorts on it and records log it without reading designs.
    const year: number = designSnap.data()!.year;
    const designName: string = designSnap.data()!.name ?? "";
    // Copied too, but for a different reason: the term can be edited, and a
    // passport grants what its slip was sold with, not whatever the design says
    // by the time it's activated.
    const termDays: number = designSnap.data()!.termDays;

    const issued: {passportId: string; activationCode: string}[] = [];
    const ops: ((batch: FirebaseFirestore.WriteBatch) => void)[] = [];
    const seen = new Set<string>();

    for (let i = 0; i < count; i++) {
        let passportId = generateSecureCode(PASSPORT_ID_LENGTH);
        // Only guards against a collision within this call; a collision with an
        // existing document is caught by batch.create() below, which fails the
        // write rather than overwriting a passport someone already owns.
        while (seen.has(passportId)) passportId = generateSecureCode(PASSPORT_ID_LENGTH);
        seen.add(passportId);

        const {key, salt, secretHash} = newActivationKey();
        issued.push({passportId, activationCode: formatActivationKey(key)});

        ops.push((batch) => {
            batch.create(db.collection(PASSPORTS).doc(passportId), {
                designId,
                year,
                status: "unclaimed",
                ownerUid: null,
                claimedAt: null,
                termDays,
                createdAt: FieldValue.serverTimestamp(),
                createdBy: uid,
                createdByName: performerName(callerSnap),
                keyIssuedAt: FieldValue.serverTimestamp(),
                keyReissueCount: 0,
                failedAttempts: 0,
                lockedUntil: null,
            });
            batch.create(db.collection(SECRETS).doc(passportId), {salt, secretHash, key});
        });
    }

    await commitInChunks(ops);

    await db.collection("records").add({
        type: "passport-generate",
        performedBy: uid,
        performedByName: performerName(callerSnap),
        passportDesignId: designId,
        passportDesignName: designName,
        passportYear: year,
        passportCount: count,
        timestamp: FieldValue.serverTimestamp(),
        expiresAt: recordExpiresAt(),
    });

    return {designId, year, passports: issued};
});

/**
 * Mint a replacement activation key for an unclaimed passport, for when a key
 * slip may have been seen by someone it shouldn't have been. A slip that was
 * merely lost or damaged doesn't need this — revealPassportKey reprints it. This
 * invalidates the old key and hands back the new one.
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
        if (snap.data()?.status === "claimed") {
            throw new HttpsError(
                "failed-precondition",
                "This passport has already been claimed; its key is spent.",
                {code: "already-claimed"},
            );
        }

        txn.set(db.collection(SECRETS).doc(passportId), {salt, secretHash, key});
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

/**
 * Serve a passport's current key: an unclaimed one's to reprint its slip, a
 * claimed one's to check the key it was activated with. Every call is written to
 * the passport's trail and to records: the key is what makes an unsold passport
 * worth stealing, so who has looked at it is part of its history.
 */
export const revealPassportKey = onCall({maxInstances: 10}, async (request) => {
    const uid = await requireAuth(request);
    const callerSnap = await requireAdmin(uid);

    const passportId = normalizePassportId((request.data as {passportId?: unknown})?.passportId);
    if (!passportId) throw new HttpsError("invalid-argument", "Invalid passportId.");

    const ref = db.collection(PASSPORTS).doc(passportId);
    const secretRef = db.collection(SECRETS).doc(passportId);

    const key = await db.runTransaction(async (txn) => {
        const [snap, secretSnap] = await Promise.all([txn.get(ref), txn.get(secretRef)]);
        if (!snap.exists) throw new HttpsError("not-found", "Passport not found.");
        const status = snap.data()?.status;
        const stored = secretSnap.data()?.key;
        if (typeof stored !== "string") {
            throw new HttpsError(
                "failed-precondition",
                status === "claimed"
                    ? "No viewable key is on file for this passport."
                    : "No viewable key is on file for this passport. Reissue its key slip to get one.",
                {code: "no-key"},
            );
        }

        txn.set(ref.collection("claims").doc(), {
            action: "key-view",
            uid: null,
            at: FieldValue.serverTimestamp(),
            performedBy: uid,
            performedByName: performerName(callerSnap),
        });
        txn.set(db.collection("records").doc(), {
            type: "passport-key-view",
            performedBy: uid,
            performedByName: performerName(callerSnap),
            passportId,
            passportYear: snap.data()?.year ?? null,
            timestamp: FieldValue.serverTimestamp(),
            expiresAt: recordExpiresAt(),
        });
        return stored;
    });

    return {passportId, activationCode: formatActivationKey(key)};
});

/** Why a claim attempt didn't go through. Kept out of the exception path so the
 * failed-attempt counter is committed rather than rolled back with it. */
type ClaimFailure =
    | {code: "invalid"}
    | {code: "no-profile"}
    | {code: "already-claimed"}
    | {code: "no-key"}
    | {code: "locked"; retryAfterMs: number}
    | {code: "bad-key"; attemptsLeft: number};

/**
 * Claim a passport with the key from its slip. Grants the passport's term (set
 * by its design), stacked onto any membership the caller already has, and binds the
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
        const membershipStartedAt = startedAtAfter(userData, membershipExpiresAt);

        txn.update(passportRef, {
            status: "claimed",
            ownerUid: uid,
            claimedAt: FieldValue.serverTimestamp(),
            failedAttempts: 0,
            lockedUntil: null,
        });
        // Membership only. `group` is never touched here — see the file comment.
        txn.update(userRef, {
            membershipExpiresAt,
            membershipStartedAt: membershipStartedAt ?? FieldValue.delete(),
        });
        // The binding is permanent, so the hash has done its one job and is
        // dropped. The key stays so an admin can still look up what was on the
        // slip (revealPassportKey).
        txn.update(secretRef, {salt: FieldValue.delete(), secretHash: FieldValue.delete()});
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

/**
 * Resolve a scanned sticker, for anyone — no sign-in.
 *
 * This is the second unauthenticated callable in the codebase (after
 * recordQrScan). The uid-keyed checkRateLimit can't apply, so abuse protection
 * is App Check, enforced for every callable by setGlobalOptions in index.ts, plus
 * the fact that reaching a real passport means holding a 10-character printed
 * code out of 31^10.
 *
 * It must not widen uid-keyed profile reads, and doesn't: nothing here accepts a
 * uid, and the owner's uid it hands back only builds the link to their profile,
 * which getPublicProfile still serves to signed-in callers alone and filters by
 * the owner's section switches. Firestore rules keep the user document itself
 * unreadable by anyone else. `isOwner` is resolved server-side rather than by
 * comparing uids on the client. Badges, events, and the owner's other passports
 * are not part of it: the page doesn't show them, so a scanner isn't handed them
 * either.
 *
 * Unknown ids — including deleted passports — and passports whose owner deleted
 * their account all answer identically ("invalid"), so a valid id can't be told
 * from a fabricated one. A private passport is distinguishable, deliberately: whoever
 * is holding that sticker deserves to know it works.
 */
export const getPassportPublicProfile = onCall({maxInstances: 20}, async (request) => {
    const passportId = normalizePassportId((request.data as {passportId?: unknown})?.passportId);
    if (!passportId) return {status: "invalid" as const};

    const passportSnap = await db.collection(PASSPORTS).doc(passportId).get();
    if (!passportSnap.exists) return {status: "invalid" as const};

    const passport = passportSnap.data()!;

    // The page reads the design itself (passportDesigns is public), for its name
    // and cover art.
    const designId: string = passport.designId ?? "";

    if (passport.status !== "claimed" || !passport.ownerUid) {
        // The term is per-passport data, not a constant: the activation screen
        // quotes what this sticker actually grants rather than today's default.
        return {
            status: "unclaimed" as const,
            designId,
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
    if (owner.hidePassportPage === true && !isOwner) return {status: "private" as const};

    return {
        status: "claimed" as const,
        designId,
        claimedAt: (passport.claimedAt as Timestamp | null)?.toDate?.()?.toISOString() ?? null,
        // The owner is looking at their own passport: the page gives them its
        // privacy switch.
        isOwner,
        hidden: owner.hidePassportPage === true,
        owner: {
            uid: ownerUid,
            displayName: owner.displayName ?? "",
            photoURL: owner.photoURL ?? "",
            joinedAt: (owner.joinedAt as Timestamp | null)?.toDate?.()?.toISOString() ?? null,
            group: normalizeGroup(owner.group),
            title: owner.title ?? "",
            titleCn: owner.titleCn ?? "",
        },
    };
});

/**
 * Delete unclaimed passports — a sticker destroyed in packing, a pack whose slip
 * and sticker were mismatched, stock written off. Each one's document, key and
 * trail all go, so the code stops resolving and is free to be minted again. A
 * claimed passport can never be deleted: the binding is permanent and its page
 * belongs to its owner.
 *
 * One passport or a whole selection comes through here, because the guard is the
 * same either way. Nothing is refused for the sake of the rest: a claimed or
 * already-gone passport is reported back as skipped and the others still go, so
 * a stale row in the admin's table can't block the delete it is part of.
 *
 * Nothing about a deleted passport survives except the one `records` entry this
 * writes, which is what an admin looking for where a code went is left with.
 */
export const deletePassports = onCall({maxInstances: 10}, async (request) => {
    const uid = await requireAuth(request);
    const callerSnap = await requireAdmin(uid);

    const input = (request.data as {passportIds?: unknown})?.passportIds;
    if (!Array.isArray(input) || input.length < 1 || input.length > MAX_DELETE_COUNT) {
        throw new HttpsError(
            "invalid-argument",
            `passportIds must hold between 1 and ${MAX_DELETE_COUNT} passport codes.`,
        );
    }
    // Deduplicated before the reads: the same code twice would otherwise be
    // counted twice in the record and deleted twice in the same batch.
    const passportIds = [...new Set(input.map(normalizePassportId))];
    if (passportIds.some(id => id === null)) {
        throw new HttpsError("invalid-argument", "Invalid passportId.");
    }

    const refs = (passportIds as string[]).map(id => db.collection(PASSPORTS).doc(id));
    const snaps = await db.getAll(...refs);

    const deleted: string[] = [];
    const claimed: string[] = [];
    const missing: string[] = [];
    const ops: ((batch: FirebaseFirestore.WriteBatch) => void)[] = [];
    let year: number | null = null;

    for (const snap of snaps) {
        if (!snap.exists) {
            missing.push(snap.id);
            continue;
        }
        if (snap.data()?.status === "claimed") {
            claimed.push(snap.id);
            continue;
        }
        deleted.push(snap.id);
        if (year === null && typeof snap.data()?.year === "number") year = snap.data()!.year;

        // The delete carries the version the guard was read at, so a claim landing
        // between the two fails this write rather than binding a passport already
        // on its way out. What a transaction gave a single delete, a precondition
        // gives the whole selection — and a batch that fails this way commits
        // nothing, so the admin retries and sees the passport reported claimed.
        const updateTime = snap.updateTime;
        ops.push(batch => batch.delete(snap.ref, {lastUpdateTime: updateTime}));
        ops.push(batch => batch.delete(db.collection(SECRETS).doc(snap.id)));
    }

    if (ops.length > 0) {
        await commitInChunks(ops);
        await db.collection("records").add({
            type: "passport-delete",
            performedBy: uid,
            performedByName: performerName(callerSnap),
            // Named only when there is one to name; the count carries the rest.
            passportId: deleted.length === 1 ? deleted[0] : null,
            passportCount: deleted.length,
            passportYear: year,
            timestamp: FieldValue.serverTimestamp(),
            expiresAt: recordExpiresAt(),
        });
    }

    // A subcollection outlives its parent's delete, so the trails are swept after
    // the fact. Each is a handful of key reissues and key views — an unclaimed
    // passport has no claim on it, and most have nothing at all — and nothing can
    // reach one once its passport is gone, so a failure here is orphaned data to
    // log, never a failed delete.
    if (deleted.length > 0) {
        try {
            const trailOps: ((batch: FirebaseFirestore.WriteBatch) => void)[] = [];
            for (let i = 0; i < deleted.length; i += TRAIL_READ_CHUNK) {
                const trails = await Promise.all(deleted.slice(i, i + TRAIL_READ_CHUNK).map(
                    id => db.collection(PASSPORTS).doc(id).collection("claims").get()));
                for (const trail of trails) {
                    for (const entry of trail.docs) trailOps.push(batch => batch.delete(entry.ref));
                }
            }
            if (trailOps.length > 0) await commitInChunks(trailOps);
        } catch (err) {
            console.error(`deletePassports: trail cleanup failed for ${deleted.join(",")}`, err);
        }
    }

    return {deleted, claimed, missing};
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

/** The names a design is shown under, folded for comparison. The Chinese name
 * falls back to the English one, as the pages that render it do. */
const shownNames = (design: {name?: unknown; nameCn?: unknown}): string[] => {
    const name = typeof design.name === "string" ? design.name : "";
    const nameCn = typeof design.nameCn === "string" && design.nameCn ? design.nameCn : name;
    return [name.toLowerCase(), nameCn.toLowerCase()];
};

/**
 * Create or edit a design: the name passports generated from it go by, their
 * cover art, and the membership term they grant. Publicly readable, so no
 * secrets here.
 *
 * A year can have any number of designs, told apart by name, so a name may not
 * repeat within its year in either language. The year is set on creation and
 * never changes after. The term can change, but only for passports generated
 * afterwards: every passport keeps the term it was generated with.
 */
export const savePassportDesign = onCall({maxInstances: 10}, async (request) => {
    const uid = await requireAuth(request);

    const input = request.data as Record<string, unknown>;
    const designId = input.designId ? validateDocId(input.designId, "designId") : null;
    const createYear = isPassportYear(input.year) ? input.year : null;
    if (!designId && createYear === null) {
        throw new HttpsError("invalid-argument", "Invalid year.");
    }
    const name = sanitizeDisplayText(validateStr(input.name, "name", 100, true));
    const nameCn = sanitizeDisplayText(validateStr(input.nameCn, "nameCn", 100));
    if (!name) throw new HttpsError("invalid-argument", "name is required.");
    const coverImageUrl = validateStr(input.coverImageUrl, "coverImageUrl", 2000, true);
    validateStorageImageUrl(coverImageUrl, "coverImageUrl");
    // Optional, and blank on purpose when cleared: the cover art stands in for
    // the shut passport, which is what it did before this was a separate image.
    const outerCoverImageUrl = validateStr(input.outerCoverImageUrl, "outerCoverImageUrl", 2000);
    validateStorageImageUrl(outerCoverImageUrl, "outerCoverImageUrl");
    const termDays = input.termDays;
    if (typeof termDays !== "number" || !Number.isInteger(termDays) || termDays < 1 || termDays > MAX_GRANT_DAYS) {
        throw new HttpsError("invalid-argument", `termDays must be an integer between 1 and ${MAX_GRANT_DAYS}.`);
    }

    const ref = designId ? db.collection(DESIGNS).doc(designId) : db.collection(DESIGNS).doc();

    await adminTransaction(uid, async (txn, callerSnap) => {
        let year: number;
        if (designId) {
            const existing = await txn.get(ref);
            if (!existing.exists) throw new HttpsError("not-found", "Design not found.");
            year = existing.data()!.year;
        } else {
            year = createYear!;
        }

        const names = shownNames({name, nameCn});
        const sameYear = await txn.get(db.collection(DESIGNS).where("year", "==", year));
        const clash = sameYear.docs.some(d =>
            d.id !== ref.id && shownNames(d.data()).some(n => names.includes(n)));
        if (clash) {
            throw new HttpsError("already-exists", `${year} already has a design with that name.`, {code: "name-taken"});
        }

        const changes = {
            name,
            nameCn,
            coverImageUrl,
            outerCoverImageUrl,
            termDays,
            updatedAt: FieldValue.serverTimestamp(),
            updatedBy: uid,
        };
        if (designId) {
            txn.update(ref, changes);
        } else {
            txn.create(ref, {...changes, year, createdAt: FieldValue.serverTimestamp()});
        }
        txn.set(db.collection("records").doc(), {
            type: designId ? "passport-design-edit" : "passport-design-create",
            performedBy: uid,
            performedByName: performerName(callerSnap),
            passportDesignId: ref.id,
            passportDesignName: name,
            passportYear: year,
            timestamp: FieldValue.serverTimestamp(),
            expiresAt: recordExpiresAt(),
        });
    });

    return {designId: ref.id};
});

/** Remove a design. Refused once any passport has been generated from it — that
 * passport would be left with nothing to render. */
export const deletePassportDesign = onCall({maxInstances: 10}, async (request) => {
    const uid = await requireAuth(request);
    const callerSnap = await requireAdmin(uid);

    const designId = validateDocId((request.data as {designId?: unknown})?.designId, "designId");

    const ref = db.collection(DESIGNS).doc(designId);
    const snap = await ref.get();
    if (!snap.exists) throw new HttpsError("not-found", "Design not found.");

    const inUse = await db.collection(PASSPORTS).where("designId", "==", designId).limit(1).get();
    if (!inUse.empty) {
        throw new HttpsError(
            "failed-precondition",
            "Passports have already been generated from this design.",
            {code: "in-use"},
        );
    }

    await ref.delete();
    await db.collection("records").add({
        type: "passport-design-delete",
        performedBy: uid,
        performedByName: performerName(callerSnap),
        passportDesignId: designId,
        passportDesignName: snap.data()?.name ?? "",
        passportYear: snap.data()?.year ?? null,
        timestamp: FieldValue.serverTimestamp(),
        expiresAt: recordExpiresAt(),
    });

    return {deleted: true};
});
