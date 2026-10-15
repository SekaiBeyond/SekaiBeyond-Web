import { createHash } from "node:crypto";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { scanExpiresAt } from "./config";
import { db } from "./firebase";

const QUOTA = "scanQuota";

export const SCAN_QUOTA_WINDOW_MS = 30 * 60_000;

/**
 * Scans one client may add to one code per window.
 *
 * A poster is scanned by a whole room behind one venue NAT, which looks like
 * very few clients, so a tight ceiling would stop counting exactly when the
 * analytics matter. This is loose enough that honest traffic won't reach it; it
 * stops one client asking thousands of times.
 */
export const SCAN_QUOTA = 500;

// Salts a hash thrown away within the hour. Set SCAN_CLIENT_SALT to make
// digests unguessable from a database export; the fallback still keeps raw
// addresses out of storage, but someone with the source and the data could
// brute-force IPv4 back out.
const CLIENT_SALT = process.env.SCAN_CLIENT_SALT ?? "sekai-beyond-scan-client";

interface ScanRequestLike {
    headers: Record<string, string | string[] | undefined>;
    ip?: string;
}

/**
 * A non-identifying quota key for whoever is scanning: their address, narrowed to
 * the IPv6 /64 so a client can't rotate through its prefix, plus the user agent
 * so phones behind one NAT stay apart. Hashed, never stored raw. An unreadable
 * address falls into a shared bucket, not an exemption.
 */
export function scanClientKey(req: ScanRequestLike | undefined): string {
    const forwarded = req?.headers?.["x-forwarded-for"];
    const chain = Array.isArray(forwarded) ? forwarded.join(",") : (forwarded ?? "");
    const address = chain.split(",")[0]?.trim() || req?.ip || "unknown";
    const agent = req?.headers?.["user-agent"];

    return createHash("sha256")
        .update(`${CLIENT_SALT}|${narrowAddress(address)}|${Array.isArray(agent) ? agent.join(" ") : agent ?? ""}`)
        .digest("hex")
        .slice(0, 32);
}

/** An IPv6 client typically owns a whole /64, so the suffix is theirs to vary. */
function narrowAddress(address: string): string {
    if (!address.includes(":")) return address;
    return address.split(":").slice(0, 4).join(":");
}

/**
 * Whether this client has used up its allowance on this code. The window is in
 * the doc id, so each gets a fresh doc and a leftover from an old window (TTL
 * sweeps lazily) can't suppress a later scan. A failed read lets the scan
 * through.
 */
async function quotaExhausted(ref: FirebaseFirestore.DocumentReference): Promise<boolean> {
    try {
        const used = (await ref.get()).data()?.count;
        return typeof used === "number" && used >= SCAN_QUOTA;
    } catch (err) {
        console.error(`recordScan: quota read failed for ${ref.id}`, err);
        return false;
    }
}

/**
 * Bump a QR code's counters and log a scan under `scans`. Both recordQrScan and
 * redirectQr write through here, which keeps the counters, the TTL policy and
 * the chart (fetchScans in app/lib/scans.ts) in agreement.
 *
 * `platform` is the link's `p` tag, also tallied under
 * `platformScans.<platform>`; "" skips that.
 */
export async function recordScan(
    ref: FirebaseFirestore.DocumentReference,
    {clientKey, platform = ""}: {
        clientKey: string;
        platform?: string;
    },
): Promise<void> {
    const window = Math.floor(Date.now() / SCAN_QUOTA_WINDOW_MS);
    const quotaRef = db.collection(QUOTA).doc(
        createHash("sha256").update(`${ref.path}|${clientKey}|${window}`).digest("hex").slice(0, 32),
    );

    if (await quotaExhausted(quotaRef)) {
        // Logged: this is the signal a code is being hammered. The redirect
        // still runs.
        console.log(`recordScan: quota reached for ${ref.path}, scan not counted`);
        return;
    }

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
    // In the same commit. Two windows' grace on the TTL, like checkRateLimit.
    batch.set(quotaRef, {
        count: FieldValue.increment(1),
        expiresAt: Timestamp.fromMillis(Date.now() + SCAN_QUOTA_WINDOW_MS * 2),
    }, {merge: true});
    await batch.commit();
}
