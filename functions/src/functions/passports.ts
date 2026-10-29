import { HttpsError, onCall } from "firebase-functions/v2/https";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { adminTransaction, normalizeGroup, requireAdmin, requireAuth } from "../utils/auth";
import { db } from "../utils/firebase";
import { commitInChunks } from "../utils/helpers";
import { MAX_GRANT_DAYS, reducedExpiry, startedAtAfter } from "../utils/membership";
import {
    formatActivationKey,
    isPassportYear,
    MAX_DELETE_COUNT,
    MAX_GENERATE_COUNT,
    MAX_KEY_EXPORT_COUNT,
    mintPassport,
    newActivationKey,
    normalizePassportId,
    PASSPORT_TERM_DAYS,
    readMintingDesign,
} from "../utils/passports";
import {
    sanitizeDisplayText,
    validateBoolean,
    validateDocId,
    validateStorageImageUrl,
    validateStr
} from "../utils/validation";
import { recordDoc, recordRef } from "../utils/records";
import { deleteStorageFile, logStorageCleanupError, requireNewlyLinkedFilesExist } from "../utils/storage";

/**
 * Physical passports.
 *
 * A passport is bound to the first account that claims it, for good: `ownerUid`
 * and `claimedAt` are written once, so /p/<passportId> always lands on the same
 * person.
 *
 * Nothing here writes `users/{uid}.group`. Claiming only moves
 * `membershipExpiresAt`.
 */

const PASSPORTS = "passports";
const SECRETS = "passportSecrets";
const DESIGNS = "passportDesigns";

const performerName = (snap: FirebaseFirestore.DocumentSnapshot): string => snap.data()?.displayName ?? "";

/**
 * Mint passports from one design, up to MAX_GENERATE_COUNT at a time. Each is
 * independent; nothing records which were made together. If the keys returned
 * here are lost before printing, exportPassportKeys and revealPassportKey serve
 * them again.
 */
export const generatePassports = onCall({maxInstances: 5}, async (request) => {
    const uid = await requireAuth(request, "staff");
    const callerSnap = await requireAdmin(uid);

    const input = request.data as {designId?: unknown; count?: unknown};
    const designId = validateDocId(input.designId, "designId");
    const count = input.count;
    if (typeof count !== "number" || !Number.isInteger(count) || count < 1 || count > MAX_GENERATE_COUNT) {
        throw new HttpsError("invalid-argument", `count must be an integer between 1 and ${MAX_GENERATE_COUNT}.`);
    }

    const design = await readMintingDesign(designId);

    const issued: {passportId: string; activationCode: string}[] = [];
    const ops: ((batch: FirebaseFirestore.WriteBatch) => void)[] = [];
    const seen = new Set<string>();
    const by = {uid, name: performerName(callerSnap)};

    for (let i = 0; i < count; i++) {
        const {passportId, key, write} = mintPassport(design, seen, by);
        issued.push({passportId, activationCode: formatActivationKey(key)});
        ops.push(write);
    }

    await commitInChunks(ops);

    await recordRef().set(recordDoc("passport-generate", {
        performedBy: uid,
        performedByName: performerName(callerSnap),
        passportDesignName: design.name,
        passportYear: design.year,
        passportCount: count,
    }));

    return {designId, year: design.year, passports: issued};
});

/**
 * Replace an unclaimed passport's key, for a slip someone else may have seen; a
 * lost slip only needs revealPassportKey. The old key stops working.
 */
export const reissuePassportKey = onCall({maxInstances: 10}, async (request) => {
    const uid = await requireAuth(request, "staff");
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
        });
        txn.set(recordRef(), recordDoc("passport-key-reissue", {
            performedBy: uid,
            performedByName: performerName(callerSnap),
            passportId,
            passportYear: snap.data()?.year ?? null,
        }));
    });

    return {passportId, activationCode: formatActivationKey(key)};
});

/**
 * A passport's current key: an unclaimed one's to reprint its slip, a claimed
 * one's to check what it was activated with. Every call is recorded, since the
 * key is what makes unsold stock worth stealing.
 */
export const revealPassportKey = onCall({maxInstances: 10}, async (request) => {
    const uid = await requireAuth(request, "staff");
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

        txn.set(recordRef(), recordDoc("passport-key-view", {
            performedBy: uid,
            performedByName: performerName(callerSnap),
            passportId,
            passportYear: snap.data()?.year ?? null,
        }));
        return stored;
    });

    return {passportId, activationCode: formatActivationKey(key)};
});

/**
 * The current keys of a set of passports, for the stock table's Keys CSV. The
 * bulk form of revealPassportKey, recorded once per call.
 *
 * A passport that is gone or has no key on file comes back in `missing` rather
 * than failing the rest. The record is written before anything is returned.
 */
