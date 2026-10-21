import { HttpsError, onCall, onRequest } from "firebase-functions/v2/https";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { adminTransaction, requireAdmin, requireAuth } from "../utils/auth";
import { db } from "../utils/firebase";
import { commitInChunks } from "../utils/helpers";
import { recordScan, scanClientKey } from "../utils/scans";
import { recordDoc, recordRef } from "../utils/records";
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

// Platform ids become field-path segments (`platformScans.<id>`), so only
// doc-id-safe characters.
const PLATFORM_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

/** The `p` scan param, or "" when absent/unsafe (never blocks the redirect). */
function readScanPlatform(value: unknown): string {
    return typeof value === "string" && PLATFORM_ID_RE.test(value) ? value : "";
}

// Set only when both coordinates are present and not the (0, 0) sentinel, like
// hasCoordinates() on the client.
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
 * Create or update a managed QR code. It encodes a stable `/qr?id=<docId>` link
 * resolved server-side, so the target, event, expiry and spot can change
 * without reprinting. Scan counts survive edits.
 */
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
    // [] means a location code. A social code is one URL with a QR link per
    // platform (`/qr?id=…&p=<platform>`), tallied per platform, and its list
    // can change later. A code is social (platforms, no spot) or location
    // (spot, no platforms), fixed at creation.
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
            // The kind is fixed: its links are already printed or shared, and
            // flipping it would orphan them and their scan counts.
            const existingPlatforms = existing.data()?.platforms;
            const wasSocial = Array.isArray(existingPlatforms) && existingPlatforms.length > 0;
            if (wasSocial !== social) {
                throw new HttpsError(
                    "failed-precondition",
                    "A code's type (location vs. social media) can't be changed after creation.",
                );
            }
            // Drop the date when the mode doesn't need one. platformScans
            // tallies are kept, so re-adding a platform keeps its history.
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
            performedBy: uid,
            performedByName: callerSnap.data()?.displayName ?? "",
            qrLabel: label,
        }));
        return {qrId: docId};
    });
});

/**
 * Pin a QR code to a map spot, from a phone: an admin scans the printed code
 * and the redirect page sends their location here.
 */
export const setQrSpot = onCall({maxInstances: 10}, async (request) => {
    const uid = await requireAuth(request, "staff");

    const input = request.data as Record<string, unknown>;
    const qrId = validateDocId(input.qrId, "qrId");
    const lat = validateCoordinate(input.lat, "lat", -90, 90);
    const lng = validateCoordinate(input.lng, "lng", -180, 180);

    return adminTransaction(uid, async (txn, callerSnap) => {
        const ref = db.collection("qrCodes").doc(qrId);
        const snap = await txn.get(ref);
        if (!snap.exists) throw new HttpsError("not-found", "QR code not found.");
        const platforms = snap.data()?.platforms;
        if (Array.isArray(platforms) && platforms.length > 0) {
            throw new HttpsError("failed-precondition", "Social media codes can't be pinned to a map spot.");
        }
        txn.update(ref, {lat, lng});
        txn.set(recordRef(), recordDoc("qrcode-spot-set", {
            performedBy: uid,
            performedByName: callerSnap.data()?.displayName ?? "",
            qrLabel: snap.data()?.label ?? qrId,
        }));
        return {lat, lng};
    });
});

export const deleteQrCode = onCall({maxInstances: 10}, async (request) => {
    const uid = await requireAuth(request, "staff");
    const callerSnap = await requireAdmin(uid);

    const qrId = validateDocId((request.data as {qrId?: string})?.qrId, "qrId");
    const ref = db.collection("qrCodes").doc(qrId);
    const snap = await ref.get();
    if (!snap.exists) throw new HttpsError("not-found", "QR code not found.");

    // An unbounded subcollection, purged in chunks outside the transaction
    // first.
    const scansSnap = await ref.collection("scans").get();
    const ops = scansSnap.docs.map(d => (b: FirebaseFirestore.WriteBatch) => b.delete(d.ref));
    if (ops.length > 0) await commitInChunks(ops);

    await ref.delete();
    await recordRef().set(recordDoc("qrcode-delete", {
        performedBy: uid,
        performedByName: callerSnap.data()?.displayName ?? "",
        qrLabel: snap.data()?.label ?? qrId,
    }));
    return {deleted: true};
});

