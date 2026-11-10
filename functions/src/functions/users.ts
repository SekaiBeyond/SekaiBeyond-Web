import { HttpsError, onCall } from "firebase-functions/v2/https";
import { onDocumentDeleted } from "firebase-functions/v2/firestore";
import { getStorage } from "firebase-admin/storage";
import { getAuth } from "firebase-admin/auth";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import {
    ADMIN_GROUPS,
    adminTransaction,
    isStaffOrAbove,
    isValidGroup,
    MANAGEABLE_GROUPS,
    normalizeGroup,
    requireAuth,
    requireCanManage,
    requireRegisteredSession,
    requireStaff,
} from "../utils/auth";
import { emailIndexRef } from "../utils/accountEmail";
import { accountDeletionMail, readMailLanguage, sendNotice } from "../utils/accountMail";
import { RESEND_API_KEY } from "../utils/resendClient";
import { deletionExpiresAt } from "../utils/config";
import { credentialsRef, googleBindingOf, googleIndexRef } from "../utils/credentials";
import { deletionPending } from "../utils/deletion";
import { extendedExpiry, isMembershipActive, MAX_GRANT_DAYS, startedAtAfter } from "../utils/membership";
import { db } from "../utils/firebase";
import { pastEventIds, shelfPassports, toStringIds } from "../utils/publicProfile";
import { decodeUpload, detectImageMime, MAX_UPLOAD_SIZE_MB, saveUpload, STORAGE_HOST } from "../utils/storage";
import { sanitizeDisplayText, validateBoolean, validateDocId, validateInstant } from "../utils/validation";
import { parseVisibilityInput, readVisibility } from "../utils/visibility";
import { recordDoc, recordRef } from "../utils/records";
import { sessionsRef } from "../utils/sessions";

export const getPublicProfile = onCall({maxInstances: 20}, async (request) => {
    const callerUid = await requireAuth(request);

    const targetUid = validateDocId((request.data as {uid?: string})?.uid, "uid");
    const userSnap = await db.collection("users").doc(targetUid).get();
    if (!userSnap.exists) {
        throw new HttpsError("not-found", "User not found.");
    }

    const data = userSnap.data()!;
    // Sections the owner has switched off are emptied here, not at the client,
    // so the data is actually withheld. The flags go along so the viewer reads
    // "kept private" rather than an empty state.
    const visibility = readVisibility(data.profileVisibility);
    // Your own profile is never filtered, or you couldn't tell a hidden section
    // from an empty one.
    const isSelf = callerUid === targetUid;
    const showBadges = isSelf || visibility.badges;
    const showEvents = isSelf || visibility.events;
    const showPassports = isSelf || visibility.passports;

    const badgeEarnedAt: Record<string, string> = {};
    if (showBadges) {
        const rawEarnedAt = (data.badgeEarnedAt ?? {}) as Record<string, Timestamp>;
        for (const [k, v] of Object.entries(rawEarnedAt)) {
            const iso = v?.toDate?.()?.toISOString();
            if (iso) badgeEarnedAt[k] = iso;
        }
    }

    // Past events only: upcoming ids would leak unpublished events whose titles
    // the rules withhold.
    const rawStaffEvents = showEvents ? toStringIds(data.eventStaffEvents) : [];
    const [pastEvents, passports] = await Promise.all([
        pastEventIds(rawStaffEvents),
        showPassports ? shelfPassports(targetUid) : [],
    ]);
    const eventStaffEvents = rawStaffEvents.filter(id => pastEvents.has(id));

    return {
        displayName: data.displayName ?? "",
        photoURL: data.photoURL ?? "",
        bannerURL: data.bannerURL ?? "",
        joinedAt: data.joinedAt?.toDate?.()?.toISOString() ?? new Date().toISOString(),
        attendedEvents: showEvents ? (data.attendedEvents ?? []) : [],
        eventStaffEvents,
        badges: showBadges ? (data.badges ?? []) : [],
        badgeEarnedAt,
        passports,
        // So the shelf doesn't link to a page that would turn the viewer away.
        passportPageHidden: showPassports && data.hidePassportPage === true,
        group: normalizeGroup(data.group),
        // Only whether there is a membership; the expiry is the owner's
        // business.
        isMember: isMembershipActive(data),
        title: data.title ?? "",
        titleCn: data.titleCn ?? "",
        visibility: {badges: showBadges, events: showEvents, passports: showPassports},
    };
});