export const exportPassportKeys = onCall({maxInstances: 10}, async (request) => {
    const uid = await requireAuth(request, "staff");
    const callerSnap = await requireAdmin(uid);

    const input = (request.data as {passportIds?: unknown})?.passportIds;
    if (!Array.isArray(input) || input.length < 1 || input.length > MAX_KEY_EXPORT_COUNT) {
        throw new HttpsError(
            "invalid-argument",
            `passportIds must hold between 1 and ${MAX_KEY_EXPORT_COUNT} passport codes.`,
        );
    }
    const normalized = [...new Set(input.map(normalizePassportId))];
    if (normalized.some(id => id === null)) {
        throw new HttpsError("invalid-argument", "Invalid passportId.");
    }
    const passportIds = normalized as string[];

    // getAll keeps the order asked, so index i is the same passport in both
    // lists.
    const [passportSnaps, secretSnaps] = await Promise.all([
        db.getAll(...passportIds.map(id => db.collection(PASSPORTS).doc(id))),
        db.getAll(...passportIds.map(id => db.collection(SECRETS).doc(id))),
    ]);

    const passports: {passportId: string; activationCode: string}[] = [];
    const missing: string[] = [];
    let year: number | null = null;
    passportIds.forEach((passportId, i) => {
        const key = passportSnaps[i].exists ? secretSnaps[i].data()?.key : undefined;
        if (typeof key !== "string") {
            missing.push(passportId);
            return;
        }
        passports.push({passportId, activationCode: formatActivationKey(key)});
        const passportYear = passportSnaps[i].data()?.year;
        if (year === null && typeof passportYear === "number") year = passportYear;
    });

    if (passports.length > 0) {
        await recordRef().set(recordDoc("passport-key-export", {
            performedBy: uid,
            performedByName: performerName(callerSnap),
            passportId: passports.length === 1 ? passports[0].passportId : null,
            passportCount: passports.length,
            passportYear: year,
        }));
    }

    return {passports, missing};
});

/**
 * Resolve a scanned sticker, for anyone, signed in or not.
 *
 * The uid-keyed rate limit can't apply to anonymous callers, so the protection is App
 * Check (setGlobalOptions in index.ts) plus the 31^10 space of printed codes.
 *
 * It doesn't widen profile reads: it takes no uid, and the owner's uid it returns
 * only builds a link to getPublicProfile, which still serves signed-in callers alone.
 * `isOwner` is decided here, not on the client. Nothing the page doesn't show is
 * returned.
 *
 * Unknown and deleted passports, and those whose owner deleted their account, all
 * answer "invalid", so real ids can't be told from made-up ones. A private passport
 * answers differently on purpose: whoever holds the sticker should know it works.
 */
