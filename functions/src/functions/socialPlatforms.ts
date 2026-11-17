import { HttpsError, onCall } from "firebase-functions/v2/https";
import { adminTransaction, requireAdmin, requireAuth } from "../utils/auth";
import { db } from "../utils/firebase";
import { sanitizeDisplayText, validateDocId, validateStr } from "../utils/validation";
import { performer, recordDoc, recordRef } from "../utils/records";

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

export const saveSocialPlatform = onCall({maxInstances: 10}, async (request) => {
    const uid = await requireAuth(request, "staff");

    const input = request.data as Record<string, unknown>;
    const platformId = input.id ? validateDocId(input.id, "id") : null;
    const label = sanitizeDisplayText(validateStr(input.label, "label", 100, true));
    if (!label) throw new HttpsError("invalid-argument", "label is required.");
    const labelCn = sanitizeDisplayText(validateStr(input.labelCn, "labelCn", 100));
    const order = validateOrder(input.order);

    const docId = platformId ?? db.collection("socialPlatforms").doc().id;
    const data = {label, labelCn, order};

    await adminTransaction(uid, async (txn, callerSnap) => {
        const ref = db.collection("socialPlatforms").doc(docId);
        if (platformId) {
            const existing = await txn.get(ref);
            if (!existing.exists) throw new HttpsError("not-found", "Social platform not found.");
            txn.update(ref, data);
        } else {
            txn.set(ref, data);
        }
        txn.set(recordRef(), recordDoc(platformId ? "social-platform-edit" : "social-platform-create", {
            ...performer(uid, callerSnap),
            platformLabel: label,
        }));
    });
});

export const deleteSocialPlatform = onCall({maxInstances: 10}, async (request) => {
    const uid = await requireAuth(request, "staff");

    const platformId = validateDocId((request.data as {id?: string})?.id, "id");

    await adminTransaction(uid, async (txn, callerSnap) => {
        const ref = db.collection("socialPlatforms").doc(platformId);
        const snap = await txn.get(ref);
        if (!snap.exists) throw new HttpsError("not-found", "Social platform not found.");

        txn.delete(ref);
        txn.set(recordRef(), recordDoc("social-platform-delete", {
            ...performer(uid, callerSnap),
            platformLabel: snap.data()?.label ?? platformId,
        }));
    });
});

export const seedSocialPlatforms = onCall({maxInstances: 10}, async (request) => {
    const uid = await requireAuth(request, "staff");
    await requireAdmin(uid);

    const col = db.collection("socialPlatforms");
    const existing = await Promise.all(
        DEFAULT_SOCIAL_PLATFORMS.map(p => col.doc(p.id).get()),
    );

    const missing = DEFAULT_SOCIAL_PLATFORMS.filter((_, i) => !existing[i].exists);
    if (missing.length === 0) return;
    const batch = db.batch();
    for (const {id, ...data} of missing) batch.set(col.doc(id), data);
    await batch.commit();
});
