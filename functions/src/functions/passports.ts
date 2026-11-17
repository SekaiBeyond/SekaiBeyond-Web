import { HttpsError, onCall } from "firebase-functions/v2/https";
import { FieldValue } from "firebase-admin/firestore";
import { adminTransaction, normalizeGroup, requireAdmin, requireAuth } from "../utils/auth";
import { db } from "../utils/firebase";
import { type BatchOp, commitInChunks, isoOrNull } from "../utils/helpers";
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
    passportNoteDoc,
    passportNoteRef,
    PASSPORTS,
    readMintingDesign,
    SECRETS,
    validatePassportNote,
} from "../utils/passports";
import {
    sanitizeDisplayText,
    validateBoolean,
    validateDocId,
    validateStorageImageUrl,
    validateStr
} from "../utils/validation";
import { shelfPassports } from "../utils/publicProfile";
import { performer, recordDoc, recordRef } from "../utils/records";
import { isSiteSignIn } from "../utils/sessions";
import { deleteStorageFile, logStorageCleanupError, requireNewlyLinkedFilesExist } from "../utils/storage";

const DESIGNS = "passportDesigns";

const performerName = (snap: FirebaseFirestore.DocumentSnapshot): string => snap.data()?.displayName ?? "";

function requirePassportId(raw: unknown): string {
    const passportId = normalizePassportId(raw);
    if (!passportId) throw new HttpsError("invalid-argument", "Invalid passportId.");
    return passportId;
}

function readPassportIds(raw: unknown, max: number): string[] {
    if (!Array.isArray(raw) || raw.length < 1 || raw.length > max) {
        throw new HttpsError("invalid-argument", `passportIds must hold between 1 and ${max} passport codes.`);
    }
    return [...new Set(raw.map(requirePassportId))];
}

export const generatePassports = onCall({maxInstances: 5}, async (request) => {
    const uid = await requireAuth(request, "staff");
    const callerSnap = await requireAdmin(uid);

    const input = request.data as {designId?: unknown; count?: unknown; note?: unknown};
    const designId = validateDocId(input.designId, "designId");
    const count = input.count;
    if (typeof count !== "number" || !Number.isInteger(count) || count < 1 || count > MAX_GENERATE_COUNT) {
        throw new HttpsError("invalid-argument", `count must be an integer between 1 and ${MAX_GENERATE_COUNT}.`);
    }
    const note = validatePassportNote(input.note);

    const design = await readMintingDesign(designId);

    const issued: {passportId: string; activationCode: string}[] = [];
    const ops: BatchOp[] = [];
    const noteOps: BatchOp[] = [];
    const seen = new Set<string>();
    const by = {uid, name: performerName(callerSnap)};

    for (let i = 0; i < count; i++) {
        const {passportId, key, write, noteWrite} = mintPassport(design, seen, by, {}, note);
        issued.push({passportId, activationCode: formatActivationKey(key)});
        ops.push(write);
        if (noteWrite) noteOps.push(noteWrite);
    }

    await commitInChunks(noteOps);
    try {
        await commitInChunks(ops);
    } catch (err) {
        if (noteOps.length > 0) {
            await commitInChunks(issued.map(({passportId}) => (batch) => batch.delete(passportNoteRef(passportId))))
                .catch(cleanupErr => console.error("generatePassports: failed to delete notes", cleanupErr));
        }
        throw err;
    }

    await recordRef().set(recordDoc("passport-generate", {
        ...performer(uid, callerSnap),
        passportDesignName: design.name,
        passportYear: design.year,
        passportCount: count,
    }));

    return {designId, year: design.year, passports: issued};
});

export const reissuePassportKey = onCall({maxInstances: 10}, async (request) => {
    const uid = await requireAuth(request, "staff");
    const callerSnap = await requireAdmin(uid);

    const passportId = requirePassportId((request.data as {passportId?: unknown})?.passportId);

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
            ...performer(uid, callerSnap),
            passportId,
            passportYear: snap.data()?.year ?? null,
        }));
    });

    return {passportId, activationCode: formatActivationKey(key)};
});

export const revealPassportKey = onCall({maxInstances: 10}, async (request) => {
    const uid = await requireAuth(request, "staff");
    const callerSnap = await requireAdmin(uid);

    const passportId = requirePassportId((request.data as {passportId?: unknown})?.passportId);

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
            ...performer(uid, callerSnap),
            passportId,
            passportYear: snap.data()?.year ?? null,
        }));
        return stored;
    });

    return {passportId, activationCode: formatActivationKey(key)};
});

