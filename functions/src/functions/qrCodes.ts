import { HttpsError, onCall, onRequest } from "firebase-functions/v2/https";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { adminTransaction, requireAdmin, requireAuth } from "../utils/auth";
import { db } from "../utils/firebase";
import { commitInChunks, deleteOps, isoOrNull } from "../utils/helpers";
import { recordScan, scanClientKey } from "../utils/scans";
import { performer, recordDoc, recordRef } from "../utils/records";
import {
    sanitizeDisplayText,
    validateCoordinate,
    validateDocId,
    validateInstant,
    validateStr,
    validateStringArray,
    validateUrl,
} from "../utils/validation";

const QR_EXPIRATION_MODES = ["none", "event", "date"] as const;
type QrExpirationMode = typeof QR_EXPIRATION_MODES[number];

const PLATFORM_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

function readScanPlatform(value: unknown): string {
    return typeof value === "string" && PLATFORM_ID_RE.test(value) ? value : "";
}

function readSpot(input: Record<string, unknown>): {lat: number; lng: number} {
    const hasLat = input.lat !== undefined && input.lat !== null;
    const hasLng = input.lng !== undefined && input.lng !== null;
    if (!hasLat && !hasLng) return {lat: 0, lng: 0};
    return {
        lat: validateCoordinate(input.lat, "lat", -90, 90),
        lng: validateCoordinate(input.lng, "lng", -180, 180),
    };
}

export const saveQrCode = onCall({maxInstances: 10}, async (request) => {
    const uid = await requireAuth(request, "staff");

    const input = request.data as Record<string, unknown>;
    const qrId = input.qrId ? validateDocId(input.qrId, "qrId") : null;
    const label = sanitizeDisplayText(validateStr(input.label, "label", 200, true));
    if (!label) throw new HttpsError("invalid-argument", "label is required.");
    const labelCn = sanitizeDisplayText(validateStr(input.labelCn, "labelCn", 200));
    const targetUrl = validateStr(input.targetUrl, "targetUrl", 2000, true);
    validateUrl(targetUrl, "targetUrl");
    const eventId = input.eventId ? validateDocId(input.eventId, "eventId") : "";
    const platforms = validateStringArray(input.platforms, "platforms", 50, 64);
    for (const p of platforms) {
        if (!PLATFORM_ID_RE.test(p)) {
            throw new HttpsError("invalid-argument", "Invalid platforms: illegal characters.");
        }
    }

    const modeRaw = input.expirationMode;
    const expirationMode: QrExpirationMode =
        (QR_EXPIRATION_MODES as readonly string[]).includes(modeRaw as string)
            ? modeRaw as QrExpirationMode
            : "none";
    if (expirationMode === "event" && !eventId) {
        throw new HttpsError("invalid-argument", "An event must be linked for event-based expiration.");
    }
    let expiresAt: Timestamp | null = null;
    if (expirationMode === "date") {
        const iso = validateInstant(input.expiresAt, "expiresAt");
        if (!iso) throw new HttpsError("invalid-argument", "An expiration date is required.");
        expiresAt = Timestamp.fromDate(new Date(iso));
    }

    const social = platforms.length > 0;
    const {lat, lng} = social ? {lat: 0, lng: 0} : readSpot(input);
    const spotLabel = social ? "" : sanitizeDisplayText(validateStr(input.spotLabel, "spotLabel", 200));
    const spotLabelCn = social ? "" : sanitizeDisplayText(validateStr(input.spotLabelCn, "spotLabelCn", 200));

    const docId = qrId ?? db.collection("qrCodes").doc().id;
    const data = {label, labelCn, targetUrl, eventId, platforms, expirationMode, lat, lng, spotLabel, spotLabelCn};

    return adminTransaction(uid, async (txn, callerSnap) => {
        const ref = db.collection("qrCodes").doc(docId);
        if (qrId) {
            const existing = await txn.get(ref);
            if (!existing.exists) throw new HttpsError("not-found", "QR code not found.");
            const existingPlatforms = existing.data()?.platforms;
            const wasSocial = Array.isArray(existingPlatforms) && existingPlatforms.length > 0;
            if (wasSocial !== social) {
                throw new HttpsError(
                    "failed-precondition",
                    "A code's type (location vs. social media) can't be changed after creation.",
                );
            }
            txn.update(ref, {...data, expiresAt: expiresAt ?? FieldValue.delete()});
        } else {
            txn.set(ref, {
                ...data,
                expiresAt,
                scanCount: 0,
                platformScans: {},
                lastScanAt: null,
                createdAt: FieldValue.serverTimestamp(),
                createdBy: uid,
                createdByName: callerSnap.data()?.displayName ?? "",
            });
        }
        txn.set(recordRef(), recordDoc(qrId ? "qrcode-edit" : "qrcode-create", {
            ...performer(uid, callerSnap),
            qrLabel: label,
        }));
        return {qrId: docId};
    });
});

