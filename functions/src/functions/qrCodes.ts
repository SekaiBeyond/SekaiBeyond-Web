import { HttpsError, onCall } from "firebase-functions/v2/https";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { adminTransaction, requireAdmin, requireAuth } from "../utils/auth";
import { qrScanExpiresAt, recordExpiresAt } from "../utils/config";
import { db } from "../utils/firebase";
import { commitInChunks } from "../utils/helpers";
import { sanitizeDisplayText, validateDocId, validateISODate, validateStr, validateUrl } from "../utils/validation";

const QR_EXPIRATION_MODES = ["none", "event", "date"] as const;
type QrExpirationMode = typeof QR_EXPIRATION_MODES[number];

function validateCoordinate(value: unknown, name: string, min: number, max: number): number {
    if (typeof value !== "number" || !Number.isFinite(value)) {
        throw new HttpsError("invalid-argument", `Invalid ${name}: must be a number.`);
    }
    if (value < min || value > max) {
        throw new HttpsError("invalid-argument", `Invalid ${name}: out of range.`);
    }
    return value;
}

// A spot is only "set" when both coordinates are present and not the (0, 0)
// origin sentinel (mirrors hasCoordinates() on the client).
function readSpot(input: Record<string, unknown>): {lat: number; lng: number} {
    const hasLat = input.lat !== undefined && input.lat !== null;
    const hasLng = input.lng !== undefined && input.lng !== null;
    if (!hasLat && !hasLng) return {lat: 0, lng: 0};
    return {
        lat: validateCoordinate(input.lat, "lat", -90, 90),
        lng: validateCoordinate(input.lng, "lng", -180, 180),
    };
}

/**
 * Create or update a managed QR code. Managed codes encode a stable
 * `/qr?id=<docId>` link resolved server-side, so the target, linked event,
 * expiration, and map spot can all be edited without reprinting the code.
 * Scan counters are preserved across edits.
 */
export const saveQrCode = onCall({maxInstances: 10}, async (request) => {
    const uid = await requireAuth(request);

    const input = request.data as Record<string, unknown>;
    const qrId = input.qrId ? validateDocId(input.qrId, "qrId") : null;
    const label = sanitizeDisplayText(validateStr(input.label, "label", 200, true));
    if (!label) throw new HttpsError("invalid-argument", "label is required.");
    const labelCn = sanitizeDisplayText(validateStr(input.labelCn, "labelCn", 200));
    const targetUrl = validateStr(input.targetUrl, "targetUrl", 2000, true);
    validateUrl(targetUrl, "targetUrl");
    const eventId = input.eventId ? validateDocId(input.eventId, "eventId") : "";

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
        const iso = validateISODate(input.expiresAt, "expiresAt");
        if (!iso) throw new HttpsError("invalid-argument", "An expiration date is required.");
        expiresAt = Timestamp.fromDate(new Date(iso));
    }

    const {lat, lng} = readSpot(input);
    const spotLabel = sanitizeDisplayText(validateStr(input.spotLabel, "spotLabel", 200));
    const spotLabelCn = sanitizeDisplayText(validateStr(input.spotLabelCn, "spotLabelCn", 200));

    const docId = qrId ?? db.collection("qrCodes").doc().id;
    const data = {label, labelCn, targetUrl, eventId, expirationMode, lat, lng, spotLabel, spotLabelCn};

    return adminTransaction(uid, async (txn, callerSnap) => {
        const ref = db.collection("qrCodes").doc(docId);
        if (qrId) {
            const existing = await txn.get(ref);
            if (!existing.exists) throw new HttpsError("not-found", "QR code not found.");
            // Drop the stored date when the mode no longer needs one.
            txn.update(ref, {...data, expiresAt: expiresAt ?? FieldValue.delete()});
        } else {
            txn.set(ref, {
                ...data,
                expiresAt,
                scanCount: 0,
                lastScanAt: null,
                createdAt: FieldValue.serverTimestamp(),
                createdBy: uid,
                createdByName: callerSnap.data()?.displayName ?? "",
            });
        }
        txn.set(db.collection("records").doc(), {
            type: qrId ? "qrcode-edit" : "qrcode-create",
            performedBy: uid,
            performedByName: callerSnap.data()?.displayName ?? "",
            qrLabel: label,
            qrId: docId,
            timestamp: FieldValue.serverTimestamp(),
            expiresAt: recordExpiresAt(),
        });
        return {qrId: docId};
    });
});

/**
 * Pin a QR code to a map spot. Powers the "link to my current location" flow:
 * an admin scans the printed code on their phone, the redirect page reads their
 * geolocation, and calls this to set the spot without any desktop UI.
 */