export const exportPassportKeys = onCall({maxInstances: 10}, async (request) => {
    const uid = await requireAuth(request, "staff");
    const callerSnap = await requireAdmin(uid);

    const passportIds = readPassportIds((request.data as {passportIds?: unknown})?.passportIds, MAX_KEY_EXPORT_COUNT);

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
            ...performer(uid, callerSnap),
            passportId: passports.length === 1 ? passports[0].passportId : null,
            passportCount: passports.length,
            passportYear: year,
        }));
    }

    return {passports, missing};
});

export const getPassportPublicProfile = onCall({maxInstances: 20}, async (request) => {
    const passportId = normalizePassportId((request.data as {passportId?: unknown})?.passportId);
    if (!passportId) return {status: "invalid" as const};

    const passportSnap = await db.collection(PASSPORTS).doc(passportId).get();
    if (!passportSnap.exists) return {status: "invalid" as const};

    const passport = passportSnap.data()!;

    const designId: string = passport.designId ?? "";

    if (passport.status !== "claimed" || !passport.ownerUid) return {status: "unclaimed" as const, designId};

    const ownerUid: string = passport.ownerUid;
    const ownerSnap = await db.collection("users").doc(ownerUid).get();
    if (!ownerSnap.exists) return {status: "invalid" as const};

    const owner = ownerSnap.data()!;
    const isOwner = !!request.auth && isSiteSignIn(request.auth.token) && request.auth.uid === ownerUid;
    if (owner.hidePassportPage === true && !isOwner) return {status: "private" as const};

    return {
        status: "claimed" as const,
        designId,
        claimedAt: isoOrNull(passport.claimedAt),
        isOwner,
        hidden: owner.hidePassportPage === true,
        owner: {
            uid: ownerUid,
            displayName: owner.displayName ?? "",
            photoURL: owner.photoURL ?? "",
            joinedAt: isoOrNull(owner.joinedAt),
            group: normalizeGroup(owner.group),
            title: owner.title ?? "",
            titleCn: owner.titleCn ?? "",
        },
    };
});

export const deletePassports = onCall({maxInstances: 10}, async (request) => {
    const uid = await requireAuth(request, "staff");
    const callerSnap = await requireAdmin(uid);

    const passportIds = readPassportIds((request.data as {passportIds?: unknown})?.passportIds, MAX_DELETE_COUNT);
    const snaps = await db.getAll(...passportIds.map(id => db.collection(PASSPORTS).doc(id)));

    const deleted: string[] = [];
    const claimed: string[] = [];
    const missing: string[] = [];
    const ops: BatchOp[] = [];
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

        const updateTime = snap.updateTime;
        ops.push(batch => batch.delete(snap.ref, {lastUpdateTime: updateTime}));
        ops.push(batch => batch.delete(db.collection(SECRETS).doc(snap.id)));
    }

    if (ops.length > 0) {
        await commitInChunks(ops);
        await commitInChunks(deleted.map(id => (batch) => batch.delete(passportNoteRef(id))))
            .catch(err => console.error("deletePassports: failed to delete notes", deleted, err));
        await recordRef().set(recordDoc("passport-delete", {
            ...performer(uid, callerSnap),
            passportId: deleted.length === 1 ? deleted[0] : null,
            passportCount: deleted.length,
            passportYear: year,
        }));
    }

    return {deleted, claimed, missing};
});

