import { HttpsError, onCall } from "firebase-functions/v2/https";
import { getDownloadURL, getStorage } from "firebase-admin/storage";
import { FieldValue } from "firebase-admin/firestore";
import { adminTransaction, checkRateLimit, requireAdmin, requireAuth } from "../utils/auth";
import { recordExpiresAt } from "../utils/config";
import { db } from "../utils/firebase";
import { detectImageMime, MAX_UPLOAD_SIZE, validateStoragePath } from "../utils/storage";
import {
    sanitizeDisplayText,
    validateDocId,
    validateISODate,
    validateStorageImageUrl,
    validateStr
} from "../utils/validation";

export const uploadAdminImage = onCall({maxInstances: 10}, async (request) => {
    const uid = await requireAuth(request);
    await requireAdmin(uid);

    const input = request.data as {
        path?: string;
        data?: string;
        contentType?: string;
    };

    const path = input.path;
    const dataBase64 = input.data;
    const contentType = input.contentType;

    if (!path || !dataBase64 || !contentType) {
        throw new HttpsError("invalid-argument", "Missing path, data, or contentType.");
    }
    validateStoragePath(path);

    if (contentType !== "image/webp") {
        throw new HttpsError("invalid-argument", "Only image/webp is allowed.");
    }

    const buffer = Buffer.from(dataBase64, "base64");
    if (buffer.length > MAX_UPLOAD_SIZE) {
        throw new HttpsError("invalid-argument", "Image exceeds 5MB limit.");
    }

    const detectedMime = detectImageMime(buffer);
    if (!detectedMime || detectedMime !== contentType) {
        throw new HttpsError("invalid-argument", "File content does not match claimed content type.");
    }

    const bucket = getStorage().bucket();
    const file = bucket.file(path);
    await file.save(buffer, {
        metadata: {contentType, cacheControl: "public, max-age=31536000, immutable"},
    });

    const downloadUrl = await getDownloadURL(file);
    return {url: downloadUrl};
});
export const saveTag = onCall({maxInstances: 10}, async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Must be signed in.");
    const uid = request.auth.uid;
    await checkRateLimit(uid);

    const input = request.data as Record<string, unknown>;
    const tagId = input.tagId ? validateDocId(input.tagId, "tagId") : null;
    const name = sanitizeDisplayText(validateStr(input.name, "name", 100, true));
    const nameCn = sanitizeDisplayText(validateStr(input.nameCn, "nameCn", 100));
    if (!name) throw new HttpsError("invalid-argument", "name is required.");
    const nameLower = name.toLowerCase();
    const docId = tagId ?? db.collection("eventLabels").doc().id;

    return adminTransaction(uid, async (txn, callerSnap) => {
        if (tagId) {
            const existing = await txn.get(db.collection("eventLabels").doc(tagId));
            if (!existing.exists) throw new HttpsError("not-found", "Tag not found.");
        }

        const existingByNameLower = await txn.get(
            db.collection("eventLabels").where("nameLower", "==", nameLower).limit(1),
        );
        if (!existingByNameLower.empty && existingByNameLower.docs[0].id !== tagId) {
            throw new HttpsError("already-exists", "A tag with this name already exists.");
        }

        const ref = db.collection("eventLabels").doc(docId);
        if (tagId) {
            txn.update(ref, {name, nameLower, nameCn});
        } else {
            txn.set(ref, {name, nameLower, nameCn});
        }
        txn.set(db.collection("records").doc(), {
            type: tagId ? "tag-edit" : "tag-create",
            performedBy: uid,
            performedByName: callerSnap.data()?.displayName ?? "",
            tagName: name,
            timestamp: FieldValue.serverTimestamp(),
            expiresAt: recordExpiresAt(),
        });
        return {tagId: docId};
    });
});
export const deleteTag = onCall({maxInstances: 10}, async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Must be signed in.");
    const uid = request.auth.uid;
    await checkRateLimit(uid);

    const tagId = validateDocId((request.data as {tagId?: string})?.tagId, "tagId");

    return adminTransaction(uid, async (txn, callerSnap) => {
        const tagSnap = await txn.get(db.collection("eventLabels").doc(tagId));
        if (!tagSnap.exists) throw new HttpsError("not-found", "Tag not found.");

        txn.delete(db.collection("eventLabels").doc(tagId));
        txn.set(db.collection("records").doc(), {
            type: "tag-delete",
            performedBy: uid,
            performedByName: callerSnap.data()?.displayName ?? "",
            tagName: tagSnap.data()?.name ?? tagId,
            timestamp: FieldValue.serverTimestamp(),
            expiresAt: recordExpiresAt(),
        });
        return {deleted: true};
    });
});
export const savePolicy = onCall({maxInstances: 10}, async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Must be signed in.");
    const uid = request.auth.uid;
    await checkRateLimit(uid);

    const input = request.data as Record<string, unknown>;
    const contentEn = validateStr(input.contentEn, "contentEn", 20000);
    const contentCn = validateStr(input.contentCn, "contentCn", 20000);

    return adminTransaction(uid, async (txn, callerSnap) => {
        txn.set(db.collection("policy").doc("main"), {
            contentEn,
            contentCn,
            updatedBy: uid,
            updatedByName: callerSnap.data()?.displayName ?? "",
            updatedAt: FieldValue.serverTimestamp(),
        });
        txn.set(db.collection("records").doc(), {
            type: "policy-update",
            performedBy: uid,
            performedByName: callerSnap.data()?.displayName ?? "",
            timestamp: FieldValue.serverTimestamp(),
            expiresAt: recordExpiresAt(),
        });
        return {saved: true};
    });
});
export const saveSiteConfig = onCall({maxInstances: 10}, async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Must be signed in.");
    const uid = request.auth.uid;
    await checkRateLimit(uid);

    const input = request.data as Record<string, unknown>;

    const bvid = input.bilibiliVideoBvid !== undefined
        ? validateStr(input.bilibiliVideoBvid, "bilibiliVideoBvid", 100)
        : undefined;

    if (bvid && !/^BV[a-zA-Z0-9]+$/.test(bvid)) {
        throw new HttpsError("invalid-argument", "Invalid Bilibili BV ID format.");
    }

    const conEditionRaw = input.conEdition;
    let conEdition: any | undefined = undefined;
    if (conEditionRaw === null) {
        conEdition = null;
    } else if (conEditionRaw !== undefined) {
        const ed = conEditionRaw as Record<string, any>;
        conEdition = {
            year: Number(ed.year),
            date: validateISODate(ed.date, "date") || "",
            location: validateStr(ed.location, "location", 200, true),
            locationCn: validateStr(ed.locationCn, "locationCn", 200),
            description: validateStr(ed.description, "description", 2000, true),
            descriptionCn: validateStr(ed.descriptionCn, "descriptionCn", 2000, true),
            image: validateStr(ed.image, "image", 500, true),
            highlights: Array.isArray(ed.highlights) ? ed.highlights.map((h: any) => ({
                labelEn: validateStr(h.labelEn, "highlight labelEn", 100, true),
                labelCn: validateStr(h.labelCn, "highlight labelCn", 100, true),
                icon: validateStr(h.icon, "highlight icon", 50, true),
            })) : [],
        };
        validateStorageImageUrl(conEdition.image, "convention image");
    }

    let coverUrl = '';
    if (bvid) {
        try {
            const apiResp = await fetch(`https://api.bilibili.com/x/web-interface/view?bvid=${bvid}`, {
                headers: {'User-Agent': 'Mozilla/5.0'},
                signal: AbortSignal.timeout(5000),
            });
            if (apiResp.ok) {
                const json = await apiResp.json() as {code: number; data?: {pic?: string}};
                const pic = json?.data?.pic ?? '';
                const picUrl = pic.startsWith('http:') ? 'https:' + pic.slice(5) : pic;
                if (picUrl) {
                    const imgResp = await fetch(picUrl, {
                        headers: {'User-Agent': 'Mozilla/5.0', 'Referer': 'https://www.bilibili.com/'},
                        signal: AbortSignal.timeout(10000),
                    });
                    if (imgResp.ok) {
                        const contentType = imgResp.headers.get('content-type') ?? 'image/jpeg';
                        const buffer = Buffer.from(await imgResp.arrayBuffer());
                        const bucket = getStorage().bucket();
                        const file = bucket.file('config/video-cover');
                        await file.save(buffer, {
                            metadata: {contentType, cacheControl: 'public, max-age=31536000, immutable'},
                        });
                        const baseCoverUrl = await getDownloadURL(file);
                        coverUrl = `${baseCoverUrl}&t=${Date.now()}`;
                    }
                }
            }
        } catch {
            // Cover fetch is best-effort; proceed without it
        }
    }

    return adminTransaction(uid, async (txn, callerSnap) => {
        const updateData: Record<string, any> = {
            updatedBy: uid,
            updatedByName: callerSnap.data()?.displayName ?? "",
            updatedAt: FieldValue.serverTimestamp(),
        };
        if (bvid !== undefined) {
            updateData.bilibiliVideoBvid = bvid;
            updateData.bilibiliVideoCoverUrl = coverUrl;
        }
        if (conEdition !== undefined) {
            updateData.conEdition = conEdition;
        }

        txn.set(db.collection("config").doc("main"), updateData, {merge: true});
        txn.set(db.collection("records").doc(), {
            type: "config-update",
            performedBy: uid,
            performedByName: callerSnap.data()?.displayName ?? "",
            timestamp: FieldValue.serverTimestamp(),
            expiresAt: recordExpiresAt(),
        });
        return {saved: true};
    });
});