/**
 * The name and photo of the Google account bound to a user, so the admin user
 * page can tell a name or photo set on the site from the Google one the profile
 * started with. Null when none is bound. Staff+ only, as they can already read
 * the profile it's compared with.
 *
 * Two names, since the profile copied the sign-up one and Google's may have
 * changed since: `signUpName` is the one it was bound with, `name` the latest.
 * Both come cleaned as a stored displayName is, so they compare directly.
 */
export const getGoogleProfile = onCall({maxInstances: 10}, async (request) => {
    const uid = await requireAuth(request);
    await requireStaff(uid);

    const targetUid = validateDocId((request.data as {uid?: string})?.uid, "uid");
    const google = googleBindingOf(await credentialsRef(targetUid).get());
    if (!google) return null;

    const clean = (name: string) => sanitizeDisplayText(name).slice(0, 50);
    return {
        name: clean(google.name),
        signUpName: clean(google.signUpName),
        photoURL: google.photoURL.slice(0, 500),
    };
});

/**
 * Switch sections of the caller's own profile on or off for everyone else, like
 * setPassportPrivacy. Partial updates, so two open tabs can't undo each other's
 * switches.
 */
export const setProfileVisibility = onCall({maxInstances: 10}, async (request) => {
    const uid = await requireAuth(request);

    const sections = parseVisibilityInput((request.data as {sections?: unknown})?.sections);

    const userRef = db.collection("users").doc(uid);
    const merged = await db.runTransaction(async (txn) => {
        const snap = await txn.get(userRef);
        if (!snap.exists) throw new HttpsError("not-found", "User not found.");
        const next = {...readVisibility(snap.data()?.profileVisibility), ...sections};
        txn.update(userRef, {profileVisibility: next});
        return next;
    });

    return {visibility: merged};
});

/** Refuses unless the caller is core staff or above, with rights over the target's group. */
function requireAdminOver(callerSnap: FirebaseFirestore.DocumentSnapshot, targetData: FirebaseFirestore.DocumentData): void {
    const callerGroup = callerSnap.data()?.group;
    if (!ADMIN_GROUPS.includes(callerGroup)) {
        throw new HttpsError("permission-denied", "Insufficient permissions.");
    }
    requireCanManage(callerGroup, targetData.group);
}

interface ProfileTarget {
    targetUid: string;
    isSelf: boolean;
    targetData: FirebaseFirestore.DocumentData;
    callerName: string;
}

// Whose profile an edit applies to: your own always, someone else's only with
// admin rights over their group.
async function resolveProfileTarget(callerUid: string, rawTargetUid: unknown): Promise<ProfileTarget> {
    const targetUid = rawTargetUid === undefined || rawTargetUid === null
        ? callerUid
        : validateDocId(rawTargetUid, "targetUid");
    const isSelf = targetUid === callerUid;

    const callerSnap = await db.collection("users").doc(callerUid).get();
    const targetSnap = isSelf ? callerSnap : await db.collection("users").doc(targetUid).get();
    if (!targetSnap.exists) {
        throw new HttpsError("not-found", "User not found.");
    }

    if (!isSelf) requireAdminOver(callerSnap, targetSnap.data()!);

    return {
        targetUid,
        isSelf,
        targetData: targetSnap.data()!,
        callerName: callerSnap.data()?.displayName ?? "",
    };
}

// Uploading your own avatar or banner is a membership perk that staff+ keep
// without one; only plain users with no active membership are blocked.
function canSetOwnImages(userData: FirebaseFirestore.DocumentData): boolean {
    return isMembershipActive(userData) || isStaffOrAbove(userData.group);
}

// Checks every profile image upload makes before touching Storage: allowed
// type, size, and bytes that match the type.
function decodeProfileImage(input: {data?: string; contentType?: string}): {buffer: Buffer; contentType: string} {
    const {data: dataBase64, contentType} = input;

    if (!dataBase64 || !contentType) {
        throw new HttpsError("invalid-argument", "Missing data or contentType.");
    }

    const buffer = decodeUpload(dataBase64, contentType, {
        types: ["image/webp", "image/jpeg", "image/png"],
        maxMb: MAX_UPLOAD_SIZE_MB,
        kind: "Image",
        detect: detectImageMime,
    });
    return {buffer, contentType};
}

