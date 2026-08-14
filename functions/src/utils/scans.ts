import { createHash } from "node:crypto";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { scanExpiresAt } from "./config";
import { db } from "./firebase";

const QUOTA = "scanQuota";

export const SCAN_QUOTA_WINDOW_MS = 30 * 60_000;

/**
 * How many scans one client may add to one subject per window. The right number
 * depends entirely on how many people are expected to scan the same thing, so it
 * is the caller's to choose.
 *
 * A passport sticker belongs to one person and is scanned by whoever is standing
 * in front of them. A poster or standee is scanned by a whole room — all behind
 * the venue's NAT, sharing a handful of user agents, and therefore looking like
 * very few clients. Metering both at the personal figure would have stopped
 * counting a busy poster's scans exactly at the event its analytics exist to
 * measure.
 *
 * Both are loose enough that hitting one is already implausible for honest
 * traffic; what they stop is the shape with no honest explanation, which is the
 * same client asking thousands of times.
 */
export const SCAN_QUOTA_PERSONAL = 30;
export const SCAN_QUOTA_PUBLIC = 500;

// Only ever used to salt a hash that is thrown away within the hour. Set
// SCAN_CLIENT_SALT in the function environment to make the digests unguessable
// to anyone holding a database export; without it the fallback still keeps raw
// addresses out of storage, which is the point, but a determined reader with
// both the source and the data could brute-force the IPv4 space back out.
const CLIENT_SALT = process.env.SCAN_CLIENT_SALT ?? "sekai-beyond-scan-client";

interface ScanRequestLike {
    headers: Record<string, string | string[] | undefined>;
    ip?: string;
}

/**
 * A stable, non-identifying handle for whoever is scanning — the address they
 * reach us from, narrowed to the IPv6 /64 so a client can't rotate through a
 * prefix it was handed for free, plus the user agent so several phones behind
 * one venue NAT aren't collapsed into a single scanner. Hashed, never stored raw.
 *
 * This is a quota key, not an identity: an unreadable address falls back to a
 * shared bucket rather than an exemption, so hiding where you came from costs
 * you the same allowance as everyone else who did.
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
 * Whether this client has already used up its allowance on this subject.
 *
 * The window is part of the document id rather than a field, so each one gets a
 * fresh document and there is no stale-window branch to get wrong — and because
 * Firestore's TTL sweeps lazily (a document can outlive its expiry by hours), a
 * leftover from an old window can never suppress a later scan.
 *
 * Best-effort by design: a read that fails lets the scan through rather than
 * dropping a tally over an unrelated outage.
 */
async function quotaExhausted(ref: FirebaseFirestore.DocumentReference, limit: number): Promise<boolean> {
    try {
        const used = (await ref.get()).data()?.count;
        return typeof used === "number" && used >= limit;
    } catch (err) {
        console.error(`recordScan: quota read failed for ${ref.id}`, err);
        return false;
    }
}

/**
 * Bump a scannable document's counters and log one scan event under its `scans`
 * subcollection.
 *
 * QR codes and passports both write this shape, and that is what lets a single
 * TTL policy cover the whole `scans` collection group and a single chart read it
 * (see fetchScans in app/lib/scans.ts). Keeping the write in one place is what
 * keeps those three in agreement — and is why the per-client quota below covers
 * every scannable thing rather than whichever one was fixed last.
 *
 * `platform` is a QR link's `p` tag, which additionally tallies under
 * `platformScans.<platform>` so click-through can be compared by platform.
 * Passports carry none and pass "", which skips that field and reads as a single
 * series in the chart.
 */
export async function recordScan(
    ref: FirebaseFirestore.DocumentReference,
    {clientKey, quota, platform = ""}: {
        clientKey: string;
        /** SCAN_QUOTA_PERSONAL or SCAN_QUOTA_PUBLIC — see their docs. */
        quota: number;
        platform?: string;
    },
): Promise<void> {
    const window = Math.floor(Date.now() / SCAN_QUOTA_WINDOW_MS);
    const quotaRef = db.collection(QUOTA).doc(
        createHash("sha256").update(`${ref.path}|${clientKey}|${window}`).digest("hex").slice(0, 32),
    );

    if (await quotaExhausted(quotaRef, quota)) {
        // The only interesting scan event is the one that stopped counting: this
        // is the signal a passport is being hammered, and the page still renders.
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
    // Rides along in the same commit rather than costing its own round trip.
    // Two windows' grace on the TTL, matching checkRateLimit.
    batch.set(quotaRef, {
        count: FieldValue.increment(1),
        expiresAt: Timestamp.fromMillis(Date.now() + SCAN_QUOTA_WINDOW_MS * 2),
    }, {merge: true});
    await batch.commit();
}
