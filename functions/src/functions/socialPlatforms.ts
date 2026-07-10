import { HttpsError, onCall } from "firebase-functions/v2/https";
import { FieldValue } from "firebase-admin/firestore";
import { adminTransaction, requireAdmin, requireAuth } from "../utils/auth";
import { recordExpiresAt } from "../utils/config";
import { db } from "../utils/firebase";
import { sanitizeDisplayText, validateDocId, validateStr } from "../utils/validation";

// Server copy of the built-in platform list used by seedSocialPlatforms.
// Kept in sync with DEFAULT_SOCIAL_PLATFORMS on the client (app/lib/socialPlatforms.ts).
const DEFAULT_SOCIAL_PLATFORMS = [
    {id: "instagram", label: "Instagram", order: 0},
    {id: "x", label: "X (Twitter)", order: 1},
    {id: "tiktok", label: "TikTok", order: 2},
    {id: "youtube", label: "YouTube", order: 3},
    {id: "facebook", label: "Facebook", order: 4},
    {id: "bilibili", label: "Bilibili", labelCn: "哔哩哔哩", order: 5},
    {id: "xiaohongshu", label: "Xiaohongshu (RED)", labelCn: "小红书", order: 6},
    {id: "weibo", label: "Weibo", labelCn: "微博", order: 7},
    {id: "douyin", label: "Douyin", labelCn: "抖音", order: 8},
];

function validateOrder(value: unknown): number {
    if (value === undefined || value === null) return 0;
    if (typeof value !== "number" || !Number.isFinite(value)) {
        throw new HttpsError("invalid-argument", "Invalid order: must be a number.");
    }
    return value;
}

/**
 * Create or update an editable social platform. Platforms are traffic-source
 * tags for tracked QR codes: creating a code "per platform" makes one code per
 * platform pointing at the same URL so scan counts compare click-through.
 * Admin-only; the list is read client-side but only written here.
 */
export const saveSocialPlatform = onCall({maxInstances: 10}, async (request) => {
    const uid = await requireAuth(request);

    const input = request.data as Record<string, unknown>;
    const platformId = input.id ? validateDocId(input.id, "id") : null;
    const label = sanitizeDisplayText(validateStr(input.label, "label", 100, true));
    if (!label) throw new HttpsError("invalid-argument", "label is required.");
    const labelCn = sanitizeDisplayText(validateStr(input.labelCn, "labelCn", 100));
    const order = validateOrder(input.order);

    const docId = platformId ?? db.collection("socialPlatforms").doc().id;
    const data = {label, labelCn, order};

    return adminTransaction(uid, async (txn, callerSnap) => {
        const ref = db.collection("socialPlatforms").doc(docId);
        if (platformId) {
            const existing = await txn.get(ref);
            if (!existing.exists) throw new HttpsError("not-found", "Social platform not found.");
            txn.update(ref, data);
        } else {
            txn.set(ref, data);
        }
        txn.set(db.collection("records").doc(), {
            type: platformId ? "social-platform-edit" : "social-platform-create",
            performedBy: uid,
            performedByName: callerSnap.data()?.displayName ?? "",
            platformLabel: label,
            timestamp: FieldValue.serverTimestamp(),
            expiresAt: recordExpiresAt(),
        });
        return {id: docId};
    });
});

export const deleteSocialPlatform = onCall({maxInstances: 10}, async (request) => {
    const uid = await requireAuth(request);

    const platformId = validateDocId((request.data as {id?: string})?.id, "id");

    return adminTransaction(uid, async (txn, callerSnap) => {
        const ref = db.collection("socialPlatforms").doc(platformId);
        const snap = await txn.get(ref);
        if (!snap.exists) throw new HttpsError("not-found", "Social platform not found.");

        txn.delete(ref);
        txn.set(db.collection("records").doc(), {
            type: "social-platform-delete",
            performedBy: uid,
            performedByName: callerSnap.data()?.displayName ?? "",
            platformLabel: snap.data()?.label ?? platformId,
            timestamp: FieldValue.serverTimestamp(),
            expiresAt: recordExpiresAt(),
        });
        return {deleted: true};
    });
});

/**
 * Idempotently write the built-in defaults so admins can edit/remove them.
 * Only missing ids are created, so re-running never clobbers customisations.
 */
export const seedSocialPlatforms = onCall({maxInstances: 10}, async (request) => {
    const uid = await requireAuth(request);
    await requireAdmin(uid);

    const col = db.collection("socialPlatforms");
    const existing = await Promise.all(
        DEFAULT_SOCIAL_PLATFORMS.map(p => col.doc(p.id).get()),
    );

    const batch = db.batch();
    let seeded = 0;
    existing.forEach((snap, i) => {
        if (!snap.exists) {
            const {id, ...data} = DEFAULT_SOCIAL_PLATFORMS[i];
            batch.set(col.doc(id), data);
            seeded++;
        }
    });
    if (seeded > 0) await batch.commit();

    return {seeded};
});