export const deleteClaimedPassport = onCall({maxInstances: 10}, async (request) => {
    const uid = await requireAuth(request, "staff");

    const input = request.data as {passportId?: unknown; subtractDays?: unknown};
    const passportId = requirePassportId(input.passportId);
    const subtractDays = input.subtractDays !== undefined && validateBoolean(input.subtractDays, "subtractDays");

    const ref = db.collection(PASSPORTS).doc(passportId);

    return adminTransaction(uid, async (txn, callerSnap) => {
        const snap = await txn.get(ref);
        if (!snap.exists) throw new HttpsError("not-found", "Passport not found.");

        const passport = snap.data()!;
        if (passport.status !== "claimed") {
            throw new HttpsError(
                "failed-precondition",
                "This passport hasn't been claimed. Delete it as stock instead.",
                {code: "not-claimed"},
            );
        }

        const ownerUid: string | null = typeof passport.ownerUid === "string" ? passport.ownerUid : null;
        const ownerRef = ownerUid ? db.collection("users").doc(ownerUid) : null;
        const ownerSnap = ownerRef ? await txn.get(ownerRef) : null;
        const ownerData = ownerSnap?.exists ? ownerSnap.data()! : null;
        const ownerName: string = ownerData?.displayName ?? "";

        const granted = typeof passport.termDays === "number" ? passport.termDays : PASSPORT_TERM_DAYS;
        const reduced = subtractDays && ownerData
            ? reducedExpiry(ownerData.membershipExpiresAt, granted)
            : null;
        if (reduced && ownerRef && ownerData) {
            txn.update(ownerRef, {
                membershipExpiresAt: reduced.expiresAt,
                membershipStartedAt: startedAtAfter(ownerData, reduced.expiresAt) ?? FieldValue.delete(),
            });
        }

        txn.delete(ref);
        txn.delete(db.collection(SECRETS).doc(passportId));
        txn.delete(passportNoteRef(passportId));

        txn.set(recordRef(), recordDoc("passport-delete", {
            ...performer(uid, callerSnap),
            targetUid: ownerUid,
            targetName: ownerName,
            passportId,
            passportCount: 1,
            passportYear: typeof passport.year === "number" ? passport.year : null,
            extendDays: reduced ? -reduced.daysRemoved : null,
            newExpiresAt: reduced ? reduced.expiresAt.toDate().toISOString() : "",
        }));

        return {
            daysRemoved: reduced?.daysRemoved ?? 0,
            nothingToSubtract: subtractDays && !reduced,
        };
    });
});

export const setPassportNote = onCall({maxInstances: 10}, async (request) => {
    const uid = await requireAuth(request, "staff");

    const input = request.data as {passportId?: unknown; note?: unknown};
    const passportId = requirePassportId(input.passportId);
    const note = validatePassportNote(input.note);

    return adminTransaction(uid, async (txn, callerSnap) => {
        const noteRef = passportNoteRef(passportId);
        const [snap, noteSnap] = await Promise.all([
            txn.get(db.collection(PASSPORTS).doc(passportId)),
            txn.get(noteRef),
        ]);
        if (!snap.exists) throw new HttpsError("not-found", "Passport not found.");
        if ((noteSnap.data()?.note ?? "") === note) return {note, updated: false};

        if (note) {
            txn.set(noteRef, passportNoteDoc(snap.data()?.designId ?? "", note, {
                uid,
                name: performerName(callerSnap),
            }));
        } else {
            txn.delete(noteRef);
        }
        txn.set(recordRef(), recordDoc("passport-note-edit", {
            ...performer(uid, callerSnap),
            passportId,
            passportYear: snap.data()?.year ?? null,
        }));
        return {note, updated: true};
    });
});

export const getMyPassports = onCall({maxInstances: 20}, async (request) => {
    const uid = await requireAuth(request, "account");
    return {passports: await shelfPassports(uid)};
});

export const setPassportPrivacy = onCall({maxInstances: 10}, async (request) => {
    const uid = await requireAuth(request);

    const hide = validateBoolean((request.data as {hide?: unknown})?.hide, "hide");

    await db.collection("users").doc(uid).update({hidePassportPage: hide});
});

const shownNames = (design: {name?: unknown; nameCn?: unknown}): string[] => {
    const name = typeof design.name === "string" ? design.name : "";
    const nameCn = typeof design.nameCn === "string" && design.nameCn ? design.nameCn : name;
    return [name.toLowerCase(), nameCn.toLowerCase()];
};

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
            ...performer(uid, callerSnap),
            passportDesignName: name,
            passportYear: year,
        }));
        return [...new Set(prevImages)].filter(url =>
            url && url !== coverImageUrl && url !== outerCoverImageUrl);
    });

    await Promise.all(orphanedImages.map(url =>
        deleteStorageFile(url, ["passports/"])
            .catch(logStorageCleanupError(`savePassportDesign ${ref.id}`))));
});

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
        ...performer(uid, callerSnap),
        passportDesignName: snap.data()?.name ?? "",
        passportYear: snap.data()?.year ?? null,
    }));
});