function validateCoordinate(value: unknown, name: string, min: number, max: number): number {
    if (typeof value !== "number" || !Number.isFinite(value)) {
        throw new HttpsError("invalid-argument", `Invalid ${name}: must be a number.`);
    }
    if (value < min || value > max) {
        throw new HttpsError("invalid-argument", `Invalid ${name}: out of range.`);
    }
    return value;
}

const PARKING_LOT_TYPES = ["general", "disabled", "garage"] as const;

export const saveParkingLot = onCall({maxInstances: 10}, async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Must be signed in.");
    const uid = request.auth.uid;
    await checkRateLimit(uid);

    const input = request.data as Record<string, unknown>;
    const lotId = input.lotId ? validateDocId(input.lotId, "lotId") : null;
    const name = sanitizeDisplayText(validateStr(input.name, "name", 200, true));
    const nameCn = sanitizeDisplayText(validateStr(input.nameCn, "nameCn", 200));
    const type = typeof input.type === "string" && (PARKING_LOT_TYPES as readonly string[]).includes(input.type)
        ? input.type as typeof PARKING_LOT_TYPES[number]
        : null;
    if (!type) throw new HttpsError("invalid-argument", `type must be one of ${PARKING_LOT_TYPES.join(", ")}.`);
    const lat = validateCoordinate(input.lat, "lat", -90, 90);
    const lng = validateCoordinate(input.lng, "lng", -180, 180);
    // rateId links to a parkingRates tier; "" means no rate assigned.
    const rateId = typeof input.rateId === "string" && input.rateId.trim()
        ? validateDocId(input.rateId, "rateId")
        : "";

    const docId = lotId ?? db.collection("parkingLots").doc().id;

    return adminTransaction(uid, async (txn, callerSnap) => {
        if (lotId) {
            const existing = await txn.get(db.collection("parkingLots").doc(lotId));
            if (!existing.exists) throw new HttpsError("not-found", "Parking lot not found.");
        }
        if (rateId) {
            const rateSnap = await txn.get(db.collection("parkingRates").doc(rateId));
            if (!rateSnap.exists) throw new HttpsError("not-found", "Parking rate not found.");
        }

        const ref = db.collection("parkingLots").doc(docId);
        const data = {name, nameCn, type, lat, lng, rateId};
        if (lotId) {
            txn.update(ref, data);
        } else {
            txn.set(ref, data);
        }
        txn.set(db.collection("records").doc(), {
            type: lotId ? "parkinglot-edit" : "parkinglot-create",
            performedBy: uid,
            performedByName: callerSnap.data()?.displayName ?? "",
            lotName: name,
            timestamp: FieldValue.serverTimestamp(),
            expiresAt: recordExpiresAt(),
        });
        return {lotId: docId};
    });
});
export const deleteParkingLot = onCall({maxInstances: 10}, async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Must be signed in.");
    const uid = request.auth.uid;
    await checkRateLimit(uid);

    const lotId = validateDocId((request.data as {lotId?: string})?.lotId, "lotId");

    return adminTransaction(uid, async (txn, callerSnap) => {
        const lotSnap = await txn.get(db.collection("parkingLots").doc(lotId));
        if (!lotSnap.exists) throw new HttpsError("not-found", "Parking lot not found.");

        // Cascade unlink: remove this lotId from every venue that references it.
        const venuesSnap = await txn.get(db.collection("venues"));
        let unlinkedFrom = 0;
        for (const doc of venuesSnap.docs) {
            const lots = Array.isArray(doc.data().parkingLots) ? doc.data().parkingLots : [];
            const filtered = lots.filter((l: any) => l?.lotId !== lotId);
            if (filtered.length !== lots.length) {
                txn.update(doc.ref, {parkingLots: filtered});
                unlinkedFrom++;
            }
        }

        txn.delete(db.collection("parkingLots").doc(lotId));
        txn.set(db.collection("records").doc(), {
            type: "parkinglot-delete",
            performedBy: uid,
            performedByName: callerSnap.data()?.displayName ?? "",
            lotName: lotSnap.data()?.name ?? lotId,
            unlinkedFrom,
            timestamp: FieldValue.serverTimestamp(),
            expiresAt: recordExpiresAt(),
        });
        return {deleted: true, unlinkedFrom};
    });
});