// Each upload overwrites the same path, so the URL busts the year-long cache.
async function saveProfileImage(path: string, buffer: Buffer, contentType: string): Promise<string> {
    return `${await saveUpload(path, buffer, contentType)}&t=${Date.now()}`;
}

// The photo a user reverts to without an uploaded avatar: their Google
// account's, if one is bound.
async function googlePhotoURL(uid: string): Promise<string> {
    return googleBindingOf(await credentialsRef(uid).get())?.photoURL ?? "";
}

export const updateDisplayName = onCall({maxInstances: 20}, async (request) => {
    const uid = await requireAuth(request);

    const input = request.data as {displayName?: string; targetUid?: string};
    const raw = input?.displayName;
    if (typeof raw !== "string") {
        throw new HttpsError("invalid-argument", "displayName must be a string.");
    }

    const sanitized = sanitizeDisplayText(raw);
    if (sanitized.length === 0) {
        throw new HttpsError("invalid-argument", "displayName is required.");
    }
    if (sanitized.length > 50) {
        throw new HttpsError("invalid-argument", "displayName exceeds maximum length.");
    }

    const {targetUid, isSelf, targetData, callerName} = await resolveProfileTarget(uid, input?.targetUid);
    const oldName = targetData.displayName ?? "";

    await db.collection("users").doc(targetUid).update({displayName: sanitized});

    if (!isSelf && oldName !== sanitized) {
        await recordRef().set(recordDoc("name-set", {
            performedBy: uid,
            performedByName: callerName,
            targetUid,
            targetName: sanitized,
            oldName,
            newName: sanitized,
        }));
    }

    return {displayName: sanitized};
});
export const uploadAvatar = onCall({maxInstances: 10}, async (request) => {
    const uid = await requireAuth(request);

    const input = request.data as {data?: string; contentType?: string; targetUid?: string};
    const {targetUid, isSelf, targetData, callerName} = await resolveProfileTarget(uid, input.targetUid);

    // A membership perk for your own avatar; admins can give one to anyone.
    if (isSelf && !canSetOwnImages(targetData)) {
        throw new HttpsError("permission-denied", "An active membership is required to upload an avatar.");
    }

    const {buffer, contentType} = decodeProfileImage(input);
    const downloadUrl = await saveProfileImage(`avatars/${targetUid}`, buffer, contentType);

    // Atomically set photoURL on the user doc so clients can't set arbitrary URLs
    await db.collection("users").doc(targetUid).update({photoURL: downloadUrl});

    if (!isSelf) {
        await recordRef().set(recordDoc("avatar-set", {
            performedBy: uid,
            performedByName: callerName,
            targetUid,
            targetName: targetData.displayName ?? "",
        }));
    }

    return {url: downloadUrl};
});
export const deleteAvatar = onCall({maxInstances: 10}, async (request) => {
    const uid = await requireAuth(request);

    const input = request.data as {targetUid?: string};
    const {targetUid, isSelf, targetData, callerName} = await resolveProfileTarget(uid, input?.targetUid);

    // Without a membership you can't upload an avatar, but may remove one an
    // admin gave you.
    const hasUploadedAvatar = typeof targetData.photoURL === "string"
        && targetData.photoURL.includes(STORAGE_HOST);
    if (isSelf && !canSetOwnImages(targetData) && !hasUploadedAvatar) {
        throw new HttpsError("permission-denied", "An active membership is required to delete an avatar.");
    }

    await getStorage().bucket().file(`avatars/${targetUid}`).delete({ignoreNotFound: true});

    const photoURL = (await googlePhotoURL(targetUid)).slice(0, 500);
    await db.collection("users").doc(targetUid).update({photoURL});

    if (!isSelf) {
        await recordRef().set(recordDoc("avatar-remove", {
            performedBy: uid,
            performedByName: callerName,
            targetUid,
            targetName: targetData.displayName ?? "",
        }));
    }

    return {photoURL};
});
/**
 * The image across the top of the caller's profile. A membership perk like an
 * avatar, but self only: admins can take a banner down, never put one up.
 */
