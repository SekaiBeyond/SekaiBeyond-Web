import { PUBLIC_ORIGIN } from "./config";

/**
 * Readers for the public data the parking guide is built from. None of these
 * sources is a documented API, so each reader validates what it gets and throws
 * rather than return something half-read; the sync then keeps its last good copy.
 *
 * - UW_LOTS_URL: the JSON behind UW Transportation Services' parking map
 *   (depts.washington.edu/tsevents), regenerated daily around 23:00 UTC.
 * - UW_EVENT_PRICING_URL: the Trumba feed behind UW's event-parking calendar,
 *   which lists the days a flat event rate replaces the usual one.
 * - WALKING_ROUTER_URL: the public OSRM foot router run by FOSSGIS on
 *   OpenStreetMap data. Fair use only, so it is called once per venue per sync.
 */
export const UW_LOTS_URL = "https://depts.washington.edu/tsevents/data/master-data.json";
export const UW_EVENT_PRICING_URL = "https://www.trumba.com/calendars/sea_commute.json";
const WALKING_ROUTER_URL = "https://routing.openstreetmap.de/routed-foot/table/v1/foot/";

// The format UW's own map checks for (EXPECTED_VERSION in its bundle).
const UW_LOTS_VERSION = "1";
// Fewer visitor lots than this means a broken or truncated file, not a real change.
const MIN_VISITOR_LOTS = 10;
const FETCH_TIMEOUT_MS = 20_000;
const USER_AGENT = `SekaiBeyond parking guide (+${PUBLIC_ORIGIN})`;

/** UW facility codes: "N22", "C07-3", "W04V", "TRI". */
export const UW_LOT_CODE_RE = /^[A-Z0-9][A-Z0-9-]{0,11}$/;
/** UW building codes: "HUB", "KNE", "MGH". */
export const UW_BUILDING_CODE_RE = /^[A-Z0-9]{2,8}$/;

// The access levels a visitor can park under; "Permits Only", "Restricted" and
// load zones ("Other") are left out of the guide.
const VISITOR_ACCESS = ["Permits or Pay", "Pay to Park"] as const;
const CLOCK_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export interface ClockRange {
    start: string;
    end: string;
}

export interface UwLot {
    code: string;
    name: string;
    /** As UW words it: "Surface Lot", "Garage" or "Underground Garage". */
    type: string;
    /** UW's campus area: "North", "Central", "South", "East" or "West". */
    area: string;
    lat: number;
    lng: number;
    access: typeof VISITOR_ACCESS[number];
    rates: {hourly: number | null; daily: number | null; night: number | null};
    stalls: {
        standard: number | null;
        compact: number | null;
        accessible: number | null;
        motorcycle: number | null;
        ev: number | null;
    };
    payByPhoneZone: number | null;
    clearanceInches: number | null;
    overflowLots: string[];
    selfServe: boolean;
    zipcar: boolean;
    ucar: boolean;
    dialARide: boolean;
    /** When visitors must pay, as HH:mm on the site clock. Null on a day with no paid hours. */
    paidHours: {weekday: ClockRange | null; saturday: ClockRange | null};
    /** When a gated garage is open, if UW lists it. */
    gateHours: ClockRange | null;
    /** Whether UW's map has a 360° photo tour of the lot. */
    hasTour: boolean;
}

export interface UwEventPricing {
    /** YYYY-MM-DD on the site clock. */
    date: string;
    /** HH:mm, or both null when the rate is in effect all day. */
    start: string | null;
    end: string | null;
    price: number;
    /** True when the rate covers every campus lot; `lots` is then empty. */
    allLots: boolean;
    lots: string[];
    title: string;
}

export interface WalkingTime {
    seconds: number;
    meters: number;
}