export const saveParkingRate = onCall({maxInstances: 10}, async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Must be signed in.");
    const uid = request.auth.uid;
    await checkRateLimit(uid);

    const input = request.data as Record<string, unknown>;
    const rateId = input.rateId ? validateDocId(input.rateId, "rateId") : null;
    const labelEn = sanitizeDisplayText(validateStr(input.labelEn, "labelEn", 200, true));
    const labelCn = sanitizeDisplayText(validateStr(input.labelCn, "labelCn", 200));
    if (!labelEn) throw new HttpsError("invalid-argument", "labelEn is required.");
    // Marker color for lots on this tier; "" defers to the client-side preset fallback.
    const color = typeof input.color === "string" ? input.color.trim().toLowerCase() : "";
    if (color && !/^#[0-9a-f]{6}$/.test(color)) {
        throw new HttpsError("invalid-argument", "color must be a hex color like #4b2e83.");
    }

    const docId = rateId ?? db.collection("parkingRates").doc().id;

    return adminTransaction(uid, async (txn, callerSnap) => {
        if (rateId) {
            const existing = await txn.get(db.collection("parkingRates").doc(rateId));
            if (!existing.exists) throw new HttpsError("not-found", "Parking rate not found.");
        }

        const ref = db.collection("parkingRates").doc(docId);
        if (rateId) {
            // Preserve the existing display order on edit; only labels and color change.
            txn.update(ref, {labelEn, labelCn, color});
        } else {
            txn.set(ref, {labelEn, labelCn, color, order: Date.now()});
        }
        txn.set(db.collection("records").doc(), {
            type: rateId ? "parkingrate-edit" : "parkingrate-create",
            performedBy: uid,
            performedByName: callerSnap.data()?.displayName ?? "",
            rateLabel: labelEn,
            timestamp: FieldValue.serverTimestamp(),
            expiresAt: recordExpiresAt(),
        });
        return {rateId: docId};
    });
});