export const setQrSpot = onCall({maxInstances: 10}, async (request) => {
    const uid = await requireAuth(request, "staff");

    const input = request.data as Record<string, unknown>;
    const qrId = validateDocId(input.qrId, "qrId");
    const lat = validateCoordinate(input.lat, "lat", -90, 90);
    const lng = validateCoordinate(input.lng, "lng", -180, 180);

    await adminTransaction(uid, async (txn, callerSnap) => {
        const ref = db.collection("qrCodes").doc(qrId);
        const snap = await txn.get(ref);
        if (!snap.exists) throw new HttpsError("not-found", "QR code not found.");
        const platforms = snap.data()?.platforms;
        if (Array.isArray(platforms) && platforms.length > 0) {
            throw new HttpsError("failed-precondition", "Social media codes can't be pinned to a map spot.");
        }
        txn.update(ref, {lat, lng});
        txn.set(recordRef(), recordDoc("qrcode-spot-set", {
            ...performer(uid, callerSnap),
            qrLabel: snap.data()?.label ?? qrId,
        }));
    });
});

export const deleteQrCode = onCall({maxInstances: 10}, async (request) => {
    const uid = await requireAuth(request, "staff");
    const callerSnap = await requireAdmin(uid);

    const qrId = validateDocId((request.data as {qrId?: string})?.qrId, "qrId");
    const ref = db.collection("qrCodes").doc(qrId);
    const snap = await ref.get();
    if (!snap.exists) throw new HttpsError("not-found", "QR code not found.");

    const scansSnap = await ref.collection("scans").get();
    if (!scansSnap.empty) await commitInChunks(deleteOps(scansSnap.docs));

    await ref.delete();
    await recordRef().set(recordDoc("qrcode-delete", {
        ...performer(uid, callerSnap),
        qrLabel: snap.data()?.label ?? qrId,
    }));
});

const EVENT_END_TTL_MS = 60_000;
const eventEndCache = new Map<string, {endAtMs: number | null; fetchedAt: number}>();

async function getEventEndAtMs(eventId: string): Promise<number | null> {
    const cached = eventEndCache.get(eventId);
    if (cached && Date.now() - cached.fetchedAt < EVENT_END_TTL_MS) {
        return cached.endAtMs;
    }
    const ev = await db.collection("upcomingEvents").doc(eventId).get();
    const endAtMs = ev.exists ? (ev.data()?.endAt?.toMillis?.() ?? null) : null;
    eventEndCache.set(eventId, {endAtMs, fetchedAt: Date.now()});
    return endAtMs;
}