export const setQrSpot = onCall({maxInstances: 10}, async (request) => {
    const uid = await requireAuth(request);

    const input = request.data as Record<string, unknown>;
    const qrId = validateDocId(input.qrId, "qrId");
    const lat = validateCoordinate(input.lat, "lat", -90, 90);
    const lng = validateCoordinate(input.lng, "lng", -180, 180);

    return adminTransaction(uid, async (txn, callerSnap) => {
        const ref = db.collection("qrCodes").doc(qrId);
        const snap = await txn.get(ref);
        if (!snap.exists) throw new HttpsError("not-found", "QR code not found.");
        txn.update(ref, {lat, lng});
        txn.set(db.collection("records").doc(), {
            type: "qrcode-spot-set",
            performedBy: uid,
            performedByName: callerSnap.data()?.displayName ?? "",
            qrLabel: snap.data()?.label ?? qrId,
            qrId,
            timestamp: FieldValue.serverTimestamp(),
            expiresAt: recordExpiresAt(),
        });
        return {lat, lng};
    });
});

export const deleteQrCode = onCall({maxInstances: 10}, async (request) => {
    const uid = await requireAuth(request);
    const callerSnap = await requireAdmin(uid);

    const qrId = validateDocId((request.data as {qrId?: string})?.qrId, "qrId");
    const ref = db.collection("qrCodes").doc(qrId);
    const snap = await ref.get();
    if (!snap.exists) throw new HttpsError("not-found", "QR code not found.");

    // Scans live in an unbounded subcollection, so they're purged in chunks
    // outside the transaction before the parent doc is removed.
    const scansSnap = await ref.collection("scans").get();
    const ops = scansSnap.docs.map(d => (b: FirebaseFirestore.WriteBatch) => b.delete(d.ref));
    if (ops.length > 0) await commitInChunks(ops);

    await ref.delete();
    await db.collection("records").add({
        type: "qrcode-delete",
        performedBy: uid,
        performedByName: callerSnap.data()?.displayName ?? "",
        qrLabel: snap.data()?.label ?? qrId,
        qrId,
        timestamp: FieldValue.serverTimestamp(),
        expiresAt: recordExpiresAt(),
    });
    return {deleted: true};
});

/**
 * Public, unauthenticated endpoint hit by the `/qr?id=` redirect page on every
 * scan. Resolves the current target, evaluates expiration server-side, and (for
 * active codes) bumps the counter plus logs a scan event for the trend charts.
 *
 * App Check is enforced globally; no per-user rate limit applies since scanners
 * are anonymous. Admins linking a spot use the in-app scanner (setQrSpot) — that
 * path never hits this endpoint, so it can't skew the heatmap.
 */
export const recordQrScan = onCall({maxInstances: 20}, async (request) => {
    const qrId = validateDocId((request.data as {id?: string})?.id, "id");
    const ref = db.collection("qrCodes").doc(qrId);

    const snap = await ref.get();
    if (!snap.exists) {
        console.log(`recordQrScan: inactive qrId=${qrId} reason=not-found`);
        throw new HttpsError("not-found", "QR code not found.", {code: "not-found"});
    }
    const data = snap.data()!;

    const now = Date.now();
    let active = true;
    // Why a scan resolved as inactive — logged below so "expired/invalid" reports
    // can be diagnosed from Cloud Logging without on-page debug output.
    let reason = "ok";
    let eventEndAt: number | null = null;
    if (data.expirationMode === "date") {
        const exp = data.expiresAt?.toMillis?.() ?? null;
        active = (exp ?? 0) > now;
        if (!active) reason = exp === null ? "date-missing" : "date-passed";
    } else if (data.expirationMode === "event") {
        active = false;
        reason = data.eventId ? "event-ended" : "event-unlinked";
        if (data.eventId) {
            try {
                const ev = await db.collection("upcomingEvents").doc(data.eventId).get();
                if (!ev.exists) {
                    reason = "event-missing";
                } else {
                    eventEndAt = ev.data()?.endAt?.toMillis?.() ?? null;
                    active = (eventEndAt ?? 0) > now;
                    reason = active ? "ok" : "event-ended";
                }
            } catch (err) {
                active = false;
                reason = "event-read-failed";
                console.error(`recordQrScan: failed to read event ${data.eventId} for ${qrId}`, err);
            }
        }
    }
    if (active && !data.targetUrl) reason = "no-target";

    // Log only failed resolutions so successful redirects stay silent. Filter the
    // function's logs by `recordQrScan: inactive` to see why codes are failing.
    if (!active) {
        console.log(
            `recordQrScan: inactive qrId=${qrId} reason=${reason} ` +
            `mode=${data.expirationMode ?? "none"} eventId=${data.eventId || "-"} ` +
            `expiresAt=${data.expiresAt?.toDate?.()?.toISOString?.() ?? "-"} ` +
            `eventEndAt=${eventEndAt !== null ? new Date(eventEndAt).toISOString() : "-"} ` +
            `serverNow=${new Date(now).toISOString()}`,
        );
    }

    if (active) {
        try {
            const batch = db.batch();
            batch.update(ref, {scanCount: FieldValue.increment(1), lastScanAt: FieldValue.serverTimestamp()});
            batch.set(ref.collection("scans").doc(), {
                scannedAt: FieldValue.serverTimestamp(),
                expiresAt: qrScanExpiresAt(),
            });
            await batch.commit();
        } catch (err) {
            // A failed counter write must not block the redirect.
            console.error(`recordQrScan: failed to record scan for ${qrId}`, err);
        }
    }

    return {active, targetUrl: data.targetUrl ?? ""};
});