export const uploadBanner = onCall({maxInstances: 10}, async (request) => {
    const uid = await requireAuth(request);

    const userRef = db.collection("users").doc(uid);
    const snap = await userRef.get();
    if (!snap.exists) {
        throw new HttpsError("not-found", "User not found.");
    }
    if (!canSetOwnImages(snap.data()!)) {
        throw new HttpsError("permission-denied", "An active membership is required to upload a banner.");
    }

    const {buffer, contentType} = decodeProfileImage(request.data as {data?: string; contentType?: string});
    const downloadUrl = await saveProfileImage(`banners/${uid}`, buffer, contentType);

    // Set on the user doc here so clients can't point bannerURL anywhere else.
    await userRef.update({bannerURL: downloadUrl});

    return {url: downloadUrl};
});
// No membership needed to remove your banner; admins can remove anyone's they
// manage.
export const deleteBanner = onCall({maxInstances: 10}, async (request) => {
    const uid = await requireAuth(request);

    const input = request.data as {targetUid?: string};
    const {targetUid, isSelf, targetData, callerName} = await resolveProfileTarget(uid, input?.targetUid);

    await getStorage().bucket().file(`banners/${targetUid}`).delete({ignoreNotFound: true});
    await db.collection("users").doc(targetUid).update({bannerURL: FieldValue.delete()});

    if (!isSelf) {
        await recordRef().set(recordDoc("banner-remove", {
            performedBy: uid,
            performedByName: callerName,
            targetUid,
            targetName: targetData.displayName ?? "",
        }));
    }

    return {deleted: true};
});

/**
 * A staff title from a request: "" when left out, refused when not a string or
 * over 100 characters once cleaned.
 */
function readTitle(raw: unknown): string {
    if (raw === undefined || raw === null) return "";
    if (typeof raw !== "string") throw new HttpsError("invalid-argument", "Invalid title.");
    const title = sanitizeDisplayText(raw);
    if (title.length > 100) throw new HttpsError("invalid-argument", "Invalid title.");
    return title;
}

