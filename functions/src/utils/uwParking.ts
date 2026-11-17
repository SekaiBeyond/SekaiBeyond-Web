import { PUBLIC_ORIGIN } from "./config";

const UW_LOTS_URL = "https://depts.washington.edu/tsevents/data/master-data.json";
const UW_EVENT_PRICING_URL = "https://www.trumba.com/calendars/sea_commute.json";
const WALKING_ROUTER_URL = "https://routing.openstreetmap.de/routed-foot/table/v1/foot/";

const UW_LOTS_VERSION = "1";
const MIN_VISITOR_LOTS = 10;
const FETCH_TIMEOUT_MS = 20_000;
const USER_AGENT = `SekaiBeyond parking guide (+${PUBLIC_ORIGIN})`;

export const UW_LOT_CODE_RE = /^[A-Z0-9][A-Z0-9-]{0,11}$/;
export const UW_BUILDING_CODE_RE = /^[A-Z0-9]{2,8}$/;

const VISITOR_ACCESS = ["Permits or Pay", "Pay to Park"] as const;
const CLOCK_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

interface ClockRange {
    start: string;
    end: string;
}

export interface UwLot {
    code: string;
    name: string;
    type: string;
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
    clearanceInches: number | null;
    overflowLots: string[];
    zipcar: boolean;
    ucar: boolean;
    dialARide: boolean;
    paidHours: {weekday: ClockRange | null; saturday: ClockRange | null};
    permitHours: {weekday: ClockRange | null; saturday: ClockRange | null};
    gateHours: ClockRange | null;
}

interface UwEventPricing {
    date: string;
    start: string | null;
    end: string | null;
    price: number;
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
        clearanceInches: count(raw.garageClearanceInches),
        overflowLots: Array.isArray(raw.overflowLots)
            ? raw.overflowLots.map(c => text(c, 12).toUpperCase()).filter(c => UW_LOT_CODE_RE.test(c))
            : [],
        zipcar: raw.zipcar === true,
        ucar: raw.uCAR === true,
        dialARide: raw.dialARide === true,
        paidHours: {
            weekday: clockRange(raw.payByPhoneWeekdayStart, raw.payByPhoneWeekdayEnd),
            saturday: clockRange(raw.payByPhoneSaturdayStart, raw.payByPhoneSaturdayEnd),
        },
        permitHours: {
            weekday: clockRange(raw.permitWeekdayStart, raw.permitWeekdayEnd),
            saturday: clockRange(raw.permitSaturdayStart, raw.permitSaturdayEnd),
        },
        gateHours: clockRange(raw.physicalAccessStart, raw.physicalAccessEnd),
    };
}

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

const PRICING_TITLE_RE = /^\$(\d+(?:\.\d{1,2})?)\s+event parking in\s+(.+)$/i;
const LOT_LIST_SEPARATOR_RE = /\s*(?:,|&|\band\b)\s*/i;
const FEED_TIME_RE = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/;
const MAX_PRICING_DAYS = 31;