export const deleteParkingRate = onCall({maxInstances: 10}, async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Must be signed in.");
    const uid = request.auth.uid;
    await checkRateLimit(uid);

    const rateId = validateDocId((request.data as {rateId?: string})?.rateId, "rateId");

    return adminTransaction(uid, async (txn, callerSnap) => {
        const rateSnap = await txn.get(db.collection("parkingRates").doc(rateId));
        if (!rateSnap.exists) throw new HttpsError("not-found", "Parking rate not found.");

        // Cascade unlink: clear this rateId from every lot that references it.
        const lotsSnap = await txn.get(db.collection("parkingLots").where("rateId", "==", rateId));
        let unlinkedFrom = 0;
        for (const doc of lotsSnap.docs) {
            txn.update(doc.ref, {rateId: ""});
            unlinkedFrom++;
        }

        txn.delete(db.collection("parkingRates").doc(rateId));
        txn.set(db.collection("records").doc(), {
            type: "parkingrate-delete",
            performedBy: uid,
            performedByName: callerSnap.data()?.displayName ?? "",
            rateLabel: rateSnap.data()?.labelEn ?? rateId,
            unlinkedFrom,
            timestamp: FieldValue.serverTimestamp(),
            expiresAt: recordExpiresAt(),
        });
        return {deleted: true, unlinkedFrom};
    });
});