/**
 * Public endpoint the `/qr?id=` page calls on every scan: resolves the target
 * and expiry, and for active codes bumps the counter and logs a scan for the
 * trend charts.
 *
 * App Check is enforced globally; scanners are anonymous, so there's no per-user
 * rate limit. Admins linking a spot use setQrSpot instead, so they don't skew
 * the heatmap.
 */
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
    let active = true;
    // Logged on failure, so "expired/invalid" reports can be diagnosed from Cloud
    // Logging.
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
    if (active && !data.targetUrl) {
        active = false;
        reason = "no-target";
    }

    // Filter the logs by `recordQrScan: inactive` to see why codes fail.
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
            await recordScan(ref, {clientKey: scanClientKey(request.rawRequest), platform});
        } catch (err) {
            // A failed counter write must not block the redirect.
            console.error(`recordQrScan: failed to record scan for ${qrId}`, err);
        }
    }

    return {active, targetUrl: data.targetUrl ?? ""};
});

// Linked-event end times, cached per instance so repeated scans during an event
// skip the read. The short TTL lets reschedules and archives correct themselves
// within a minute, which is simpler than copying endAt onto every QR doc.
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

/**
 * Public HTTP endpoint behind the `/qr` hosting rewrite: resolves a managed code
 * and answers with a 302 straight to the target, with no SPA boot and no App
 * Check round-trip (HTTP functions aren't gated by enforceAppCheck; see
 * serveTicketQr).
 *
 * Expired and invalid codes are handed to the SPA's styled card. The
 * `recordQrScan` callable and the SPA `/qr` page remain as a fallback where
 * there is no rewrite, e.g. local dev.
 */
export const redirectQr = onRequest({maxInstances: 20, memory: "256MiB"}, async (req, res) => {
    // Target URLs are editable and expiry is time-based — this must never cache.
    res.set("Cache-Control", "no-store");

    const id = typeof req.query.id === "string" ? req.query.id : "";
    const platform = readScanPlatform(req.query.p);

    // Hand-offs are same-origin relative paths, so scanners stay on whatever
    // host served the request.

    // No id: an old inline-url code. Its `url` param was an open-redirect
    // vector, so it gets the expired card instead.
    if (!id) {
        res.redirect(302, "/qr/expired");
        return;
    }

    // Same id rules as validateDocId; a malformed id just resolves to expired.
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
    const now = Date.now();
    let active = true;
    let reason = "ok";
    if (data.expirationMode === "date") {
        const exp = data.expiresAt?.toMillis?.() ?? null;
        active = (exp ?? 0) > now;
        if (!active) reason = exp === null ? "date-missing" : "date-passed";
    } else if (data.expirationMode === "event") {
        if (!data.eventId) {
            active = false;
            reason = "event-unlinked";
        } else {
            try {
                const endAtMs = await getEventEndAtMs(data.eventId);
                active = (endAtMs ?? 0) > now;
                reason = active ? "ok" : (endAtMs === null ? "event-missing" : "event-ended");
            } catch (err) {
                active = false;
                reason = "event-read-failed";
                console.error(`redirectQr: failed to read event ${data.eventId} for ${id}`, err);
            }
        }
    }
    if (active && !data.targetUrl) {
        active = false;
        reason = "no-target";
    }

    if (!active) {
        console.log(
            `redirectQr: inactive qrId=${id} reason=${reason} ` +
            `mode=${data.expirationMode ?? "none"} eventId=${data.eventId || "-"}`,
        );
        res.redirect(302, "/qr/expired");
        return;
    }

    // Redirect first, then record: the instance runs until the handler resolves,
    // so the write still completes, just off the redirect's critical path.
    res.redirect(302, data.targetUrl);
    try {
        await recordScan(ref, {clientKey: scanClientKey(req), platform});
    } catch (err) {
        // The response is already sent; a failed counter write only loses a tally.
        console.error(`redirectQr: failed to record scan for ${id}`, err);
    }
});