async function qrCodeStatus(
    qrId: string,
    data: FirebaseFirestore.DocumentData,
    now: number,
): Promise<{active: boolean; reason: string; eventEndAt: number | null}> {
    let reason = "ok";
    let eventEndAt: number | null = null;
    if (data.expirationMode === "date") {
        const exp = data.expiresAt?.toMillis?.() ?? null;
        if ((exp ?? 0) <= now) reason = exp === null ? "date-missing" : "date-passed";
    } else if (data.expirationMode === "event") {
        if (!data.eventId) {
            reason = "event-unlinked";
        } else {
            try {
                eventEndAt = await getEventEndAtMs(data.eventId);
                if ((eventEndAt ?? 0) <= now) reason = eventEndAt === null ? "event-missing" : "event-ended";
            } catch (err) {
                reason = "event-read-failed";
                console.error(`qrCodeStatus: failed to read event ${data.eventId} for ${qrId}`, err);
            }
        }
    }
    if (reason === "ok" && !data.targetUrl) reason = "no-target";
    return {active: reason === "ok", reason, eventEndAt};
}

export const recordQrScan = onCall({maxInstances: 20}, async (request) => {
    const qrId = validateDocId((request.data as {id?: string})?.id, "id");
    const platform = readScanPlatform((request.data as {p?: string})?.p);
    const ref = db.collection("qrCodes").doc(qrId);

    const snap = await ref.get();
    if (!snap.exists) {
        console.log(`recordQrScan: inactive qrId=${qrId} reason=not-found`);
        throw new HttpsError("not-found", "QR code not found.", {code: "not-found"});
    }
    const data = snap.data()!;

    const now = Date.now();
    const {active, reason, eventEndAt} = await qrCodeStatus(qrId, data, now);

    if (!active) {
        console.log(
            `recordQrScan: inactive qrId=${qrId} reason=${reason} ` +
            `mode=${data.expirationMode ?? "none"} eventId=${data.eventId || "-"} ` +
            `expiresAt=${isoOrNull(data.expiresAt) ?? "-"} ` +
            `eventEndAt=${eventEndAt !== null ? new Date(eventEndAt).toISOString() : "-"} ` +
            `serverNow=${new Date(now).toISOString()}`,
        );
    }

    if (active) {
        try {
            await recordScan(ref, {clientKey: scanClientKey(request.rawRequest), platform});
        } catch (err) {
            console.error(`recordQrScan: failed to record scan for ${qrId}`, err);
        }
    }

    return {active, targetUrl: data.targetUrl ?? ""};
});

export const redirectQr = onRequest({maxInstances: 20, memory: "256MiB"}, async (req, res) => {
    res.set("Cache-Control", "no-store");

    const id = typeof req.query.id === "string" ? req.query.id : "";
    const platform = readScanPlatform(req.query.p);

    if (!id) {
        res.redirect(302, "/qr/expired");
        return;
    }

    if (id.length > 128 || /[/\0]/.test(id)) {
        res.redirect(302, "/qr/expired");
        return;
    }

    const ref = db.collection("qrCodes").doc(id);
    let snap: FirebaseFirestore.DocumentSnapshot;
    try {
        snap = await ref.get();
    } catch (err) {
        console.error(`redirectQr: read failed for ${id}`, err);
        res.redirect(302, "/qr/expired?error=1");
        return;
    }
    if (!snap.exists) {
        console.log(`redirectQr: inactive qrId=${id} reason=not-found`);
        res.redirect(302, "/qr/expired");
        return;
    }

    const data = snap.data()!;
    const {active, reason} = await qrCodeStatus(id, data, Date.now());
    if (!active) {
        console.log(
            `redirectQr: inactive qrId=${id} reason=${reason} ` +
            `mode=${data.expirationMode ?? "none"} eventId=${data.eventId || "-"}`,
        );
        res.redirect(302, "/qr/expired");
        return;
    }

    res.redirect(302, data.targetUrl);
    try {
        await recordScan(ref, {clientKey: scanClientKey(req), platform});
    } catch (err) {
        console.error(`redirectQr: failed to record scan for ${id}`, err);
    }
});