export const saveVenue = onCall({maxInstances: 10}, async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Must be signed in.");
    const uid = request.auth.uid;
    await checkRateLimit(uid);

    const input = request.data as Record<string, unknown>;
    const venueId = input.venueId ? validateDocId(input.venueId, "venueId") : null;
    const nameEn = sanitizeDisplayText(validateStr(input.nameEn, "nameEn", 200, true));
    const nameCn = sanitizeDisplayText(validateStr(input.nameCn, "nameCn", 200));
    const lat = validateCoordinate(input.lat, "lat", -90, 90);
    const lng = validateCoordinate(input.lng, "lng", -180, 180);

    const rawLots = Array.isArray(input.parkingLots) ? input.parkingLots : [];
    if (rawLots.length > 50) {
        throw new HttpsError("invalid-argument", "Too many parking lots (max 50).");
    }
    const parkingLots = rawLots.map((link: any, i: number) => ({
        lotId: validateDocId(link?.lotId, `parkingLots[${i}].lotId`),
    }));
    const seenLotIds = new Set<string>();
    for (const l of parkingLots) {
        if (seenLotIds.has(l.lotId)) {
            throw new HttpsError("invalid-argument", `Duplicate lotId in parkingLots: ${l.lotId}.`);
        }
        seenLotIds.add(l.lotId);
    }

    const docId = venueId ?? db.collection("venues").doc().id;

    return adminTransaction(uid, async (txn, callerSnap) => {
        if (venueId) {
            const existing = await txn.get(db.collection("venues").doc(venueId));
            if (!existing.exists) throw new HttpsError("not-found", "Venue not found.");
        }

        // Verify referenced lots exist.
        for (const link of parkingLots) {
            const lotSnap = await txn.get(db.collection("parkingLots").doc(link.lotId));
            if (!lotSnap.exists) {
                throw new HttpsError("not-found", `Referenced parking lot not found: ${link.lotId}.`);
            }
        }

        const ref = db.collection("venues").doc(docId);
        const data = {nameEn, nameCn, lat, lng, parkingLots};
        if (venueId) {
            txn.update(ref, data);
        } else {
            txn.set(ref, data);
        }
        txn.set(db.collection("records").doc(), {
            type: venueId ? "venue-edit" : "venue-create",
            performedBy: uid,
            performedByName: callerSnap.data()?.displayName ?? "",
            venueName: nameEn,
            timestamp: FieldValue.serverTimestamp(),
            expiresAt: recordExpiresAt(),
        });
        return {venueId: docId};
    });
});
export const deleteVenue = onCall({maxInstances: 10}, async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Must be signed in.");
    const uid = request.auth.uid;
    await checkRateLimit(uid);

    const venueId = validateDocId((request.data as {venueId?: string})?.venueId, "venueId");

    return adminTransaction(uid, async (txn, callerSnap) => {
        const venueSnap = await txn.get(db.collection("venues").doc(venueId));
        if (!venueSnap.exists) throw new HttpsError("not-found", "Venue not found.");

        txn.delete(db.collection("venues").doc(venueId));
        txn.set(db.collection("records").doc(), {
            type: "venue-delete",
            performedBy: uid,
            performedByName: callerSnap.data()?.displayName ?? "",
            venueName: venueSnap.data()?.nameEn ?? venueId,
            timestamp: FieldValue.serverTimestamp(),
            expiresAt: recordExpiresAt(),
        });
        return {deleted: true};
    });
});
export const saveTeamMembers = onCall({maxInstances: 10}, async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Must be signed in.");
    const uid = request.auth.uid;
    await checkRateLimit(uid);

    const input = request.data as {teamMembers?: any[]};
    const members = Array.isArray(input.teamMembers) ? input.teamMembers : [];
    const validMembers = members.map(m => {
        // Legacy useAccountInfo (single toggle) maps to all three per-field flags.
        const useAccountName = Boolean(m.useAccountName ?? m.useAccountInfo);
        const useAccountRole = Boolean(m.useAccountRole ?? m.useAccountInfo);
        const useAccountPhoto = Boolean(m.useAccountPhoto ?? m.useAccountInfo);
        // Stored name/role are only fallbacks when the field follows the linked account
        // (resolved live at read time), so require them only for custom fields — this
        // matches the client's canSave and allows following an account with no title set.
        return {
            id: validateStr(m.id, "id", 128, true),
            uid: m.uid ? validateStr(m.uid, "uid", 128) : "",
            name: validateStr(m.name, "name", 200, !useAccountName),
            nameCn: validateStr(m.nameCn, "nameCn", 200),
            role: validateStr(m.role, "role", 200, !useAccountRole),
            roleCn: validateStr(m.roleCn, "roleCn", 200),
            imageUrl: validateStr(m.imageUrl, "imageUrl", 500),
            isHonorary: Boolean(m.isHonorary),
            useAccountName,
            useAccountRole,
            useAccountPhoto,
        };
    });

    return adminTransaction(uid, async (txn, callerSnap) => {
        txn.set(db.collection("config").doc("main"), {
            teamMembers: validMembers,
            updatedBy: uid,
            updatedByName: callerSnap.data()?.displayName ?? "",
            updatedAt: FieldValue.serverTimestamp(),
        }, {merge: true});
        txn.set(db.collection("records").doc(), {
            type: "config-update",
            performedBy: uid,
            performedByName: callerSnap.data()?.displayName ?? "",
            timestamp: FieldValue.serverTimestamp(),
            expiresAt: recordExpiresAt(),
        });
        return {saved: true};
    });
});

