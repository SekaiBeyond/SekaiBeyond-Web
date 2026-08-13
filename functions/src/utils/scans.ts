import { FieldValue } from "firebase-admin/firestore";
import { scanExpiresAt } from "./config";
import { db } from "./firebase";

/**
 * Bump a scannable document's counters and log one scan event under its `scans`
 * subcollection.
 *
 * QR codes and passports both write this shape, and that is what lets a single
 * TTL policy cover the whole `scans` collection group and a single chart read it
 * (see fetchScans in app/lib/scans.ts). Keeping the write in one place is what
 * keeps those three in agreement.
 *
 * `platform` is a QR link's `p` tag, which additionally tallies under
 * `platformScans.<platform>` so click-through can be compared by platform.
 * Passports carry none and pass "", which skips that field and reads as a single
 * series in the chart.
 */
export async function recordScan(
    ref: FirebaseFirestore.DocumentReference,
    platform = "",
): Promise<void> {
    const update: Record<string, unknown> = {
        scanCount: FieldValue.increment(1),
        lastScanAt: FieldValue.serverTimestamp(),
    };
    if (platform) update[`platformScans.${platform}`] = FieldValue.increment(1);

    const batch = db.batch();
    batch.update(ref, update);
    batch.set(ref.collection("scans").doc(), {
        scannedAt: FieldValue.serverTimestamp(),
        platform,
        expiresAt: scanExpiresAt(),
    });
    await batch.commit();
}
