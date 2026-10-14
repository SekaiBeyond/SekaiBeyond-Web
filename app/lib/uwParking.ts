import { doc, getDoc } from 'firebase/firestore';
import { createValueCache, toDate } from './collectionCache';
import { getFirebaseDb } from './firebase';

/**
 * The parking guide's synced copy of UW Transportation Services' parking data
 * (uwParking/current), written nightly by the uwParkingNightlySync function.
 * Mirrors UwLot / UwEventPricing in functions/src/utils/uwParking.ts.
 */

export interface ClockRange {
    /** HH:mm on the site clock. */
    start: string;
    end: string;
}

export interface UwLot {
    code: string;
    name: string;
    /** As UW words it: "Surface Lot", "Garage" or "Underground Garage". */
    type: string;
    area: string;
    lat: number;
    lng: number;
    access: 'Permits or Pay' | 'Pay to Park';
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
    /** When visitors can pay to park. Null on a day with no paid hours. */
    paidHours: {weekday: ClockRange | null; saturday: ClockRange | null};
    /** When a permit is required; outside paidHours, a visitor can't park then. */
    permitHours: {weekday: ClockRange | null; saturday: ClockRange | null};
    gateHours: ClockRange | null;
    hasTour: boolean;
}

export interface UwEventPricing {
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

export interface VenueWalking {
    /** The venue location the times were measured from. */
    lat: number;
    lng: number;
    lots: Record<string, WalkingTime>;
}

/**
 * A venue's building footprint. Each polygon maps ring index to a flat
 * [lng, lat, lng, lat, …] list (Firestore can't nest arrays), outline first.
 */
export interface VenueOutline {
    /** The UW building code it was looked up by. */
    code: string;
    polygons: Record<string, number[]>[];
}

export interface UwParkingData {
    lots: UwLot[];
    /** When UW generated the lot file, as UW writes it. */
    lotsGeneratedAt: string;
    lotsSyncedAt: Date | null;
    eventPricing: UwEventPricing[];
    walking: Record<string, VenueWalking>;
    /** Keyed by venue document ID, like walking. */
    outlines: Record<string, VenueOutline>;
    lastRunAt: Date | null;
    /** Sources the last sync could not refresh; their previous copy was kept. */
    lastRunErrors: string[];
}

const EMPTY: UwParkingData = {
    lots: [],
    lotsGeneratedAt: '',
    lotsSyncedAt: null,
    eventPricing: [],
    walking: {},
    outlines: {},
    lastRunAt: null,
    lastRunErrors: [],
};

const cache = createValueCache<UwParkingData>('uwParking', async () => {
    const snap = await getDoc(doc(getFirebaseDb(), 'uwParking', 'current'));
    const data = snap.data();
    if (!data) return EMPTY;
    return {
        lots: Array.isArray(data.lots) ? data.lots : [],
        lotsGeneratedAt: typeof data.lotsGeneratedAt === 'string' ? data.lotsGeneratedAt : '',
        lotsSyncedAt: toDate(data.lotsSyncedAt),
        eventPricing: Array.isArray(data.eventPricing) ? data.eventPricing : [],
        walking: data.walking && typeof data.walking === 'object' ? data.walking : {},
        outlines: data.outlines && typeof data.outlines === 'object' ? data.outlines : {},
        lastRunAt: toDate(data.lastRunAt),
        lastRunErrors: Array.isArray(data.lastRunErrors) ? data.lastRunErrors.filter((e: unknown) => typeof e === 'string') : [],
    };
}, EMPTY);

export function useUwParking(): {
    parking: UwParkingData;
    loading: boolean;
    failed: boolean;
    refresh: () => Promise<void>
} {
    const {value: parking, loading, error, refresh} = cache.useValue();
    return {parking, loading, failed: error !== null, refresh};
}

/** Localized lot type (e.g. "Underground garage" / "地下停车库"). */
export function uwLotTypeLabel(type: string, isEnglish: boolean): string {
    if (type === 'Underground Garage') return isEnglish ? 'Underground garage' : '地下停车库';
    if (type === 'Garage') return isEnglish ? 'Garage' : '停车楼';
    return isEnglish ? 'Surface lot' : '地面停车场';
}

/** Badge glyph for a lot: G for garages, P for surface lots. */
export const uwLotGlyph = (type: string): string => /Garage/.test(type) ? 'G' : 'P';

/** Whole minutes for a walk, never less than one. */
export const walkMinutes = (seconds: number): number => Math.max(1, Math.round(seconds / 60));