// Public (unauthenticated) resolver for the "Our Team" section on the landing page.
// The public site cannot read the users collection directly (Firestore rules gate it
// to staff/self), so members that opt a field into following their linked account have
// name/role/photo resolved here from the account's live displayName/title/photoURL.
// Only members the admin explicitly placed on the public team are looked up, and no
// email is exposed.
export const getPublicTeamMembers = onCall({maxInstances: 20}, async () => {
    const configSnap = await db.collection("config").doc("main").get();
    const members = (configSnap.data()?.teamMembers ?? []) as Record<string, unknown>[];

    // Legacy single-toggle members: treat useAccountInfo as all three per-field flags.
    const follows = (m: Record<string, unknown>) => ({
        name: Boolean(m.useAccountName ?? m.useAccountInfo),
        role: Boolean(m.useAccountRole ?? m.useAccountInfo),
        photo: Boolean(m.useAccountPhoto ?? m.useAccountInfo),
    });

    const linkedUids = [...new Set(
        members
            .filter(m => typeof m?.uid === "string" && m.uid)
            .filter(m => {
                const f = follows(m);
                return f.name || f.role || f.photo;
            })
            .map(m => m.uid as string)
    )];

    const accounts = new Map<string, {displayName: string; title: string; titleCn: string; photoURL: string}>();
    if (linkedUids.length > 0) {
        const snaps = await db.getAll(...linkedUids.map(uid => db.collection("users").doc(uid)));
        for (const snap of snaps) {
            if (!snap.exists) continue;
            const d = snap.data()!;
            accounts.set(snap.id, {
                displayName: (d.displayName as string) ?? "",
                title: (d.title as string) ?? "",
                titleCn: (d.titleCn as string) ?? "",
                photoURL: (d.photoURL as string) ?? "",
            });
        }
    }

    const teamMembers = members.map(m => {
        const acc = typeof m?.uid === "string" ? accounts.get(m.uid) : undefined;
        if (!acc) return m;
        const f = follows(m);
        // The role toggle governs both languages: English role follows the account's
        // English title, Chinese role its Chinese title (each falling back to the custom value).
        return {
            ...m,
            name: f.name ? (acc.displayName || m.name) : m.name,
            role: f.role ? (acc.title || m.role) : m.role,
            roleCn: f.role ? (acc.titleCn || m.roleCn) : m.roleCn,
            imageUrl: f.photo ? (acc.photoURL || m.imageUrl) : m.imageUrl,
        };
    });

    return {teamMembers};
});