function addDays(date: string, n: number): string {
    const [y, m, d] = date.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

export async function fetchUwEventPricing(fromDay: string): Promise<UwEventPricing[]> {
    const raw = await fetchJson(`${UW_EVENT_PRICING_URL}?months=12`);
    if (!Array.isArray(raw)) throw new Error("UW's event-parking feed is not a list");

    const days: UwEventPricing[] = [];
    for (const entry of raw) {
        if (!isRecord(entry) || entry.canceled === true) continue;
        const title = text(entry.title, 200);
        const match = PRICING_TITLE_RE.exec(title);
        const start = FEED_TIME_RE.exec(text(entry.startDateTime, 40));
        const end = FEED_TIME_RE.exec(text(entry.endDateTime, 40));
        if (!match || !start) continue;

        const allDay = entry.allDay === true;
        if ((!allDay && !end) || (end && end[1] < start[1])) continue;

        const where = match[2].trim();
        const allLots = /all campus lots/i.test(where);
        const lots = allLots ? [] : where.split(LOT_LIST_SEPARATOR_RE)
            .map(c => c.trim().toUpperCase())
            .filter(c => UW_LOT_CODE_RE.test(c));
        if (!allLots && lots.length === 0) continue;

        const firstDay = start[1];
        const [endDay, endClock] = end ? [end[1], end[2]] : [addDays(firstDay, 1), "00:00"];
        const lastDay = endClock === "00:00" && endDay > firstDay ? addDays(endDay, -1) : endDay;
        const covered: string[] = [];
        for (let day = firstDay; day <= lastDay && covered.length <= MAX_PRICING_DAYS; day = addDays(day, 1)) {
            covered.push(day);
        }
        if (covered.length > MAX_PRICING_DAYS) continue;

        for (const day of covered) {
            if (day < fromDay) continue;
            const from = allDay || day !== firstDay ? "00:00" : start[2];
            const to = allDay || day !== endDay ? "00:00" : endClock;
            if (to !== "00:00" && to <= from) continue;
            const wholeDay = from === "00:00" && to === "00:00";
            days.push({
                date: day,
                start: wholeDay ? null : from,
                end: wholeDay ? null : to,
                price: Number(match[1]),
                allLots,
                lots,
                title,
            });
        }
    }
    return days.sort((a, b) => a.date.localeCompare(b.date) || (a.start ?? "").localeCompare(b.start ?? ""));
}

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

const UW_GIS = "https://gis.maps.uw.edu/federated/rest/services";
const UW_BUILDINGS_LAYER = `${UW_GIS}/BaseComponents/UW_Seattle_Buildings_and_Paths/FeatureServer/1/query`;
const UW_BUILDING_INFO_LAYER = `${UW_GIS}/PublicData/PUBLIC_ADA/MapServer/6/query`;

export interface UwBuilding {
    code: string;
    name: string;
    address: string;
    lat: number;
    lng: number;
    parkingTip: string;
}

export function lotCodesInText(note: string): string[] {
    const codes: string[] = [];
    const add = (letter: string, n: number) => {
        const code = `${letter}${String(n).padStart(2, "0")}`;
        if (!codes.includes(code)) codes.push(code);
    };
    for (const m of note.toUpperCase().matchAll(/\b([CENSW])(\d{1,2})(?:\s*[-–]\s*\1?(\d{1,2}))?\b/g)) {
        const from = Number(m[2]);
        const to = m[3] ? Number(m[3]) : from;
        if (to < from || to - from > 10) continue;
        for (let n = from; n <= to; n++) add(m[1], n);
    }
    return codes;
}

function ringCentroid(ring: unknown): {area: number; x: number; y: number} | null {
    if (!Array.isArray(ring) || ring.length < 4) return null;
    let a = 0, cx = 0, cy = 0;
    for (let i = 0; i + 1 < ring.length; i++) {
        const p = ring[i], q = ring[i + 1];
        if (!Array.isArray(p) || !Array.isArray(q)) return null;
        const [x1, y1, x2, y2] = [num(p[0]), num(p[1]), num(q[0]), num(q[1])];
        if (x1 === null || y1 === null || x2 === null || y2 === null) return null;
        const c = x1 * y2 - x2 * y1;
        a += c;
        cx += (x1 + x2) * c;
        cy += (y1 + y2) * c;
    }
    if (a === 0) return null;
    return {area: Math.abs(a / 2), x: cx / (3 * a), y: cy / (3 * a)};
}

async function fetchBuildingFeatures(code: string): Promise<Record<string, unknown>[]> {
    const query = new URLSearchParams({
        where: `FacCode='${code}' AND FeatureStatus='Active'`,
        outFields: "FacCode,FacName,Address",
        outSR: "4326",
        f: "geojson",
    });
    const buildings = await fetchJson(`${UW_BUILDINGS_LAYER}?${query}`);
    if (!isRecord(buildings) || !Array.isArray(buildings.features)) {
        throw new Error("UW's building layer returned no features list");
    }
    return buildings.features.filter(isRecord);
}

function polygonsOf(feature: Record<string, unknown>): unknown[][] {
    const geometry = feature.geometry;
    if (!isRecord(geometry) || !Array.isArray(geometry.coordinates)) return [];
    if (geometry.type === "Polygon") return [geometry.coordinates];
    if (geometry.type === "MultiPolygon") return geometry.coordinates.filter(Array.isArray);
    return [];
}

export async function fetchUwBuilding(code: string): Promise<UwBuilding | null> {
    if (!UW_BUILDING_CODE_RE.test(code)) return null;
    const infoQuery = new URLSearchParams({
        where: `FacilityCode='${code}'`,
        outFields: "Parking",
        returnGeometry: "false",
        f: "json",
    });
    const [features, info] = await Promise.all([
        fetchBuildingFeatures(code),
        fetchJson(`${UW_BUILDING_INFO_LAYER}?${infoQuery}`).catch(() => null),
    ]);

    let name = "", address = "", area = 0, x = 0, y = 0;
    for (const feature of features) {
        const props = isRecord(feature.properties) ? feature.properties : {};
        name ||= text(props.FacName);
        address ||= text(props.Address, 200);
        for (const polygon of polygonsOf(feature)) {
            const c = ringCentroid(polygon[0]);
            if (!c) continue;
            area += c.area;
            x += c.x * c.area;
            y += c.y * c.area;
        }
    }
    if (area === 0) return null;

    const attributes = isRecord(info) && Array.isArray(info.features) && isRecord(info.features[0])
    && isRecord(info.features[0].attributes) ? info.features[0].attributes : {};
    return {
        code,
        name: name || code,
        address,
        lat: Number((y / area).toFixed(6)),
        lng: Number((x / area).toFixed(6)),
        parkingTip: text(attributes.Parking, 300),
    };
}

export interface UwBuildingOutline {
    code: string;
    polygons: Record<string, number[]>[];
}

const roundCoord = (n: number) => Math.round(n * 1e6) / 1e6;

export async function fetchUwBuildingOutline(code: string): Promise<UwBuildingOutline | null> {
    if (!UW_BUILDING_CODE_RE.test(code)) return null;
    const polygons: Record<string, number[]>[] = [];
    for (const feature of await fetchBuildingFeatures(code)) {
        for (const polygon of polygonsOf(feature)) {
            const rings: Record<string, number[]> = {};
            polygon.forEach((ring, i) => {
                if (!Array.isArray(ring) || ring.length < 4) return;
                const flat: number[] = [];
                for (const point of ring) {
                    const lng = Array.isArray(point) ? num(point[0]) : null;
                    const lat = Array.isArray(point) ? num(point[1]) : null;
                    if (lng === null || lat === null) return;
                    flat.push(roundCoord(lng), roundCoord(lat));
                }
                rings[String(i)] = flat;
            });
            if (rings["0"]) polygons.push(rings);
        }
    }
    return polygons.length > 0 ? {code, polygons} : null;
}
