import { Timestamp } from "firebase-admin/firestore";
import { onCall } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { requireAdmin, requireAuth } from "../utils/auth";
import { db } from "../utils/firebase";
import { recordDoc, recordRef } from "../utils/records";
import { SITE_TIME_ZONE, siteDay } from "../utils/siteTime";
import { fetchUwEventPricing, fetchUwLots, fetchWalkingTimes, type UwLot, type WalkingTime } from "../utils/uwParking";

// The parking guide's synced copy of UW's data. Publicly readable: it holds only
// what UW already publishes, plus walking times from venues that are public too.
const PARKING_DOC = db.collection("uwParking").doc("current");
// Pause between walking-router calls, to stay well inside FOSSGIS's fair use.
const ROUTER_PAUSE_MS = 1_000;

export interface ParkingSyncSummary {
    lotCount: number;
    pricingDayCount: number;
    walkingVenueCount: number;
    errors: string[];
}

interface VenueWalking {
    /** The venue location these times were measured from. */
    lat: number;
    lng: number;
    lots: Record<string, WalkingTime>;
}

const errorMessage = (err: unknown) => err instanceof Error ? err.message : String(err);
const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Refreshes uwParking/current. Each source is refreshed on its own: one that
 * fails keeps its last good copy and is named in lastRunErrors, so a UW outage
 * leaves the guide on yesterday's data instead of blanking it.
 */
async function runUwParkingSync(): Promise<ParkingSyncSummary> {
    const previous = (await PARKING_DOC.get()).data() ?? {};
    const now = Timestamp.now();
    const errors: string[] = [];
    const update: Record<string, unknown> = {};

    let lots: UwLot[] = Array.isArray(previous.lots) ? previous.lots : [];
    try {
        const fetched = await fetchUwLots();
        lots = fetched.lots;
        Object.assign(update, {lots, lotsGeneratedAt: fetched.generatedAt, lotsSyncedAt: now});
    } catch (err) {
        errors.push(`Lots: ${errorMessage(err)}`);
    }

    let pricingDayCount = Array.isArray(previous.eventPricing) ? previous.eventPricing.length : 0;
    try {
        const pricing = await fetchUwEventPricing(siteDay(Date.now()));
        pricingDayCount = pricing.length;
        Object.assign(update, {eventPricing: pricing, eventPricingSyncedAt: now});
    } catch (err) {
        errors.push(`Event pricing: ${errorMessage(err)}`);
    }

    // Measured from every venue with a location. A venue whose call fails keeps
    // its last times; a deleted venue's are dropped with it.
    const previousWalking = (previous.walking ?? {}) as Record<string, VenueWalking>;
    const walking: Record<string, VenueWalking> = {};
    if (lots.length > 0) {
        const venues = await db.collection("venues").get();
        let calls = 0;
        for (const venue of venues.docs) {
            const {lat, lng, nameEn} = venue.data();
            if (typeof lat !== "number" || typeof lng !== "number" || (lat === 0 && lng === 0)) continue;
            if (calls++ > 0) await pause(ROUTER_PAUSE_MS);
            try {
                walking[venue.id] = {lat, lng, lots: await fetchWalkingTimes({lat, lng}, lots)};
            } catch (err) {
                errors.push(`Walking times for ${nameEn || venue.id}: ${errorMessage(err)}`);
                if (previousWalking[venue.id]) walking[venue.id] = previousWalking[venue.id];
            }
        }
        update.walking = walking;
    }

    Object.assign(update, {lastRunAt: now, lastRunErrors: errors});
    // mergeFields writes each listed field whole, so `walking` loses deleted venues
    // (a plain merge would deep-merge it), and a failed source's fields stay as they were.
    await PARKING_DOC.set(update, {mergeFields: Object.keys(update)});

    return {lotCount: lots.length, pricingDayCount, walkingVenueCount: Object.keys(walking).length, errors};
}

// Daily, after UW regenerates its lot file (about 23:00 UTC, mid-afternoon in Seattle).
// Every source keeps its last good copy on failure, so a retry is always safe.
export const uwParkingNightlySync = onSchedule({
    schedule: "30 17 * * *",
    timeZone: SITE_TIME_ZONE,
    timeoutSeconds: 300,
    memory: "256MiB",
    retryCount: 1,
}, async () => {
    const summary = await runUwParkingSync();
    console.log(`uwParkingNightlySync: lots=${summary.lotCount} pricingDays=${summary.pricingDayCount} ` +
        `venues=${summary.walkingVenueCount}`);
    if (summary.errors.length > 0) console.warn("uwParkingNightlySync: kept the last good copy of", summary.errors);
});

// The same sync on demand, for an admin who has just added or moved a venue.
export const syncUwParking = onCall({maxInstances: 2, timeoutSeconds: 300}, async (request) => {
    const uid = await requireAuth(request);
    const callerSnap = await requireAdmin(uid);
    const summary = await runUwParkingSync();
    await recordRef().set(recordDoc("parking-sync", {
        performedBy: uid,
        performedByName: callerSnap.data()?.displayName ?? "",
        lotCount: summary.lotCount,
    }));
    return summary;
});
