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
    clearanceInches: number | null;
    overflowLots: string[];
    zipcar: boolean;
    ucar: boolean;
    dialARide: boolean;
    /** When visitors can pay to park. Null on a day with no paid hours. */
    paidHours: {weekday: ClockRange | null; saturday: ClockRange | null};
    /** When a permit is required; outside paidHours, a visitor can't park then. */
    permitHours: {weekday: ClockRange | null; saturday: ClockRange | null};
    gateHours: ClockRange | null;
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

interface VenueWalking {
    lat: number;
    lng: number;
    lots: Record<string, WalkingTime>;
}

/**
 * Building footprint polygons mapping ring index to flat `[lng, lat, lng, lat, …]`
 * coordinate lists.
 */
export interface VenueOutline {
    polygons: Record<string, number[]>[];
}

export interface UwParkingData {
    lots: UwLot[];
    lotsGeneratedAt: string;
    eventPricing: UwEventPricing[];
    walking: Record<string, VenueWalking>;
    outlines: Record<string, VenueOutline>;
    lastRunAt: Date | null;
    lastRunErrors: string[];
}

const EMPTY: UwParkingData = {
    lots: [],
    lotsGeneratedAt: '',
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

const LOT_TYPES: Record<string, {en: string; zh: string}> = {
    'Surface Lot': {en: 'Surface lot', zh: '地面停车场'},
    'Garage': {en: 'Garage', zh: '停车楼'},
    'Underground Garage': {en: 'Underground garage', zh: '地下停车库'},
};

export function uwLotTypeLabel(type: string, isEnglish: boolean): string {
    return LOT_TYPES[type]?.[isEnglish ? 'en' : 'zh'] ?? type;
}

export const isGarage = (lot: Pick<UwLot, 'type'>): boolean => /Garage/.test(lot.type);

export const uwLotGlyph = (type: string): string => isGarage({type}) ? 'G' : 'P';

export const walkMinutes = (seconds: number): number => Math.max(1, Math.round(seconds / 60));