async function fetchJson(url: string): Promise<unknown> {
    const res = await fetch(url, {
        headers: {"User-Agent": USER_AGENT, "Accept": "application/json"},
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`${new URL(url).host} answered HTTP ${res.status}`);
    return res.json();
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const num = (v: unknown): number | null => typeof v === "number" && Number.isFinite(v) ? v : null;
const count = (v: unknown): number | null => {
    const n = num(v);
    return n !== null && n >= 0 ? Math.round(n) : null;
};
const text = (v: unknown, maxLen = 120): string => typeof v === "string" ? v.trim().slice(0, maxLen) : "";
const clock = (v: unknown): string | null => typeof v === "string" && CLOCK_RE.test(v) ? v : null;

function clockRange(start: unknown, end: unknown): ClockRange | null {
    const s = clock(start), e = clock(end);
    return s && e ? {start: s, end: e} : null;
}

/** One facility from UW's file as a visitor lot, or null for a permit-only, malformed or unusable one. */
function toVisitorLot(raw: unknown): UwLot | null {
    if (!isRecord(raw)) return null;
    const access = VISITOR_ACCESS.find(a => a === raw.accessRestrictions);
    const code = text(raw.facilityCode, 12).toUpperCase();
    const lat = num(raw.latitude), lng = num(raw.longitude);
    if (!access || !UW_LOT_CODE_RE.test(code) || lat === null || lng === null
        || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
        return null;
    }
    return {
        code,
        name: text(raw.facilityName) || code,
        type: text(raw.facilityType, 40),
        area: text(raw.campusLocation, 20),
        lat,
        lng,
        access,
        rates: {hourly: num(raw.hourlyRate), daily: num(raw.dailyRate), night: num(raw.nightRate)},
        stalls: {
            standard: count(raw.standardStalls),
            compact: count(raw.compactStalls),
            accessible: count(raw.accessibleStalls),
            motorcycle: count(raw.motorcycleStalls),
            ev: count(raw.evStalls),
        },
        payByPhoneZone: count(raw.payByPhoneLocation),
        clearanceInches: count(raw.garageClearanceInches),
        overflowLots: Array.isArray(raw.overflowLots)
            ? raw.overflowLots.map(c => text(c, 12).toUpperCase()).filter(c => UW_LOT_CODE_RE.test(c))
            : [],
        selfServe: raw.selfServeParking === true,
        zipcar: raw.zipcar === true,
        ucar: raw.uCAR === true,
        dialARide: raw.dialARide === true,
        paidHours: {
            weekday: clockRange(raw.payByPhoneWeekdayStart, raw.payByPhoneWeekdayEnd),
            saturday: clockRange(raw.payByPhoneSaturdayStart, raw.payByPhoneSaturdayEnd),
        },
        gateHours: clockRange(raw.physicalAccessStart, raw.physicalAccessEnd),
        hasTour: isRecord(raw.tour) && raw.tour.hasImages === true,
    };
}

/** UW's visitor lots, sorted by code, with the time UW generated the file. */
export async function fetchUwLots(): Promise<{lots: UwLot[]; generatedAt: string}> {
    const raw = await fetchJson(UW_LOTS_URL);
    if (!isRecord(raw) || !Array.isArray(raw.facilities)) {
        throw new Error("UW's lot file has no facilities list");
    }
    if (String(raw.version) !== UW_LOTS_VERSION) {
        throw new Error(`UW's lot file is version ${String(raw.version)}, not ${UW_LOTS_VERSION}`);
    }
    const lots = new Map<string, UwLot>();
    for (const facility of raw.facilities) {
        const lot = toVisitorLot(facility);
        if (lot && !lots.has(lot.code)) lots.set(lot.code, lot);
    }
    if (lots.size < MIN_VISITOR_LOTS) {
        throw new Error(`UW's lot file lists only ${lots.size} visitor lots`);
    }
    return {
        lots: [...lots.values()].sort((a, b) => a.code.localeCompare(b.code)),
        generatedAt: text(raw.generatedAt, 40),
    };
}

// "$14 Event Parking in E01, E17, E18" / "$70 Event Parking in All Campus Lots"
const PRICING_TITLE_RE = /^\$(\d+(?:\.\d{1,2})?)\s+event parking in\s+(.+)$/i;
const FEED_TIME_RE = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/;

/** Event-rate days from `fromDay` (YYYY-MM-DD) on, in date order. */
export async function fetchUwEventPricing(fromDay: string): Promise<UwEventPricing[]> {
    // Twelve months ahead; the feed starts at the current month by default.
    const raw = await fetchJson(`${UW_EVENT_PRICING_URL}?months=12`);
    if (!Array.isArray(raw)) throw new Error("UW's event-parking feed is not a list");

    const days: UwEventPricing[] = [];
    for (const entry of raw) {
        if (!isRecord(entry) || entry.canceled === true) continue;
        const title = text(entry.title, 200);
        const match = PRICING_TITLE_RE.exec(title);
        const start = FEED_TIME_RE.exec(text(entry.startDateTime, 40));
        if (!match || !start || start[1] < fromDay) continue;

        const allDay = entry.allDay === true;
        const endClock = FEED_TIME_RE.exec(text(entry.endDateTime, 40))?.[2] ?? null;
        if (!allDay && !endClock) continue;

        const where = match[2].trim();
        const allLots = /all campus lots/i.test(where);
        const lots = allLots ? [] : where.split(/\s*,\s*|\s+and\s+/)
            .map(c => c.trim().toUpperCase())
            .filter(c => UW_LOT_CODE_RE.test(c));
        if (!allLots && lots.length === 0) continue;

        days.push({
            date: start[1],
            start: allDay ? null : start[2],
            end: allDay ? null : endClock,
            price: Number(match[1]),
            allLots,
            lots,
            title,
        });
    }
    return days.sort((a, b) => a.date.localeCompare(b.date) || (a.start ?? "").localeCompare(b.start ?? ""));
}

/** Walking time and distance from a point to each lot, keyed by lot code. Unroutable lots are left out. */
export async function fetchWalkingTimes(
    origin: {lat: number; lng: number},
    lots: Pick<UwLot, "code" | "lat" | "lng">[],
): Promise<Record<string, WalkingTime>> {
    const coords = [origin, ...lots].map(p => `${p.lng.toFixed(6)},${p.lat.toFixed(6)}`).join(";");
    const raw = await fetchJson(`${WALKING_ROUTER_URL}${coords}?sources=0&annotations=duration,distance`);
    if (!isRecord(raw) || raw.code !== "Ok" || !Array.isArray(raw.durations) || !Array.isArray(raw.distances)) {
        throw new Error("the walking router returned no table");
    }
    const durations = raw.durations[0], distances = raw.distances[0];
    if (!Array.isArray(durations) || !Array.isArray(distances) || durations.length !== lots.length + 1) {
        throw new Error("the walking router returned a table of the wrong size");
    }

    const times: Record<string, WalkingTime> = {};
    lots.forEach((lot, i) => {
        const seconds = num(durations[i + 1]), meters = num(distances[i + 1]);
        if (seconds !== null && meters !== null) {
            times[lot.code] = {seconds: Math.round(seconds), meters: Math.round(meters)};
        }
    });
    return times;
}