export const changeUserGroup = onCall({maxInstances: 10}, async (request) => {
    const uid = await requireAuth(request, "staff");

    const input = request.data as {targetUid?: string; newGroup?: string; title?: unknown; titleCn?: unknown};
    const targetUid = validateDocId(input.targetUid, "targetUid");
    const newGroup = input.newGroup;

    if (!isValidGroup(newGroup)) {
        throw new HttpsError("invalid-argument", "Invalid group.");
    }

    if (uid === targetUid) {
        throw new HttpsError("permission-denied", "Cannot change your own group.");
    }

    // Titles can only be set when assigning staff or core-staff
    const shouldHaveTitle = ["staff", "core-staff"].includes(newGroup);
    const title = readTitle(input.title);
    const titleCn = readTitle(input.titleCn);
    if ((title || titleCn) && !shouldHaveTitle) {
        throw new HttpsError("invalid-argument", "Title can only be set for staff or core-staff.");
    }

    const oldGroup = await adminTransaction(uid, async (txn, callerSnap) => {
        const targetSnap = await txn.get(db.collection("users").doc(targetUid));
        if (!targetSnap.exists) throw new HttpsError("not-found", "Target user not found.");
        const targetData = targetSnap.data()!;

        const callerGroup = callerSnap.data()!.group;
        const oldGroup = normalizeGroup(targetData.group);
        requireCanManage(callerGroup, oldGroup);
        if (callerGroup !== "president" && !MANAGEABLE_GROUPS.includes(newGroup)) {
            throw new HttpsError("permission-denied", "Cannot assign this group.");
        }

        txn.update(db.collection("users").doc(targetUid), {
            group: newGroup,
            title: shouldHaveTitle ? title : FieldValue.delete(),
            titleCn: shouldHaveTitle ? titleCn : FieldValue.delete(),
        });
        const fields = {
            performedBy: uid,
            performedByName: callerSnap.data()!.displayName ?? "",
            targetUid,
            targetName: targetData.displayName ?? "",
        };
        txn.set(recordRef(), recordDoc("group-assign", {...fields, oldGroup, newGroup}));

        const oldTitle: string = targetData.title ?? "";
        const oldTitleCn: string = targetData.titleCn ?? "";
        if (oldTitle !== title || oldTitleCn !== titleCn) {
            txn.set(recordRef(), recordDoc("title-set", {
                ...fields,
                oldTitle,
                newTitle: title,
                oldTitleCn,
                newTitleCn: titleCn,
            }));
        }
        return oldGroup;
    });

    return {oldGroup, newGroup};
});
// Membership is time-boxed, not a group: this never writes `group`, which only
// changeUserGroup does.
export const setMembership = onCall({maxInstances: 10}, async (request) => {
    const uid = await requireAuth(request, "staff");
    const input = request.data as {targetUid?: string; expiresAt?: string | null; extendDays?: number};
    const targetUid = validateDocId(input.targetUid, "targetUid");

    const hasExpiresAt = "expiresAt" in input;
    const hasExtendDays = input.extendDays !== undefined;
    if (hasExpiresAt === hasExtendDays) {
        throw new HttpsError("invalid-argument", "Provide exactly one of expiresAt or extendDays.");
    }

    // expiresAt: null revokes. A date sets the expiry outright.
    let absoluteExpiry: Timestamp | null = null;
    if (hasExpiresAt && input.expiresAt !== null) {
        const iso = validateInstant(input.expiresAt, "expiresAt");
        if (!iso) {
            throw new HttpsError("invalid-argument", "expiresAt must be a date or null.");
        }
        absoluteExpiry = Timestamp.fromDate(new Date(iso));
    }

    let extendDays = 0;
    if (hasExtendDays) {
        extendDays = input.extendDays!;
        if (!Number.isInteger(extendDays) || extendDays === 0 || Math.abs(extendDays) > MAX_GRANT_DAYS) {
            throw new HttpsError("invalid-argument",
                `extendDays must be a non-zero integer within ${MAX_GRANT_DAYS} days.`);
        }
    }

    return adminTransaction(uid, async (txn, callerSnap) => {
        const targetSnap = await txn.get(db.collection("users").doc(targetUid));
        if (!targetSnap.exists) throw new HttpsError("not-found", "Target user not found.");

        const targetData = targetSnap.data()!;
        requireCanManage(callerSnap.data()!.group, targetData.group);

        const oldExpiry: Timestamp | null = targetData.membershipExpiresAt ?? null;
        const newExpiry = hasExtendDays
            ? extendedExpiry(oldExpiry, extendDays)
            : absoluteExpiry;
        const newStart = startedAtAfter(targetData, newExpiry);

        txn.update(db.collection("users").doc(targetUid), {
            membershipExpiresAt: newExpiry === null ? FieldValue.delete() : newExpiry,
            membershipStartedAt: newStart ?? FieldValue.delete(),
        });

        const recordType = newExpiry === null
            ? "membership-revoke"
            : hasExtendDays ? "membership-extend" : "membership-grant";
        txn.set(recordRef(), recordDoc(recordType, {
            performedBy: uid,
            performedByName: callerSnap.data()!.displayName ?? "",
            targetUid,
            targetName: targetData.displayName ?? "",
            oldExpiresAt: oldExpiry?.toDate?.()?.toISOString() ?? "",
            newExpiresAt: newExpiry?.toDate?.()?.toISOString() ?? "",
            extendDays: hasExtendDays ? extendDays : null,
        }));

        return {membershipExpiresAt: newExpiry?.toDate?.()?.toISOString() ?? null};
    });
});
export const setUserTitle = onCall({maxInstances: 10}, async (request) => {
    const uid = await requireAuth(request, "staff");
    const input = request.data as {targetUid?: string; title?: unknown; titleCn?: unknown};
    const targetUid = validateDocId(input.targetUid, "targetUid");
    const title = readTitle(input.title);
    const titleCn = readTitle(input.titleCn);

    await adminTransaction(uid, async (txn, callerSnap) => {
        const targetSnap = await txn.get(db.collection("users").doc(targetUid));
        if (!targetSnap.exists) throw new HttpsError("not-found", "Target user not found.");

        const callerGroup = callerSnap.data()!.group;
        const targetGroup = targetSnap.data()!.group;

        if (!["staff", "core-staff"].includes(targetGroup)) {
            throw new HttpsError("invalid-argument", "Title can only be set for staff or core-staff.");
        }

        // Only president can set title for core-staff; core-staff can only set title for staff
        if (targetGroup === "core-staff" && callerGroup !== "president") {
            throw new HttpsError("permission-denied",
                "Only the president can set the title of a core-staff member.");
        }

        txn.update(db.collection("users").doc(targetUid), {
            title: title || FieldValue.delete(),
            titleCn: titleCn || FieldValue.delete(),
        });
        txn.set(recordRef(), recordDoc("title-set", {
            performedBy: uid,
            performedByName: callerSnap.data()!.displayName ?? "",
            targetUid,
            targetName: targetSnap.data()!.displayName ?? "",
            oldTitle: targetSnap.data()!.title ?? "",
            newTitle: title,
            oldTitleCn: targetSnap.data()!.titleCn ?? "",
            newTitleCn: titleCn,
        }));
    });

    return {success: true};
});
export const toggleUserBadge = onCall({maxInstances: 10}, async (request) => {
    const uid = await requireAuth(request, "staff");

    const input = request.data as {targetUid?: string; badgeId?: string; grant?: unknown};
    const targetUid = validateDocId(input.targetUid, "targetUid");
    const badgeId = validateDocId(input.badgeId, "badgeId");
    const grant = validateBoolean(input.grant, "grant");

    return adminTransaction(uid, async (txn, callerSnap) => {
        const targetSnap = await txn.get(db.collection("users").doc(targetUid));
        if (!targetSnap.exists) throw new HttpsError("not-found", "User not found.");
        requireCanManage(callerSnap.data()!.group, targetSnap.data()!.group);

        const badgeSnap = await txn.get(db.collection("badges").doc(badgeId));
        if (!badgeSnap.exists) throw new HttpsError("not-found", "Badge not found.");

        txn.update(db.collection("users").doc(targetUid), {
            badges: grant ? FieldValue.arrayUnion(badgeId) : FieldValue.arrayRemove(badgeId),
            [`badgeEarnedAt.${badgeId}`]: grant ? FieldValue.serverTimestamp() : FieldValue.delete(),
        });
        txn.set(recordRef(), recordDoc(grant ? "achievement-grant" : "achievement-revoke", {
            performedBy: uid,
            performedByName: callerSnap.data()!.displayName ?? "",
            targetUid,
            targetName: targetSnap.data()!.displayName ?? "",
            badgeId,
            badgeName: badgeSnap.data()?.name ?? badgeId,
        }));
        return {granted: grant};
    });
});
/**
 * Schedules an account's deletion, for `deleteAt`'s TTL policy to carry out.
 * Anyone may ask for their own, from a device on its list, and its address is
 * told at once, with the way to cancel: otherwise someone with a stolen sign-in
 * could quietly delete it. `deletionRequestedBy` says whose request it is, which
 * decides who may cancel it (cancelAccountDeletion).
 */