export const getPassportPublicProfile = onCall({maxInstances: 20}, async (request) => {
    const passportId = normalizePassportId((request.data as {passportId?: unknown})?.passportId);
    if (!passportId) return {status: "invalid" as const};

    const passportSnap = await db.collection(PASSPORTS).doc(passportId).get();
    if (!passportSnap.exists) return {status: "invalid" as const};

    const passport = passportSnap.data()!;

    // The page reads the design itself (passportDesigns is public) for its name
    // and cover art.
    const designId: string = passport.designId ?? "";

    if (passport.status !== "claimed" || !passport.ownerUid) return {status: "unclaimed" as const, designId};

    const ownerUid: string = passport.ownerUid;
    const ownerSnap = await db.collection("users").doc(ownerUid).get();
    // The owner deleted their account. The binding is permanent, so the sticker
    // just stops resolving.
    if (!ownerSnap.exists) return {status: "invalid" as const};

    const owner = ownerSnap.data()!;
    const isOwner = request.auth?.uid === ownerUid;
    if (owner.hidePassportPage === true && !isOwner) return {status: "private" as const};

    return {
        status: "claimed" as const,
        designId,
        claimedAt: (passport.claimedAt as Timestamp | null)?.toDate?.()?.toISOString() ?? null,
        // The page gives the owner its privacy switch.
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
 * Delete unclaimed passports, e.g. stock destroyed in packing or written off.
 * The document and key both go, so the code stops resolving and can be minted
 * again.
 *
 * Claimed passports are never deleted here, whatever the selection: that goes
 * through deleteClaimedPassport, one passport at a time. A claimed or
 * already-gone passport is reported as skipped and the rest still go, so a stale
 * row can't block the delete.
 *
 * Only the `records` entry this writes survives.
 */
export const deletePassports = onCall({maxInstances: 10}, async (request) => {
    const uid = await requireAuth(request, "staff");
    const callerSnap = await requireAdmin(uid);

    const input = (request.data as {passportIds?: unknown})?.passportIds;
    if (!Array.isArray(input) || input.length < 1 || input.length > MAX_DELETE_COUNT) {
        throw new HttpsError(
            "invalid-argument",
            `passportIds must hold between 1 and ${MAX_DELETE_COUNT} passport codes.`,
        );
    }
    // Deduplicated so a code listed twice isn't counted or deleted twice.
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

        // A precondition on the version the guard read, so a claim landing in
        // between fails the batch instead of binding a passport on its way out.
        // Nothing commits, and the retry reports it claimed.
        const updateTime = snap.updateTime;
        ops.push(batch => batch.delete(snap.ref, {lastUpdateTime: updateTime}));
        ops.push(batch => batch.delete(db.collection(SECRETS).doc(snap.id)));
    }

    if (ops.length > 0) {
        await commitInChunks(ops);
        await recordRef().set(recordDoc("passport-delete", {
            performedBy: uid,
            performedByName: performerName(callerSnap),
            // Named only when there is one to name; the count carries the rest.
            passportId: deleted.length === 1 ? deleted[0] : null,
            passportCount: deleted.length,
            passportYear: year,
        }));
    }

    return {deleted, claimed, missing};
});

/**
 * Delete one claimed passport from its own page, optionally taking back the
 * membership it granted.
 *
 * The only way out of a permanent binding, for a passport activated in error or
 * onto the wrong account. Kept apart from `deletePassports`, which refuses claimed
 * stock, so staff must open the passport and see who holds it first.
 *
 * `subtractDays` is the admin's call each time: a wrong-account activation should
 * take its days back, but a deletion the holder had no part in shouldn't cost
 * them. It takes back the term the passport carried, the same field
 * claimPassportWithKey granted from, and never past today (reducedExpiry). Left
 * off, the user document isn't touched.
 *
 * Only the `records` entry survives, naming the holder and carrying the days
 * taken.
 */
export const deleteClaimedPassport = onCall({maxInstances: 10}, async (request) => {
    const uid = await requireAuth(request, "staff");

    const input = request.data as {passportId?: unknown; subtractDays?: unknown};
    const passportId = normalizePassportId(input.passportId);
    if (!passportId) throw new HttpsError("invalid-argument", "Invalid passportId.");
    if (input.subtractDays !== undefined && typeof input.subtractDays !== "boolean") {
        throw new HttpsError("invalid-argument", "subtractDays must be a boolean.");
    }
    const subtractDays = input.subtractDays === true;

    const ref = db.collection(PASSPORTS).doc(passportId);

    // One transaction: the days come back on the strength of a claim this same
    // commit erases, and a passport can't be deleted twice.
    return adminTransaction(uid, async (txn, callerSnap) => {
        const snap = await txn.get(ref);
        if (!snap.exists) throw new HttpsError("not-found", "Passport not found.");

        const passport = snap.data()!;
        // Unclaimed stock goes through deletePassports.
        if (passport.status !== "claimed") {
            throw new HttpsError(
                "failed-precondition",
                "This passport hasn't been claimed. Delete it as stock instead.",
                {code: "not-claimed"},
            );
        }

        const ownerUid: string | null = typeof passport.ownerUid === "string" ? passport.ownerUid : null;
        // Read before any write, as transactions require, and only when needed.
        const ownerRef = ownerUid ? db.collection("users").doc(ownerUid) : null;
        const ownerSnap = ownerRef ? await txn.get(ownerRef) : null;
        const ownerData = ownerSnap?.exists ? ownerSnap.data()! : null;
        // Copied into the record: the passport is about to point at no one, and
        // the account may be deleted later.
        const ownerName: string = ownerData?.displayName ?? "";

        // Read as claimPassportWithKey read it, so the two numbers agree.
        const granted = typeof passport.termDays === "number" ? passport.termDays : PASSPORT_TERM_DAYS;
        const reduced = subtractDays && ownerData
            ? reducedExpiry(ownerData.membershipExpiresAt, granted)
            : null;
        if (reduced && ownerRef && ownerData) {
            txn.update(ownerRef, {
                membershipExpiresAt: reduced.expiresAt,
                // Trimmed to today, the membership is over, and startedAtAfter
                // answers null.
                membershipStartedAt: startedAtAfter(ownerData, reduced.expiresAt) ?? FieldValue.delete(),
            });
        }

        txn.delete(ref);
        txn.delete(db.collection(SECRETS).doc(passportId));

        txn.set(recordRef(), recordDoc("passport-delete", {
            performedBy: uid,
            performedByName: performerName(callerSnap),
            // The holder, so the entry still says whose passport this was.
            targetUid: ownerUid,
            targetName: ownerName,
            passportId,
            passportCount: 1,
            passportYear: typeof passport.year === "number" ? passport.year : null,
            // Negative, mirroring passport-claim's days given; null when nothing
            // was taken.
            extendDays: reduced ? -reduced.daysRemoved : null,
            newExpiresAt: reduced ? reduced.expiresAt.toDate().toISOString() : "",
        }));

        return {
            daysRemoved: reduced?.daysRemoved ?? 0,
            // Days were asked for but none were left (lapsed membership or
            // deleted account); the screen says so.
            nothingToSubtract: subtractDays && !reduced,
        };
    });
});

/** Hide or show the caller's own passport page. Self only, no admin path. */
export const setPassportPrivacy = onCall({maxInstances: 10}, async (request) => {
    const uid = await requireAuth(request);

    const hide = validateBoolean((request.data as {hide?: unknown})?.hide, "hide");

    await db.collection("users").doc(uid).update({hidePassportPage: hide});
    return {hidePassportPage: hide};
});

/**
 * A design's shown names, folded for comparison. The Chinese name falls back to
 * the English one, as on the pages.
 */
const shownNames = (design: {name?: unknown; nameCn?: unknown}): string[] => {
    const name = typeof design.name === "string" ? design.name : "";
    const nameCn = typeof design.nameCn === "string" && design.nameCn ? design.nameCn : name;
    return [name.toLowerCase(), nameCn.toLowerCase()];
};

/**
 * Create or edit a design: its name, cover art, and the membership term its
 * passports grant. Publicly readable.
 *
 * Names can't repeat within a year in either language. The year is fixed at
 * creation; a term change only applies to passports generated afterwards.
 */
export const savePassportDesign = onCall({maxInstances: 10}, async (request) => {
    const uid = await requireAuth(request, "staff");

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
    // Optional; without it the cover art stands in for the shut passport.
    const outerCoverImageUrl = validateStr(input.outerCoverImageUrl, "outerCoverImageUrl", 2000);
    validateStorageImageUrl(outerCoverImageUrl, "outerCoverImageUrl");
    const termDays = input.termDays;
    if (typeof termDays !== "number" || !Number.isInteger(termDays) || termDays < 1 || termDays > MAX_GRANT_DAYS) {
        throw new HttpsError("invalid-argument", `termDays must be an integer between 1 and ${MAX_GRANT_DAYS}.`);
    }

    const ref = designId ? db.collection(DESIGNS).doc(designId) : db.collection(DESIGNS).doc();

    const orphanedImages = await adminTransaction(uid, async (txn, callerSnap) => {
        let year: number;
        let prevImages: string[] = [];
        if (designId) {
            const existing = await txn.get(ref);
            if (!existing.exists) throw new HttpsError("not-found", "Design not found.");
            year = existing.data()!.year;
            prevImages = [existing.data()!.coverImageUrl ?? "", existing.data()!.outerCoverImageUrl ?? ""];
        } else {
            year = createYear!;
        }
        await requireNewlyLinkedFilesExist([coverImageUrl, outerCoverImageUrl], prevImages);

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
        txn.set(recordRef(), recordDoc(designId ? "passport-design-edit" : "passport-design-create", {
            performedBy: uid,
            performedByName: performerName(callerSnap),
            passportDesignName: name,
            passportYear: year,
        }));
        // Each upload is a new time-stamped object, so covers this save replaces
        // or clears are deleted once it commits. Passports read covers live, so
        // nothing else holds these URLs.
        return [...new Set(prevImages)].filter(url =>
            url && url !== coverImageUrl && url !== outerCoverImageUrl);
    });

    await Promise.all(orphanedImages.map(url =>
        deleteStorageFile(url, ["passports/"])
            .catch(logStorageCleanupError(`savePassportDesign ${ref.id}`))));

    return {designId: ref.id};
});

/**
 * Remove a design. Refused once any passport uses it, which would be left with
 * nothing to render.
 */
export const deletePassportDesign = onCall({maxInstances: 10}, async (request) => {
    const uid = await requireAuth(request, "staff");
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
    await Promise.all([snap.data()?.coverImageUrl, snap.data()?.outerCoverImageUrl].map(url =>
        deleteStorageFile(url ?? "", ["passports/"])
            .catch(logStorageCleanupError(`deletePassportDesign ${designId}`))));
    await recordRef().set(recordDoc("passport-design-delete", {
        performedBy: uid,
        performedByName: performerName(callerSnap),
        passportDesignName: snap.data()?.name ?? "",
        passportYear: snap.data()?.year ?? null,
    }));

    return {deleted: true};
});
