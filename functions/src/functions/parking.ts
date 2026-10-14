import { FieldPath, FieldValue, Timestamp } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { requireAdmin, requireAuth } from "../utils/auth";
import { db } from "../utils/firebase";
import { recordDoc, recordRef } from "../utils/records";
import { SITE_TIME_ZONE, siteDay } from "../utils/siteTime";
import {
    fetchUwBuilding,
    fetchUwBuildingOutline,
    fetchUwEventPricing,
    fetchUwLots,
    fetchWalkingTimes,
    lotCodesInText,
    UW_BUILDING_CODE_RE,
    type UwBuilding,
    type UwBuildingOutline,
    type UwLot,
    type WalkingTime,
} from "../utils/uwParking";

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
// How many walking-nearest lots a building lookup suggests.
const NEAREST_LOT_COUNT = 8;

/** The synced visitor lots, or none before the first sync. */
async function syncedLots(): Promise<UwLot[]> {
    const lots = (await PARKING_DOC.get()).data()?.lots;
    return Array.isArray(lots) ? lots : [];
}

/**
 * Brings a saved venue's walking times and building outline up to date, unless
 * they were already taken from this spot and this building, so a new or changed
 * venue has them before the nightly sync. Does nothing before the first sync.
 */
export async function refreshVenueParking(
    venueId: string,
    venue: {lat: number; lng: number; buildingCode: string},
): Promise<void> {
    const data = (await PARKING_DOC.get()).data();
    if (!data) return;
    const lots: UwLot[] = Array.isArray(data.lots) ? data.lots : [];
    const walking = data.walking?.[venueId] as VenueWalking | undefined;
    const outline = data.outlines?.[venueId] as UwBuildingOutline | undefined;
    const {lat, lng, buildingCode} = venue;

    const refreshWalking = lots.length > 0 && !(lat === 0 && lng === 0)
        && !(walking?.lat === lat && walking?.lng === lng);
    const refreshOutline = (outline?.code ?? "") !== buildingCode;
    const [walkingResult, outlineResult] = await Promise.allSettled([
        refreshWalking ? fetchWalkingTimes({lat, lng}, lots) : null,
        refreshOutline && buildingCode ? fetchUwBuildingOutline(buildingCode) : null,
    ]);

    const updates: [FieldPath, unknown][] = [];
    if (refreshWalking && walkingResult.status === "fulfilled" && walkingResult.value) {
        updates.push([new FieldPath("walking", venueId), {lat, lng, lots: walkingResult.value} satisfies VenueWalking]);
    }
    if (refreshOutline && outlineResult.status === "fulfilled") {
        updates.push([new FieldPath("outlines", venueId), outlineResult.value ?? FieldValue.delete()]);
    }
    if (updates.length > 0) {
        const [[field, value], ...rest] = updates;
        await PARKING_DOC.update(field, value, ...rest.flat());
    }
    // Whatever did refresh is saved; a failed source waits for the nightly sync.
    for (const result of [walkingResult, outlineResult]) {
        if (result.status === "rejected") throw result.reason;
    }
}

/** Drops a deleted venue's walking times and building outline. */
export async function dropVenueParking(venueId: string): Promise<void> {
    const data = (await PARKING_DOC.get()).data();
    const updates = (["walking", "outlines"] as const)
        .filter(field => data?.[field]?.[venueId])
        .map((field): [FieldPath, unknown] => [new FieldPath(field, venueId), FieldValue.delete()]);
    if (updates.length === 0) return;
    const [[field, value], ...rest] = updates;
    await PARKING_DOC.update(field, value, ...rest.flat());
}

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
    const venues = await db.collection("venues").get();
    const previousWalking = (previous.walking ?? {}) as Record<string, VenueWalking>;
    const walking: Record<string, VenueWalking> = {};
    if (lots.length > 0) {
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

    // The footprint of each venue's building, for the guide's venue highlight. Like
    // walking times, a failed lookup keeps the last outline for the same building.
    const previousOutlines = (previous.outlines ?? {}) as Record<string, UwBuildingOutline>;
    const outlines: Record<string, UwBuildingOutline> = {};
    for (const venue of venues.docs) {
        const {buildingCode, nameEn} = venue.data();
        if (typeof buildingCode !== "string" || !buildingCode) continue;
        try {
            const outline = await fetchUwBuildingOutline(buildingCode);
            if (outline) outlines[venue.id] = outline;
        } catch (err) {
            errors.push(`Outline for ${nameEn || venue.id}: ${errorMessage(err)}`);
            if (previousOutlines[venue.id]?.code === buildingCode) outlines[venue.id] = previousOutlines[venue.id];
        }
    }
    update.outlines = outlines;

    Object.assign(update, {lastRunAt: now, lastRunErrors: errors});
    // mergeFields writes each listed field whole, so `walking` and `outlines` lose deleted venues
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

// The same sync on demand, e.g. right after a UW change the nightly run has not picked up yet.
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

/**
 * What the venue editor needs to set a venue up from a UW building code: where
 * the building is, UW's own parking note for it, the visitor lots that note
 * names, and the visitor lots nearest on foot.
 */
export const lookUpUwBuilding = onCall({maxInstances: 5, timeoutSeconds: 60}, async (request) => {
    const uid = await requireAuth(request);
    await requireAdmin(uid);
    const raw = (request.data as {code?: unknown})?.code;
    const code = typeof raw === "string" ? raw.trim().toUpperCase() : "";
    if (!UW_BUILDING_CODE_RE.test(code)) {
        throw new HttpsError("invalid-argument", "Enter a UW building code, like HUB or KNE.");
    }

    let building: UwBuilding | null;
    try {
        building = await fetchUwBuilding(code);
    } catch (err) {
        console.error("lookUpUwBuilding:", code, err);
        throw new HttpsError("unavailable", "UW's building map didn't answer. Try again in a minute.");
    }
    if (!building) throw new HttpsError("not-found", `UW has no Seattle building with the code ${code}.`);

    const lots = await syncedLots();
    const visitorCodes = new Set(lots.map(l => l.code));
    const recommendedLots = lotCodesInText(building.parkingTip).filter(c => visitorCodes.has(c));
    let nearestLots: {code: string; seconds: number; meters: number}[] = [];
    if (lots.length > 0) {
        try {
            const times = await fetchWalkingTimes(building, lots);
            nearestLots = Object.entries(times)
                .map(([lotCode, t]) => ({code: lotCode, ...t}))
                .sort((a, b) => a.seconds - b.seconds)
                .slice(0, NEAREST_LOT_COUNT);
        } catch (err) {
            // The building itself was found; the editor can still be filled in by hand.
            console.warn("lookUpUwBuilding: walking times failed for", code, err);
        }
    }
    return {building, recommendedLots, nearestLots};
});