export const requestAccountDeletion = onCall({maxInstances: 10, secrets: [RESEND_API_KEY]}, async (request) => {
    const input = (request.data ?? {}) as {targetUid?: string; language?: unknown};
    const ownAccount = !input.targetUid || input.targetUid === request.auth?.uid;
    const callerUid = ownAccount ? await requireRegisteredSession(request) : await requireAuth(request);
    const targetUid = input.targetUid ? validateDocId(input.targetUid, "targetUid") : callerUid;

    const deleteAt = deletionExpiresAt();

    const notifyEmail = await db.runTransaction(async (txn) => {
        const [callerSnap, targetSnap] = await Promise.all([
            txn.get(db.collection("users").doc(callerUid)),
            txn.get(db.collection("users").doc(targetUid)),
        ]);

        if (!targetSnap.exists) {
            throw new HttpsError("not-found", "User not found.");
        }
        const targetData = targetSnap.data()!;

        // Anyone may delete their own account; someone else's needs admin rights
        // over them.
        if (callerUid !== targetUid) requireAdminOver(callerSnap, targetData);

        if (deletionPending(targetData)) {
            throw new HttpsError("already-exists", "deletion-already-pending");
        }

        const callerName = callerSnap.exists
            ? (callerSnap.data()!.displayName ?? "")
            : (targetData.displayName ?? "");

        txn.update(db.collection("users").doc(targetUid), {deleteAt, deletionRequestedBy: callerUid});
        txn.set(recordRef(), recordDoc("account-deletion-requested", {
            performedBy: callerUid,
            performedByName: callerName,
            targetUid,
            targetName: targetData.displayName ?? "",
        }));
        return callerUid === targetUid ? (targetData.email as string | undefined) ?? "" : "";
    });

    if (notifyEmail) {
        await sendNotice(await accountDeletionMail(notifyEmail, deleteAt.toDate(), readMailLanguage(input.language)));
    }
    return {deleteAt: deleteAt.toDate().toISOString()};
});
export const cancelAccountDeletion = onCall({maxInstances: 10}, async (request) => {
    const callerUid = await requireAuth(request);
    const inputTarget = (request.data as {targetUid?: string})?.targetUid;
    const targetUid = inputTarget ? validateDocId(inputTarget, "targetUid") : callerUid;

    await db.runTransaction(async (txn) => {
        const [callerSnap, targetSnap] = await Promise.all([
            txn.get(db.collection("users").doc(callerUid)),
            txn.get(db.collection("users").doc(targetUid)),
        ]);

        if (!targetSnap.exists) {
            throw new HttpsError("not-found", "User not found.");
        }
        const targetData = targetSnap.data()!;
        if (!deletionPending(targetData)) {
            throw new HttpsError("not-found", "No pending deletion.");
        }

        // Staff may cancel any they could have asked for. An owner may cancel only
        // their own request, so someone staff are removing can't keep the account.
        if (callerUid !== targetUid) {
            requireAdminOver(callerSnap, targetData);
        } else if (targetData.deletionRequestedBy !== callerUid) {
            throw new HttpsError("permission-denied", "Only staff can cancel this deletion.", {
                code: "deletion-by-staff",
            });
        }

        const callerName = callerSnap.exists
            ? (callerSnap.data()!.displayName ?? "")
            : (targetData.displayName ?? "");

        txn.update(db.collection("users").doc(targetUid), {
            deleteAt: FieldValue.delete(),
            deletionRequestedBy: FieldValue.delete(),
        });
        txn.set(recordRef(), recordDoc("account-deletion-cancelled", {
            performedBy: callerUid,
            performedByName: callerName,
            targetUid,
            targetName: targetData.displayName ?? "",
        }));
    });

    return {cancelled: true};
});
// retry: a dropped event would leave a sign-in that still works for an account
// that's gone. Re-runs are safe: every step tolerates what's already gone, and
// the record has a fixed id.
export const onUserDeleted = onDocumentDeleted(
    {document: "users/{uid}", maxInstances: 10, retry: true},
    async (event) => {
        const data = event.data?.data();
        const uid = event.params.uid;

        try {
            await getAuth().deleteUser(uid);
        } catch (err: unknown) {
            const code = (err as {code?: string})?.code;
            if (code !== "auth/user-not-found") {
                console.error(`onUserDeleted: deleteUser failed for ${uid}`, err);
                throw err;
            }
        }

        // Frees the address and the Google account for use again. One batch, as
        // the credentials doc is the only thing that names the Google account.
        const credentials = await credentialsRef(uid).get();
        const sub = googleBindingOf(credentials)?.sub;
        const emailRef = data?.email ? emailIndexRef(data.email) : null;
        const holdsEmail = emailRef ? (await emailRef.get()).get("uid") === uid : false;
        const release = db.batch();
        release.delete(credentials.ref);
        if (sub) release.delete(googleIndexRef(sub));
        if (emailRef && holdsEmail) release.delete(emailRef);
        await release.commit();

        for (const path of [`avatars/${uid}`, `banners/${uid}`]) {
            try {
                await getStorage().bucket().file(path).delete({ignoreNotFound: true});
            } catch (err) {
                console.error(`onUserDeleted: ${path} delete failed`, err);
            }
        }

        try {
            await db.recursiveDelete(sessionsRef(uid));
        } catch (err) {
            console.error(`onUserDeleted: sessions delete failed for ${uid}`, err);
        }

        try {
            // Fixed id, so retries and re-fires overwrite one record.
            await recordRef(`account-deleted-${uid}`).set(recordDoc("account-deleted", {
                targetUid: uid,
                targetName: data?.displayName ?? "",
                targetEmail: data?.email ?? "",
            }));
        } catch (err) {
            console.error(`onUserDeleted: record write failed for ${uid}`, err);
        }
    }
);
